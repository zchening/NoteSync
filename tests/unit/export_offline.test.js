// v7.5.1 回归：html2canvas 去 CDN 化 —— 同源懒加载 + 服务路由 + SW 缓存 + 文件在库
// 背景 bug：head 挂公共 CDN jsdelivr html2canvas，大陆网络下不可达 → 手机「图片导出组件未加载」。
// 修法：自托管 html2canvas.min.js，exportImage 里 loadHtml2Canvas() 同源懒加载；SW 改缓存同源路径。
// 静态断言，锁定不回退（对齐 v60.test.js 的 jsQR 同款护栏风格）。
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { INDEX_PATH } = require('../helpers');

const ROOT = path.resolve(INDEX_PATH, '..');
const readSrc = () => fs.readFileSync(INDEX_PATH, 'utf8');
const readServer = () => fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
const readSw = () => fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');

test('index.html 不再挂公共 CDN 的 html2canvas', () => {
  const src = readSrc();
  assert.ok(!/cdn\.jsdelivr\.net[^"']*html2canvas/.test(src), '不得再从 jsdelivr CDN 加载 html2canvas（大陆不可达即致「组件未加载」）');
  assert.ok(!src.includes('html2canvas@1.4.1/dist'), '不得保留旧的 CDN 版本路径引用');
});

test('exportImage 走同源懒加载 loadHtml2Canvas', () => {
  const src = readSrc();
  assert.ok(src.includes('function loadHtml2Canvas()'), '应有同源懒加载函数 loadHtml2Canvas');
  assert.ok(src.includes("s.src = '/html2canvas.min.js';"), '懒加载应从同源 /html2canvas.min.js 拉取');
  assert.ok(src.includes('!(await loadHtml2Canvas())'), 'exportImage 应先 await loadHtml2Canvas 再判定');
  assert.ok(!src.includes("'图片导出组件未加载'"), '旧的「未加载」死逻辑应移除');
  assert.ok(src.includes('图片导出组件加载失败'), '加载失败时给明确的网络类提示文案');
});

test('server.js 有 /html2canvas.min.js 同源路由（immutable 长缓存）', () => {
  const sv = readServer();
  assert.ok(sv.includes("if (url === '/html2canvas.min.js') {"), 'server.js 应有 /html2canvas.min.js 静态路由');
  assert.ok(/url === '\/html2canvas\.min\.js'[\s\S]{0,260}immutable/.test(sv), '该路由应 immutable 长缓存');
});

test('sw.js 缓存同源 html2canvas（离线导出可复用），不再认 CDN', () => {
  const sw = readSw();
  assert.ok(sw.includes("'/html2canvas.min.js'"), 'SW 应把同源 /html2canvas.min.js 纳入缓存策略（离线导出）');
  assert.ok(!sw.includes('cdn.jsdelivr.net'), 'SW 不应再拦 CDN 版 html2canvas');
});

test('html2canvas.min.js 已随仓库自托管（部署需带上）', () => {
  assert.ok(fs.existsSync(path.join(ROOT, 'html2canvas.min.js')), '仓库根应存在自托管的 html2canvas.min.js');
});
