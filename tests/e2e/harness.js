// 共享 E2E 工具：启动浏览器 + 鲁棒拆解（规避 Windows/Playwright browser.close 卡死/抛错导致 node --test 退出码异常）
const { chromium } = require('playwright');
const { startServer } = require('./server');

async function setup() {
  const server = await startServer();
  const baseURL = `http://localhost:${server.address().port}/`;
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });
  return { server, baseURL, browser };
}

// browser.close() 在部分 Windows 环境会挂起或抛未处理 rejection；
// 用 6s 超时竞赛 + catch 兜底，确保 after() 一定能返回，不会卡死整个测试进程。
async function teardown(browser, server) {
  if (browser) {
    await Promise.race([
      browser.close().catch(() => {}),
      new Promise((resolve) => setTimeout(resolve, 6000)),
    ]).catch(() => {});
  }
  try {
    if (server) server.close();
  } catch {}
}

module.exports = { setup, teardown };
