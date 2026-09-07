#!/usr/bin/env node
// NoteSync MCP Server (stdio, 零依赖, node>=18) —— v6.3 新增
// ============================================================
// 让 WorkBuddy 等 MCP 宿主以结构化工具方式操作 NoteSync 笔记。
// 零知识不变：口令只存在本机 MCP 配置的 env 里，PBKDF2(200k)+AES-256-GCM
// 全部本地完成，服务端只见密文（与 web 端 index.html 的实现逐字节同构）。
//
// 环境变量（写在 ~/.workbuddy/mcp.json 的 env 字段，不进 git）：
//   NOTESYNC_BASE        服务基址，默认 https://biji.xuyinji.com.cn
//   NOTESYNC_NOTE        默认笔记名（工具入参 name 未传时用它）
//   NOTESYNC_PASSPHRASE  笔记口令（必填）
//   NOTESYNC_OUT_DIR     note_read 生成图片的输出目录，默认系统临时目录/notesync-mcp
//
// 工具集：
//   note_locate  按名称定位笔记（可附带试解密验证）
//   note_read    获取笔记全文：text 纯文本 / html 原文 / image 长图 PNG
//   note_edit    追加/插入/删除一段文字（纯文本语义，位置按可见字符计）
//   note_image   本机图片上传 Cloudinary 后插入正文 <img>（v7.1.1，不压缩直传 ≤8MB）
//   note_remind  提醒管理：add 设提醒（回写正文行）/ list 列出 / cancel 取消 / clear 清理过期（v7.1.1）

'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const BASE = (process.env.NOTESYNC_BASE || 'https://biji.xuyinji.com.cn').replace(/\/+$/, '');
const DEFAULT_NOTE = process.env.NOTESYNC_NOTE || '';
const PASSPHRASE = process.env.NOTESYNC_PASSPHRASE || '';
const OUT_DIR = process.env.NOTESYNC_OUT_DIR || path.join(os.tmpdir(), 'notesync-mcp');
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const PBKDF2_ITER = 200000; // 与 index.html PBKDF2_ITER 严格一致
const REM_MAX = 10;         // 未来提醒上限（与 index.html REM_MAX 一致）
const REM_DONE_MAX = 20;    // 已触发条目保留上限 FIFO（与 index.html REM_DONE_MAX 一致）

// ---------- Cloudinary（v7.1.1 note_image） ----------
// 与 web 端 index.html 同源同值（unsigned preset，非密钥可公开）——改一处必须同步另一处。
const CLOUD_NAME = 'dntsgx6t3';
const UPLOAD_PRESET = 'NoteXCloudinary';
const CLOUDINARY_URL = 'https://api.cloudinary.com/v1_1/' + CLOUD_NAME + '/image/upload';
const IMG_MAX_BYTES = 8 * 1024 * 1024; // MCP 直传不压缩（web 端才压缩到 1920 宽），上限 8MB
const IMG_EXT_RE = /\.(png|jpe?g|gif|webp)$/i;

// ---------- 加解密（与 web 端同构） ----------
const keyCache = new Map(); // key = name + '|' + saltB64
function deriveKeySync(pass, saltBuf) {
  return crypto.pbkdf2Sync(Buffer.from(pass, 'utf8'), saltBuf, PBKDF2_ITER, 32, 'sha256');
}
function getKeyFor(name, saltB64) {
  const k = name + '|' + saltB64;
  if (keyCache.has(k)) return keyCache.get(k);
  const raw = deriveKeySync(PASSPHRASE, Buffer.from(saltB64, 'base64'));
  keyCache.set(k, raw);
  return raw;
}
function encryptText(text, keyRaw, ivBuf) {
  const iv = ivBuf || crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', keyRaw, iv);
  const ct = Buffer.concat([c.update(Buffer.from(text, 'utf8')), c.final(), c.getAuthTag()]);
  return { ct: ct.toString('base64'), iv: iv.toString('base64') };
}
function decryptText(ctB64, ivB64, keyRaw) {
  const ct = Buffer.from(ctB64, 'base64');
  // 16 字节 = 纯 GCM tag = 空明文（web 端 webcrypto 无长度守卫，清空正文会产出 16 字节密文，
  // v7.1.1 起 MCP 与 web 语义对齐：16 字节合法解出空串；<16 才是真截断）
  if (ct.length < 16) throw new Error('ciphertext too short');
  const tag = ct.subarray(ct.length - 16);
  const body = ct.subarray(0, ct.length - 16);
  const d = crypto.createDecipheriv('aes-256-gcm', keyRaw, Buffer.from(ivB64, 'base64'));
  d.setAuthTag(tag);
  return Buffer.concat([d.update(body), d.final()]).toString('utf8');
}

// ---------- API ----------
async function apiGet(name) {
  const r = await fetch(BASE + '/api/note/' + encodeURIComponent(name), { cache: 'no-store' });
  if (!r.ok) throw new Error('GET /api/note failed: HTTP ' + r.status);
  return r.json();
}
async function apiPut(name, obj) {
  const r = await fetch(BASE + '/api/note/' + encodeURIComponent(name), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(obj),
  });
  const j = await r.json().catch(() => ({}));
  if (r.status === 409) { const e = new Error('version conflict'); e.conflict = true; e.serverV = j.v; throw e; }
  if (!r.ok) throw new Error('PUT /api/note failed: HTTP ' + r.status);
  return j;
}
function assertName(name) {
  if (!name || !ID_RE.test(name)) throw new Error('笔记名只允许英数/下划线/短横线，1-64 字符：' + name);
}
function mustPass() {
  if (!PASSPHRASE) throw new Error('未配置 NOTESYNC_PASSPHRASE（写在 MCP 配置的 env 里，不进对话不进 git）');
}

// 读取+解密主文档；处女笔记（无盐）时生成新盐
async function loadNote(name) {
  mustPass();
  const note = await apiGet(name);
  let saltB64 = note.salt || '';
  let fresh = false;
  if (!saltB64) { saltB64 = crypto.randomBytes(16).toString('base64'); fresh = true; }
  const key = getKeyFor(name, saltB64);
  let html = '';
  if (note.ct && note.iv && !fresh) {
    try { html = decryptText(note.ct, note.iv, key); }
    catch (e) { const err = new Error('解密失败：口令不对或密文损坏'); err.decrypt = true; throw err; }
  }
  return { note, saltB64, key, html, fresh, v: note.v || 0 };
}

// ---------- 纯文本 <-> HTML（带可见字符偏移映射，供插入/删除定位） ----------
function decodeEntities(s) {
  return s.replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&amp;/g, '&');
}
function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
// 遍历 HTML，产出纯文本 text 与 map（map[p] = 该可见字符在 HTML 中的起始下标）。
// 换行符也登记进 map，锚点=对应闭合/br 标签的起始下标——这样「删到行尾」「插在行尾」
// 的边界都落在标签之外紧贴纯文本处，不会把 </div> 卷进删除区间。
function htmlToPlainMap(html) {
  let text = '', map = [];
  let i = 0, n = html.length;
  const NL_AFTER = /^<\/(div|p|h[1-6]|li)>|^<br\b/i;
  while (i < n) {
    if (html[i] === '<') {
      const close = html.indexOf('>', i);
      const tag = close === -1 ? html.slice(i) : html.slice(i, close + 1);
      if (NL_AFTER.test(tag)) { map.push({ p: text.length, h: i }); text += '\n'; }
      i = close === -1 ? n : close + 1;
      continue;
    }
    // 实体折叠为一个可见字符
    const amp = html.indexOf('&', i);
    if (amp === i) {
      const semi = html.indexOf(';', i);
      const ent = semi !== -1 && semi - i <= 8 ? html.slice(i, semi + 1) : '';
      const dec = ent ? decodeEntities(ent) : '';
      if (dec && dec !== ent) { map.push({ p: text.length, h: i }); text += dec; i = semi + 1; continue; }
    }
    map.push({ p: text.length, h: i });
    text += html[i];
    i++;
  }
  return { text, map };
}
function plainToHtmlIndex(pm, p) {
  if (p <= 0) return 0;
  if (pm.map.length === 0) return 0;
  if (p >= pm.text.length) return pm.map[pm.map.length - 1].h; // 文档末尾=最后一个锚点（行尾/块边界）
  return pm.map[p].h;
}

// ---------- 工具实现 ----------
async function toolLocate(args) {
  const name = args.name || DEFAULT_NOTE;
  assertName(name);
  let note;
  try { note = await apiGet(name); }
  catch (e) { return { exists: false, name, error: String(e.message || e) }; }
  const out = { exists: true, name, v: note.v || 0, updatedAt: note.updatedAt || 0, size: (note.ct || '').length };
  if (args.verify_decrypt) {
    mustPass();
    if (!note.salt) out.readable = false;
    else {
      try { decryptText(note.ct, note.iv, getKeyFor(name, note.salt)); out.readable = true; }
      catch (e) { out.readable = false; }
    }
  }
  return out;
}

async function toolRead(args) {
  const name = args.name || DEFAULT_NOTE;
  assertName(name);
  const format = args.format || 'text';
  const { html } = await loadNote(name);
  if (format === 'html') return { name, format, html };
  if (format === 'text') {
    const { text } = htmlToPlainMap(html);
    return { name, format, text };
  }
  if (format === 'image') {
    const png = await renderImage(html);
    return { name, format: 'image', path: png.path, bytes: png.bytes, width: png.width, height: png.height };
  }
  throw new Error('format 只支持 text | html | image');
}

// 图片渲染：优先用仓库内 Playwright（tests/node_modules，e2e 同款 chromium）；
// 不可用时落一个 .html 文件并明确报错（宿主可自行预览），绝不静默。
async function renderImage(html) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  let chromium = null;
  const candidates = [
    'playwright',
    path.join(__dirname, '..', 'tests', 'node_modules', 'playwright'),
    path.join(__dirname, '..', 'node_modules', 'playwright'),
  ];
  for (const c of candidates) {
    try { chromium = require(c).chromium; break; } catch (e) { /* try next */ }
  }
  if (!chromium) {
    const htmlPath = path.join(OUT_DIR, 'note-' + stamp + '.html');
    const page = '<!DOCTYPE html><meta charset="utf-8"><title>NoteSync 导出</title><body style="font:15px/1.7 system-ui;max-width:760px;margin:32px auto;white-space:pre-wrap">' + html;
    fs.writeFileSync(htmlPath, page);
    const err = new Error('本机没有可用的 Playwright chromium，无法出图；已生成 HTML 版：' + htmlPath +
      '（在仓库 tests/ 下安装 playwright 并 npx playwright install chromium 后重试）');
    err.htmlPath = htmlPath;
    throw err;
  }
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 800, height: 1000 }, deviceScaleFactor: 2 });
    await page.setContent('<!DOCTYPE html><html><head><meta charset="utf-8"><style>' +
      'body{font:15px/1.7 -apple-system,"Segoe UI","Microsoft YaHei",sans-serif;color:#1a1c23;background:#fff;padding:32px 40px}' +
      'div,p{min-height:1em;margin:0}u.rem-mark{text-decoration:underline}s{text-decoration:line-through}a{color:#2456c8}' +
      'img{max-width:100%;height:auto}' + // v7.1.1：note_image 落地后宽图长图导出不横向爆版
      '</style></head><body>' +
      html + '</body></html>', { waitUntil: 'load' });
    const dims = await page.evaluate(() => ({ w: document.documentElement.scrollWidth, h: document.documentElement.scrollHeight }));
    const pngPath = path.join(OUT_DIR, 'note-' + stamp + '.png');
    const buf = await page.screenshot({ fullPage: true, path: pngPath, type: 'png' });
    // v6.3 验收修正：piped-stdio MCP 宿主下 chromium 子进程继承 stdio 句柄，
    // await browser.close() 死锁 → JSON-RPC 响应永远发不出去（WorkBuddy 宿主实测必现）。
    // 截图落盘后立即返回；关闭挪到后台 2.5s 超时竞速，超时强杀进程兜底，绝不阻塞应答。
    setTimeout(() => {
      Promise.race([
        browser.close().catch(() => {}),
        new Promise(r => setTimeout(r, 2500)),
      ]).catch(() => {}).then(() => {
        try { const p = browser.process(); if (p && p.exitCode === null) { try { p.kill(); } catch (e) {} } } catch (e) {}
      });
    }, 0).unref();
    return { path: pngPath, bytes: buf.byteLength, width: dims.w, height: dims.h };
  } catch (e) {
    // 异常路径同样不 await close（同一死锁面）：1.5s 后强杀回收进程
    setTimeout(() => { try { const p = browser.process(); if (p && p.exitCode === null) { try { p.kill(); } catch (e2) {} } } catch (e2) {} }, 1500).unref();
    throw e;
  }
}

async function withRetry409(name, fn, tries) {
  for (let i = 0; ; i++) {
    try { return await fn(); }
    catch (e) {
      if (e.conflict && i < (tries || 3)) continue; // 409 → 重读-改-重写
      throw e;
    }
  }
}

async function toolEdit(args) {
  const name = args.name || DEFAULT_NOTE;
  assertName(name);
  const op = args.op;
  if (!['append', 'insert', 'delete'].includes(op)) throw new Error('op 只支持 append | insert | delete');
  if (op !== 'delete' && typeof args.text !== 'string') throw new Error('缺少 text');
  return withRetry409(name, async () => {
    const { note, saltB64, key, html, fresh, v } = await loadNote(name);
    let nextHtml = html;
    if (op === 'append') {
      const block = '<div>' + escapeHtml(args.text) + '</div>';
      nextHtml = html ? html + block : block;
    } else if (op === 'insert') {
      const pm = htmlToPlainMap(html);
      let at = -1;
      if (typeof args.position === 'number') at = plainToHtmlIndex(pm, Math.max(0, Math.floor(args.position)));
      else if (args.match) {
        const idx = html.indexOf(escapeHtml(args.match)); // match 按 HTML 源串查找（纯文本行两者一致）
        if (idx === -1) throw new Error('未在正文中找到 match：' + args.match);
        at = args.where === 'after' ? idx + escapeHtml(args.match).length : idx;
      } else throw new Error('insert 需要 position（纯文本字符偏移）或 match（HTML 源串子串）');
      nextHtml = html.slice(0, at) + escapeHtml(args.text) + html.slice(at);
    } else { // delete
      const pm = htmlToPlainMap(html);
      let hStart, hEnd;
      if (args.match) {
        const p = pm.text.indexOf(args.match);
        if (p === -1) throw new Error('未在正文纯文本中找到 match：' + args.match);
        hStart = plainToHtmlIndex(pm, p);
        hEnd = plainToHtmlIndex(pm, p + args.match.length);
      } else if (typeof args.position === 'number' && typeof args.length === 'number') {
        hStart = plainToHtmlIndex(pm, Math.max(0, Math.floor(args.position)));
        hEnd = plainToHtmlIndex(pm, Math.max(0, Math.floor(args.position)) + Math.max(0, Math.floor(args.length)));
      } else throw new Error('delete 需要 match 或 position+length');
      const slice = html.slice(hStart, hEnd);
      if (slice.includes('<')) throw new Error('删除区间跨过了结构边界（含标签），请缩小范围或改用 match 精确匹配');
      nextHtml = html.slice(0, hStart) + html.slice(hEnd);
    }
    const enc = encryptText(nextHtml, key);
    const body = { ct: enc.ct, iv: enc.iv, salt: saltB64, baseV: v };
    if (note.rem !== undefined) body.rem = note.rem; // 只动正文，提醒原样透传
    const r = await apiPut(name, body);
    return { ok: true, op, v: r.v, snippet: nextHtml.replace(/<[^>]+>/g, '').slice(0, 120) };
  });
}

// 回写正文行的时间串：与 web 端 fmtRemInsert（index.html「function fmtRemInsert」）逐字同构——
// 年-月-日 时:分（年月日时不补零、分补零两位）。正文行经 web collectTimeMatches 解析后
// 必须得到与 rem.at 完全一致的 at，下划线/触发后删除线才会命中。
function fmtRemLine(at) {
  const d = new Date(at);
  return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate() + ' ' + d.getHours() + ':' + String(d.getMinutes()).padStart(2, '0');
}
// 与 web 端 normalizeRemList（index.html「function normalizeRemList」）同构：
// 合法条目过滤 → at 升序 → 未来全留（上限 REM_MAX 由 add 把守）→ 已过期/已触发留最新 REM_DONE_MAX 条
function normRemList(list) {
  const now = Date.now();
  const all = list
    .filter(r => r && typeof r.at === 'number')
    .map(r => ({ at: r.at, text: typeof r.text === 'string' ? r.text : '', fired: !!r.fired }))
    .sort((a, b) => a.at - b.at);
  const future = all.filter(r => r.at > now).slice(0, REM_MAX); // 与 web 同构：异常超限时留最近 REM_MAX 条（验收路三 P07b）
  const done = all.filter(r => r.at <= now).slice(-REM_DONE_MAX);
  return future.concat(done).sort((a, b) => a.at - b.at);
}
// cancel/clear 的 PUT：服务端缺 ct/iv/salt 直接 400（missing fields），空串字段才保留原值——
// 「不动正文」指明文不变，密文层必须连同 ct/iv/salt 一起重加密提交，409 由 withRetry409 兜。
// 清空后 rem 用显式 null（服务端约定 null=取消提醒，写 {"list":[]} 语义不等价）。
async function putBodyPreservingHtml(name, html, saltB64, key, v, remValue) {
  const encHtml = encryptText(html, key);
  const body = { ct: encHtml.ct, iv: encHtml.iv, salt: saltB64, baseV: v };
  if (remValue !== undefined) body.rem = remValue;
  return apiPut(name, body);
}
async function toolRemind(args) {
  const name = args.name || DEFAULT_NOTE;
  assertName(name);
  mustPass();
  const op = args.op || 'add';
  if (!['add', 'list', 'cancel', 'clear'].includes(op)) throw new Error('op 只支持 add | list | cancel | clear');
  return withRetry409(name, async () => {
    const { note, saltB64, key, html, v } = await loadNote(name);
    let list = [];
    if (note.rem) {
      const enc = JSON.parse(note.rem);
      const obj = JSON.parse(decryptText(enc.ct, enc.iv, key));
      list = Array.isArray(obj.list) ? obj.list.filter(r => r && typeof r.at === 'number')
        : (obj && typeof obj.at === 'number' ? [obj] : []); // v5.37 前单条目旧格式迁移（与 web normalizeRemList 同构，防 add 静默丢旧提醒——验收路三 P17）
    }
    const now = Date.now();

    if (op === 'list') {
      return { list: list.slice().sort((a, b) => a.at - b.at).map(r => ({
        at: r.at, atStr: fmtRemLine(r.at), text: r.text || '', fired: !!r.fired, expired: r.at <= now,
      })) };
    }

    if (op === 'cancel') {
      let atNum = typeof args.at === 'number' ? args.at : parseAt(typeof args.at === 'string' ? args.at : '');
      if (atNum === null || atNum === undefined) throw new Error('cancel 需要 at（数字时间戳或可解析的时间串；先用 op=list 拿精确值）');
      const gone = list.find(r => r.at === atNum);
      if (!gone) throw new Error('未找到该时刻的提醒：' + atNum + '（可先 op=list 查看）');
      const next = normRemList(list.filter(r => r.at !== atNum));
      // 逐字对齐 web removeReminder：只删 rem 条目，正文文字行保留（时间串回归普通文本）
      const r = await putBodyPreservingHtml(name, html, saltB64, key, v,
        next.length ? JSON.stringify(encryptText(JSON.stringify({ list: next }), key)) : null);
      return { ok: true, op, removed: { at: gone.at, atStr: fmtRemLine(gone.at), text: gone.text || '' }, futureCount: next.filter(x => x.at > now).length, v: r.v };
    }

    if (op === 'clear') {
      const next = normRemList(list.filter(r => r.at > now));
      const cleared = list.length - next.length;
      if (cleared === 0 && next.length === list.length) return { ok: true, op, cleared: 0, futureCount: next.length }; // 无可清，不发起 PUT
      const r = await putBodyPreservingHtml(name, html, saltB64, key, v,
        next.length ? JSON.stringify(encryptText(JSON.stringify({ list: next }), key)) : null);
      return { ok: true, op, cleared, futureCount: next.length, v: r.v };
    }

    // op === 'add'（默认）：v7.1.1 起回写正文行（与 web 面板 insertRemLine 同构；MCP 无光标，固定追加正文末尾）
    const at = parseAt(args.at);
    if (at === null) throw new Error('at 需为 "YYYY-MM-DDTHH:MM" 或 "YYYY-M-D H:MM"（本地时区，分钟级，不带秒与时区）或中文相对时间（如 明天早上9点、这周五18:30、下个月1号 18:50）');
    if (at <= Date.now() + 30000) throw new Error('过去或 30 秒内的时间不能设提醒：' + args.at + '（若是「这周X」已过，可改用「下周X」）');
    const text = String(args.text || '').trim().slice(0, 20); // 与 web chip 面板同口径：先 trim 再截 20
    const dup = list.find(r => r.at === at);
    const future = list.filter(r => r.at > now);
    if (!dup && future.length >= REM_MAX) throw new Error('提醒最多 ' + REM_MAX + ' 条（当前未来提醒 ' + future.length + ' 条），先取消一些吧');
    const next = normRemList(list.filter(r => r.at !== at));
    next.push({ at, text, fired: false });
    next.sort((a, b) => a.at - b.at);
    const line = fmtRemLine(at) + (text ? '　' + text : ''); // 全角空格 U+3000，与 web fmtRemInsert+'　'+item 逐字一致
    const nextHtml = html + '<div>' + escapeHtml(line) + '</div>';
    const re = encryptText(JSON.stringify({ list: next }), key);
    const r = await putBodyPreservingHtml(name, nextHtml, saltB64, key, v, JSON.stringify(re));
    return { ok: true, op, v: r.v, at, atStr: fmtRemLine(at), text, futureCount: next.filter(x => x.at > Date.now()).length, bodyLine: line, overwrote: !!dup };
  });
}
// ---------- note_image：本机图片 → Cloudinary → 正文插 <img>（v7.1.1） ----------
// 线上 CSP 已放行：img-src https://res.cloudinary.com + connect-src api.cloudinary.com（Caddy 头），
// web 端正文渲染 <img> 无障碍；正文保存走 isDecorativelyEqual 之外的结构标签，不受纯文本转义影响。
async function toolImage(args) {
  const name = args.name || DEFAULT_NOTE;
  assertName(name);
  const p = String(args.path || '');
  if (!p) throw new Error('path 必填（本机图片绝对路径）');
  if (!IMG_EXT_RE.test(p)) throw new Error('只支持 png/jpg/jpeg/gif/webp：' + p);
  let buf;
  try { buf = fs.readFileSync(p); } catch (e) { throw new Error('读取图片失败：' + p + '（' + (e.code || e.message) + '）'); }
  if (buf.length > IMG_MAX_BYTES) throw new Error('图片超过 8MB（实际 ' + (buf.length / 1048576).toFixed(1) + 'MB）；MCP 直传不压缩，请先缩小后再试');

  // 上传放在重试闭包外：409 重试只重做 PUT，绝不重复上传产生垃圾文件（对抗审 P1-2）
  const fd = new FormData();
  fd.append('file', new Blob([buf]), path.basename(p));
  fd.append('upload_preset', UPLOAD_PRESET);
  let url = '';
  try {
    const resp = await fetch(CLOUDINARY_URL, { method: 'POST', body: fd, signal: AbortSignal.timeout(30000) });
    let j = null;
    try { j = await resp.json(); } catch (e) { throw new Error('Cloudinary 响应非 JSON：HTTP ' + resp.status); }
    if (!resp.ok || !j || !j.secure_url) {
      throw new Error('Cloudinary 上传失败：HTTP ' + resp.status + (j && j.error && j.error.message ? ' ' + j.error.message : ''));
    }
    url = j.secure_url;
  } catch (e) {
    if (e.name === 'TimeoutError') throw new Error('Cloudinary 上传超时（30s），未写入笔记');
    throw e;
  }
  if (!/^https:\/\/res\.cloudinary\.com\//.test(url)) throw new Error('Cloudinary 返回了非预期的 URL，拒绝写入笔记：' + url);

  const imgHtml = '<img src="' + escapeHtml(url) + '">';
  try {
    return await withRetry409(name, async () => {
      const { note, saltB64, key, html, v } = await loadNote(name);
      let nextHtml;
      const located = typeof args.position === 'number' || args.match !== undefined;
      if (located) {
        const pm = htmlToPlainMap(html);
        let at;
        if (typeof args.position === 'number') {
          at = plainToHtmlIndex(pm, Math.max(0, Math.floor(args.position)));
        } else {
          const m = String(args.match || '');
          if (!m.trim()) throw new Error('match 不能为空（按纯文本子串定位；正文里的 &<>"\' 存储为 HTML 实体，直接给纯文本即可）');
          const idx = html.indexOf(escapeHtml(m)); // 与 toolEdit 同口径：纯文本子串，内部转义后查找
          if (idx === -1) throw new Error('未在正文中找到 match：' + m);
          at = args.where === 'before' ? idx : idx + escapeHtml(m).length;
        }
        nextHtml = html.slice(0, at) + imgHtml + html.slice(at);
      } else {
        nextHtml = html + '<div>' + imgHtml + '</div>'; // 默认：正文末尾独立一行（与 web 行块结构一致）
      }
      const enc = encryptText(nextHtml, key);
      const body = { ct: enc.ct, iv: enc.iv, salt: saltB64, baseV: v };
      if (note.rem !== undefined) body.rem = note.rem; // 只动正文，提醒原样透传
      const r = await apiPut(name, body);
      return { ok: true, url, v: r.v, inserted: located ? 'inline' : 'append' };
    });
  } catch (e) {
    const err = new Error((e.message || String(e)) + '｜图片已上传成功：' + url + '（可重试写入或手动插入该 URL）');
    err.uploadedUrl = url;
    throw err;
  }
}

// 中文相对时间表（与 web 端逐字一致）：[日期段]? [\s]* [时段词]? [\s]* [时刻]，锚定全串匹配。
// H 左邻不设 (?<![年月日号:])：锚定全串下「2026年9月8日18点」整体必不匹配（天然防护），
// 而日期段结尾（日/号）直接接 H点 是合法形态（本月10日18点30 / 下周日9点）——裁决 2025-09-07。
// 红线由 toolRemind 执行：算出过去（含 now+30s 内）一律视为过期。
const REL_RE = /^(大后天|明天|后天|今天|这周[一二三四五六日天]|下周[一二三四五六日天]|(?:这个月|本月)(\d{1,2})[日号]|(?:下个月|下月)(\d{1,2})[日号])?\s*(凌晨|早上|上午|中午|下午|傍晚|晚上|夜里)?\s*(?:(?<!\d)(\d{1,2}):(\d{2})(?!\d)|(?<!\d)(?<!第)(\d{1,2})点(?:(\d{1,2})分?|(半))?(?!\d))$/;
const REL_WD = { '一': 0, '二': 1, '三': 2, '四': 3, '五': 4, '六': 5, '日': 6, '天': 6 }; // 周首日=周一
// 带年份完整中文日期（与 web 端 reFullCn 同构）：绝对年份不滚动，hh:mm 直用，锚定整串
const REL_FULLCN_RE = /^(\d{4})年(\d{1,2})月(\d{1,2})日\s*(\d{1,2}):(\d{2})$/;
// 兜底守门（与 web 端边界防护同构）：串含相对时间/时刻 token 却未整体命中 REL_RE
// = 形似时间但被防护拒绝（10:301 / 3点2019 / 本周五 18:00 / 会议纪要　明天10点 …），
// 一律 null，绝不放进 Date.parse（V8 会把 10:301 之类误解析成 1970 年怪值）。
const REL_GATE_RE = /年|月|\d{1,2}:\d{1,2}|\d{1,2}点|今天|明天|后天|这周|下周|本周|星期|礼拜/;
function parseAt(s, now = Date.now()) {
  if (typeof s !== 'string' || !s) return null;
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{2})$/);
  if (m) {
    const t = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]).getTime();
    return isNaN(t) ? null : t;
  }
  m = s.match(REL_FULLCN_RE); // 2027年5月1日 07:00（无空格 \s* 亦通）：绝对年份原生构造
  if (m) {
    const h = +m[4], mi = +m[5];
    if (h > 23 || mi > 59) return null;
    const t = new Date(+m[1], +m[2] - 1, +m[3], h, mi).getTime();
    return isNaN(t) ? null : t;
  }
  m = s.trim().match(REL_RE); // 相对时间表：须恰好一个匹配覆盖整个字符串
  if (m) {
    const base = new Date(now);
    const y = base.getFullYear(), mo = base.getMonth(), d = base.getDate();
    let monthShift = 0, targetD = d;
    const seg = m[1];
    if (seg === '今天') targetD = d;
    else if (seg === '明天') targetD = d + 1;
    else if (seg === '后天') targetD = d + 2;
    else if (seg === '大后天') targetD = d + 3;
    else if (seg && seg.length === 3 && (seg[0] === '这' || seg[0] === '下')) {
      // 这周X/下周X：dayIdx=(getDay()+6)%7（周一=0..周日=6），本周一+dayIdx(X)天，下周再+7
      targetD = d - ((base.getDay() + 6) % 7) + REL_WD[seg[2]] + (seg[0] === '下' ? 7 : 0);
    } else if (seg) {
      const n = +(m[2] || m[3]);
      if (seg[0] === '下') { // 下(个)月N日/号：new Date 原生滚动跨年（12月→次年1月），与 web 端 reRel 同收 [日号]
        if (!(n >= 1 && n <= new Date(y, mo + 2, 0).getDate())) return null;
        monthShift = 1;
      } else { // (这个)月N日/号：超当月天数→null
        if (!(n >= 1 && n <= new Date(y, mo + 1, 0).getDate())) return null;
      }
      targetD = n;
    }
    let h, mi;
    if (m[5] !== undefined) { // hh:mm 一律直用（时段词不生效）
      h = +m[5]; mi = +m[6];
      if (!(h <= 23 && mi <= 59)) return null;
    } else { // H点[半|M分|M]
      h = +m[7]; mi = m[8] !== undefined ? +m[8] : (m[9] !== undefined ? 30 : 0); // 半=30分
      if (!(h <= 23 && mi <= 59)) return null;
      const p = m[4];
      if (p === '凌晨') { if (h === 12) h = 0; } // 凌晨12点=当天00:xx
      else if (p === '早上' || p === '上午') { /* 原值 */ }
      else if (p === '中午') { if (h >= 1 && h <= 5) h += 12; }
      else if (p === '下午' || p === '傍晚') { if (h >= 1 && h <= 11) h += 12; }
      else if (p === '晚上' || p === '夜里') {
        if (h === 12) h = 24;               // 晚上12点=次日00:xx
        else if (h >= 1 && h <= 5) h += 24; // 次日凌晨
        else if (h >= 6 && h <= 11) h += 12;
      }
    }
    const t = new Date(y, mo + monthShift, targetD, h, mi).getTime(); // 原生进位，禁手工钳制
    return isNaN(t) ? null : t;
  }
  if (REL_GATE_RE.test(s)) return null; // 兜底守门：形似时间未整串命中 → 防护拒绝
  const t = Date.parse(s);
  return isNaN(t) ? null : t;
}

// ---------- MCP over stdio ----------
const TOOLS = [
  {
    name: 'note_locate',
    description: '按名称定位 NoteSync 笔记，返回是否存在/版本/更新时间/密文大小；verify_decrypt=true 时附带试解密（readable）',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: '笔记名（英文/数字/_/-，1-64 字符）' },
        verify_decrypt: { type: 'boolean', description: '是否用口令试解密验证可读' },
      },
    },
  },
  {
    name: 'note_read',
    description: '获取笔记全文。format=text 纯文本（<br>/<div> 转 \\n）；format=html 解密后的原始 HTML；format=image 渲染为长图 PNG 并返回本机文件路径',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        format: { type: 'string', enum: ['text', 'html', 'image'] },
      },
      required: ['format'],
    },
  },
  {
    name: 'note_edit',
    description: '编辑笔记正文。op=append 在末尾追加一行；op=insert 按 position（纯文本字符偏移）或 match（HTML 源串子串，where=before/after）插入；op=delete 按 match 或 position+length 删除（不允许跨结构边界）',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        op: { type: 'string', enum: ['append', 'insert', 'delete'] },
        text: { type: 'string', description: 'append/insert 要写入的文字（自动 HTML 转义）' },
        position: { type: 'number', description: '纯文本可见字符偏移（insert 起点 / delete 起点）' },
        length: { type: 'number', description: 'delete 删除的可见字符数' },
        match: { type: 'string', description: '定位锚点（纯文本子串；正文中的 &<>"\' 存储为 HTML 实体，直接给纯文本即可）' },
        where: { type: 'string', enum: ['before', 'after'], description: 'insert 相对 match 的位置' },
      },
      required: ['op'],
    },
  },
  {
    name: 'note_image',
    description: '把本机图片加入笔记：上传 Cloudinary 后在正文插入 <img>（线上 CSP 已放行该域）。默认追加为正文末尾独立一行；给 match（纯文本子串，where=before/after）或 position（纯文本偏移）可内联插入。png/jpg/jpeg/gif/webp，≤8MB，直传不压缩',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        path: { type: 'string', description: '本机图片绝对路径' },
        match: { type: 'string', description: '定位锚点（纯文本子串），与 where 配合内联插入' },
        position: { type: 'number', description: '纯文本可见字符偏移（与 match 二选一）' },
        where: { type: 'string', enum: ['before', 'after'], description: '相对 match 的位置，默认 after' },
      },
      required: ['path'],
    },
  },
  {
    name: 'note_remind',
    description: '笔记提醒管理（v7.1.1 起）。op=add（默认）设提醒：at 支持相对时间，上限 10 条未来提醒，同刻重设=更新文案，并在正文末尾回写「时间　事项」一行；op=list 列出全部提醒（含 at 精确值，供 cancel 用）；op=cancel 按 at 取消一条（只删提醒，不动正文文字——与网页端一致）；op=clear 清理全部已过期/已触发条目',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        op: { type: 'string', enum: ['add', 'list', 'cancel', 'clear'], description: 'add=设提醒（默认）/ list=列出 / cancel=取消一条 / clear=清理过期' },
        at: { type: ['string', 'number'], description: 'add：提醒时刻，支持 "YYYY-MM-DDTHH:MM" 或 YYYY-M-D H:MM（本地时区，分钟级，不带秒与时区）；中文相对时间 [今天/明天/后天/大后天|这周X/下周X|本月N日(号)/下个月N号]? [凌晨/早上/上午/中午/下午/傍晚/晚上/夜里]? [hh:mm 或 H点/H点半/H点M分/H点M]，如「明天早上9点」「这周五18:30」「下个月1号 18:50」「晚上12点半」。cancel：数字时间戳或可解析的时间串（建议先 op=list 取精确值）' },
        text: { type: 'string', description: '提醒事项（≤20 字，可空；仅 add 用）' },
      },
    },
  },
];

const IMPLS = { note_locate: toolLocate, note_read: toolRead, note_edit: toolEdit, note_image: toolImage, note_remind: toolRemind };

function rpcResult(id, result) { process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n'); }
function rpcError(id, code, message) {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } }) + '\n');
}

function handleLine(line) {
  let msg;
  try { msg = JSON.parse(line); } catch (e) { return; }
  const { id, method, params } = msg;
  if (method === 'initialize') {
    rpcResult(id, {
      protocolVersion: '2024-11-05',
      capabilities: { tools: {} },
      serverInfo: { name: 'notesync', version: '7.1.1' },
    });
    return;
  }
  if (method === 'notifications/initialized' || (method || '').startsWith('notifications/')) return;
  if (method === 'ping') { rpcResult(id, {}); return; }
  if (method === 'tools/list') {
    rpcResult(id, { tools: TOOLS });
    return;
  }
  if (method === 'tools/call') {
    const name = params && params.name;
    const args = (params && params.arguments) || {};
    const fn = IMPLS[name];
    if (!fn) { rpcError(id, -32602, 'unknown tool: ' + name); return; }
    fn(args).then(result => {
      rpcResult(id, { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] });
    }).catch(e => {
      rpcResult(id, { content: [{ type: 'text', text: 'ERROR: ' + (e.message || String(e)) }], isError: true });
    });
    return;
  }
  if (id !== undefined) rpcError(id, -32601, 'method not found: ' + method);
}

// 仅直接运行时启动 stdio 服务；被 require（如对齐测试）时不挂住 stdin/stdout
if (require.main === module) {
  let buf = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => {
    buf += chunk;
    let idx;
    while ((idx = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (line) handleLine(line);
    }
  });
  process.stdin.on('end', () => process.exit(0));
  process.stderr.write('[notesync-mcp] ready base=' + BASE + ' note=' + (DEFAULT_NOTE || '(per-call)') + ' pass=' + (PASSPHRASE ? 'set' : 'MISSING') + '\n');
}

module.exports = { parseAt, toolRemind, toolImage, fmtRemLine, encryptText, decryptText, getKeyFor };
