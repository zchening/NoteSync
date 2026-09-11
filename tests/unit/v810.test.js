// v8.1.0 链接打开方式（挑版A）+ 扫码换机改名——jsdom 行为守护 + 静态锚点
// A 静态：改名两处用户可见串、打开链接行 DOM（v8.1.1 起 linkrow/尖角为禁现钉）+行序钉、二级页 CSS 规则、renderMenu 同族枚举、mousedown 走分流函数
// B 行为：openNoteLink 五路分流（APK browser/inapp/旧桥回退、Web browser/inapp）
// C 行为：菜单二级页进出 + localStorage 本机键 + 金勾 sel 同步 + renderMenu 复位
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const { webcrypto } = require('node:crypto');
const { JSDOM, VirtualConsole } = require('jsdom');
const { INDEX_PATH } = require('../helpers');

const SRC = fs.readFileSync(INDEX_PATH, 'utf8');
const sleep = ms => new Promise(r => setTimeout(r, ms));

function freshApp() {
  let navHits = 0;
  const html = SRC.replace(/<script src="https:\/\/cdn\.jsdelivr[^"]*"><\/script>/, '');
  const vc = new VirtualConsole();
  vc.on('jsdomError', e => { if (/navigation/i.test(e.message)) navHits++; });
  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    url: 'http://localhost/bv810',
    virtualConsole: vc,
    beforeParse(w) {
      w.fetch = () => Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
      w.EventSource = class { close() {} };
      try { Object.defineProperty(w, 'crypto', { value: webcrypto, configurable: true }); }
      catch (e) { w.crypto = webcrypto; }
      w.TextEncoder = TextEncoder;
      w.TextDecoder = TextDecoder;
      if (!w.Range.prototype.getClientRects) {
        w.Range.prototype.getClientRects = function () { return []; };
        w.Range.prototype.getBoundingClientRect = function () { return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 }; };
      }
    },
  });
  const window = dom.window;
  window.open = (...a) => { (window.__open = window.__open || []).push(a); return null; };
  return { dom, window, document: window.document, navCount: () => navHits };
}
async function waitFor(fn, ms = 3000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (fn()) return true; await sleep(30); }
  return false;
}
async function readyApp() {
  const app = freshApp();
  await waitFor(() => app.window.document.getElementById('editor'));
  return app;
}
function stubNative(app, withLinkOpen) {
  const w = app.window;
  w.__ext = []; w.__inapp = [];
  w.Capacitor = { isNativePlatform: () => true };
  if (withLinkOpen) {
    w.Capacitor.Plugins = { LinkOpen: {
      openExternal: o => { w.__ext.push(o.url); return Promise.resolve({ ok: true }); },
      openInApp: o => { w.__inapp.push(o.url); return Promise.resolve({ ok: true }); },
    } };
  }
}
async function clickLink(app, href) {
  const d = app.document;
  d.getElementById('editor').innerHTML = '<a id="lkv810" href="' + href + '">x</a>';
  const a = d.getElementById('lkv810');
  await waitFor(() => typeof app.window.openNoteLink === 'function');
  a.dispatchEvent(new app.window.MouseEvent('mousedown', { bubbles: true }));
  await sleep(30);
}

// ── A：静态锚点（锚补丁行，禁裸匹配恒真）────────────────────
test('A1 改名「扫码换机」两处用户可见串落位', () => {
  assert.ok(SRC.includes('<span class="mi-l">扫码换机</span>'), '菜单行文案已改');
  assert.ok(SRC.includes("h.textContent = '扫码换机'"), '弹窗标题已改');
  assert.ok(!SRC.includes('<span class="mi-l">备份换机码</span>'), '旧菜单文案不得残留用户可见位');
});
test('A2 「打开链接」行 DOM（v8.1.1 方案二：无箭头语言，尖角/linkrow 禁现）+ mousedown 走 openNoteLink', () => {
  assert.ok(SRC.includes('id="menuLink" class="menu-item" role="button"'), '主菜单行 DOM（普通 menu-item，无派生类）');
  assert.ok(!SRC.includes('class="chev"') && !SRC.includes('.linkrow'), '尖角类与 linkrow 全文件禁现（v8.1.1 退役，含注释）');
  assert.ok(SRC.indexOf('id="menuLink"') < SRC.indexOf('id="menuBackup"'), '行序（v8.1.1 拍板）：打开链接在扫码换机之前');
  assert.ok(SRC.includes('openNoteLink(a.href);'), 'mousedown 分支已切分流函数');
  assert.ok(SRC.includes('function openNoteLink(href)'), '分流函数在位');
});
test('A3 CSS：二级页左起笔/金勾 visibility 占位（v8.1.1 起尖角定位规则退役）', () => {
  assert.ok(SRC.includes('#menuLinkView .menu-item{justify-content:flex-start}'), '二级页同族左起笔（红线17 枚举）');
  assert.ok(SRC.includes('.link-opt .tick{margin-left:auto;width:16px;height:16px;color:var(--accent);visibility:hidden}'), '金勾 visibility 占位（禁 display:none——切换漂移）');
  assert.ok(SRC.includes('.link-opt.sel .tick{visibility:visible}'), '选中显勾');
});
test('A4 renderMenu 视图复位收编 menuLinkView（同族禁漏枚举）', () => {
  assert.ok(SRC.includes("const linkView = document.getElementById('menuLinkView');"), 'renderMenu 枚举新视图');
  assert.ok(SRC.includes('linkView.classList.add(\'hidden\')'), '开菜单必回主视图');
});

// ── B：openNoteLink 五路分流 ────────────────────────────────
test('B1 APK+默认(browser)：走 openExternal 直开，零 window.open 零导航', async () => {
  const app = await readyApp();
  stubNative(app, true);
  await clickLink(app, 'https://example.com/x');
  assert.deepStrictEqual(app.window.__ext, ['https://example.com/x'], 'APK 默认=原生桥直开系统浏览器');
  assert.ok(!app.window.__open || !app.window.__open.length, '不许回退 window.open（那是弹窗噪声老路）');
  assert.strictEqual(app.navCount(), 0, '本窗口零导航');
  app.dom.window.close();
});
test('B2 APK+应用内：走 openInApp 子 WebView', async () => {
  const app = await readyApp();
  stubNative(app, true);
  app.window.localStorage.setItem('notesync_link_open', 'inapp');
  await clickLink(app, 'https://example.com/y');
  assert.deepStrictEqual(app.window.__inapp, ['https://example.com/y']);
  assert.ok(!app.window.__ext.length, '应用内不该同时外跳');
  app.dom.window.close();
});
test('B3 旧 APK 无 LinkOpen 桥：静默回退 window.open（现状行为零破坏）', async () => {
  const app = await readyApp();
  stubNative(app, false);
  await clickLink(app, 'https://example.com/z');
  assert.ok(app.window.__open && app.window.__open.length === 1, '回退一次 window.open');
  assert.strictEqual(app.window.__open[0][0], 'https://example.com/z');
  app.dom.window.close();
});
test('B4 Web+默认(browser)：window.open 新标签（现状不动）', async () => {
  const app = await readyApp();
  await clickLink(app, 'https://example.com/w');
  assert.ok(app.window.__open && app.window.__open.length === 1);
  assert.strictEqual(app.window.__open[0][1], '_blank');
  assert.strictEqual(app.navCount(), 0);
  app.dom.window.close();
});
test('B5 Web+应用内：当前标签跳转（location.href 真导航，零新标签）', async () => {
  const app = await readyApp();
  app.window.localStorage.setItem('notesync_link_open', 'inapp');
  await clickLink(app, 'https://example.com/v');
  assert.ok(!app.window.__open || !app.window.__open.length, '不许开新标签');
  assert.ok(app.navCount() >= 1, 'jsdom 真实导航计数=location.href 被写（v781 Z 族同法）');
  app.dom.window.close();
});

// ── C：菜单二级页交互 ───────────────────────────────────────
test('A5 安卓原生侧 grep 钉（仓库惯例 v555/v556 同族，Kotlin 半边不留零守护）', () => {
  const path = require('path');
  const ROOT = path.resolve(INDEX_PATH, '..');
  const main = fs.readFileSync(path.join(ROOT, 'android', 'app', 'src', 'main', 'java', 'cn', 'xuyinji', 'notesync', 'MainActivity.java'), 'utf8');
  assert.ok(main.includes('registerPlugin(LinkOpenPlugin.class)'), 'LinkOpen 桥必须显式注册');
  assert.ok(main.includes('"note.xuyinji.com.cn".equals(host) || "biji.xuyinji.com.cn".equals(host)'), '主文档拦截器双域白名单钉（离线缓存污染堵口）');
  assert.ok(main.includes('appLinkTarget'), 'App Links 转发 origin 归一在位（闸R1-P1 跨源锁屏修）');
  const mani = fs.readFileSync(path.join(ROOT, 'android', 'app', 'src', 'main', 'AndroidManifest.xml'), 'utf8');
  assert.ok(mani.includes('android:autoVerify="true"'), 'autoVerify 声明在位');
  assert.ok(mani.includes('.link.LinkViewActivity'), '子 WebView Activity 已声明');
  const kt = fs.readFileSync(path.join(ROOT, 'android', 'app', 'src', 'main', 'java', 'cn', 'xuyinji', 'notesync', 'link', 'LinkOpenPlugin.kt'), 'utf8');
  assert.ok(kt.includes('startsWith("https://") || u.startsWith("http://")'), '桥侧只收 http(s) 校验钉');
});
test('B6 协议门（闸R2）：javascript: href 全路径拦截——零桥调用零 open 零导航', async () => {
  const app = await readyApp();
  stubNative(app, true);
  await clickLink(app, 'javascript:alert(1)');
  assert.strictEqual(app.window.__ext.length, 0);
  assert.strictEqual(app.window.__inapp.length, 0);
  assert.ok(!app.window.__open || !app.window.__open.length);
  assert.strictEqual(app.navCount(), 0);
  app.dom.window.close();
});
test('B7 本站门（闸R2-P2-6）：APK+应用内+笔记域链接→当前窗跳转，不进子 WebView 双实例', async () => {
  const app = await readyApp();
  stubNative(app, true);
  app.window.localStorage.setItem('notesync_link_open', 'inapp');
  await clickLink(app, 'https://note.xuyinji.com.cn/other');
  assert.strictEqual(app.window.__inapp.length, 0, '本站链接绝不 openInApp（双实例并发写面）');
  assert.ok(app.navCount() >= 1, '当前窗 location.href 真导航');
  app.dom.window.close();
});
test('B8 mailto 回退（闸复验P2-B）：APK 里 mailto 走同窗导航命中 launchIntent，不静默丢', async () => {
  const app = await readyApp();
  stubNative(app, true);
  await clickLink(app, 'mailto:someone@example.com');
  assert.strictEqual(app.window.__ext.length, 0, 'LinkOpen 只收 http(s)，mailto 不进桥');
  assert.ok(app.navCount() >= 1, '同窗导航=旧 window.open 路径的 Capacitor launchIntent 等价');
  app.dom.window.close();
});
test('C1 进二级页/点选存本机键+金勾同步/返回/renderMenu 复位', async () => {
  const app = await readyApp();
  const d = app.document;
  d.getElementById('menuLink').click();
  assert.ok(!d.getElementById('menuLinkView').classList.contains('hidden'), 'menuLink 点入二级页');
  assert.ok(d.getElementById('menuMainView').classList.contains('hidden'), '主视图让位');
  assert.ok(d.getElementById('linkOptBrowser').classList.contains('sel'), '默认选中=系统浏览器');
  d.getElementById('linkOptInapp').click();
  assert.strictEqual(app.window.localStorage.getItem('notesync_link_open'), 'inapp', '点选即存本机键');
  assert.ok(d.getElementById('linkOptInapp').classList.contains('sel') && !d.getElementById('linkOptBrowser').classList.contains('sel'), '金勾互斥切换');
  d.getElementById('menuLinkBack').click();
  assert.ok(!d.getElementById('menuMainView').classList.contains('hidden'), '返回回主视图');
  d.getElementById('menuLink').click();
  d.getElementById('menuBtn').click(); // 重开菜单 → renderMenu 复位
  assert.ok(d.getElementById('menuLinkView').classList.contains('hidden'), 'renderMenu 复位不漏新视图');
  app.dom.window.close();
});
