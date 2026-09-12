#!/usr/bin/env node
// NoteSync MCP Server (stdio, 零依赖, node>=18) —— v6.3 新增
// ============================================================
// 让 WorkBuddy 等 MCP 宿主以结构化工具方式操作 NoteSync 笔记。
// 零知识不变：口令只存在本机 MCP 配置的 env 里，PBKDF2(200k)+AES-256-GCM
// 全部本地完成，服务端只见密文（与 web 端 index.html 的实现逐字节同构）。
//
// 环境变量（写在 ~/.workbuddy/mcp.json 的 env 字段，不进 git）：
//   NOTESYNC_BASE        服务基址，默认 https://biji.xuyinji.com.cn
//   NOTESYNC_NOTE        默认笔记名（工具入参 name 未传时用它；也是注册表种子）
//   NOTESYNC_NOTES       种子笔记名，逗号分隔（v7.2.0 注册表）
//   NOTESYNC_PASSPHRASE  笔记口令（必填）
//   NOTESYNC_OUT_DIR     note_read 图片/note_export zip 的输出目录，默认系统临时目录/notesync-mcp
//   NOTESYNC_CACHE_DIR   注册表与索引的持久根目录，默认 ~/.notesync-mcp（v7.2.0）
//   NOTESYNC_INDEX_PLAIN 置 1 时检索索引明文落盘（调试用，默认加密）
//
// 工具集：
//   note_locate  按名称定位笔记（可附带试解密验证）
//   note_read    获取笔记全文：text 纯文本 / html 原文 / image 长图 PNG
//   note_edit    追加/插入/删除一段文字（纯文本语义，位置按可见字符计）
//   note_image   本机图片上传 Cloudinary 后插入正文 <img>（v7.1.1，不压缩直传 ≤8MB）；op=remove 按 URL 删图（v7.2.0）
//   note_remind  提醒管理：add 设提醒（回写正文行）/ list 列出 / cancel 取消 / clear 清理过期（v7.1.1）
//   note_search  全文检索：本地加密倒排索引+按版本号增量（v7.2.0）
//   note_export  一键备份 zip：plain（md+html+附件+manifest 明文）/ raw（密文免口令）（v7.2.0）
//   note_import  从备份 zip 恢复：默认 preview，白名单校验不静默剥离（v7.2.0）

'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');

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

// ---------- 本地缓存根目录（v7.2.0 note_search/note_export） ----------
// 注册表 + 索引都要求持久（系统临时目录会被清），默认 ~/.notesync-mcp，env 可改根目录。
const CACHE_DIR = process.env.NOTESYNC_CACHE_DIR || path.join(os.homedir(), '.notesync-mcp');
const REG_FILE = path.join(CACHE_DIR, 'registry.json');
const INDEX_DIR = path.join(CACHE_DIR, 'index');
const INDEX_SALT_FILE = path.join(CACHE_DIR, 'index.salt');
const INDEX_PLAIN = process.env.NOTESYNC_INDEX_PLAIN === '1'; // 调试用：索引明文落盘（默认关）
const SEED_NOTES_ENV = process.env.NOTESYNC_NOTES || '';       // 逗号分隔种子笔记名

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

// ---------- 笔记注册表（v7.2.0：note_search/note_export 的枚举前置） ----------
// 服务端没有列表 API 也绝不加（无鉴权=公开广播全部笔记名，安全模型降级）——
// 枚举走 MCP 本地注册表：env 种子 + 调用自动累积。stdio 单进程顺序执行，无需锁。
function regLoad() {
  let reg = null;
  try { reg = JSON.parse(fs.readFileSync(REG_FILE, 'utf8')); } catch (e) { reg = null; }
  if (!reg || !Array.isArray(reg.names)) reg = { names: [] };
  reg.names = [...new Set(reg.names.filter(n => typeof n === 'string' && ID_RE.test(n)))];
  return reg;
}
function regSave(reg) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  reg.updatedAt = Date.now();
  fs.writeFileSync(REG_FILE, JSON.stringify(reg, null, 2));
}
// 登记一个笔记名（自动累积）。注册表坏了自愈：重写只含本次名字。
function regAdd(name) {
  if (!name || !ID_RE.test(name)) return;
  const reg = regLoad();
  if (!reg.names.includes(name)) { reg.names.push(name); regSave(reg); }
}
// 启动种子：NOTESYNC_NOTE + NOTESYNC_NOTES 合入注册表（幂等，缺文件也能建）。
function regSeed() {
  const seeds = (DEFAULT_NOTE ? [DEFAULT_NOTE] : [])
    .concat(SEED_NOTES_ENV.split(',').map(s => s.trim()).filter(Boolean));
  if (!seeds.length) return;
  try {
    const reg = regLoad();
    const add = seeds.filter(n => ID_RE.test(n) && !reg.names.includes(n));
    if (add.length) { reg.names.push(...add); regSave(reg); }
  } catch (e) { /* 种子失败不挡服务启动 */ }
}
// names 入参解析：显式 names[]（逐个入册）优先，否则注册表全部；一个都没有则报错。
function resolveNames(args) {
  const explicit = Array.isArray(args && args.names) ? args.names.filter(Boolean) : null;
  const names = explicit || regLoad().names;
  for (const n of names) assertName(n);
  if (explicit) for (const n of names) regAdd(n);
  if (!names.length) throw new Error('没有可用的笔记名：注册表为空（配置 env NOTESYNC_NOTE / NOTESYNC_NOTES，或调用任何工具时传 name/names 自动登记）');
  return [...new Set(names)];
}

// ---------- 全文检索：分词与倒排索引（v7.2.0） ----------
// CJK 连续段切二元组（bigram），拉丁/数字切整词（lowercase）；单字 CJK 段整字成词。
// 返回 [{t, off}]：t=词元，off=该词元在纯文本中的偏移。
function tokenize(text) {
  const out = [];
  const re = /[一-龥]+|[A-Za-z0-9_]+/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const seg = m[0], base = m.index;
    if (/[一-龥]/.test(seg[0])) {
      if (seg.length === 1) out.push({ t: seg, off: base });
      else for (let i = 0; i < seg.length - 1; i++) out.push({ t: seg.slice(i, i + 2), off: base + i });
    } else {
      out.push({ t: seg.toLowerCase(), off: base });
    }
  }
  return out;
}
// 索引密钥：口令 + 专用本地盐（CACHE_DIR/index.salt，16B 首次生成）派生一次缓存。
let indexKeyCache = null;
function indexKey() {
  mustPass();
  if (indexKeyCache) return indexKeyCache;
  let salt;
  try { salt = fs.readFileSync(INDEX_SALT_FILE); } catch (e) { salt = null; }
  if (!salt || salt.length !== 16) {
    salt = crypto.randomBytes(16);
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(INDEX_SALT_FILE, salt);
  }
  indexKeyCache = deriveKeySync(PASSPHRASE, salt);
  return indexKeyCache;
}
// 索引落盘：AES-256-GCM 加密（索引含正文词元，明文落盘违背「本地只存密文」姿态）；
// env NOTESYNC_INDEX_PLAIN=1 时明文（调试用）。坏文件读取返回 null（自愈重建）。
function indexStore(name, payload) {
  fs.mkdirSync(INDEX_DIR, { recursive: true });
  const file = path.join(INDEX_DIR, name + '.idx.json');
  if (INDEX_PLAIN) { fs.writeFileSync(file, JSON.stringify(payload)); return; }
  const enc = encryptText(JSON.stringify(payload), indexKey());
  fs.writeFileSync(file, JSON.stringify({ enc: 1, iv: enc.iv, ct: enc.ct }));
}
function indexLoad(name) {
  let raw;
  try { raw = fs.readFileSync(path.join(INDEX_DIR, name + '.idx.json'), 'utf8'); } catch (e) { return null; }
  try {
    const j = JSON.parse(raw);
    if (j && j.enc === 1) return JSON.parse(decryptText(j.ct, j.iv, indexKey()));
    if (INDEX_PLAIN && j && j.terms) return j; // 明文调试文件
    return null;
  } catch (e) { return null; }
}
// 单笔记索引项：{ name, v, updatedAt, docLen, terms:{词元:[offset...]} }——只存词元与偏移，不存原文。
function buildIndexItem(name, v, updatedAt, plainText) {
  const terms = {};
  for (const { t, off } of tokenize(plainText)) (terms[t] = terms[t] || []).push(off);
  return { name, v, updatedAt: updatedAt || 0, docLen: plainText.length, terms };
}

// ---------- 零依赖 zip（v7.2.0 note_export/note_import） ----------
// method 8（raw deflate，zlib.deflateRawSync）+ CRC32 查表 + UTF-8 文件名标志位。
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
// entries: [{ name, data:Buffer }] → 标准 zip Buffer（local header + data + central dir + EOCD）。
function buildZip(entries) {
  const locals = [], centrals = [];
  let offset = 0;
  const dosTime = ((new Date().getHours() << 11) | (new Date().getMinutes() << 5) | (Math.floor(new Date().getSeconds() / 2))) & 0xFFFF;
  const dosDate = (((new Date().getFullYear() - 1980) << 9) | ((new Date().getMonth() + 1) << 5) | new Date().getDate()) & 0xFFFF;
  for (const e of entries) {
    const nameBuf = Buffer.from(e.name, 'utf8');
    const crc = crc32(e.data);
    const comp = zlib.deflateRawSync(e.data);
    const useComp = comp.length < e.data.length;
    const data = useComp ? comp : e.data; // 小文件存原样也合法（method 0）
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);           // version needed
    lh.writeUInt16LE(0x0800, 6);       // flags: UTF-8 文件名
    lh.writeUInt16LE(useComp ? 8 : 0, 8);
    lh.writeUInt16LE(dosTime, 10); lh.writeUInt16LE(dosDate, 12);
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(data.length, 18);
    lh.writeUInt32LE(e.data.length, 22);
    lh.writeUInt16LE(nameBuf.length, 26);
    lh.writeUInt16LE(0, 28);
    locals.push(lh, nameBuf, data);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(0x0800, 8);
    ch.writeUInt16LE(useComp ? 8 : 0, 10);
    ch.writeUInt16LE(dosTime, 12); ch.writeUInt16LE(dosDate, 14);
    ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(data.length, 20);
    ch.writeUInt32LE(e.data.length, 24);
    ch.writeUInt16LE(nameBuf.length, 28);
    ch.writeUInt16LE(0, 30); ch.writeUInt16LE(0, 32); ch.writeUInt16LE(0, 34);
    ch.writeUInt16LE(0, 36); ch.writeUInt32LE(0, 38);
    ch.writeUInt32LE(offset, 42);
    centrals.push(ch, nameBuf);
    offset += 30 + nameBuf.length + data.length;
  }
  const cdStart = offset;
  const cdBuf = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4); eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8); eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cdBuf.length, 12);
  eocd.writeUInt32LE(cdStart, 16);
  eocd.writeUInt16LE(0, 20);
  return Buffer.concat([...locals, cdBuf, eocd]);
}
// 读 zip：尾部搜 EOCD → central directory 逐条 → local header 对齐 → inflateRaw。
// 返回 [{ name, data }]。条目名含 .. / 绝对路径 / 盘符一律拒绝（zip slip）。
function readZip(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65535); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd === -1) throw new Error('不是有效的 zip（找不到 EOCD）');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out = [];
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('zip central directory 损坏');
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const cmtLen = buf.readUInt16LE(p + 32);
    const localOff = buf.readUInt32LE(p + 42);
    const name = buf.slice(p + 46, p + 46 + nameLen).toString('utf8');
    if (/(^|\/)\.\.(\/|$)/.test(name) || name.startsWith('/') || /^[A-Za-z]:/.test(name)) {
      throw new Error('zip 条目名不安全（拒绝 zip slip）：' + name);
    }
    if (name.endsWith('/')) { p += 46 + nameLen + extraLen + cmtLen; continue; } // 目录条目跳过
    const lhNameLen = buf.readUInt16LE(localOff + 26);
    const lhExtraLen = buf.readUInt16LE(localOff + 28);
    const dataStart = localOff + 30 + lhNameLen + lhExtraLen;
    const data = buf.slice(dataStart, dataStart + compSize);
    out.push({ name, data: method === 8 ? zlib.inflateRawSync(data) : Buffer.from(data) });
    p += 46 + nameLen + extraLen + cmtLen;
  }
  return out;
}

// ---------- HTML → Markdown（有损，plain 导出给人看；恢复绝不从 md 重建） ----------
function htmlToMd(html) {
  let s = html;
  s = s.replace(/<img\b[^>]*\ssrc="([^"]*)"[^>]*>/gi, (m, src) => '![](' + decodeEntities(src) + ')');
  s = s.replace(/<a\b[^>]*\shref="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (m, href, txt) => '[' + txt.replace(/<[^>]+>/g, '') + '](' + decodeEntities(href) + ')');
  s = s.replace(/<(s|del|strike)\b[^>]*>([\s\S]*?)<\/\1>/gi, '~~$2~~');
  s = s.replace(/<br\s*\/?>/gi, '\n');
  s = s.replace(/<\/(div|p|h[1-6]|li)>/gi, '\n');
  s = s.replace(/<[^>]+>/g, '');
  s = s.replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&amp;/g, '&');
  return s.replace(/\n{3,}/g, '\n\n').trim();
}

// ---------- HTML 白名单校验（import 闸：未知标签报错列出，绝不静默剥离） ----------
const HTML_WHITELIST = new Set(['div', 'br', 'u', 's', 'a', 'img', 'span', 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li']);
function assertWhitelistHtml(html) {
  if (/<(script|iframe|object|embed|link|meta)\b/i.test(html)) {
    throw new Error('HTML 含危险标签（script/iframe/object/embed/link/meta），拒绝导入（笔记正文不允许脚本）');
  }
  const unknown = new Set();
  const re = /<\/?([a-zA-Z][a-zA-Z0-9]*)/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    if (!HTML_WHITELIST.has(m[1].toLowerCase())) unknown.add(m[1].toLowerCase());
  }
  if (unknown.size) throw new Error('HTML 含白名单外标签（允许：div/br/u/s/a/img/span/p/h1-6/li），拒绝导入：' + [...unknown].join(', '));
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
  if (!['append', 'insert', 'delete', 'replace_html'].includes(op)) throw new Error('op 只支持 append | insert | delete | replace_html');
  if (op === 'replace_html') {
    if (typeof args.html !== 'string') throw new Error('replace_html 缺少 html（整篇正文的 HTML 源串，建议 <div>行</div> 结构；空串=清空正文）');
    if (/<script[\s>]/i.test(args.html)) throw new Error('html 含 <script>，拒绝写入（笔记正文不允许脚本）');
  } else if (op !== 'delete' && typeof args.text !== 'string') throw new Error('缺少 text');
  return withRetry409(name, async () => {
    const { note, saltB64, key, html, fresh, v } = await loadNote(name);
    let nextHtml = html;
    if (op === 'replace_html') {
      nextHtml = args.html; // 整篇替换：不与旧正文拼接，结构由调用方负责（建议 <div>行</div>）；rem 原样透传
    } else if (op === 'append') {
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
    .map(r => ({ at: r.at, text: typeof r.text === 'string' ? r.text : '', fired: !!r.fired, src: typeof r.src === 'string' ? r.src : '' })) // v8.1.6：与 web 同构透传出处指纹，防 MCP 重写列表把联动依据洗掉
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
    next.push({ at, text, fired: false, src: fmtRemLine(at) }); // v8.1.6：指纹=即将追加的正文行时间串前缀（与 web 面板 addReminder 同构）
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
  if (args.op === 'remove') return imageRemove(name, args); // v7.2.0：按 URL 删图
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

// ---------- note_image op=remove：按 match=图片 URL（或其子串）删正文 <img>（v7.2.0） ----------
// 属性值按 escapeHtml 的逆序解码（&amp; 必须最后解，防 &amp;lt; 二次解码成 <）。
function decodeAttr(s) {
  return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
}
async function imageRemove(name, args) {
  const m = String(args.match || '').trim();
  if (!m) throw new Error('remove 需要 match（图片 URL 或其子串；添加图片时返回的 url 可直接用）');
  return withRetry409(name, async () => {
    const { note, saltB64, key, html, v } = await loadNote(name);
    const tags = html.match(/<img\b[^>]*>/gi) || [];
    const srcOf = (t) => { const sm = t.match(/\ssrc="([^"]*)"/i); return sm ? decodeAttr(sm[1]) : '(无 src)'; };
    const hit = tags.filter((t) => srcOf(t).includes(m));
    if (hit.length === 0) {
      const list = tags.map(srcOf);
      throw new Error('未找到 match 对应的图片：' + m + (list.length ? '｜正文现有图片：' + list.join(' , ') : '｜正文里没有图片'));
    }
    if (hit.length > 1) throw new Error('match 命中 ' + hit.length + ' 张图片（歧义拒绝，请给更精确的 URL）：' + hit.map(srcOf).join(' , '));
    const tag = hit[0];
    const lineBlock = '<div>' + tag + '</div>'; // note_image add 的默认落盘形态（独立一行），连行一起删不留空壳 div
    const asLine = html.includes(lineBlock);
    const nextHtml = asLine ? html.split(lineBlock).join('') : html.split(tag).join('');
    const enc = encryptText(nextHtml, key);
    const body = { ct: enc.ct, iv: enc.iv, salt: saltB64, baseV: v };
    if (note.rem !== undefined) body.rem = note.rem; // 只动正文，提醒原样透传
    const r = await apiPut(name, body);
    return { ok: true, op: 'remove', removed: { src: srcOf(tag), asLine }, v: r.v };
  });
}

// 中文相对时间表（与 web 端逐字一致）：[日期段]? [\s]* [时段词]? [\s]* [时刻]，锚定全串匹配。
// H 左邻不设 (?<![年月日号:])：锚定全串下「2026年9月8日18点」整体必不匹配（天然防护），
// 而日期段结尾（日/号）直接接 H点 是合法形态（本月10日18点30 / 下周日9点）——裁决 2025-09-07。
// 红线由 toolRemind 执行：算出过去（含 now+30s 内）一律视为过期。
// ---------- note_search：全文检索（v7.2.0） ----------
// 流程：注册表 names → 并行 GET（比对 v）→ v 未变用本地索引缓存 / 变了解密重建 →
// 查询分词 AND 匹配 → 命中笔记解密纯文本做子串二次校验（bigram 固有误命中兜底）→ 摘要。
async function toolSearch(args) {
  const query = String(args.query || '').trim();
  if (!query) throw new Error('缺少 query');
  const limit = Math.max(1, Math.min(20, typeof args.limit === 'number' ? Math.floor(args.limit) : 5));
  const names = resolveNames(args);
  const rebuild = !!args.rebuild;
  const now = Date.now();
  let fresh = 0, stale = 0;

  // query 分词：CJK 连续段必须整体连续命中（无空格 query 按「连续子串」校验）；
  // 空格分隔多词时任一词连续命中即可（OR 校验，AND 命中已由索引层保证）。
  const qTokens = tokenize(query).map(x => x.t);
  if (!qTokens.length) throw new Error('query 分词后为空（需含中文或字母数字）');
  const cjkSegments = (query.match(/[一-龥]+/g) || []);

  const jobs = names.map(async (name) => {
    const note = await apiGet(name);
    if (!note.ct || !note.iv) return null; // 处女笔记没内容，无可检索
    const v = note.v || 0;
    let item = rebuild ? null : indexLoad(name);
    if (item && item.v === v) { fresh++; }
    else {
      const saltB64 = note.salt || '';
      if (!saltB64) return null;
      const key = getKeyFor(name, saltB64);
      let html;
      try { html = decryptText(note.ct, note.iv, key); }
      catch (e) { stale++; return null; } // 解密失败（口令不对？）该笔记跳过
      item = buildIndexItem(name, v, note.updatedAt, htmlToPlainMap(html).text);
      try { indexStore(name, item); } catch (e) { /* 索引落盘失败不挡检索 */ }
    }
    // AND 语义：全部 query 词元都在索引里才算命中
    for (const t of qTokens) if (!item.terms[t]) return null;
    let hitCount = 0, firstOff = Infinity;
    for (const t of qTokens) {
      const offs = item.terms[t];
      hitCount += offs.length;
      if (offs[0] < firstOff) firstOff = offs[0];
    }
    return { name, v, hitCount, firstOff };
  });
  const settled = await Promise.all(jobs.map(j => j.catch(() => { stale++; return null; })));

  const results = [];
  for (const hit of settled) {
    if (!hit) continue;
    // 子串二次校验：解密纯文本里确认 query 确实出现（bigram 拼接误命中兜底）。
    // 无空格 CJK query 按连续段校验（「明天上午」必须原文连续出现）；空格分隔多词任一词连续出现即可。
    let plain = null;
    try {
      const full = await apiGet(hit.name);
      const saltB64 = full.salt || '';
      const key = getKeyFor(hit.name, saltB64);
      plain = htmlToPlainMap(decryptText(full.ct, full.iv, key)).text;
    } catch (e) { stale++; continue; }
    const probe = cjkSegments.find(seg => plain.includes(seg)) || qTokens.find(t => plain.includes(t));
    if (!probe) continue; // bigram 误命中，丢弃
    const at = plain.indexOf(probe);
    const start = Math.max(0, at - 30), end = Math.min(plain.length, at + 40);
    results.push({
      name: hit.name, v: hit.v, hitCount: hit.hitCount,
      snippets: [{ offset: at, text: (start > 0 ? '…' : '') + plain.slice(start, end) + (end < plain.length ? '…' : '') }],
    });
  }
  // 排序：命中词频降序 → 笔记新旧（updatedAt）降序；截断 limit
  results.sort((a, b) => (b.hitCount || 0) - (a.hitCount || 0) || (b.v || 0) - (a.v || 0));
  return { results: results.slice(0, limit), indexed: names.length - fresh - stale, fresh, stale };
}

// ---------- note_export / note_import：一键备份与恢复（v7.2.0） ----------
// plain=明文（md+html+附件+manifest，人读归档迁移，落盘即裸奔用户自管）；
// raw=密文（ct/iv/salt/rem/v 原样，免口令可放云盘，零知识不外泄；恢复须同口令环境）。
async function exportOne(name, mode, key) {
  const note = await apiGet(name);
  if (mode === 'raw') {
    return { name, v: note.v || 0, updatedAt: note.updatedAt || 0, salt: note.salt || '',
      json: { ct: note.ct || '', iv: note.iv || '', salt: note.salt || '', rem: note.rem || null, v: note.v || 0 },
      html: null, remPlain: null, images: [] };
  }
  // plain：解密出 html + rem 明文
  const saltB64 = note.salt || '';
  if (!note.ct || !note.iv) return { name, v: 0, updatedAt: note.updatedAt || 0, salt: saltB64, json: null, html: '', remPlain: { list: [] }, images: [] };
  const html = decryptText(note.ct, note.iv, key);
  let remPlain = null;
  if (note.rem) {
    try { remPlain = JSON.parse(decryptText(JSON.parse(note.rem).ct, JSON.parse(note.rem).iv, key)); }
    catch (e) { remPlain = null; }
  }
  return { name, v: note.v || 0, updatedAt: note.updatedAt || 0, salt: saltB64, json: null, html, remPlain, images: [] };
}
async function toolExport(args) {
  const mode = args.mode || 'plain';
  if (!['plain', 'raw'].includes(mode)) throw new Error('mode 只支持 plain | raw');
  if (mode === 'plain') mustPass();
  const names = resolveNames(args);
  const downloadImages = args.download_images !== false;
  const skipped = [], notes = [];
  const entries = [];
  const manifestNotes = [];
  let imagesTotal = 0;

  for (const name of names) {
    try {
      // plain 模式逐笔记现取盐派生 key（处女笔记无盐走空正文分支）
      let one;
      if (mode === 'raw') one = await exportOne(name, 'raw', null);
      else {
        const pre = await apiGet(name);
        const saltB64 = pre.salt || '';
        const k = saltB64 ? getKeyFor(name, saltB64) : null;
        one = await exportOne(name, 'plain', k);
      }
      if (one.json === null && one.html === null) throw new Error('导出内容为空');
      const m = { name: one.name, v: one.v, updatedAt: one.updatedAt, salt: one.salt };
      if (mode === 'plain') {
        m.rem = one.remPlain || { list: [] };
        // 图片下载：Cloudinary 原图 → attachments/<name>/<i>.<ext>，md 内链接改写相对路径（原 URL 注释保留）
        // src 兼容带/不带 https:// 前缀两种形态，捕获完整 src 值（md 转换产物里是原文）
        const imgRe = /<img\b[^>]*\ssrc="((?:https?:\/\/)?res\.cloudinary\.com\/[^"]+)"[^>]*>/gi;
        const imgs = [];
        let im;
        while ((im = imgRe.exec(one.html)) !== null) imgs.push(decodeEntities(im[1]));
        const rels = [];
        for (let i = 0; i < imgs.length; i++) {
          const url = imgs[i];
          const ext = (url.match(IMG_EXT_RE) || [])[0] || '.jpg';
          let buf = null;
          try {
            const r = await fetch(url.startsWith('http') ? url : 'https://' + url, { cache: 'no-store' });
            if (r.ok) buf = Buffer.from(await r.arrayBuffer());
          } catch (e) { /* 下载失败不挡导出：md 保留原 URL */ }
          if (buf) {
            const rel = 'attachments/' + name + '/' + i + ext;
            entries.push({ name: rel, data: buf });
            rels.push({ url, rel });
            imagesTotal++;
          }
        }
        let md = htmlToMd(one.html);
        for (const { url, rel } of rels) {
          md = md.split(url).join(rel);
          md = md.replace('![](' + rel + ')', '![](' + rel + ') <!-- 原 URL: ' + url + ' -->');
        }
        entries.push({ name: name + '.md', data: Buffer.from(md, 'utf8') });
        entries.push({ name: name + '.html', data: Buffer.from(one.html, 'utf8') });
        notes.push({ name: one.name, v: one.v, chars: one.html.length, images: rels.length });
      } else {
        entries.push({ name: name + '.json', data: Buffer.from(JSON.stringify(one.json, null, 2), 'utf8') });
        notes.push({ name: one.name, v: one.v, chars: (one.json.ct || '').length, images: 0 });
      }
      manifestNotes.push(m);
    } catch (e) {
      skipped.push({ name, reason: e.message });
    }
  }
  if (!manifestNotes.length) throw new Error('没有可导出的笔记：' + skipped.map(s => s.name + '(' + s.reason + ')').join('; '));
  const manifest = { app: 'notesync', schema: 1, exportedAt: Date.now(), mode, notes: manifestNotes };
  entries.unshift({ name: 'manifest.json', data: Buffer.from(JSON.stringify(manifest, null, 2), 'utf8') });
  const zip = buildZip(entries);
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const outPath = args.out || path.join(OUT_DIR, 'notesync-backup-' + new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '').replace(/^(\d{8})(\d{4})$/, '$1-$2') + '.zip');
  fs.writeFileSync(outPath, zip);
  return { ok: true, path: outPath, bytes: zip.length, notes, skipped, images: imagesTotal };
}

// import：默认 preview（只报告不写）；apply 时 create（新盐）/ update（v 一致直写）/ skip-conflict（force 才覆盖）。
async function toolImport(args) {
  const from = String(args.from || '');
  if (!from) throw new Error('缺少 from（本工具导出的 zip 绝对路径）');
  let entries;
  try { entries = readZip(fs.readFileSync(from)); }
  catch (e) { throw new Error('读取 zip 失败：' + e.message); }
  const manEntry = entries.find(e => e.name === 'manifest.json');
  if (!manEntry) throw new Error('zip 里没有 manifest.json（须为本工具导出的备份）');
  let manifest;
  try { manifest = JSON.parse(manEntry.data.toString('utf8')); }
  catch (e) { throw new Error('manifest.json 解析失败：' + e.message); }
  if (manifest.app !== 'notesync' || manifest.schema !== 1) throw new Error('manifest 不是 notesync 备份（app/schema 不符）');
  const mode = args.mode || 'preview';
  if (!['preview', 'apply'].includes(mode)) throw new Error('mode 只支持 preview | apply');
  const force = !!args.force;
  const namesFilter = Array.isArray(args.names) ? args.names.filter(Boolean) : null;
  const singleTo = args.to || null;
  if (singleTo) assertName(singleTo);

  const plan = [], applied = [], skipped = [];
  const items = manifest.notes.filter(m => !namesFilter || namesFilter.includes(m.name));
  if (!items.length) throw new Error('zip 里没有匹配的笔记');
  if (singleTo && items.length > 1) throw new Error('to（改名导入）仅单篇导入时可用（zip 内匹配到 ' + items.length + ' 篇，请用 names 先限定一篇）');
  for (const m of items) {
    const target = singleTo || m.name;
    try { assertName(target); } catch (e) { skipped.push({ name: m.name, reason: e.message }); continue; }
    let remote = null;
    try { remote = await apiGet(target); } catch (e) { remote = null; } // 404/无内容=新建
    const remoteV = remote && remote.v ? remote.v : null;
    let action;
    if (!remoteV || !remote.ct) action = 'create';
    else if (remoteV === m.v) action = 'update';
    else action = force ? 'update' : 'skip-conflict';
    plan.push({ name: m.name, target, remoteV, exportV: m.v, action });
  }
  if (mode === 'preview') return { plan, skipped };

  // apply：逐条执行。plain 在此白名单校验（报错不静默剥离）；rem 明文用当前口令重加密随同一 PUT 原子提交。
  for (const p of plan) {
    if (p.action === 'skip-conflict') { skipped.push({ name: p.name, reason: '远端 v=' + p.remoteV + ' ≠ 导出 v=' + p.exportV + '（force=true 可覆盖）' }); continue; }
    try {
      const m = manifest.notes.find(x => x.name === p.name);
      if (manifest.mode === 'raw') {
        const jEntry = entries.find(e => e.name === p.name + '.json');
        if (!jEntry) throw new Error('zip 缺 ' + p.name + '.json');
        const j = JSON.parse(jEntry.data.toString('utf8'));
        if (!j.ct || !j.iv || !j.salt) throw new Error(p.name + '.json 缺 ct/iv/salt');
        const body = { ct: j.ct, iv: j.iv, salt: j.salt, baseV: p.remoteV || 0 };
        if (j.rem !== undefined && j.rem !== null) body.rem = j.rem; // raw：rem 密文原样（须同口令环境）
        const r = await apiPut(p.target, body);
        applied.push({ name: p.name, target: p.target, action: p.action, v: r.v });
      } else {
        const hEntry = entries.find(e => e.name === p.name + '.html');
        if (!hEntry) throw new Error('zip 缺 ' + p.name + '.html');
        const html = hEntry.data.toString('utf8');
        assertWhitelistHtml(html); // 白名单外标签报错拒绝，绝不静默剥离
        let remCipher = undefined;
        if (m && m.rem && Array.isArray(m.rem.list)) {
          const pre = await apiGet(p.target).catch(() => ({}));
          const saltB64 = (pre && pre.salt) || crypto.randomBytes(16).toString('base64');
          const k = getKeyFor(p.target, saltB64);
          const list = normRemList(m.rem.list.map(r => ({ at: r.at, text: r.text || '', fired: !!r.fired, src: typeof r.src === 'string' ? r.src : '' }))); // v8.1.6：恢复备份必须带出处指纹，否则整表洗掉联动依据
          const enc = encryptText(JSON.stringify({ list }), k);
          remCipher = JSON.stringify({ ct: enc.ct, iv: enc.iv });
        }
        const fresh = await loadNote(p.target);
        const enc2 = encryptText(html, fresh.key);
        const body = { ct: enc2.ct, iv: enc2.iv, salt: fresh.saltB64, baseV: fresh.v };
        if (remCipher !== undefined) body.rem = remCipher;
        const r = await apiPut(p.target, body);
        applied.push({ name: p.name, target: p.target, action: p.action, v: r.v });
      }
    } catch (e) {
      skipped.push({ name: p.name, reason: e.message });
    }
  }
  return { ok: true, applied, skipped };
}

// v8.1.5：中文数字→阿拉伯（与 web 端 cnNum 逐字同表），非法返回 NaN。
function cnNumMcp(s) {
  if (s === undefined || s === null) return NaN;
  s = String(s);
  if (/^\d+$/.test(s)) return +s;
  const U = { '零': 0, '一': 1, '二': 2, '两': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9 };
  if (s === '十') return 10;
  const mm = s.match(/^([1-9]|[一二两三四五六七八九])?十([一二三四五六七八九])?$/);
  if (mm) return (mm[1] ? U[mm[1]] : 1) * 10 + (mm[2] ? U[mm[2]] : 0);
  if (s.length === 1 && U[s] !== undefined) return U[s];
  return NaN;
}
// v8.1.5 时刻片段（与 web 端 HOUR/MIN/MH/TIME_SEG 同构，含中文数字、点钟）。
const HOUR_M = '(\\d{1,2}|二十[一二三]?|十[一二三四五六七八九]?|[一二两三四五六七八九])';
const MIN_M = '(\\d{1,2}|(?:[一二三四五]?十[一二三四五六七八九]?)|[一二三四五六七八九])';
const MH_M = '(?:(?:' + MIN_M + ')分|' + MIN_M + '|(半))?'; // 分/裸分/半，整体可选（3 捕获）
// 整串锚定：g1=日期段整体 g2=周几字 g3=本月N g4=下月N g5=时段词 g6:冒号时 g7:冒号分 g8=点时 g9/g10/g11=点钟(分/裸/半) g12/g13/g14=点(分/裸/半)
const REL_RE = new RegExp(
  '^((?:大后天|后天|明天|今天|(?:这|下)?\\s?(?:个\\s?)?(?:周|星期|礼拜)\\s?([一二三四五六日天])|(?:这个月|本月)(\\d{1,2})[日号]|(?:下个月|下月)(\\d{1,2})[日号]))?' +
  '\\s*(凌晨|早上|上午|中午|下午|傍晚|晚上|夜里)?\\s*' +
  '(?:(\\d{1,2}):(\\d{2})|' + HOUR_M + '点(?:钟' + MH_M + '|' + MH_M + ')?)$'
);
const REL_WD = { '一': 0, '二': 1, '三': 2, '四': 3, '五': 4, '六': 5, '日': 6, '天': 6 }; // 周首日=周一
// 带年份完整中文日期（与 web 端 reFullCn 同构）：绝对年份不滚动，hh:mm 直用，锚定整串
const REL_FULLCN_RE = /^(\d{4})年(\d{1,2})月(\d{1,2})日\s*(\d{1,2}):(\d{2})$/;
// 兜底守门（与 web 端边界防护同构）：串含相对时间/时刻 token 却未整体命中 REL_RE
// = 形似时间但被防护拒绝（10:301 / 3点2019 / 本周五 18:00 / 会议纪要　明天10点 …），
// 一律 null，绝不放进 Date.parse（V8 会把 10:301 之类误解析成 1970 年怪值）。
const REL_GATE_RE = /年|月|\d{1,2}:\d{1,2}|[0-9一二两三四五六七八九十]{1,3}点|今天|明天|后天|大后天|周[一二三四五六日天]|星期[一二三四五六日天]|礼拜[一二三四五六日天]|这周|下周|本周|星期|礼拜/;
// v7.2.0：全角→半角归一（与 web 端 normFullWidth 逐字同表）——手机全角输入法打出的
// 「９-１０ ２０：０４」此前一个分支都不命中直接 null。等宽替换不改变长度，索引口径不受影响。
function normFullWidthMcp(s) {
  return s.replace(/[０-９：－／]/g, c => {
    const code = c.charCodeAt(0);
    if (code >= 0xFF10 && code <= 0xFF19) return String.fromCharCode(code - 0xFEE0);
    if (c === '：') return ':';
    if (c === '－') return '-';
    return '/'; // ／
  });
}
function parseAt(s, now = Date.now()) {
  if (typeof s !== 'string' || !s) return null;
  s = normFullWidthMcp(s); // v7.2.0：入口归一（与 web 端 collectTimeMatches/collectRelTimeMatches 同口径）
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
    else if (m[2] !== undefined) {
      // 周几（裸/这/下 + 周/星期/礼拜 + 可选「个」）：dayIdx=(getDay()+6)%7（周一=0..周日=6），下周再+7
      const wd = REL_WD[m[2]];
      if (wd === undefined) return null;
      targetD = d - ((base.getDay() + 6) % 7) + wd + (seg.charAt(0) === '下' ? 7 : 0);
    } else if (seg) {
      const n = +(m[3] || m[4]);
      if (seg.charAt(0) === '下') { // 下(个)月N日/号：new Date 原生滚动跨年（12月→次年1月），与 web 端 reRel 同收 [日号]
        if (!(n >= 1 && n <= new Date(y, mo + 2, 0).getDate())) return null;
        monthShift = 1;
      } else { // (这个)月N日/号：超当月天数→null
        if (!(n >= 1 && n <= new Date(y, mo + 1, 0).getDate())) return null;
      }
      targetD = n;
    }
    let h, mi;
    if (m[6] !== undefined) { // hh:mm 一律直用（阿拉伯，时段词不生效）
      h = +m[6]; mi = +m[7];
      if (!(h <= 23 && mi <= 59)) return null;
    } else { // H点(钟)[半|M分|M]，H/M 支持中文数字
      h = cnNumMcp(m[8]);
      const minCap = m[9] !== undefined ? m[9] : (m[10] !== undefined ? m[10] : (m[12] !== undefined ? m[12] : (m[13] !== undefined ? m[13] : undefined)));
      mi = (m[11] !== undefined || m[14] !== undefined) ? 30 : (minCap !== undefined ? cnNumMcp(minCap) : 0);
      if (Number.isNaN(h) || Number.isNaN(mi)) return null;
      if (!(h <= 23 && mi <= 59)) return null; // 原始时/分越界（如「25点」）拒绝；晚上 h+24 是转换后才发生，不受此拦
      const p = m[5];
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
    description: '编辑笔记正文。op=append 在末尾追加一行；op=insert 按 position（纯文本字符偏移）或 match（HTML 源串子串，where=before/after）插入；op=delete 按 match 或 position+length 删除（不允许跨结构边界）；op=replace_html（v7.2.0）整篇替换为给定 HTML（建议 <div>行</div> 结构，含 <script> 拒绝；空串=清空正文）',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        op: { type: 'string', enum: ['append', 'insert', 'delete', 'replace_html'] },
        html: { type: 'string', description: 'replace_html：整篇正文的 HTML 源串（建议 <div>行</div> 结构；含 <script> 会被拒绝；空串=清空正文）' },
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
    description: '把本机图片加入笔记：上传 Cloudinary 后在正文插入 <img>（线上 CSP 已放行该域）。默认追加为正文末尾独立一行；给 match（纯文本子串，where=before/after）或 position（纯文本偏移）可内联插入。png/jpg/jpeg/gif/webp，≤8MB，直传不压缩。op=remove（v7.2.0）按 match=图片 URL（或其子串）删除正文里的 <img>：独占一行的连行删除，内联的只摘标签；命中多张会歧义拒绝',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        op: { type: 'string', enum: ['add', 'remove'], description: 'add=加图（默认）/ remove=删图（v7.2.0）' },
        path: { type: 'string', description: '本机图片绝对路径（仅 add）' },
        match: { type: 'string', description: 'add：定位锚点（纯文本子串），与 where 配合内联插入；remove：图片 URL 或其子串（添加时返回的 url 可直接用）' },
        position: { type: 'number', description: '纯文本可见字符偏移（与 match 二选一，仅 add）' },
        where: { type: 'string', enum: ['before', 'after'], description: '相对 match 的位置，默认 after（仅 add）' },
      },
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
        at: { type: ['string', 'number'], description: 'add：提醒时刻，支持 "YYYY-MM-DDTHH:MM" 或 YYYY-M-D H:MM（本地时区，分钟级，不带秒与时区）；中文相对时间 [今天/明天/后天/大后天 | 裸周X/这周X/下周X（周/星期/礼拜 + 可选「个」；上/本 不支持）| 本月N日(号)/下个月N号]? [凌晨/早上/上午/中午/下午/傍晚/晚上/夜里]? [hh:mm 或 H点/H点钟/H点半/H点M分/H点M，数字可中文]，如「明天早上9点」「周日下午4点钟」「下周三9点半」「这周五18:30」「下午三点半」「下个月1号 18:50」「晚上12点半」。cancel：数字时间戳或可解析的时间串（建议先 op=list 取精确值）' },
        text: { type: 'string', description: '提醒事项（≤20 字，可空；仅 add 用）' },
      },
    },
  },
  {
    name: 'note_search',
    description: '全文检索（v7.2.0）：遍历注册表全部笔记（或 names 显式指定），中文按二元组索引（AND 语义）+解密纯文本子串二次校验，返回命中笔记与 ±30 字摘要。索引按笔记版本号增量更新并加密落盘本机（不存原文）；names 显式指定的也会自动登记进注册表',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '检索词（中文连续段必须整体连续命中；空格分隔多词任一命中即返回）' },
        names: { type: 'array', items: { type: 'string' }, description: '限定检索的笔记名列表（默认注册表全部）' },
        limit: { type: 'number', description: '返回上限，默认 5' },
        rebuild: { type: 'boolean', description: '强制全量重建索引（默认按版本号增量）' },
      },
      required: ['query'],
    },
  },
  {
    name: 'note_export',
    description: '一键备份（v7.2.0）：把注册表全部笔记（或 names 指定）导出为 zip。mode=plain（默认）产出 manifest+每篇 .md/.html+附件图片（明文！落盘即裸奔，用户自行保管）；mode=raw 只打包密文（ct/iv/salt/rem/v 原样），免口令可放心放云盘，恢复须同口令环境。隐私提示：plain 产物含笔记明文与提醒事项，注意保管位置',
    inputSchema: {
      type: 'object',
      properties: {
        names: { type: 'array', items: { type: 'string' }, description: '导出的笔记名列表（默认注册表全部）' },
        mode: { type: 'string', enum: ['plain', 'raw'] },
        download_images: { type: 'boolean', description: 'plain 模式是否下载图片到 attachments/（默认 true；false 时 md 保留 Cloudinary 原 URL）' },
        out: { type: 'string', description: '输出 zip 绝对路径（默认 OUT_DIR/notesync-backup-<时间戳>.zip）' },
      },
    },
  },
  {
    name: 'note_import',
    description: '从本工具导出的 zip 恢复（v7.2.0）：默认 mode=preview 只报告导入计划不写远端；mode=apply 才写入。目标不存在=新建（新盐），远端版本=导出版本直接更新，不一致默认跳过（force=true 才覆盖）。plain 的 HTML 按白名单校验（div/br/u/s/a/img/span/p/h1-6/li），白名单外标签报错拒绝绝不静默剥离；提醒按当前口令重加密随正文原子恢复；raw 恢复须与导出口令一致',
    inputSchema: {
      type: 'object',
      properties: {
        from: { type: 'string', description: '备份 zip 绝对路径（须为本工具 note_export 的产物）' },
        mode: { type: 'string', enum: ['preview', 'apply'], description: 'preview=只看计划（默认）/ apply=执行写入' },
        names: { type: 'array', items: { type: 'string' }, description: '只导入指定笔记（默认 zip 内全部）' },
        to: { type: 'string', description: '改名导入的目标笔记名（仅单篇导入时可用）' },
        force: { type: 'boolean', description: '远端版本与导出版本不一致时强制覆盖（默认跳过）' },
      },
      required: ['from'],
    },
  },
];

const IMPLS = { note_locate: toolLocate, note_read: toolRead, note_edit: toolEdit, note_image: toolImage, note_remind: toolRemind, note_search: toolSearch, note_export: toolExport, note_import: toolImport };

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
      serverInfo: { name: 'notesync', version: '8.2.1' },
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
      // 自动累积：任何调用成功后把涉笔的名字登记进本地注册表（search/export 的 names 数组逐个入册）
      try {
        if (Array.isArray(args.names)) { for (const n of args.names) regAdd(n); }
        const n1 = args.name || DEFAULT_NOTE;
        if (n1) regAdd(n1);
      } catch (e) { /* 注册表失败不挡返回 */ }
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
  regSeed(); // NOTESYNC_NOTE / NOTESYNC_NOTES 种子合入注册表
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

module.exports = {
  parseAt, toolRemind, toolImage, fmtRemLine, encryptText, decryptText, getKeyFor,
  // v7.2.0：注册表 / 检索 / 备份恢复（测试与对齐用）
  regLoad, regAdd, regSeed, resolveNames,
  tokenize, buildIndexItem, indexLoad, indexStore,
  crc32, buildZip, readZip, htmlToMd, assertWhitelistHtml,
  toolSearch, toolExport, toolImport, htmlToPlainMap,
};
