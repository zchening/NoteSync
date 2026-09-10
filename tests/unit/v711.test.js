// v7.1.1 单元测试——note_image（本机图直传 Cloudinary 插 <img>）、note_remind op 四模式
// （add 回写正文行 / list / cancel / clear）、normDecorHtml 保留 img src、README 条目把关。
// 结构沿 v71.test.js（源码断言 + jsdom loadApp + fetch mock 行为测试）。
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { webcrypto } = require('node:crypto');
const { loadApp } = require('../helpers');

const SRC = fs.readFileSync(path.resolve(__dirname, '..', '..', 'index.html'), 'utf8');
const MCP_SRC = fs.readFileSync(path.resolve(__dirname, '..', '..', 'tools', 'notesync-mcp-server.js'), 'utf8');
const README = fs.readFileSync(path.resolve(__dirname, '..', '..', 'README.md'), 'utf8');

// 口令先设再 require（getKeyFor 用 PASSPHRASE 派生密钥；require.main!==module 不起 stdio）
process.env.NOTESYNC_PASSPHRASE = 'test-pass-v711';
const mcp = require(path.resolve(__dirname, '..', '..', 'tools', 'notesync-mcp-server.js'));
const NOTE = 'testnote';

// ── 从 index.html 源码抽取 web fmtRemInsert 实函数（防两处格式漂移，对抗审 P2-10 采纳） ──
const mWeb = SRC.match(/function fmtRemInsert\(at\) \{[\s\S]*?\n\}/);
assert.ok(mWeb, 'index.html 应有 fmtRemInsert 函数');
const webFmtRemInsert = (new Function(mWeb[0] + '; return fmtRemInsert;'))();

// ── fetch mock：Cloudinary / GET note / PUT note 三路 ──
const jsonResp = (status, obj) => ({ ok: status >= 200 && status < 300, status, json: async () => obj });
function makeFetch(state) {
  return async (url, opts = {}) => {
    const u = String(url);
    if (u.startsWith('https://api.cloudinary.com')) {
      state.cloudCalls += 1;
      const spec = state.cloudinary.shift() || {};
      return jsonResp(spec.status || 200, spec.body !== undefined ? spec.body
        : { secure_url: 'https://res.cloudinary.com/dntsgx6t3/image/upload/v1/img_' + state.cloudCalls + '.png' });
    }
    if (u.endsWith('/api/note/' + NOTE) && (!opts.method || opts.method === 'GET')) {
      return jsonResp(200, { v: state.v, ct: state.ct, iv: state.iv, salt: state.salt, rem: state.rem });
    }
    if (u.endsWith('/api/note/' + NOTE) && opts.method === 'PUT') {
      const body = JSON.parse(opts.body);
      state.putLog.push(body);
      if (state.put409 && state.putLog.length <= state.put409) return jsonResp(409, { error: 'version conflict', v: state.v });
      state.v += 1; state.ct = body.ct; state.iv = body.iv; state.rem = body.rem === undefined ? state.rem : body.rem;
      return jsonResp(200, { ok: true, v: state.v });
    }
    return jsonResp(404, {});
  };
}
function scenario({ html = '', remList = null } = {}) {
  const salt = crypto.randomBytes(16).toString('base64');
  const key = mcp.getKeyFor(NOTE, salt);
  const encHtml = mcp.encryptText(html, key);
  const state = { v: 3, ct: encHtml.ct, iv: encHtml.iv, salt, rem: null, putLog: [], cloudCalls: 0, cloudinary: [], put409: 0, key };
  if (remList !== null) state.rem = JSON.stringify(mcp.encryptText(JSON.stringify({ list: remList }), key));
  return state;
}
const decryptHtml = (st) => mcp.decryptText(st.ct, st.iv, st.key);
const decryptRem = (st) => { if (!st.rem) return null; return JSON.parse(mcp.decryptText(JSON.parse(st.rem).ct, JSON.parse(st.rem).iv, st.key)).list; };
// v7.3.2：硬编码固定日期会随当日时间流逝过期（09:05 后「未来」变「过去」→ add/clear 用例全红，
// 同日 23:00 后超限用例再红）。改为 now 相对时间（+2h 保证未来），任意时刻运行都稳定。
// 且必须分钟对齐（毫秒归零）：parseAt(fmtRemLine(T1)) 只到分钟精度，带毫秒的 T1 会使
// add 落库值≠T1、cancel 字符串命中失败（V711-C/C2/D2/N 全红根因）。
const T1 = Math.floor(Date.now() / 60000) * 60000 + 2 * 3600 * 1000;
const H = mcp.fmtRemLine(T1); // 与 fmtRemInsert 同构的 MCP 行格式，parseAt 可回解

// ════════ A. 源码断言 ════════
test('V711-A MCP 源码：五工具/版本/常量/样式/上传闭包外', () => {
  assert.ok(MCP_SRC.includes("name: 'note_image'"), 'TOOLS 应注册 note_image');
  assert.ok(MCP_SRC.includes('note_image: toolImage'), 'IMPLS 应含 note_image');
  assert.ok(MCP_SRC.includes("version: '8.0.7'"), 'serverInfo 应 8.0.7');
  assert.ok(MCP_SRC.includes("['add', 'list', 'cancel', 'clear']"), 'note_remind op 四模式');
  assert.ok(MCP_SRC.includes('const REM_DONE_MAX = 20'), 'REM_DONE_MAX=20 与 web 对齐');
  assert.ok(MCP_SRC.includes('img{max-width:100%;height:auto}'), 'renderImage 应有完整 img 限宽样式（宽图长图导出不爆版）');
  assert.ok(MCP_SRC.includes('/^https:\\/\\/res\\.cloudinary\\.com\\//'), 'secure_url 必须校验 Cloudinary 域前缀');
  // P1-2 实证：上传（new FormData）必须在 withRetry409 调用之前出现（409 重试不重传）
  const fn = MCP_SRC.slice(MCP_SRC.indexOf('async function toolImage'));
  assert.ok(fn.indexOf('new FormData()') < fn.indexOf('withRetry409'), '上传必须在上传重试闭包之外（409 重试不重传）');
});

// ════════ B. fmtRemLine 与 web fmtRemInsert 逐字对齐 ════════
test('V711-B fmtRemLine 与 web fmtRemInsert 同一时刻输出逐字相等', () => {
  const cases = [
    new Date(2026, 8, 8, 9, 5).getTime(),   // 单位数月/日/时 + 补零分
    new Date(2026, 11, 31, 23, 59).getTime(), // 年末
    new Date(2027, 0, 1, 0, 0).getTime(),   // 跨年零点
    new Date(2026, 0, 5, 0, 7).getTime(),   // 单位数分
    new Date(2026, 8, 30, 12, 0).getTime(), // 整点
  ];
  for (const t of cases) assert.strictEqual(mcp.fmtRemLine(t), webFmtRemInsert(t), 'at=' + t);
  assert.strictEqual(mcp.fmtRemLine(new Date(2026, 8, 8, 9, 5).getTime()), '2026-9-8 9:05', '格式形态（不补零年月日时+补零分）');
});

// ════════ C. add 回写正文行 ════════
test('V711-C add：单 PUT 原子带正文行+提醒，行格式与 web 同构', async () => {
  const st = scenario({ html: '<div>购物清单</div>', remList: [{ at: T1 + 86400000, text: '旧提醒', fired: false }] });
  global.fetch = makeFetch(st);
  const r = await mcp.toolRemind({ name: NOTE, at: H, text: '  晨会  ' });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.bodyLine, H + '　晨会', '回写行=fmtRemLine+全角空格+trim 后事项');
  assert.strictEqual(r.text, '晨会', 'text 先 trim 再截断');
  assert.strictEqual(decryptHtml(st), '<div>购物清单</div><div>' + H + '　晨会</div>', '正文末尾追加 div 行');
  const list = decryptRem(st);
  assert.ok(list.some(x => x.at === T1 && x.text === '晨会' && x.fired === false), 'rem 应含新提醒');
  assert.strictEqual(st.putLog.length, 1, '单次 PUT 原子提交');
});
test('V711-C2 add：空事项行只有时间串；同刻重设=覆盖不重复进 rem', async () => {
  const st = scenario({ html: '', remList: [{ at: T1, text: '旧文案', fired: false }] });
  global.fetch = makeFetch(st);
  const r = await mcp.toolRemind({ name: NOTE, at: H, text: '' });
  assert.strictEqual(r.bodyLine, H, '空事项无全角空格段（与 web insertRemLine 一致）');
  assert.strictEqual(decryptRem(st).filter(x => x.at === T1).length, 1, '同刻重设只保留一条');
  assert.ok(r.overwrote === true, '返回 overwrote 标记');
});
test('V711-C3 add：过去/30 秒内拒绝；未来满 10 条拒绝', async () => {
  const st = scenario({ html: '<div>x</div>' });
  global.fetch = makeFetch(st);
  await assert.rejects(() => mcp.toolRemind({ name: NOTE, at: '2020-1-1 10:00', text: 'a' }), /过去或 30 秒内/);
  const full = Array.from({ length: 10 }, (_, i) => ({ at: T1 + 86400000 * (i + 1), text: 'f' + i, fired: false }));
  const st2 = scenario({ html: '<div>x</div>', remList: full });
  global.fetch = makeFetch(st2);
  await assert.rejects(() => mcp.toolRemind({ name: NOTE, at: mcp.fmtRemLine(T1 + 86400000 * 11), text: 'b' }), /提醒最多 10 条/);
});

// ════════ D. list / cancel / clear ════════
test('V711-D list：返回 atStr/fired/expired，不写库', async () => {
  const st = scenario({ html: '<div>x</div>', remList: [{ at: T1, text: '未来', fired: false }, { at: T1 - 86400000, text: '已过', fired: true }] });
  global.fetch = makeFetch(st);
  const r = await mcp.toolRemind({ name: NOTE, op: 'list' });
  assert.strictEqual(r.list.length, 2);
  assert.strictEqual(r.list[0].atStr, mcp.fmtRemLine(T1 - 86400000), '按 at 升序');
  assert.strictEqual(r.list[0].expired, true);
  assert.strictEqual(r.list[1].fired, false);
  assert.strictEqual(st.putLog.length, 0, 'list 不发起 PUT');
});
test('V711-D2 cancel：只删 rem，正文明文逐字不变（对齐 web removeReminder）', async () => {
  const st = scenario({ html: '<div>会议记录</div>', remList: [{ at: T1, text: '晨会', fired: false }, { at: T1 + 86400000, text: '备用', fired: false }] });
  global.fetch = makeFetch(st);
  const r = await mcp.toolRemind({ name: NOTE, op: 'cancel', at: T1 });
  assert.strictEqual(r.removed.at, T1);
  assert.strictEqual(decryptHtml(st), '<div>会议记录</div>', '正文明文不变');
  assert.strictEqual(decryptRem(st).some(x => x.at === T1), false, 'rem 已删');
  await assert.rejects(() => mcp.toolRemind({ name: NOTE, op: 'cancel', at: 12345 }), /未找到该时刻的提醒/);
  const r2 = await mcp.toolRemind({ name: NOTE, op: 'cancel', at: mcp.fmtRemLine(T1 + 86400000) }); // 字符串→parseAt→精确命中
  assert.strictEqual(r2.removed.at, T1 + 86400000, 'cancel 支持时间串');
});
test('V711-D3 clear：只清过期/已触发；清空→rem:null；无可清不 PUT', async () => {
  const st = scenario({ html: '<div>x</div>', remList: [{ at: T1, text: '未来', fired: false }, { at: T1 - 86400000, text: '死条目', fired: true }] });
  global.fetch = makeFetch(st);
  const r = await mcp.toolRemind({ name: NOTE, op: 'clear' });
  assert.strictEqual(r.cleared, 1);
  assert.strictEqual(decryptRem(st).length, 1, '未来条目保留');
  const st2 = scenario({ html: '<div>y</div>', remList: [{ at: T1 - 86400000, text: '只剩过期', fired: true }] });
  global.fetch = makeFetch(st2);
  const r2 = await mcp.toolRemind({ name: NOTE, op: 'clear' });
  assert.strictEqual(st2.rem, null, '清空必须显式 rem:null（服务端 null=取消提醒）');
  const st3 = scenario({ html: '<div>z</div>', remList: [{ at: T1 + 86400000, text: '只剩未来', fired: false }] });
  global.fetch = makeFetch(st3);
  const r3 = await mcp.toolRemind({ name: NOTE, op: 'clear' });
  assert.strictEqual(r3.cleared, 0);
  assert.strictEqual(st3.putLog.length, 0, '无可清不发起 PUT');
});

// ════════ E. note_image ════════
let tmpDir = '';
test('V711-E note_image：成功 append / 409 重试不重传 / 内联定位 / 各失败路径', async t => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ns711-'));
  const imgP = path.join(tmpDir, 'cat.png');
  fs.writeFileSync(imgP, Buffer.alloc(1024, 7));
  try {
    // ① append 成功
    const st = scenario({ html: '<div>购物清单</div>' });
    global.fetch = makeFetch(st);
    const r = await mcp.toolImage({ name: NOTE, path: imgP });
    assert.strictEqual(r.ok, true && r.url.startsWith('https://res.cloudinary.com/'));
    assert.strictEqual(r.inserted, 'append');
    assert.strictEqual(decryptHtml(st), '<div>购物清单</div><div><img src="https://res.cloudinary.com/dntsgx6t3/image/upload/v1/img_1.png"></div>');
    // ② 409 重试：Cloudinary 只传一次（P1-2 实证）
    const st2 = scenario({ html: '<div>a</div>' });
    st2.put409 = 2;
    global.fetch = makeFetch(st2);
    await mcp.toolImage({ name: NOTE, path: imgP });
    assert.strictEqual(st2.cloudCalls, 1, '409 重试只重做 PUT，不重传图');
    assert.strictEqual(st2.putLog.length, 3, '409×2 + 成功×1');
    // ③ 内联 match
    const st3 = scenario({ html: '<div>今日膳食清单</div>' });
    global.fetch = makeFetch(st3);
    const r3 = await mcp.toolImage({ name: NOTE, path: imgP, match: '今日膳食', where: 'after' });
    assert.strictEqual(r3.inserted, 'inline');
    assert.strictEqual(decryptHtml(st3), '<div>今日膳食<img src="https://res.cloudinary.com/dntsgx6t3/image/upload/v1/img_1.png">清单</div>');
    // ④ URL 前缀校验
    const st4 = scenario({ html: '<div>x</div>' });
    st4.cloudinary.push({ body: { secure_url: 'https://evil.com/x.png' } });
    global.fetch = makeFetch(st4);
    await assert.rejects(() => mcp.toolImage({ name: NOTE, path: imgP }), /非预期的 URL/);
    // ⑤ 扩展名拒绝 / 文件不存在
    global.fetch = makeFetch(scenario({}));
    await assert.rejects(() => mcp.toolImage({ name: NOTE, path: path.join(tmpDir, 'x.txt') }), /只支持 png/);
    await assert.rejects(() => mcp.toolImage({ name: NOTE, path: path.join(tmpDir, 'nope.png') }), /读取图片失败/);
    // ⑥ 超限 8MB
    const bigP = path.join(tmpDir, 'big.png');
    fs.writeFileSync(bigP, Buffer.alloc(9 * 1024 * 1024, 1));
    global.fetch = makeFetch(scenario({}));
    await assert.rejects(() => mcp.toolImage({ name: NOTE, path: bigP }), /超过 8MB/);
    // ⑦ PUT 失败：报错带上传 URL，绝不静默
    const st7 = scenario({ html: '<div>x</div>' });
    global.fetch = makeFetch(st7);
    global.fetch = async (url, opts = {}) => {
      const u = String(url);
      if (u.startsWith('https://api.cloudinary.com')) return jsonResp(200, { secure_url: 'https://res.cloudinary.com/dntsgx6t3/image/upload/v1/ok.png' });
      if (opts.method === 'PUT') return jsonResp(500, { error: 'boom' });
      return jsonResp(200, { v: 3, ct: st7.ct, iv: st7.iv, salt: st7.salt, rem: null });
    };
    await assert.rejects(async () => {
      try { await mcp.toolImage({ name: NOTE, path: imgP }); } catch (e) {
        assert.ok(e.uploadedUrl && e.uploadedUrl.startsWith('https://res.cloudinary.com/'), '错误对象带 uploadedUrl');
        throw e;
      }
    }, /图片已上传成功/);
    // ⑧ match 找不到 / 空 match
    const st8 = scenario({ html: '<div>正文</div>' });
    global.fetch = makeFetch(st8);
    await assert.rejects(() => mcp.toolImage({ name: NOTE, path: imgP, match: '不存在的锚点' }), /未在正文中找到 match/);
    await assert.rejects(() => mcp.toolImage({ name: NOTE, path: imgP, match: '  ' }), /match 不能为空/);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

// ════════ F. normDecorHtml 保留 img src（jsdom） ════════
test('V711-F normDecorHtml：img src 保留，不同 src 不判等、同 src 判等', () => {
  const dom = loadApp(w => {
    try { Object.defineProperty(w, 'crypto', { value: webcrypto, configurable: true }); } catch (e) { w.crypto = webcrypto; }
    w.TextEncoder = TextEncoder; w.TextDecoder = TextDecoder;
  });
  try {
    const w = dom.window;
    const A = '<p><img src="https://res.cloudinary.com/dntsgx6t3/a.png"></p>';
    const B = '<p><img src="https://res.cloudinary.com/dntsgx6t3/b.png"></p>';
    assert.strictEqual(w.normDecorHtml(A), w.normDecorHtml(A), '同串判等');
    assert.ok(w.normDecorHtml(A).includes('src="https://res.cloudinary.com/dntsgx6t3/a.png"'), '归一化输出保留 src');
    assert.strictEqual(w.isDecorativelyEqual(A, B), false, '不同 src 的两张图绝不判等');
    assert.strictEqual(w.isDecorativelyEqual(A, '<p><img src="https://res.cloudinary.com/dntsgx6t3/a.png" style="width:30px"></p>'), true, '仅样式属性差异仍判等（v7.1.0 白名单语义不回退）');
  } finally { dom.window.close(); }
});

// ════════ G. README 把关（v61/v62 无覆盖的新行） ════════
test('V711-G README：v7.1.1 行存在且 ≤40 汉字、无裸竖线', () => {
  const row = README.match(/^\| v7\.1\.1 \|[^|]+\|([^|]+)\|$/m);
  assert.ok(row, '更新历史应有 v7.1.1 行');
  const hz = (row[1].match(/[一-龥]/g) || []).length;
  assert.ok(hz > 0 && hz <= 40, 'v7.1.1 摘要应为 1-40 汉字（实测 ' + hz + '）');
  assert.ok(README.includes('`note_image`'), 'MCP 工具表应有 note_image 行');
  assert.ok(!README.includes('规划 v7.1.x 的 `note_image`'), '旧「规划中」文案应已移除');
  // v7.2.0 起 README 宣称 8 个工具（+search/export/import），此处只守下限防回退
  assert.ok(/[0-9]+ 个工具/.test(README) && !README.includes('4 个工具'), '工具数声明应存在且 ≥5');
});

// ════════ H. decryptText 16 字节边界（验收路一 P0 补测：回退 <17 必红） ════════
test('V711-H decryptText：16 字节 tag-only=空明文合法；<16 抛错', () => {
  const salt = crypto.randomBytes(16).toString('base64');
  const key = mcp.getKeyFor(NOTE, salt);
  const enc = mcp.encryptText('', key);
  assert.strictEqual(Buffer.from(enc.ct, 'base64').length, 16, '空明文密文必须恰为 16 字节 GCM tag');
  assert.strictEqual(mcp.decryptText(enc.ct, enc.iv, key), '', '16 字节应解出空串（与 web 端无守卫语义对齐）');
  assert.throws(() => mcp.decryptText(Buffer.alloc(15, 1).toString('base64'), enc.iv, key), /ciphertext too short/, '15 字节=真截断必须抛错');
});

// ════════ I. note_image rem 逐字透传（验收路一 P1 补测：删透传行必红） ════════
test('V711-I note_image：rem 非空时 PUT 逐字透传，解密后条目不变', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ns711i-'));
  const imgP = path.join(dir, 'a.png');
  fs.writeFileSync(imgP, Buffer.alloc(64, 3));
  try {
    const remList = [{ at: T1 + 86400000, text: '别丢', fired: false }];
    const st = scenario({ html: '<div>x</div>', remList });
    const remBefore = st.rem;
    global.fetch = makeFetch(st);
    await mcp.toolImage({ name: NOTE, path: imgP });
    assert.strictEqual(st.putLog.length, 1);
    assert.strictEqual(st.putLog[0].rem, remBefore, 'PUT body.rem 必须逐字等于原 rem（删掉透传行此断言必红）');
    assert.deepStrictEqual(decryptRem(st), remList, 'rem 条目解密后与原来一致');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// ════════ J. note_image position / where:before（验收路一 P2-a 补测） ════════
test('V711-J note_image：position 纯文本偏移与 where:before 定位', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ns711j-'));
  const imgP = path.join(dir, 'b.png');
  fs.writeFileSync(imgP, Buffer.alloc(64, 4));
  try {
    const st = scenario({ html: '<div>abcdef</div>' });
    global.fetch = makeFetch(st);
    const r = await mcp.toolImage({ name: NOTE, path: imgP, position: 3 });
    assert.strictEqual(r.inserted, 'inline');
    assert.strictEqual(decryptHtml(st), '<div>abc<img src="https://res.cloudinary.com/dntsgx6t3/image/upload/v1/img_1.png">def</div>', 'position=3 插在纯文本第 3 字符（0 基）之前');
    const st2 = scenario({ html: '<div>今日膳食清单</div>' });
    global.fetch = makeFetch(st2);
    await mcp.toolImage({ name: NOTE, path: imgP, match: '膳食', where: 'before' });
    assert.strictEqual(decryptHtml(st2), '<div>今日<img src="https://res.cloudinary.com/dntsgx6t3/image/upload/v1/img_1.png">膳食清单</div>', 'where:before 插在锚点文本之前');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// ════════ K. note_image 格式/恰 8MB/Cloudinary 失败分支（验收路一 P2-b 补测） ════════
test('V711-K note_image：大写扩展名接受、恰 8MB 放行、Cloudinary 四失败分支', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ns711k-'));
  const jpgP = path.join(dir, 'x.JPG');
  fs.writeFileSync(jpgP, Buffer.alloc(32, 5));
  try {
    let st = scenario({ html: '' });
    global.fetch = makeFetch(st);
    assert.strictEqual((await mcp.toolImage({ name: NOTE, path: jpgP })).ok, true, '大写 .JPG 应接受（IMG_EXT_RE /i）');
    const exactP = path.join(dir, 'exact.png');
    fs.writeFileSync(exactP, Buffer.alloc(8 * 1024 * 1024, 6)); // 恰 8MB：实现是 > 严格大于
    st = scenario({ html: '' });
    global.fetch = makeFetch(st);
    assert.strictEqual((await mcp.toolImage({ name: NOTE, path: exactP })).ok, true, '恰 8MB 应放行');
    st = scenario({ html: '' });
    st.cloudinary.push({ status: 400, body: { error: { message: 'bad preset' } } });
    global.fetch = makeFetch(st);
    await assert.rejects(() => mcp.toolImage({ name: NOTE, path: jpgP }), /Cloudinary 上传失败：HTTP 400 bad preset/, '非 2xx 带服务端错误消息');
    st = scenario({ html: '' });
    st.cloudinary.push({ body: {} });
    global.fetch = makeFetch(st);
    await assert.rejects(() => mcp.toolImage({ name: NOTE, path: jpgP }), /Cloudinary 上传失败：HTTP 200/, '2xx 但无 secure_url');
    st = scenario({ html: '' });
    const base = makeFetch(st);
    global.fetch = async (url, opts) => {
      if (String(url).startsWith('https://api.cloudinary.com')) return { ok: true, status: 200, json: async () => { throw new Error('not json'); } };
      return base(url, opts);
    };
    await assert.rejects(() => mcp.toolImage({ name: NOTE, path: jpgP }), /响应非 JSON：HTTP 200/, '非 JSON 响应');
    global.fetch = async (url) => {
      if (String(url).startsWith('https://api.cloudinary.com')) { const e = new Error('aborted'); e.name = 'TimeoutError'; throw e; }
      throw new Error('不应到达（上传在重试闭包外，先于 loadNote）');
    };
    await assert.rejects(() => mcp.toolImage({ name: NOTE, path: jpgP }), /上传超时（30s），未写入笔记/, '30s 超时分支');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// ════════ L. add 事项截 20 字（验收路一 P2-c 补测） ════════
test('V711-L add：事项 trim 后截 20 字，正文行与 rem 同步截断', async () => {
  const long = '一二三四五六七八九十一二三四五六七八九十一二三四五'; // 25 字
  const st = scenario({ html: '' });
  global.fetch = makeFetch(st);
  const r = await mcp.toolRemind({ name: NOTE, at: H, text: long });
  assert.strictEqual(r.text, long.slice(0, 20), '事项截 20 字');
  assert.strictEqual(r.bodyLine, H + '　' + long.slice(0, 20), '正文行用截断后文案');
  assert.strictEqual(decryptRem(st)[0].text, long.slice(0, 20), 'rem 内也是截断后文案');
});

// ════════ M. list 的 at 精确数值（验收路一 P2-d 补测） ════════
test('V711-M list：at 为精确毫秒时间戳（cancel 的直接输入）', async () => {
  const st = scenario({ html: '', remList: [{ at: T1, text: 'a', fired: false }, { at: T1 + 86400000, text: 'b', fired: false }] });
  global.fetch = makeFetch(st);
  const r = await mcp.toolRemind({ name: NOTE, op: 'list' });
  assert.strictEqual(typeof r.list[0].at, 'number');
  assert.strictEqual(r.list[0].at, T1, 'at 精确值===构造值');
  assert.strictEqual(r.list[1].at, T1 + 86400000);
});

// ════════ N. done 区 slice(-20) FIFO（验收路一 P2-e 补测，与 web normalizeRemList 同构） ════════
test('V711-N add：过期条目超 20 条时最旧的被挤掉', async () => {
  const now = Date.now();
  const expired = Array.from({ length: 25 }, (_, i) => ({ at: now - (25 - i) * 60000, text: 'e' + i, fired: true }));
  const st = scenario({ html: '', remList: expired });
  global.fetch = makeFetch(st);
  await mcp.toolRemind({ name: NOTE, at: H, text: '新' });
  const list = decryptRem(st);
  assert.strictEqual(list.length, 21, '20 条最新过期 + 1 条新增未来');
  assert.strictEqual(list.filter(x => x.at <= Date.now()).length, 20, 'done 区恰 20 条');
  assert.ok(!list.some(x => x.text === 'e0') && !list.some(x => x.text === 'e4'), '最旧 5 条被挤掉');
  assert.ok(list.some(x => x.text === 'e5'), 'e5 是幸存最旧一条');
  assert.ok(list.some(x => x.at === T1 && x.text === '新'), '新增未来条目在');
});

// ════════ O. README 提醒示例与能与不能表（验收路一 P2-f 补测） ════════
test('V711-O README：提醒管理示例与能与不能表 v7.1.1 翻转行', () => {
  assert.ok(README.includes('笔记里都有哪些提醒'), '应有 list 示例');
  assert.ok(README.includes('取消明天早上 9 点那条提醒'), '应有 cancel 示例');
  assert.ok(README.includes('把已经触发过的提醒清理掉'), '应有 clear 示例');
  assert.ok(README.includes('把 D:\\pics\\cat.png 加到笔记末尾'), '应有图片示例');
  assert.ok(README.includes('加图 / 删图：本机图直传 Cloudinary 后插正文'), '能与不能表插图行应翻 ✅');
  assert.ok(README.includes('提醒全套：设（回写正文行）/ 列出 / 取消 / 清理过期'), '能与不能表提醒行应翻 ✅');
});

// ════════ P. 旧格式 rem 迁移（验收路三 P17 回归锁：v5.37 前单条目无 list 包裹，add 不得静默丢） ════════
test('V711-P toolRemind：旧格式 rem 迁移保留，add 不丢旧提醒', async () => {
  const salt = crypto.randomBytes(16).toString('base64');
  const key = mcp.getKeyFor(NOTE, salt);
  const encHtml = mcp.encryptText('<div>x</div>', key);
  const legacy = mcp.encryptText(JSON.stringify({ at: T1 + 86400000, text: '旧格式提醒' }), key); // 无 list 包裹
  const st = { v: 3, ct: encHtml.ct, iv: encHtml.iv, salt, rem: JSON.stringify(legacy), putLog: [], cloudCalls: 0, cloudinary: [], put409: 0, key };
  global.fetch = makeFetch(st);
  const r0 = await mcp.toolRemind({ name: NOTE, op: 'list' });
  assert.strictEqual(r0.list.length, 1, '旧格式单条目应迁移列出（与 web normalizeRemList 同构）');
  assert.strictEqual(r0.list[0].text, '旧格式提醒');
  await mcp.toolRemind({ name: NOTE, at: H, text: '新' });
  const list = decryptRem(st);
  assert.ok(list.some(x => x.text === '旧格式提醒'), 'add 后旧提醒必须还在（P17 回归锁）');
  assert.ok(list.some(x => x.text === '新'), '新提醒也在');
});

// ════════ Q. 未来超限归一化与 web 对齐（验收路三 P07b 回归锁） ════════
test('V711-Q normRemList：未来条目超 10 条时留最近 10 条（与 web slice(0,REM_MAX) 同构）', async () => {
  const now = Date.now();
  const future12 = Array.from({ length: 12 }, (_, i) => ({ at: now + (i + 1) * 3600000, text: 'f' + i, fired: false }));
  const st = scenario({ html: '', remList: future12 });
  global.fetch = makeFetch(st);
  const r = await mcp.toolRemind({ name: NOTE, op: 'cancel', at: future12[0].at });
  const list = decryptRem(st);
  assert.strictEqual(list.length, 10, '12 条取消 1 条后归一化留最近 10（与 web 一致）');
  assert.ok(!list.some(x => x.text === 'f11'), '最远的 f11 被裁掉');
  assert.ok(list.some(x => x.text === 'f10'), 'f10 幸存');
  assert.strictEqual(r.futureCount, 10);
});
