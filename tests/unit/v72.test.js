// v7.2.0 单元测试——MCP note_search（本地加密倒排索引+增量）/ note_export / note_import
// （plain/raw 双模式 zip 零依赖手写）+ 注册表枚举 + zip slip/白名单安全闸。
// 结构沿 v711.test.js：源码断言 + require 不挂 stdio + mock fetch 行为测试（全程不碰真实服务器）。
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const SRC = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const MCP_PATH = path.join(ROOT, 'tools', 'notesync-mcp-server.js');
const MCP_SRC = fs.readFileSync(MCP_PATH, 'utf8');
const README = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');

// 口令/缓存目录先设再 require（模块级 env 固化；require.main!==module 不起 stdio）
process.env.NOTESYNC_PASSPHRASE = 'test-pass-v72';
process.env.NOTESYNC_CACHE_DIR = path.join(os.tmpdir(), 'ns-mcp-v72-test');
process.env.NOTESYNC_OUT_DIR = path.join(os.tmpdir(), 'ns-mcp-v72-out');
const mcp = require(MCP_PATH);
const CACHE_DIR = process.env.NOTESYNC_CACHE_DIR;

// ── 测试数据工厂 ──
const SALT = 'c2FsdDEyMzQ1Njc4OTAxMjM0Nw==';
const NOTE_A = 'v72a';
const NOTE_B = 'v72b';
function encHtml(name, html) { return mcp.encryptText(html, mcp.getKeyFor(name, SALT)); }

// ── fetch mock：可变服务端状态（v 自增 / 冲突 / 404） ──
let serverState; // { [name]: { v, updatedAt, salt, ct, iv, rem, gone } , putCalls: [...] }
let imageHits = 0;
const PNG_HEX = '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489';
function makeFetch() {
  return async (url, opts = {}) => {
    const u = String(url);
    const json = (status, obj) => ({ ok: status >= 200 && status < 300, status, json: async () => obj });
    if (u.includes('res.cloudinary.com')) {
      imageHits += 1;
      return { ok: true, status: 200, arrayBuffer: async () => Buffer.from(PNG_HEX, 'hex').buffer.slice(0, 33) };
    }
    const name = [NOTE_A, NOTE_B].find(n => u.endsWith('/api/note/' + n));
    if (!name) return json(200, { v: 0, ct: '', iv: '', salt: '', rem: null }); // 服务端对不存在笔记返回 200+EMPTY（readNote catch 形态）
    if (opts.method === 'PUT') {
      const body = JSON.parse(opts.body);
      serverState.putCalls.push({ name, body });
      if (typeof body.baseV === 'number' && body.baseV !== serverState[name].v) {
        return { ok: false, status: 409, json: async () => ({ v: serverState[name].v }) };
      }
      serverState[name].v += 1;
      serverState[name].ct = body.ct; serverState[name].iv = body.iv;
      if (body.salt) serverState[name].salt = body.salt;
      if (body.rem !== undefined) serverState[name].rem = body.rem;
      return json(200, { v: serverState[name].v });
    }
    // GET
    return json(200, serverState[name]);
  };
}
function freshServer() {
  serverState = {
    putCalls: [],
    [NOTE_A]: { v: 3, updatedAt: 1700000000000, salt: SALT, ...encHtml(NOTE_A, '<div>明天上午开会讨论项目进度</div><div>记得带笔记本</div>'), rem: null },
    [NOTE_B]: { v: 2, updatedAt: 1700000010000, salt: SALT, ...encHtml(NOTE_B, '<div>购物清单：牛奶鸡蛋面包</div>'), rem: null },
  };
  global.fetch = makeFetch();
  // 清缓存目录（注册表+索引），保证每条测试独立
  fs.rmSync(CACHE_DIR, { recursive: true, force: true });
}

// ═══════════ 源码断言 ═══════════
test('V72-S1 版本三处一致：index 7.6.0 / gradle 750 / MCP serverInfo 7.6.0', () => {
  assert.ok(SRC.includes("const APP_VERSION = '7.6.0';"), 'APP_VERSION 应 7.6.0');
  const gradle = fs.readFileSync(path.join(ROOT, 'android', 'app', 'build.gradle'), 'utf8');
  assert.ok(gradle.includes('versionCode 760') && gradle.includes('versionName "7.6.0"'), 'gradle 应 750/7.6.0');
  assert.ok(MCP_SRC.includes("serverInfo: { name: 'notesync', version: '7.6.0' }"), 'MCP serverInfo 应 7.6.0');
});

test('V72-S2 新工具注册齐全：TOOLS 含 search/export/import + description 含隐私提示', () => {
  for (const t of ['note_search', 'note_export', 'note_import']) {
    assert.ok(MCP_SRC.includes("name: '" + t + "'"), '应有 ' + t);
  }
  assert.ok(MCP_SRC.includes('落盘即裸奔'), 'export description 应含 plain 明文隐私提示');
  assert.ok(MCP_SRC.includes('preview'), 'import description 应含 preview 默认说明');
  // require 层 IMPLS 挂上
  const IMPLS_LINE = MCP_SRC.match(/const IMPLS = \{[^}]+\}/);
  assert.ok(IMPLS_LINE && IMPLS_LINE[0].includes('note_search: toolSearch') && IMPLS_LINE[0].includes('note_export: toolExport') && IMPLS_LINE[0].includes('note_import: toolImport'), 'IMPLS 应挂三新工具');
});

test('V72-S3 服务端零改动：server.js 不在本批改动面（枚举走本地注册表的安全决策）', () => {
  // 服务端没有也不加列表 API——源码断言 server.js 无 /api/notes 列表路由
  const serverSrc = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  assert.ok(!serverSrc.includes("'/api/notes'") && !serverSrc.includes('"/api/notes"'), 'server.js 不得新增笔记列表 API');
});

// ═══════════ 注册表 ═══════════
test('V72-R1 regAdd 自动累积 + regLoad 幂等去重', () => {
  freshServer();
  mcp.regAdd(NOTE_A); mcp.regAdd(NOTE_A); mcp.regAdd(NOTE_B);
  const reg = mcp.regLoad();
  assert.deepStrictEqual(reg.names.sort(), [NOTE_A, NOTE_B]);
});
test('V72-R2 注册表坏文件自愈（重写为只含新名字的合法 JSON）', () => {
  freshServer();
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.writeFileSync(path.join(CACHE_DIR, 'registry.json'), '{corrupted!!!');
  mcp.regAdd('selfheal');
  const reg = mcp.regLoad();
  assert.deepStrictEqual(reg.names, ['selfheal']);
});
test('V72-R3 非法名拒绝入册（ID_RE 口径与 assertName 一致）', () => {
  freshServer();
  mcp.regAdd('../evil'); mcp.regAdd('');
  assert.deepStrictEqual(mcp.regLoad().names, []);
});
test('V72-R4 regSeed 子进程种子合并（NOTESYNC_NOTE + NOTESYNC_NOTES）', () => {
  const tmpCache = path.join(os.tmpdir(), 'ns-mcp-v72-seed-' + Date.now());
  const script = "process.env.NOTESYNC_PASSPHRASE='x';process.env.NOTESYNC_CACHE_DIR=" + JSON.stringify(tmpCache) +
    ";process.env.NOTESYNC_NOTE='mainnote';process.env.NOTESYNC_NOTES='work, read ,,mainnote';" +
    "const m=require(" + JSON.stringify(MCP_PATH) + ");m.regSeed();console.log(JSON.stringify(m.regLoad().names));";
  const out = execFileSync(process.execPath, ['-e', script], { encoding: 'utf8' });
  assert.deepStrictEqual(JSON.parse(out.trim()).sort(), ['mainnote', 'read', 'work']);
  fs.rmSync(tmpCache, { recursive: true, force: true });
});
test('V72-R5 resolveNames：显式 names 优先并入册；空注册表报错', async () => {
  freshServer();
  assert.throws(() => mcp.resolveNames({}), /注册表为空/); // 空表先断言（后面入册会占位）
  const names = await mcp.resolveNames({ names: [NOTE_A] });
  assert.deepStrictEqual(names, [NOTE_A]);
  assert.ok(mcp.regLoad().names.includes(NOTE_A), '显式 names 应自动入册');
});

// ═══════════ note_search ═══════════
test('V72-T1 tokenize：CJK bigram / 拉丁数字整词 / 单字 CJK 整字', () => {
  freshServer();
  const toks = mcp.tokenize('明天上午开会9点');
  assert.ok(toks.some(t => t.t === '明天' && t.off === 0), 'bigram 起点');
  assert.ok(toks.some(t => t.t === '上午'), 'bigram 跨段');
  assert.ok(toks.some(t => t.t === '9'), '拉丁整词');
  assert.deepStrictEqual(mcp.tokenize('猫').map(t => t.t), ['猫'], '单字 CJK 整字');
});
test('V72-T2 search 命中 + 摘要（首次建索引，indexed=2）', async () => {
  freshServer();
  const r = await mcp.toolSearch({ query: '开会', names: [NOTE_A, NOTE_B] });
  assert.strictEqual(r.results.length, 1);
  assert.strictEqual(r.results[0].name, NOTE_A);
  assert.ok(r.results[0].hitCount >= 1);
  assert.ok(r.results[0].snippets[0].text.includes('开会'), '摘要含命中上下文');
  assert.strictEqual(r.fresh, 0);
  assert.strictEqual(r.indexed, 2, '首次全部重建');
});
test('V72-T3 AND 语义：部分词元缺失不命中', async () => {
  freshServer();
  const r = await mcp.toolSearch({ query: '开会 牛奶', names: [NOTE_A, NOTE_B] });
  // 「开会」只在 A、「牛奶」只在 B——AND 下两篇都不命中
  assert.strictEqual(r.results.length, 0, 'AND 语义下跨笔记词组合不命中');
});
test('V72-T4 bigram 误命中兜底：索引全命中但原文无连续子串 → 丢弃', async () => {
  freshServer();
  // 「天上开」的 bigram（天上/上开）都在 A 索引里（明天上午开会），但原文无此连续串
  const r = await mcp.toolSearch({ query: '天上开', names: [NOTE_A] });
  assert.strictEqual(r.results.length, 0, '子串二次校验应排掉 bigram 拼接误命中');
});
test('V72-T5 无空格 CJK query 连续串命中：天上午开（原文确有此连续串）', async () => {
  freshServer();
  const r = await mcp.toolSearch({ query: '天上午开', names: [NOTE_A] });
  assert.strictEqual(r.results.length, 1, '「明天上午开会」含连续串「天上午开」');
});
test('V72-T6 增量：v 不变走缓存（fresh=2, indexed=0）；改 v 触发重建', async () => {
  freshServer();
  await mcp.toolSearch({ query: '开会', names: [NOTE_A, NOTE_B] });
  const r2 = await mcp.toolSearch({ query: '开会', names: [NOTE_A, NOTE_B] });
  assert.strictEqual(r2.fresh, 2, 'v 未变全走缓存');
  assert.strictEqual(r2.indexed, 0);
  assert.strictEqual(r2.results.length, 1, '缓存路径命中结果一致');
  // 改 v（远端内容变化）→ 重建
  serverState[NOTE_B] = { ...serverState[NOTE_B], v: 9, ...encHtml(NOTE_B, '<div>牛奶也参加会议准备</div>') };
  const r3 = await mcp.toolSearch({ query: '牛奶', names: [NOTE_B] });
  assert.strictEqual(r3.results.length, 1, 'v 变化后新内容可检索');
  assert.strictEqual(r3.indexed, 1, '改 v 触发重建');
});
test('V72-T7 rebuild=true 强制全量重建', async () => {
  freshServer();
  await mcp.toolSearch({ query: '开会', names: [NOTE_A] });
  const r = await mcp.toolSearch({ query: '开会', names: [NOTE_A], rebuild: true });
  assert.strictEqual(r.fresh, 0, 'rebuild 不吃缓存');
  assert.strictEqual(r.indexed, 1);
});
test('V72-T8 索引加密落盘：文件含 enc 字段且 grep 不到正文词；NOTESYNC_INDEX_PLAIN 形态可读回', async () => {
  freshServer();
  await mcp.toolSearch({ query: '开会', names: [NOTE_A] });
  const idxFile = path.join(CACHE_DIR, 'index', NOTE_A + '.idx.json');
  assert.ok(fs.existsSync(idxFile), '索引文件应存在');
  const raw = fs.readFileSync(idxFile, 'utf8');
  assert.ok(raw.includes('"enc":1'), '加密形态');
  assert.ok(!raw.includes('开会') && !raw.includes('笔记本'), '落盘文件不含正文词');
  const idx = mcp.indexLoad(NOTE_A);
  assert.ok(idx && idx.terms['开会'], '解密读回可命中词元');
});
test('V72-T9 索引坏文件自愈：损坏后 search 正常（重建）', async () => {
  freshServer();
  await mcp.toolSearch({ query: '开会', names: [NOTE_A] });
  fs.writeFileSync(path.join(CACHE_DIR, 'index', NOTE_A + '.idx.json'), '{broken');
  const r = await mcp.toolSearch({ query: '开会', names: [NOTE_A] });
  assert.strictEqual(r.results.length, 1, '坏索引自愈重建后命中');
});

// ═══════════ zip ═══════════
test('V72-Z1 CRC32 标准值 + buildZip/readZip round-trip（含中文与目录条目）', () => {
  freshServer();
  assert.strictEqual(mcp.crc32(Buffer.from('abc')).toString(16), '352441c2', 'CRC32 标准测试向量');
  assert.strictEqual(mcp.crc32(Buffer.from('')), 0, '空串 crc=0');
  const zip = mcp.buildZip([
    { name: 'manifest.json', data: Buffer.from('{"app":"notesync"}') },
    { name: 'main.md', data: Buffer.from('# 标题\n中文内容 hello') },
    { name: 'attachments/main/0.jpg', data: Buffer.from(PNG_HEX, 'hex') },
  ]);
  const back = mcp.readZip(zip);
  assert.strictEqual(back.length, 3);
  assert.strictEqual(back[1].data.toString('utf8'), '# 标题\n中文内容 hello');
  assert.deepStrictEqual(back[2].data, Buffer.from(PNG_HEX, 'hex'));
});
test('V72-Z2 zip 字节结构：本地头/中央目录/EOCD 签名与条目数', () => {
  freshServer();
  const zip = mcp.buildZip([{ name: 'a.txt', data: Buffer.from('x') }]);
  assert.strictEqual(zip.readUInt32LE(0), 0x04034b50, 'local header 签名');
  assert.strictEqual(zip.readUInt16LE(6), 0x0800, 'UTF-8 文件名标志位');
  // EOCD 在尾部 22 字节
  const eocdOff = zip.length - 22;
  assert.strictEqual(zip.readUInt32LE(eocdOff), 0x06054b50, 'EOCD 签名');
  assert.strictEqual(zip.readUInt16LE(eocdOff + 10), 1, 'EOCD 条目数');
});
test('V72-Z3 zip slip 拒绝：../ /绝对路径/盘符', () => {
  freshServer();
  for (const evil of ['../evil.txt', 'a/../../evil.txt', '/abs.txt', 'C:/evil.txt']) {
    const zip = mcp.buildZip([{ name: evil, data: Buffer.from('x') }]);
    assert.throws(() => mcp.readZip(zip), /zip slip/, evil + ' 应被拒绝');
  }
});
test('V72-Z4 非法 zip（无 EOCD）明确报错', () => {
  freshServer();
  assert.throws(() => mcp.readZip(Buffer.from('not a zip at all')), /EOCD/);
});

// ═══════════ note_export ═══════════
test('V72-E1 plain 导出：manifest+md+html 结构、rem 明文入 manifest、md 有损不回还原', async () => {
  freshServer();
  const remKey = mcp.getKeyFor(NOTE_A, SALT);
  const remEnc = mcp.encryptText(JSON.stringify({ list: [{ at: Date.now() + 86400000, text: '明天开会提醒' }] }), remKey);
  serverState[NOTE_A].rem = JSON.stringify({ ct: remEnc.ct, iv: remEnc.iv });
  const out = path.join(os.tmpdir(), 'ns-v72-plain.zip');
  const r = await mcp.toolExport({ names: [NOTE_A, NOTE_B], mode: 'plain', out });
  assert.ok(r.ok && r.bytes > 0);
  assert.strictEqual(r.notes.length, 2);
  const entries = mcp.readZip(fs.readFileSync(out));
  const names = entries.map(e => e.name);
  for (const f of ['manifest.json', NOTE_A + '.md', NOTE_A + '.html', NOTE_B + '.md', NOTE_B + '.html']) {
    assert.ok(names.includes(f), 'zip 应含 ' + f + '（实际：' + names.join(',') + '）');
  }
  const manifest = JSON.parse(entries.find(e => e.name === 'manifest.json').data.toString('utf8'));
  assert.strictEqual(manifest.app, 'notesync');
  assert.strictEqual(manifest.schema, 1);
  assert.strictEqual(manifest.mode, 'plain');
  assert.ok(Array.isArray(manifest.notes[0].rem.list) && manifest.notes[0].rem.list.length === 1, 'rem 明文入 manifest');
  // md 有损验证：html 的 div 结构转行，正文文字保留
  const md = entries.find(e => e.name === NOTE_A + '.md').data.toString('utf8');
  assert.ok(md.includes('开会') && md.includes('\n'), 'md 含正文与换行');
});
test('V72-E2 plain 导出图片：Cloudinary 图下载进 attachments/，md 改相对路径+原 URL 注释', async () => {
  freshServer();
  const html = '<div>看图</div><div><img src="https://res.cloudinary.com/dntsgx6t3/image/upload/v1/test.jpg"></div>';
  serverState[NOTE_A] = { v: 3, updatedAt: 1, salt: SALT, ...encHtml(NOTE_A, html), rem: null };
  imageHits = 0;
  const out = path.join(os.tmpdir(), 'ns-v72-img.zip');
  const r = await mcp.toolExport({ names: [NOTE_A], mode: 'plain', out });
  assert.strictEqual(r.images, 1, '应下载 1 张图');
  assert.ok(imageHits >= 1, 'fetch 触发过图片下载');
  const entries = mcp.readZip(fs.readFileSync(out));
  const img = entries.find(e => e.name === 'attachments/' + NOTE_A + '/0.jpg');
  assert.ok(img, 'zip 含附件');
  assert.ok(img.data.length > 0);
  const md = entries.find(e => e.name === NOTE_A + '.md').data.toString('utf8');
  assert.ok(md.includes('attachments/' + NOTE_A + '/0.jpg'), 'md 改相对路径');
  assert.ok(md.includes('原 URL: https://res.cloudinary.com'), '原 URL 注释保留');
});
test('V72-E3 raw 导出：免口令产物全密文（ct/iv/salt/rem 原样，无明文正文）', async () => {
  freshServer();
  const out = path.join(os.tmpdir(), 'ns-v72-raw.zip');
  const r = await mcp.toolExport({ names: [NOTE_A], mode: 'raw', out });
  assert.ok(r.ok);
  const entries = mcp.readZip(fs.readFileSync(out));
  const j = JSON.parse(entries.find(e => e.name === NOTE_A + '.json').data.toString('utf8'));
  assert.ok(j.ct && j.iv && j.salt, '密文三件套原样');
  assert.strictEqual(j.v, 3);
  assert.ok(!entries.some(e => e.name.endsWith('.md') || e.name.endsWith('.html')), 'raw 无明文产物');
  // 密文与当前服务端一致（原样备份）
  assert.strictEqual(j.ct, serverState[NOTE_A].ct);
});
test('V72-E4 导出失败笔记进 skipped 不挡其余（坏密文=解密失败）', async () => {
  freshServer();
  serverState[NOTE_B] = { ...serverState[NOTE_B], ct: 'c2FsdA==', iv: serverState[NOTE_B].iv }; // 密文 <16B 必解密失败
  const out = path.join(os.tmpdir(), 'ns-v72-skip.zip');
  const r = await mcp.toolExport({ names: [NOTE_A, NOTE_B], mode: 'plain', out });
  assert.strictEqual(r.notes.length, 1);
  assert.strictEqual(r.skipped.length, 1);
  assert.strictEqual(r.skipped[0].name, NOTE_B);
  assert.ok(/ciphertext|解密/.test(r.skipped[0].reason), '失败原因如实（<16B 密文报 ciphertext too short）');
});

// ═══════════ note_import ═══════════
async function makeBackup(mode) {
  const out = path.join(os.tmpdir(), 'ns-v72-import-' + mode + '.zip');
  await mcp.toolExport({ names: [NOTE_A, NOTE_B], mode, out });
  return out;
}
test('V72-I1 preview 默认：只报告计划不写远端（无 PUT 调用）', async () => {
  freshServer();
  const zip = await makeBackup('plain');
  const r = await mcp.toolImport({ from: zip }); // 不传 mode=preview 默认
  assert.strictEqual(r.plan.length, 2);
  assert.ok(r.plan.every(p => p.action === 'update'), 'v 一致 → update 计划');
  assert.strictEqual(serverState.putCalls.length, 0, 'preview 不写远端');
});
test('V72-I2 apply：v 一致 update（PUT 带 baseV=远端 v）；HTML 白名单过闸', async () => {
  freshServer();
  const zip = await makeBackup('plain');
  const r = await mcp.toolImport({ from: zip, mode: 'apply' });
  assert.strictEqual(r.applied.length, 2);
  const put = serverState.putCalls.find(p => p.name === NOTE_A);
  assert.strictEqual(put.body.baseV, 3, 'update 应带远端当前 v 作 baseV');
  // 解密回读与导出 html 一致
  const key = mcp.getKeyFor(NOTE_A, put.body.salt);
  const html = mcp.decryptText(put.body.ct, put.body.iv, key);
  assert.ok(html.includes('开会'), '回写正文含原文');
});
test('V72-I3 apply：远端 v 变化 → skip-conflict；force=true 覆盖', async () => {
  freshServer();
  const zip = await makeBackup('plain');
  serverState[NOTE_B].v = 9; // 远端前进了
  const r1 = await mcp.toolImport({ from: zip, mode: 'apply' });
  assert.ok(r1.skipped.some(s => s.name === NOTE_B && /skip|v=9/.test(s.reason)), 'v 不一致默认跳过');
  const r2 = await mcp.toolImport({ from: zip, mode: 'apply', force: true });
  assert.ok(r2.applied.some(a => a.name === NOTE_B), 'force 覆盖成功');
});
test('V72-I4 create：远端无内容（处女笔记 EMPTY）→ 新盐新建', async () => {
  freshServer();
  const zip2 = await makeBackup('plain');
  serverState[NOTE_B] = { v: 0, updatedAt: 0, salt: '', ct: '', iv: '', rem: null }; // 处女笔记 EMPTY 形态
  serverState.putCalls = [];
  const r = await mcp.toolImport({ from: zip2, mode: 'apply', names: [NOTE_B] });
  assert.strictEqual(r.applied.length, 1);
  assert.strictEqual(r.applied[0].action, 'create');
  const put = serverState.putCalls.find(p => p.name === NOTE_B);
  assert.ok(put.body.salt && put.body.salt !== SALT, 'create 应生成新盐');
  assert.ok(!('baseV' in put.body) || put.body.baseV === 0, 'create 无 baseV 或 0');
});
test('V72-I5 白名单外标签报错拒绝（不静默剥离）；script 危险标签直接拒', async () => {
  freshServer();
  assert.throws(() => mcp.assertWhitelistHtml('<div>ok</div><table><tr><td>x</td></tr></table>'), /table, tr/);
  assert.throws(() => mcp.assertWhitelistHtml('<div>x</div><script>alert(1)</script>'), /script/);
  assert.throws(() => mcp.assertWhitelistHtml('<div>x</div><iframe src="a"></iframe>'), /iframe/);
  // 白名单内全放行
  mcp.assertWhitelistHtml('<div><u>s</u><s>d</s><a href="https://x">l</a><img src="https://res.cloudinary.com/a.jpg"><span>sp</span><p>p</p><h1>h</h1><li>li</li><br></div>');
});
test('V72-I6 import 白名单闸在 apply 生效：白名单外 HTML 的备份拒绝写入', async () => {
  freshServer();
  // 手工造一份含白名单外标签的 plain 备份
  const entries = [
    { name: 'manifest.json', data: Buffer.from(JSON.stringify({ app: 'notesync', schema: 1, exportedAt: Date.now(), mode: 'plain', notes: [{ name: NOTE_A, v: 3, updatedAt: 1, salt: SALT, rem: { list: [] } }] })) },
    { name: NOTE_A + '.html', data: Buffer.from('<div>x</div><marquee>y</marquee>') },
    { name: NOTE_A + '.md', data: Buffer.from('x') },
  ];
  const zipPath = path.join(os.tmpdir(), 'ns-v72-evil-html.zip');
  fs.writeFileSync(zipPath, mcp.buildZip(entries));
  const r = await mcp.toolImport({ from: zipPath, mode: 'apply' });
  assert.ok(r.skipped.length === 1 && /marquee/.test(r.skipped[0].reason), '白名单外标签报错列出');
  assert.strictEqual(serverState.putCalls.length, 0, '绝不静默剥离，拒绝写入');
});
test('V72-I7 rem 原子恢复：manifest rem 明文按当前口令重加密随同一 PUT 提交', async () => {
  freshServer();
  const remKey = mcp.getKeyFor(NOTE_A, SALT);
  const remEnc = mcp.encryptText(JSON.stringify({ list: [{ at: Date.now() + 86400000, text: '原子恢复验证' }] }), remKey);
  serverState[NOTE_A].rem = JSON.stringify({ ct: remEnc.ct, iv: remEnc.iv });
  const zip = await makeBackup('plain');
  // 清掉远端 rem，模拟换环境
  serverState[NOTE_A].rem = null;
  serverState[NOTE_A].v = 3; // 对齐导出 v 防 skip（导出后 v 自增了，重置）
  serverState.putCalls = [];
  const r = await mcp.toolImport({ from: zip, mode: 'apply', names: [NOTE_A] });
  assert.strictEqual(r.applied.length, 1, '恢复成功');
  const put = serverState.putCalls.find(p => p.name === NOTE_A);
  assert.ok(put && put.body.rem, 'PUT body 带 rem');
  // 用当前口令可解出原 list（重加密后明文一致）
  const curKey = mcp.getKeyFor(NOTE_A, put.body.salt);
  const parsed = JSON.parse(put.body.rem);
  const list = JSON.parse(mcp.decryptText(parsed.ct, parsed.iv, curKey));
  assert.strictEqual(list.list.length, 1);
  assert.strictEqual(list.list[0].text, '原子恢复验证');
});
test('V72-I8 raw 恢复：密文原样透传（免解密），v 一致直接 PUT', async () => {
  freshServer();
  const zip = await makeBackup('raw');
  serverState.putCalls = [];
  const r = await mcp.toolImport({ from: zip, mode: 'apply', names: [NOTE_A] });
  assert.strictEqual(r.applied.length, 1);
  const put = serverState.putCalls.find(p => p.name === NOTE_A);
  assert.strictEqual(put.body.ct, serverState[NOTE_A].ct, 'raw 恢复 ct 原样（未重加密）');
  assert.strictEqual(put.body.salt, SALT);
});
test('V72-I9 非本工具 zip 拒绝：无 manifest / app 不符', async () => {
  freshServer();
  const bad1 = path.join(os.tmpdir(), 'ns-v72-nomanifest.zip');
  fs.writeFileSync(bad1, mcp.buildZip([{ name: 'random.txt', data: Buffer.from('x') }]));
  await assert.rejects(() => mcp.toolImport({ from: bad1 }), /manifest/);
  const bad2 = path.join(os.tmpdir(), 'ns-v72-badapp.zip');
  fs.writeFileSync(bad2, mcp.buildZip([
    { name: 'manifest.json', data: Buffer.from(JSON.stringify({ app: 'other', schema: 1, notes: [] })) },
  ]));
  await assert.rejects(() => mcp.toolImport({ from: bad2 }), /app|schema|notesync/);
});
test('V72-I10 to 改名导入：仅单篇可用；多篇+to 报错', async () => {
  freshServer();
  const zip = await makeBackup('plain');
  const r = await mcp.toolImport({ from: zip, mode: 'apply', names: [NOTE_B], to: 'renamed-note' });
  assert.strictEqual(r.applied[0].target, 'renamed-note');
  await assert.rejects(() => mcp.toolImport({ from: zip, mode: 'apply', to: 'x' }), /单篇/);
});
test('V72-I11 preview/apply 对不安全 zip 条目名拒绝（zip slip 复用 readZip 闸）', async () => {
  freshServer();
  const evil = path.join(os.tmpdir(), 'ns-v72-slip.zip');
  fs.writeFileSync(evil, mcp.buildZip([
    { name: 'manifest.json', data: Buffer.from(JSON.stringify({ app: 'notesync', schema: 1, notes: [] })) },
    { name: '../escape.txt', data: Buffer.from('x') },
  ]));
  await assert.rejects(() => mcp.toolImport({ from: evil }), /zip slip/);
});

// ═══════════ web 端症状 1/2/3/4 源码断言（本版范围的最低守门） ═══════════
test('V72-W1 症状2：web PUT 带 baseV + 409 挂起（handleWriteConflict 存在且不自动重试）', () => {
  assert.ok(SRC.includes('handleWriteConflict'), '应有 handleWriteConflict');
  // v7.3.0（HB3）：baseV 用 localVer（SSE 已知版本不得抬高——静默覆盖他端内容），409 仍走挂起不自动重试。
  // apiPut 行尾注释较长，baseV→409 实际间距 856 字符，{0,600} 不足放宽 {0,1200}。
  assert.ok(/function saveLocal[\s\S]{0,2000}baseV: localVer[\s\S]{0,1200}status === 409[\s\S]{0,200}handleWriteConflict/.test(SRC), 'saveLocal 的 apiPut 应带 baseV=localVer 并在 409 走挂起');
  assert.ok(/persistReminders[\s\S]{0,3000}baseV: localVer/.test(SRC), 'persistReminders 应带 baseV=localVer');
});
test('V72-W2 症状4：poll 远端三级分类（严格相等静默/装饰等价静默/真实变更走原路径）', () => {
  assert.ok(/if \(html === lastHtml\) \{[\s\S]{0,400}return; \/\/ 级0/.test(SRC), '级0 严格相等静默消费');
  assert.ok(/isDecorativelyEqual\(html, lastHtml\)\)[\s\S]{0,500}return; \/\/ 级1/.test(SRC), '级1 装饰等价静默');
});
test('V72-W3 症状3：relocateCaretToVisible 删除跨块候选层（函数体无兄弟块搜索/无末尾重建回退）', () => {
  const relFn = SRC.match(/function relocateCaretToVisible\([\s\S]*?\n\}/);
  assert.ok(relFn, '应有 relocateCaretToVisible 函数');
  assert.ok(!relFn[0].includes('sibling'), 'relocate 不得再搜其他块（旧 sibling 候选层已删）');
  assert.ok(!relFn[0].includes('ensureBlockWrapped('), 'relocate 同块失败应保持原位，不得调用 ensureBlockWrapped 回退末尾重建（注释提及不算）');
  assert.ok(relFn[0].includes('__relocateKept'), '保持原位应有 diag 探针计数');
  assert.ok(SRC.includes('linkifyDeferred'), 'linkify 应有打字中推迟版');
  assert.ok(/lastTypeAt < 1500/.test(SRC), '1.5s 打字活跃阈值');
});
test('V72-W4 症状1：全角归一 normFullWidth + hover 路（hover:hover+pointer:fine 闸）', () => {
  assert.ok(SRC.includes('function normFullWidth'), 'web 全角归一函数');
  assert.ok(MCP_SRC.includes('function normFullWidthMcp'), 'MCP 同表归一');
  assert.ok(SRC.includes("matchMedia('(hover: hover) and (pointer: fine)')"), 'hover 路 PC 闸');
  assert.ok(SRC.includes("addEventListener('mousemove'"), 'editor mousemove 监听');
});
test('V72-W5 README 更新历史含 v7.2.0 条目（≤40 汉字）+ 边界表新行', () => {
  const row = README.match(/\| v7\.2\.0[^\n]*\|/);
  assert.ok(row, 'README 应有 7.2.0 条目');
  const han = (row[0].match(/[一-龥]/g) || []).length;
  assert.ok(han <= 40, '条目摘要 ≤40 汉字（当前 ' + han + '）');
  assert.ok(README.includes('全文检索') || README.includes('note_search'), 'README 应提及检索/备份能力');
  assert.ok(!README.includes('v7.1.2'), '未发布的 v7.1.2 条目应已并入 v7.2.0');
});
