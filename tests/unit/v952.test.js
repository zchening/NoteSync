// v9.5.2 守护：更新弹窗两处文案（用户拍板原话逐字钉）——按钮「立即安装」、提示「点「立即安装」升级，笔记和数据都会保留」；旧文案禁回潮。
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const SRC = fs.readFileSync(path.resolve(__dirname, '..', '..', 'index.html'), 'utf8');

test('v9.5.2 文案：nsUpdInstall 按钮与提示语按用户原话，旧串禁回潮', () => {
  assert.ok(SRC.includes("y.textContent = '立即安装';"), '按钮文案应为「立即安装」');
  assert.ok(SRC.includes("updMsg('点「立即安装」升级，笔记和数据都会保留')"), '提示语应为用户拍板原话');
  assert.ok(!SRC.includes('重新拉起安装'), '旧按钮文案「重新拉起安装」禁回潮');
  assert.ok(!SRC.includes('安装页已打开：点「安装」即覆盖升级'), '旧提示语禁回潮');
});
