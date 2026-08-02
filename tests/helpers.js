// 加载真实 index.html 到 jsdom，导出页面内的全局函数供测试调用。
// 关键：用根路径 url('http://localhost/') 让 noteId 为空，init() 走 landing 分支，
// 不触发任何 fetch/EventSource；并剥离外部 html2canvas CDN 脚本，避免联网。
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const INDEX_PATH = path.resolve(__dirname, '..', 'index.html');
const ZWSP = '​';

function loadApp() {
  let html = fs.readFileSync(INDEX_PATH, 'utf8');
  html = html.replace(/<script src="https:\/\/cdn\.jsdelivr[^"]*"><\/script>/, '');

  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', (e) => {
    // 把页面脚本的报错打出来，便于定位测试加载问题
    console.error('[jsdomError]', e.message);
  });

  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    url: 'http://localhost/',
    virtualConsole,
    beforeParse(window) {
      window.fetch = () => Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
      window.EventSource = class { close() {} };
    },
  });

  // 函数均为顶层声明，按规范应挂到 window 上；做一次健全性检查
  if (typeof dom.window.visibleLen !== 'function') {
    throw new Error('index.html 内的函数未挂到 window，jsdom 加载可能失败');
  }
  return dom;
}

module.exports = { loadApp, INDEX_PATH, ZWSP };
