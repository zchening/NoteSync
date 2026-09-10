// v7.5.1 回归：诊断复制提示自动消失 + 刷新/开关诊断清提示
// 背景 bug：#diagCopy 的 done 只 showUploadStatus 未排 hideUploadStatus → 「已复制诊断信息」常驻，
// 只能整页刷新才消失（v8.0.8 起右下角钮即整页 reload，与 F5 同路径；v8.0.7 及以前它只跑 poll 不碰 toast）。
// 修：done 补「文案仍是它才清」的自动隐藏；开/关诊断均 hideUploadStatus；忙时给轻提示。
// v8.0.8：刷新钮改为字面 reload，「点刷新顺手 hideUploadStatus」随整页重建退役（重载天然清道）。
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const { INDEX_PATH } = require('../helpers');
const src = fs.readFileSync(INDEX_PATH, 'utf8');

test('复制诊断信息：补自动隐藏且移除旧的常驻写法', () => {
  assert.ok(src.includes("if (uploadStatus.textContent === '已复制诊断信息') hideUploadStatus();"), 'done 应排「文案仍是它才清」的自动隐藏，杜绝提示常驻');
  assert.ok(!src.includes("const done = () => showUploadStatus('已复制诊断信息');"), '旧的「显示后不隐藏」死写法应退役');
});

test('右下角刷新：v8.0.8 reload 天然清道、不再手动 hideUploadStatus；忙时轻提示仍保留', () => {
  assert.ok(!src.includes('hideUploadStatus(); // v7.5.1：点刷新'), 'v8.0.8：reload 整页重建已天然清提示，不再需要手动 hideUploadStatus');
  assert.ok(src.includes("showUploadStatus('正在保存中"), '忙/在途写入应给轻提示而非静默 return');
});

test('打开/关闭/滚动关闭诊断：均清掉 toast，杜绝孤儿提示', () => {
  assert.ok(src.includes('hideUploadStatus(); // v7.5.1：打开诊断前'), 'openDiagModal 应先清残留提示');
  assert.ok((src.match(/diagMask\.classList\.add\('hidden'\); hideUploadStatus\(\);/g) || []).length >= 2, '诊断遮罩关闭与滚动自动关闭都应 hideUploadStatus');
});
