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

// browser.close() 在本机 Windows 环境实测必挂（Playwright 1.62 + headless shell，干净单页场景
// 也挂，v7.3.3 最小诊断复现：close 6s 超时后残留 ChildProcess(chrome-headless-shell) +
// 4 个 transport Socket 撑 event loop，runner 永不退出）。三层防御：
// ①close 6s race 超时后从 active handles 找 Chromium ChildProcess 强杀（browser.process()
//   在 Playwright 1.62 已不存在，只能走 handles）；
// ②server.close() 后立即 closeAllConnections() 强清 SSE/keep-alive 存量连接（Node 18.2+）；
// ③runner 退出交给 node --test --test-force-exit（官方开关，跑 e2e 必须带上，见发版纪律）。
async function teardown(browser, server) {
  if (browser) {
    const closed = await Promise.race([
      browser.close().then(() => true).catch(() => true),
      new Promise((resolve) => setTimeout(() => resolve(false), 6000)),
    ]).catch(() => false);
    if (!closed) {
      // close 挂死兜底：强杀 Chromium 子进程（transport socket 无公开释放 API，
      // runner 退出靠 --test-force-exit 兜底，这里杀进程只为不泄漏浏览器实例）
      try {
        for (const h of process._getActiveHandles()) {
          if (h && h.constructor && h.constructor.name === 'ChildProcess' &&
              /chrome/i.test(h.spawnfile || '')) {
            try { h.kill(); } catch {}
          }
        }
      } catch {}
    }
  }
  try {
    if (server) {
      server.close();
      if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
    }
  } catch {}
}

module.exports = { setup, teardown };
