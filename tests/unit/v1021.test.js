// v10.2.1 单元测试：更新弹窗长文把按钮顶出屏（用户报障）
//   S1  CSS 钉：#updNotes 加 max-height + overflow-y 滚动上限（按钮恒可见的结构保证）
//   S2  JS 钉：body 兜底路径每行掐到 60 字（长 body 不再整段塞进弹窗）
//   S3  行为级：真实 nsCheckUpdate + 超长 body（v10.2.0 真实形状）→ 弹窗可见、每行文本 ≤61 字
//   S4  行为级：summary（人工浓缩短句）路径原样展示，不受兜底掐断影响
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const { loadApp, INDEX_PATH } = require('../helpers');

const SRC = fs.readFileSync(INDEX_PATH, 'utf8');

// v10.2.0 真实形状：summary 空、body 两条超长单行段落（当时 1387 字）
const LONG_BODY = [
  '## v10.2.0 完整更新详情',
  '',
  '两条用户诉求（仿 NoteSyncX）。',
  '',
  '- ①长按删除折叠列表：' + '折叠组此前没有任何删掉整组的路，手势确认框组界重映射撤销找回一整条链。'.repeat(16),
  '- ②APK 26MB→3MB 级：' + '移除随包 ML Kit 扫码插件，扫码全靠同源 jsQR 纯 JS 解码零 APK 成本兼容。'.repeat(8),
  '',
  '**Full Changelog**: https://github.com/zchening/NoteSync/compare/v10.1.8...v10.2.0',
].join('\n');

const UPD_JSON = (extra) => ({
  tag_name: 'v10.3.0', // 必须 > APP_VERSION 才会弹窗
  assets: [{ name: 'app-release.apk', browser_download_url: 'https://biji.xuyinji.com.cn/dl/v10.3.0.apk', size: 3524754 }],
  body: LONG_BODY,
  ...extra,
});

function app0(summary) {
  const dom = loadApp(w => {
    w.fetch = async () => ({ ok: true, json: async () => UPD_JSON(summary ? { summary } : {}) });
  }, 'http://localhost/');
  return { dom, w: dom.window };
}

/* ── S1/S2 源码钉 ─────────────────────────────────────────── */
test('S1 #updNotes 必须有高度上限 + 滚动（长 body 不许把按钮顶出屏）', () => {
  assert.ok(SRC.includes('#updNotes{font-size:13.5px;line-height:1.95;color:var(--fg);font-weight:500;text-align:left;margin:14px 22px 2px;max-height:38vh;overflow-y:auto}'),
    '#updNotes 规则必须带 max-height:38vh + overflow-y:auto（v10.2.0 真机实锤：长正文把按钮顶出屏）');
});

test('S2 body 兜底路径必须逐行掐到 60 字（summary 人工短句不受影响）', () => {
  assert.ok(SRC.includes("s.length > 60 ? s.slice(0, 60) + '…' : s"),
    'body 兜底行必须有 60 字掐断（详情始终看发布页）');
});

/* ── S3 行为级：长 body → 弹窗可见、每行 ≤61 字 ─────────────── */
test('S3 长 body（v10.2.0 真实形状）：弹窗弹出、兜底行全部 ≤61 字', async t => {
  const app = app0(); t.after(() => app.dom.window.close());
  const { w } = app;
  await w.nsCheckUpdate();
  const mask = w.document.getElementById('updMask');
  assert.ok(!mask.classList.contains('hidden'), '长 body 也要正常弹窗');
  const ne = w.document.getElementById('updNotes');
  const texts = Array.from(ne.childNodes).filter(n => n.nodeType === 3).map(n => n.nodeValue);
  assert.ok(texts.length >= 2, '兜底行应有内容：' + JSON.stringify(texts));
  for (const s of texts) assert.ok(s.length <= 61, '兜底行超长（≤61 含省略号）：' + s.length);
  assert.ok(w.document.getElementById('updYes'), '确认按钮必须存在');
});

/* ── S4 行为级：summary 人工短句原样展示 ───────────────────── */
test('S4 有 summary 时按 summary 原样展示（人工浓缩不被兜底掐断）', async t => {
  const app = app0(['长按折叠标题可整组删除', 'APK瘦身至3.4MB']); t.after(() => app.dom.window.close());
  const { w } = app;
  await w.nsCheckUpdate();
  const ne = w.document.getElementById('updNotes');
  const texts = Array.from(ne.childNodes).filter(n => n.nodeType === 3).map(n => n.nodeValue);
  assert.deepStrictEqual(texts, ['长按折叠标题可整组删除', 'APK瘦身至3.4MB'], 'summary 必须逐条原样上屏');
});
