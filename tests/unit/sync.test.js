// NoteSync 同步回归单测（jsdom 加载真实 index.html）
// 核心守卫（v5.17）：轮询基线无条件常驻（每 4 秒），SSE 仅作加速器；
// 旧代码在 SSE onopen 时 clearInterval 杀掉轮询、且只在 onerror 才启动轮询——
// 当 SSE 在隧道/代理下“连上但不投递”悬挂时，onerror 永不触发、轮询永不启动，另一端必须手动刷新。
// 本测试用可控假 EventSource + 监听 setInterval/clearInterval，断言：
//   1) startSync 建立 4000ms 无条件轮询；
//   2) 模拟 SSE 连上（onopen）不会 clearInterval（轮询保活）；
//   3) SSE onmessage 会触发 poll。
const { test, after } = require('node:test');
const assert = require('node:assert');
const { loadApp } = require('../helpers');

let dom;
after(() => { try { if (dom) dom.window.close(); } catch (e) {} });

test('v5.17 同步：轮询基线无条件常驻，SSE onopen 不再清轮询', () => {
  dom = loadApp();
  const { window } = dom;

  // 可控假 EventSource：仅记录分配的 handlers，不自动触发（模拟“连上但不投递”悬挂）
  class FakeES {
    constructor(url) { this.url = url; this.readyState = 1; window.__es = this; }
    close() { this.readyState = 2; }
  }
  window.EventSource = FakeES;

  // 监听定时器调用
  const intervalCalls = [];
  let clearCount = 0;
  const origSI = window.setInterval.bind(window);
  const origCI = window.clearInterval.bind(window);
  window.setInterval = (fn, ms) => { const id = origSI(fn, ms); intervalCalls.push({ fn, ms, id }); return id; };
  window.clearInterval = (id) => { clearCount++; return origCI(id); };

  // 监听 poll 调用（SSE onmessage 应触发它）
  let pollCalls = 0;
  const origPoll = window.poll;
  window.poll = (...a) => { pollCalls++; return origPoll.apply(window, a); };

  // 调用 startSync（顶层函数声明，挂在 window 上）
  window.startSync();

  // 1) 无条件基线：startSync 应已建立 4000ms 轮询
  const base = intervalCalls.find((c) => c.ms === 4000);
  assert.ok(base, 'startSync 应建立 4000ms 无条件轮询基线');
  assert.strictEqual(typeof base.fn, 'function', '轮询回调应为函数');
  const clearAfterStart = clearCount;
  assert.strictEqual(clearAfterStart, 0, 'startSync 阶段不应有 clearInterval');

  // 2) 模拟 SSE 连上（onopen）——旧代码这里会 clearInterval 杀掉轮询；新代码绝不应
  const es = window.__es;
  assert.strictEqual(typeof es.onopen, 'function', 'connectSSE 应分配 onopen handler');
  es.onopen();
  assert.strictEqual(clearCount, clearAfterStart, 'SSE onopen 不应调用 clearInterval（轮询基线必须保活）');

  // 3) SSE onmessage 应触发 poll（加速器路径）
  const pollBeforeMsg = pollCalls;
  assert.strictEqual(typeof es.onmessage, 'function', 'connectSSE 应分配 onmessage handler');
  es.onmessage({ data: '{}' });
  assert.ok(pollCalls > pollBeforeMsg, 'SSE onmessage 应触发 poll()');

  // 清理已建立的轮询定时器，避免 jsdom 遗留
  for (const c of intervalCalls) { try { origCI(c.id); } catch (e) {} }
});
