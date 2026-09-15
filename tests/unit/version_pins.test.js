'use strict';
// 版本 pin 一致性自检（V4 阶段1）：三源（index.html / build.gradle / mcp-server）必须一致，红了列出待改文件
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');

function read(rel) { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); }
function first(src, re) { const m = src.match(re); return m ? m[1] : null; }

const html = read('index.html');
const gradle = read(path.join('android', 'app', 'build.gradle'));
const mcp = read(path.join('tools', 'notesync-mcp-server.js'));

const APP_VERSION = first(html, /const APP_VERSION = '([^']+)'/);
const BUILD_DATE = first(html, /const BUILD_DATE = '([^']+)'/);
const versionCode = first(gradle, /versionCode\s+(\d+)/);
const versionName = first(gradle, /versionName\s+"([^"]+)"/);
const mcpVersion = first(mcp, /serverInfo:\s*\{\s*name:\s*'notesync',\s*version:\s*'([^']+)'\s*\}/);

test('三源版本 pin 一致（index.html ↔ gradle ↔ mcp-server）', () => {
  assert.ok(APP_VERSION, 'index.html 缺 const APP_VERSION');
  assert.ok(BUILD_DATE, 'index.html 缺 const BUILD_DATE');
  assert.ok(versionCode, 'build.gradle 缺 versionCode');
  assert.ok(versionName, 'build.gradle 缺 versionName');
  assert.ok(mcpVersion, 'notesync-mcp-server.js 缺 serverInfo');
  assert.strictEqual(versionName, APP_VERSION, 'gradle versionName ≠ APP_VERSION');
  assert.strictEqual(versionCode, APP_VERSION.replace(/\./g, ''), 'gradle versionCode ≠ APP_VERSION 去点');
  assert.strictEqual(mcpVersion, APP_VERSION, 'mcp serverInfo ≠ APP_VERSION');
  assert.match(BUILD_DATE, /^\d{4}-\d{2}-\d{2}$/, 'BUILD_DATE 须为 YYYY-MM-DD');
});

test('APP_VERSION 为三段式版本号', () => {
  assert.match(APP_VERSION, /^\d+\.\d+\.\d+$/, 'APP_VERSION 须为三段式（发版 tag 也用三段式）');
});

// 警告级：含版本引用的 unit 文件若完全不含当前 APP_VERSION，提示人工核对（历史版本注释文件属正常）
const pinFiles = ['pwa', 'qr_pairing', 'reminder', 'v556', 'v61', 'v61_behavior', 'v62', 'v63', 'v71', 'v711', 'v72', 'v830', 'v900']
  .map((n) => `tests/unit/${n}.test.js`);
const stale = pinFiles.filter((f) => !read(f).includes(APP_VERSION));
if (stale.length) {
  console.warn(`[version_pins] 未含当前版本 ${APP_VERSION} 的 pin 文件（可能为历史版本注释，人工核对）: ${stale.join(', ')}`);
}
