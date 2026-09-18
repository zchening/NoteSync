// v9.5.3 守护：更新弹窗「拉起」黑话清零三处（用户拍板）——进行中态「正在安装…」、needPermission 重试钮「立即安装」、失败提示「立即安装没成功：」；旧串禁回潮。
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const SRC = fs.readFileSync(path.resolve(__dirname, '..', '..', 'index.html'), 'utf8');

test('v9.5.3 文案：nsUpdInstall 三处新串在位、旧「拉起」串禁回潮', () => {
  assert.ok(SRC.includes("y.textContent = '正在安装…'; y.disabled = true;"), '进行中态按钮应为「正在安装…」');
  assert.ok(/needPermission\) \{[\s\S]{0,220}y\.textContent = '立即安装';/.test(SRC), 'needPermission 重试钮应为「立即安装」');
  assert.ok(SRC.includes("updMsg('立即安装没成功：'"), '失败提示应为「立即安装没成功：」');
  assert.ok(!SRC.includes('拉起安装…'), '旧「拉起安装…」禁回潮');
  assert.ok(!SRC.includes('安装页没拉起来'), '旧「安装页没拉起来」禁回潮');
  // 主 CTA「立即更新」（发现新版/下载入口）不属本波，必须还在
  assert.ok(SRC.includes("y.textContent = '立即更新'; y.onclick = () => nsUpdDownload"), '主按钮「立即更新」应保持不动');
});
