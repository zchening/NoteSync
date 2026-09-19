// NoteSync v10.0.0 安全面 E2E：真 server.js + 独立数据目录。
// 覆盖：写入凭据三态、**认领只能发生在无正文时（闸 R2-H1 的 P0 回归）**、改口令原子换绑、
// 伪造旧凭据夺注、历史侧门同判据、/api/upsign（simple 请求拦截 / 签名可复算 / 配额按 IP 不可绕）、
// 未认领凭据哈希不出门、笔记名扫描守卫、模式热切换。
// 纪律：不起浏览器；模式靠「每档一个实例」隔离，绕开 wkMode 的 5 秒缓存；不依赖定值 sleep 判绿。
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { spawn } = require('child_process');
const crypto = require('crypto');
const os = require('os');
const fs = require('fs');
const path = require('path');

const SERVER = path.resolve(__dirname, '..', '..', 'server.js');
const sha256hex = s => crypto.createHash('sha256').update(s).digest('hex');
const srvs = [];

function boot(port, env) {
  const data = path.join(os.tmpdir(), 'ns-v1000-' + port + '-' + Date.now());
  fs.mkdirSync(path.join(data, 'notes'), { recursive: true });
  const proc = spawn(process.execPath, [SERVER], {
    env: Object.assign({}, process.env, { PORT: String(port), NOTESYNC_DATA_DIR: data }, env || {}),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stderr.on('data', () => {});
  srvs.push(proc);
  return { base: 'http://127.0.0.1:' + port + '/', data };
}
function waitUp(port) {
  const deadline = Date.now() + 8000;
  return (async () => {
    while (Date.now() < deadline) {
      try { const r = await fetch('http://127.0.0.1:' + port + '/healthz'); if (r.ok) return; } catch (e) {}
      await new Promise(r => setTimeout(r, 120));
    }
    throw new Error('server :' + port + ' 8 秒内未监听');
  })();
}
const ip = n => ({ 'X-Forwarded-For': '203.0.113.' + n });
const put = (base, name, body, hdrs) => fetch(base + 'api/note/' + name, Object.assign({ method: 'PUT', headers: Object.assign({ 'Content-Type': 'application/json' }, hdrs || {}) }, { body: JSON.stringify(body) }));
const get = (base, name, hdrs) => fetch(base + 'api/note/' + name, Object.assign({ cache: 'no-store', headers: hdrs || {} }));
// 空正文=「落盐/新建」形态，只有这种写入才允许登记凭据（闸 R2-H1）
const emptyBody = () => ({ ct: '', iv: '', salt: 'c2FsdHNhbHRzYWx0MTIzNA==' });
const noteBody = t => ({ ct: t || 'AAAA', iv: 'CgAAAAAAAAAAAAAAAA==', salt: 'c2FsdHNhbHRzYWx0MTIzNA==' });
const readNoteFile = (srv, name) => JSON.parse(fs.readFileSync(path.join(srv.data, 'notes', name + '.json'), 'utf8'));

let OFF, NEWONLY, FULL, SIGN, NOSIGN;
before(async () => {
  OFF = boot(19311, {});
  NEWONLY = boot(19312, { NOTESYNC_WK_MODE: 'new-only' });
  FULL = boot(19313, { NOTESYNC_WK_MODE: 'full' });
  SIGN = boot(19314, { CLOUDINARY_CLOUD: 'demo123', CLOUDINARY_KEY: '163685468839222', CLOUDINARY_SECRET: 'unit-secret-xyz', CLOUDINARY_FOLDER: 'notesync', CLOUDINARY_PRESET: 'notesync-signed' });
  NOSIGN = boot(19315, {});
  await Promise.all([19311, 19312, 19313, 19314, 19315].map(waitUp));
});
after(() => { srvs.forEach(p => { try { p.kill(); } catch (e) {} }); });

test('V10-1 off 档：不带凭据的旧客户端写入行为与今天逐字相同', async () => {
  const r = await put(OFF.base, 'legacyA', noteBody('x'), ip(1));
  assert.strictEqual(r.status, 200);
  assert.strictEqual((await r.json()).v, 1);
});

test('V10-2 无正文时认领：只落哈希，且哈希与「是否已认领」都不出门', async () => {
  const wkA = 'A'.repeat(43);
  assert.strictEqual((await put(OFF.base, 'claimed1', emptyBody(), Object.assign({ 'x-note-key': wkA }, ip(2)))).status, 200);
  assert.strictEqual(readNoteFile(OFF, 'claimed1').wkHash, sha256hex(wkA), '应存 sha256(凭据) 而非凭据本身');
  const gj = await (await get(OFF.base, 'claimed1', ip(2))).json();
  assert.ok(!('wkHash' in gj), 'GET 绝不能带出凭据哈希');
  for (const k of ['v', 'ct', 'iv', 'salt']) assert.ok(k in gj, '旧客户端依赖的形状缺字段 ' + k);
  // 认领后带对凭据继续写：正常
  assert.strictEqual((await put(OFF.base, 'claimed1', noteBody('c1'), Object.assign({ 'x-note-key': wkA }, ip(2)))).status, 200);
  assert.strictEqual(readNoteFile(OFF, 'claimed1').ct, 'c1');
});

test('V10-3 错凭据在 new-only/full 档被拒；off 档照常放行（守"与今天逐字相同"）', async () => {
  const wkA = 'A'.repeat(43), wkB = 'B'.repeat(43);
  assert.strictEqual((await put(FULL.base, 'swapme', emptyBody(), Object.assign({ 'x-note-key': wkA }, ip(3)))).status, 200);
  const bad = await put(FULL.base, 'swapme', noteBody('s2'), Object.assign({ 'x-note-key': wkB }, ip(3)));
  assert.strictEqual(bad.status, 403);
  assert.strictEqual((await bad.json()).error, 'forbidden');
  // 复核②：off 档不得发任何锁——错凭据也照写，否则「发布置 off 时行为与今天逐字相同」这句是假的
  assert.strictEqual((await put(OFF.base, 'offnote', emptyBody(), Object.assign({ 'x-note-key': wkA }, ip(3)))).status, 200);
  assert.strictEqual((await put(OFF.base, 'offnote', noteBody('byB'), Object.assign({ 'x-note-key': wkB }, ip(3)))).status, 200, 'off 档错凭据不得拒写');
  assert.strictEqual(readNoteFile(OFF, 'offnote').wkHash, sha256hex(wkA), 'off 档错凭据不能改写已登记的哈希');
});

test('V10-3b 【B1 已知代价 + 恢复通道】抢注可发生，删掉 wkHash 即恢复', async () => {
  const wkOwn = 'M'.repeat(43), wkAtk = 'N'.repeat(43);
  assert.strictEqual((await put(OFF.base, 'salted', emptyBody(), ip(18))).status, 200); // 真主落盐（老流程不带凭据）
  // 攻击者抢先登记：B1 明确允许「未认领档接受第一次登记」，代价就是这一种抢注
  assert.strictEqual((await put(OFF.base, 'salted', emptyBody(), Object.assign({ 'x-note-key': wkAtk }, ip(18)))).status, 200);
  assert.strictEqual(readNoteFile(OFF, 'salted').wkHash, sha256hex(wkAtk), 'B1 允许首次登记=也允许抢注，这是换取存量保护的明确代价');
  // README「手工解除认领」那条必须真的有效：删掉 wkHash → 真主重新写入并重新登记
  const f = path.join(OFF.data, 'notes', 'salted.json');
  const rec = JSON.parse(fs.readFileSync(f, 'utf8')); delete rec.wkHash; fs.writeFileSync(f, JSON.stringify(rec));
  assert.strictEqual((await put(OFF.base, 'salted', noteBody('by-owner'), Object.assign({ 'x-note-key': wkOwn }, ip(18)))).status, 200, '手工解除后真主必须能写');
  assert.strictEqual(readNoteFile(OFF, 'salted').wkHash, sha256hex(wkOwn), '恢复后由真主重新登记');
  assert.strictEqual(readNoteFile(OFF, 'salted').ct, 'by-owner', '恢复过程不得丢正文');
});

test('V10-4 改口令原子换绑：出示旧凭据即换绑，旧凭据随即失效', async () => {
  const wkOld = 'A'.repeat(43), wkNew = 'D'.repeat(43); // wkOld 必须与 V10-3 认领那把同源
  const r = await put(FULL.base, 'swapme', Object.assign(noteBody('after'), { wkOld: wkOld }), Object.assign({ 'x-note-key': wkNew }, ip(4)));
  assert.strictEqual(r.status, 200, '带旧凭据自证的换绑必须被接受');
  assert.strictEqual(readNoteFile(FULL, 'swapme').wkHash, sha256hex(wkNew), '哈希应已换到新凭据');
  assert.strictEqual((await put(FULL.base, 'swapme', noteBody('x'), Object.assign({ 'x-note-key': wkOld }, ip(4)))).status, 403, '换绑后旧凭据必须失效');
});

test('V10-5 伪造旧凭据不能夺走已认领笔记', async () => {
  const r = await put(FULL.base, 'swapme', Object.assign(noteBody('hijack'), { wkOld: 'Z'.repeat(43) }), Object.assign({ 'x-note-key': 'E'.repeat(43) }, ip(5)));
  assert.strictEqual(r.status, 403);
  assert.strictEqual(readNoteFile(FULL, 'swapme').ct, 'after', '正文不能被改写');
});

test('V10-6 【B1 核心承诺】真主认领后防护不可被卸掉', async () => {
  const wkOwn = 'A'.repeat(43), wkAtk = 'K'.repeat(43);
  // 自建一篇、自己认领，不依赖其它用例的执行顺序
  assert.strictEqual((await put(FULL.base, 'b1note', emptyBody(), Object.assign({ 'x-note-key': wkOwn }, ip(6)))).status, 200);
  assert.strictEqual(readNoteFile(FULL, 'b1note').wkHash, sha256hex(wkOwn), '前置：真主已认领');
  // ① 错凭据写不进去
  assert.strictEqual((await put(FULL.base, 'b1note', noteBody('atk'), Object.assign({ 'x-note-key': wkAtk }, ip(6)))).status, 403, '错凭据必须被拒');
  // ② 也换不掉、清不掉已登记的哈希——否则撞几下就卸掉防护，保护退化成防手滑的摆设
  const after = readNoteFile(FULL, 'b1note');
  assert.strictEqual(after.wkHash, sha256hex(wkOwn), '错凭据不得改写或抹掉哈希（不可被卸掉）');
  assert.notStrictEqual(after.ct, 'atk', '正文不得被错凭据写入改掉');
  // ③ 无凭据写入同样被硬拒 = 保护是真的
  assert.strictEqual((await put(FULL.base, 'b1note', noteBody('bare'), ip(6))).status, 403, 'full 档无凭据不得绕过已认领的闸');
  assert.strictEqual(readNoteFile(FULL, 'b1note').ct, '', '三轮攻击后正文应仍是真主那份');
  // ④ 真主自己照常能写
  assert.strictEqual((await put(FULL.base, 'b1note', noteBody('mine'), Object.assign({ 'x-note-key': wkOwn }, ip(6)))).status, 200);
});

test('V10-7 new-only 档：真新建必须带凭据，存量宽限照旧放行', async () => {
  assert.strictEqual((await put(NEWONLY.base, 'brandnew', noteBody('n'), ip(7))).status, 403, '无凭据新建必须被拒');
  assert.strictEqual((await put(NEWONLY.base, 'legacyC', noteBody('l'), Object.assign({ 'x-note-key': 'F'.repeat(43) }, ip(7)))).status, 200, '带凭据新建必须成功');
  assert.strictEqual((await put(NEWONLY.base, 'legacyC', noteBody('l2'), ip(7))).status, 200, 'new-only 不得挡存量写入');
});

test('V10-8 full 档：已认领笔记无凭据一律拒；未认领存量不误伤（不能把用户关在门外）', async () => {
  assert.strictEqual((await put(FULL.base, 'f1', emptyBody(), Object.assign({ 'x-note-key': 'G'.repeat(43) }, ip(8)))).status, 200);
  const r = await put(FULL.base, 'f1', noteBody('o2'), ip(8));
  assert.strictEqual(r.status, 403);
  assert.strictEqual((await r.json()).mode, 'full');
  // 未认领的存量笔记在 full 档仍放行：宁可少挡，也不制造不可自愈的锁死。
  // 直接落一份老数据模拟（full 档下无凭据新建本就被拒，不能用 API 造）。
  fs.writeFileSync(path.join(FULL.data, 'notes', 'f-legacy.json'),
    JSON.stringify({ v: 1, ct: 'old', iv: 'CgAAAAAAAAAAAAAAAA==', salt: 'c2FsdHNhbHRzYWx0MTIzNA==', updatedAt: Date.now() }));
  assert.strictEqual((await put(FULL.base, 'f-legacy', noteBody('x'), ip(8))).status, 200, '未认领存量不得被 full 档误伤');
});

test('V10-9 历史侧门与主写入同判据 + 孤儿历史不落盘', async () => {
  const noKey = await fetch(FULL.base + 'api/note/f1/history', { method: 'PUT', headers: Object.assign({ 'Content-Type': 'application/json' }, ip(9)), body: JSON.stringify({ ct: 'QQ', iv: 'CgAAAAAAAAAAAAAAAA==' }) });
  assert.strictEqual(noKey.status, 403, 'full 档无凭据追加历史必须被拒');
  const offInst = await fetch(OFF.base + 'api/note/ghostnote/history', { method: 'PUT', headers: Object.assign({ 'Content-Type': 'application/json' }, ip(9)), body: JSON.stringify({ ct: 'QQ', iv: 'CgAAAAAAAAAAAAAAAA==' }) });
  assert.strictEqual(offInst.status, 200, 'off 档行为保持与今天一致');
  const orphan = await fetch(FULL.base + 'api/note/ghost2/history', { method: 'PUT', headers: Object.assign({ 'Content-Type': 'application/json', 'x-note-key': 'H'.repeat(43) }, ip(9)), body: JSON.stringify({ ct: 'QQ', iv: 'CgAAAAAAAAAAAAAAAA==' }) });
  assert.strictEqual(orphan.status, 403, '笔记档不存在时不得凭空建出 .hist.json（磁盘填充面）');
});

test('V10-10 签发端点：simple 请求被拒、签名可复算、字段齐全', async () => {
  const simple = await fetch(SIGN.base + 'api/upsign', { method: 'POST', headers: ip(10), body: '{}' });
  assert.strictEqual(simple.status, 400, '不带 JSON content-type 的跨域 simple 请求必须被拒');
  const j = await (await fetch(SIGN.base + 'api/upsign', { method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json' }, ip(10)), body: JSON.stringify({ note: 'claimed1' }) })).json();
  for (const k of ['cloud_name', 'api_key', 'timestamp', 'signature', 'upload_preset', 'folder']) assert.ok(k in j, '缺响应字段 ' + k);
  const expect = crypto.createHash('sha1').update('folder=' + j.folder + '&timestamp=' + j.timestamp + '&upload_preset=' + j.upload_preset + 'unit-secret-xyz').digest('hex');
  assert.strictEqual(j.signature, expect, '签名必须与 Cloudinary 规则逐字可复算');
});

test('V10-11 签发配额按 IP 计，换假笔记名不能绕过（闸 R2-A 回归）', async () => {
  let hit429 = 0, calls = 0;
  for (let i = 0; i < 30; i++) {
    calls++;
    const r = await fetch(SIGN.base + 'api/upsign', { method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json' }, ip(11)), body: JSON.stringify({ note: 'fake' + i }) }); // 每次换名字
    if (r.status === 429) { hit429 = calls; break; }
    assert.strictEqual(r.status, 200);
  }
  assert.ok(hit429 > 0, '同一 IP 连打 30 次必须触发 429——若没触发说明配额仍可被换名绕过');
  assert.ok(hit429 <= UPSIGN_MAX_SEEN, '第 ' + hit429 + ' 次才 429，超过默认 20/分的合理边界');
  const other = await fetch(SIGN.base + 'api/upsign', { method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json' }, ip(12)), body: '{}' });
  assert.strictEqual(other.status, 200, '配额按 IP 隔离，不应误伤他人');
  const nosign = await fetch(NOSIGN.base + 'api/upsign', { method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json' }, ip(13)), body: '{}' });
  assert.strictEqual(nosign.status, 503, '未配置云端 secret 时应降级 503，而不是崩或假装签发');
});
const UPSIGN_MAX_SEEN = 21; // 默认 20/分，第 21 次必被拒

test('V10-12 凭据失败只挡写不挡读（闸 R2-B 回归）', async () => {
  const wkBad = 'Q'.repeat(43);
  // 错凭据在 off 档不再被拒（那是本版刻意守住的「与今天逐字相同」），故必须在 full 档造失败
  assert.strictEqual((await put(FULL.base, 'floodme', emptyBody(), Object.assign({ 'x-note-key': 'W'.repeat(43) }, ip(14)))).status, 200);
  for (let i = 0; i < 5; i++) {
    assert.strictEqual((await put(FULL.base, 'floodme', noteBody('x'), Object.assign({ 'x-note-key': wkBad }, ip(14)))).status, 403);
  }
  const g = await get(FULL.base, 'floodme', ip(14));
  assert.strictEqual(g.status, 200, '凭据失败绝不能牵连 GET——否则旧客户端连自己的笔记都看不到');
});

test('V10-13 笔记名扫描守卫：连探不存在的名字会被拦', async () => {
  let blocked = false;
  for (let i = 0; i < 100; i++) {
    const r = await get(OFF.base, 'zznosuch' + i, ip(15));
    if (r.status === 429) { blocked = true; break; }
  }
  assert.ok(blocked, '100 次不存在名字的探测应触发 429');
  assert.strictEqual((await get(OFF.base, 'legacyA', ip(16))).status, 200, '守卫按 IP 计，不应误伤他人');
});

test('V10-14 模式热切换：写 data/wk-mode.txt 即改档（不必重启服务）', async () => {
  // 先以 off 档「无正文认领」建立一篇已认领笔记——full 档只挡已认领的，未认领存量按 V10-8 不误伤
  assert.strictEqual((await put(OFF.base, 'hot1', emptyBody(), Object.assign({ 'x-note-key': 'J'.repeat(43) }, ip(17)))).status, 200);
  assert.strictEqual((await put(OFF.base, 'hot1', noteBody('h'), ip(17))).status, 200, 'off 档：已认领笔记无凭据仍可写');
  fs.writeFileSync(path.join(OFF.data, 'wk-mode.txt'), 'full');
  const deadline = Date.now() + 12000;
  let st = 200;
  while (Date.now() < deadline) { // 轮询到生效为止（wkMode 有 5 秒缓存），绝不定值 sleep 判绿
    st = (await put(OFF.base, 'hot1', noteBody('h2'), ip(17))).status;
    if (st === 403) break;
    await new Promise(r => setTimeout(r, 250));
  }
  assert.strictEqual(st, 403, '热切到 full 后，已认领笔记的无凭据写入应被拒');
  fs.writeFileSync(path.join(OFF.data, 'wk-mode.txt'), 'off');
});

test('V10-15 认领端点：纯登记不建档不改版本，换人必须被拒', async () => {
  const claim = (base, name, wk, ipN) => fetch(base + 'api/note/' + name + '/claim', {
    method: 'POST',
    headers: Object.assign({ 'Content-Type': 'application/json' }, wk ? { 'x-note-key': wk } : {}, ip(ipN)),
    body: '{}',
  });
  const wkOwn = 'R'.repeat(43), wkOther = 'S'.repeat(43);
  // 上一条用例刚把 wk-mode.txt 从 full 拨回 off，而 wkMode 有 5 秒缓存：
  // 轮询到该实例真的回到 off 再继续（本仓 e2e 铁律——不用定值 sleep 判绿）。
  const offDeadline = Date.now() + 12000;
  while (Date.now() < offDeadline) {
    if ((await put(OFF.base, 'mode-probe', noteBody('p'), ip(19))).status === 200) break;
    await new Promise(r => setTimeout(r, 250));
  }
  assert.strictEqual((await claim(OFF.base, 'nope-not-here', wkOwn, 19)).status, 404, '认领不建档：名字不存在必须 404');
  assert.strictEqual((await put(OFF.base, 'clm', noteBody('v1-content'), ip(19))).status, 200);
  assert.strictEqual((await claim(OFF.base, 'clm', null, 19)).status, 400, '不带凭据的认领请求必须 400');
  const before = readNoteFile(OFF, 'clm');
  assert.strictEqual((await claim(OFF.base, 'clm', wkOwn, 19)).status, 200, '未认领档必须认领成功');
  const after = readNoteFile(OFF, 'clm');
  assert.strictEqual(after.wkHash, sha256hex(wkOwn), '应登记 sha256(凭据)');
  assert.strictEqual(after.v, before.v, '认领不得递增版本');
  assert.strictEqual(after.ct, before.ct, '认领不得改动正文');
  assert.strictEqual(after.salt, before.salt, '认领不得改动盐');
  assert.strictEqual((await claim(OFF.base, 'clm', wkOwn, 19)).status, 200, '重复认领必须幂等');
  assert.strictEqual(readNoteFile(OFF, 'clm').v, before.v, '幂等认领同样不动版本');
  assert.strictEqual((await claim(OFF.base, 'clm', wkOther, 19)).status, 403, '已认领后换人必须被拒');
  assert.strictEqual(readNoteFile(OFF, 'clm').wkHash, sha256hex(wkOwn), '被拒的认领请求不得改写哈希');
});
