// v5.51：/api/app-version 路由单元测试（APK 热更新检查接口）
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const SERVER_PATH = path.resolve(__dirname, '..', '..', 'server.js');
const INDEX_PATH = path.resolve(__dirname, '..', '..', 'index.html');

function readServer() { return fs.readFileSync(SERVER_PATH, 'utf8'); }

// ── C1：路由存在 ──
test('C1 /api/app-version GET 路由已注册', () => {
  const src = readServer();
  assert.ok(src.includes("url === '/api/app-version'"), '应判断 url === /api/app-version');
  assert.ok(src.includes("req.method === 'GET'"), '应限定 GET 方法');
});

// ── C2：返回值包含 version / sha256 / size ──
test('C2 getAppVersionInfo 返回 {version, sha256, size}', () => {
  const src = readServer();
  assert.ok(src.includes("version: version, sha256: sha256, size: buf.length"),
    '返回对象应包含 version/sha256/size 三个字段');
});

// ── C3：缓存 TTL 非零 ──
test('C3 getAppVersionInfo 启用缓存（避免热更文件刚发版被旧缓存挡住）', () => {
  const src = readServer();
  assert.ok(src.match(/APP_VER_TTL\s*=\s*\d+/), '应定义 APP_VER_TTL 数值常量');
  assert.ok(src.includes('appVerCacheAt') && src.includes('appVerCache'),
    '应使用 appVerCache/appVerCacheAt 做时间窗缓存');
});

// ── C4：index.html 真有 APP_VERSION 常量供抓取 ──
test('C4 index.html 含 const APP_VERSION = \'5.51\'（正则抓取目标）', () => {
  const src = fs.readFileSync(INDEX_PATH, 'utf8');
  assert.ok(src.match(/const APP_VERSION\s*=\s*'5\.51'/), '正则应能匹配 APP_VERSION');
});