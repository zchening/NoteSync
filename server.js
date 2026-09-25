'use strict';
// NoteSync — 极简端到端加密便签后端（多笔记 + 限流，零依赖 Node.js）
// 只做一件事：按 URL 路径存/取多段密文。所有加解密都在浏览器完成，服务器从不见明文、不见口令、不见密钥。

const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 8080;
const APP_DIR = __dirname;
// v9.3.1：App 在线升级元数据 = 发布时随部署落地的 latest_app.json（见 /api/latest 路由）。
// 手机与服务器到 GitHub 的连接在实测环境均间歇失败（容器直连必挂；服务器侧 api 域配额被共享出口耗尽、
// 网页域 TLS 又间歇断）——升级查询因此零外网依赖，GitHub 只作为 APK 的下载源出现在元数据里。
// 数据目录允许用环境变量改址：唯一目的是让 e2e 能起真服务器做接口测试而不污染仓库 data/
const DATA_DIR = process.env.NOTESYNC_DATA_DIR || path.join(APP_DIR, 'data');
const NOTES_DIR = path.join(DATA_DIR, 'notes');
const INDEX_FILE = path.join(APP_DIR, 'index.html');

if (!fs.existsSync(NOTES_DIR)) fs.mkdirSync(NOTES_DIR, { recursive: true });

// --- v9.0.0 街机档案（彩蛋成绩 + 桌宠成长）：极小 KV 文件存储，零依赖零数据库 ---
// 归属模型：id 只寻址、writeKey 走请求头当凭据、服务端只存其哈希；
// 「不存在」与「钥匙错」统一 404，防枚举探测。档案只含计数与形态，永不含笔记内容。
const ARCADE_DIR = path.join(DATA_DIR, 'arcade');
if (!fs.existsSync(ARCADE_DIR)) fs.mkdirSync(ARCADE_DIR, { recursive: true });
const ARC_ID_RE = /^[A-Z2-9]{8}$/;          // 32^8 ≈ 1.1e12 空间
const ARC_KEY_MIN = 8;                      // 短于 8 的钥匙一律视为非法
const ARC_MAX_BODY = 2048;                  // 档案硬上限 2KB
const ARC_WRITE_PER_MIN = 10;               // 每个档案每分钟写入次数
const arcWrites = new Map();                // id -> { n, t }
function arcPath(id) { return path.join(ARCADE_DIR, id + '.json'); }
function arcRead(id) { try { return JSON.parse(fs.readFileSync(arcPath(id), 'utf8')); } catch (e) { return null; } }
function arcSave(id, obj) { const f = arcPath(id); const tmp = f + '.tmp.' + process.pid; fs.writeFileSync(tmp, JSON.stringify(obj)); fs.renameSync(tmp, f); }
function arcHash(k) { return crypto.createHash('sha256').update(String(k)).digest('hex'); }
function sweepArcWrites() { // 限流表无界增长=内存泄漏（公网可无限建档把它刷大）
  if (arcWrites.size < 2000) return;
  const now = Date.now();
  for (const [k, v] of arcWrites) { if (now - v.t > 120000) arcWrites.delete(k); }
}
function arcLimited(id) {
  const now = Date.now(), rec = arcWrites.get(id);
  if (!rec || now - rec.t > 60000) { arcWrites.set(id, { n: 1, t: now }); return false; }
  rec.n++; return rec.n > ARC_WRITE_PER_MIN;
}
// 合并规则写在服务端、不信客户端整体覆盖：计数器取 max、集合并、小字段按 updatedAt 后者胜。
// 否则两台设备各玩各的会互相把对方进度冲掉（「我昨天明明养到成体了」）。
function arcMerge(cur, inc) {
  const out = cur || { counters: {}, shelf: [], updatedAt: 0 };
  const incU = Number(inc.updatedAt) || 0;
  if (incU >= (Number(out.updatedAt) || 0)) {
    out.stage = inc.stage != null ? inc.stage : out.stage;
    out.ate = inc.ate != null ? inc.ate : out.ate;
    out.asleep = inc.asleep != null ? !!inc.asleep : out.asleep;
    out.born = inc.born || out.born || Date.now();
    out.retiredAt = inc.retiredAt != null ? (Number(inc.retiredAt) || 0) : (out.retiredAt || 0); // 客户端已上行；不搬等于「保留 30 天可原样认领」是空话
    out.updatedAt = incU;
  }
  out.counters = out.counters || {};
  const ic = (inc.counters && typeof inc.counters === 'object') ? inc.counters : {};
  Object.keys(ic).slice(0, 40).forEach(function (k) {
    const v = Number(ic[k]); if (!Number.isFinite(v)) return;
    const p = Number(out.counters[k]); if (!Number.isFinite(p) || v > p) out.counters[k] = Math.min(v, 1e12);
  });
  const set = new Set((out.shelf || []).concat(inc.shelf || []).map(Number).filter(n => Number.isFinite(n) && n >= 0 && n < 512));
  out.shelf = Array.from(set).sort(function (a, b) { return a - b; });
  return out;
}
function arcAuth(req, id) {
  const k = req.headers['x-arcade-key'];
  if (typeof k !== 'string' || k.length < ARC_KEY_MIN || k.length > 64) return null;
  return arcHash(k);
}
function readBody(req, limit) {
  return new Promise(function (resolve, reject) {
    let size = 0; const chunks = [];
    req.on('data', function (c) { size += c.length; if (size > limit) { reject(new Error('too large')); req.destroy(); return; } chunks.push(c); });
    req.on('end', function () { resolve(Buffer.concat(chunks).toString('utf8')); });
    req.on('error', reject);
  });
}

const EMPTY = { v: 0, ct: '', iv: '', salt: '', updatedAt: 0 };

// ===== v10.0.0 笔记写入凭据（writeKey）=====
// 背景：街机档案（/api/arcade）早已实现「id 只寻址 + 请求头凭据 + 服务端只存哈希 + 钥匙错与不存在同形」，
// 但笔记接口从未回填——PUT /api/note/:id 零凭据，任何人猜中笔记名即可覆盖写（读只拿到密文，毁却很容易）。
// 模型：客户端在解锁后从已有 AES 密钥派生 writeKey（HMAC-SHA256，域分离含笔记名），写入时带 x-note-key 头；
// 服务端只存 sha256(writeKey)，零知识不变——没口令 → 解不开 → 也派生不出凭据，「能解密」与「能写入」同义。
// 兼容铁律：GET 的响应形状一个字节都不能改（旧客户端靠 200+空密文判「新建」，改 404 会直接堵死建笔记）；
// 无凭据的写在 off 档完全照旧放行，线上旧版客户端不受任何影响。
const WK_HEADER = 'x-note-key';
const WK_MIN = 16, WK_MAX = 128;                 // 32 字节 base64url=43 字符，留双侧余量
const WK_MODE_FILE = path.join(DATA_DIR, 'wk-mode.txt');
let _wkMode = { v: '', at: 0 };
function wkMode() {
  const now = Date.now();
  if (now - _wkMode.at < 5000) return _wkMode.v;
  let m = String(process.env.NOTESYNC_WK_MODE || 'off').trim();
  try { const f = fs.readFileSync(WK_MODE_FILE, 'utf8').trim(); if (f) m = f; } catch (e) {} // 文件优先：SFTP 写一个字节即热切，不必重启服务
  if (m !== 'off' && m !== 'new-only' && m !== 'full') m = 'off';
  _wkMode = { v: m, at: now };
  return m;
}
function wkHash(k) { return crypto.createHash('sha256').update(String(k)).digest('hex'); }
function wkHashFromReq(req) {
  const k = req.headers[WK_HEADER];
  if (typeof k !== 'string' || k.length < WK_MIN || k.length > WK_MAX) return null;
  return wkHash(k);
}
// 凭据失败独立桶：只挡写入，绝不牵连 GET。
// 若与口令爆破共用 failMap，不升级的旧客户端每次自动保存都记一次失败，攒够就把「老版本不能写」
// 升级成「老版本连自己的笔记都看不到」（闸 R2-B 命中，不可接受的误伤）。阈值给到 60，
// 真持有者永远撞不到，只有脚本化抢注才会被限。
const WK_FAIL_LIMIT = 60, WK_FAIL_WINDOW = 10 * 60 * 1000, WK_LOCK = 10 * 60 * 1000;
const wkFailMap = new Map(); // 'ip:id' -> { n, first, lockedAt }
function wkRecordFail(ip, id) {
  const key = ip + ':' + id, now = Date.now();
  let r = wkFailMap.get(key);
  // 窗口滚动只重置计数，绝不清 lockedAt——否则锁到点自动解，等于没锁（复核意见）
  if (!r || now - r.first > WK_FAIL_WINDOW) { r = { n: 0, first: now, lockedAt: (r && r.lockedAt) || 0 }; wkFailMap.set(key, r); }
  r.n++;
  if (r.n >= WK_FAIL_LIMIT) r.lockedAt = now;
  if (wkFailMap.size > 5000) { for (const [k, v] of wkFailMap) { if (now - v.first > WK_FAIL_WINDOW && !v.lockedAt) wkFailMap.delete(k); } }
}
function wkLimited(ip, id) {
  const r = wkFailMap.get(ip + ':' + id);
  if (!r || !r.lockedAt) return 0;
  const left = WK_LOCK - (Date.now() - r.lockedAt);
  if (left <= 0) { wkFailMap.delete(ip + ':' + id); return 0; }
  return Math.ceil(left / 1000);
}
// 主写入与两处历史快照写入共用同一判据（抄三处=改一处忘两处，本项目历来如此）。
// 【B1 语义】未认领的笔记接受第一次凭据登记（=认领）；一旦认领，凭据不符一律硬 403，绝不自动降级。
//   · 为什么允许对「已有正文的存量笔记」认领：否则本版对外宣称修掉了零鉴权，实际你手上所有存量
//     笔记一个字节都没被保护（只保护新建≈不保护），那才是不可接受的。
//   · 代价与其边界：真主完成认领之前，知道笔记名的人可以抢先登记、把真主挡在写入之外。
//     但他本来就能直接覆盖这篇（off/new-only 下无凭据写入仍放行），所以抢注并未给他新的破坏力，
//     只是新增一种"冻结写入"。恢复通道明确存在且只有一步：登录服务器删掉该档的 wkHash 字段
//     （见 README「手工解除认领」）。真主一旦认领完成，抢注窗口永久关闭——故发版当天把全部
//     笔记各打开一遍（客户端首次解锁即自动认领），窗口就压到几分钟。
//   · 为什么不做"被抢注即自动退回无保护"：那等于攻击者先用错凭据撞一下就能卸掉防护再覆盖，
//     保护退化成防手滑的摆设，还不如不做。宁可承担"可一步恢复的冻结"，不做"不可依赖的防护"。
//   · 已认领笔记仍允许同一次请求出示 wkOld 自证换绑（改口令路径），避免换密钥把自己锁死。
// 凭据失败另立独立计数桶，且只挡写入、绝不牵连 GET（见 wkRecordFail）。
function wkCheckNote(req, ip, id, cur, obj) {
  const wk = wkHashFromReq(req);
  const claimed = typeof cur.wkHash === 'string' && cur.wkHash.length === 64;
  if (wk) {
    if (claimed && cur.wkHash !== wk) {
      const old = obj && typeof obj.wkOld === 'string' ? obj.wkOld : '';
      if (old.length >= WK_MIN && old.length <= WK_MAX && wkHash(old) === cur.wkHash) {
        return { ok: true, wk: wk, claimed: true, swap: true }; // 旧凭据自证 → 换绑（改口令）
      }
      // 复核②：off 档一律不拒——off 的全部承诺就是「行为与今天逐字相同、不发任何锁」，
      // 把 mismatch 检查放在 mode 之前等于让 off 档也能把人锁死，自相矛盾。
      if (wkMode() === 'off') return { ok: true, wk: wk, claimed: true };
      wkRecordFail(ip, id);
      return { ok: false, code: 403, error: 'forbidden' };
    }
    if (claimed) return { ok: true, wk: wk, claimed: true };
    // B1：未认领的档一律接受第一次凭据登记（=认领）。曾要求「该档尚不存在且无正文」，
    // 那样存量笔记永远登记不上，等于对外宣称修了零鉴权、实际一个字节都没保护。
    return { ok: true, wk: wk, claimed: false, claim: true };
  }
  const mode = wkMode();
  if (claimed) {
    if (mode === 'full') { wkRecordFail(ip, id); return { ok: false, code: 403, error: 'credential required', mode: mode }; }
    return { ok: true, wk: null, claimed: true }; // off / new-only：已认领笔记的宽限期
  }
  if (mode !== 'off' && !noteExists(id)) {        // 只挡「真新建且无凭据」，存量永不因此被拒
    wkRecordFail(ip, id);
    return { ok: false, code: 403, error: 'credential required', mode: mode };
  }
  return { ok: true, wk: null, claimed: false };
}

// --- 笔记名扫描守卫：GET 一个不存在的名字会拿到 200+空密文（形状不可改），于是名字存在性可被枚举。
// 凭据上线后枚举的收益已降到「知道某人有个叫 work 的笔记」，这里再补一道按 IP 的 misses 计数收紧。
// 【闸 R2-D】阈值从 40 提到 80：该桶按 IP 计，共享出口（CGNAT/校园网）下攻击者用自己那份流量
// 就能把同段邻居一起挡在读取外，误伤代价大于收益；而它防的只是低价值的存在性探测。
const SCAN_WINDOW = 10 * 60 * 1000;
const SCAN_LIMIT = 80;
const scanMap = new Map(); // ip -> { n, first }
function noteExists(id) {
  try { return fs.existsSync(notePath(id)); } catch (e) { return false; }
}
function scanCheck(ip) {
  const now = Date.now(), rec = scanMap.get(ip);
  if (!rec || now - rec.first > SCAN_WINDOW) return { blocked: false };
  return rec.n >= SCAN_LIMIT ? { blocked: true, retryAfter: Math.ceil((SCAN_WINDOW - (now - rec.first)) / 1000) } : { blocked: false };
}
function scanRecordMiss(ip) {
  const now = Date.now(), rec = scanMap.get(ip);
  if (!rec || now - rec.first > SCAN_WINDOW) { scanMap.set(ip, { n: 1, first: now }); return; }
  rec.n++;
  if (scanMap.size > 5000) { for (const [k, v] of scanMap) { if (now - v.first > SCAN_WINDOW) scanMap.delete(k); } } // 无界增长=内存泄漏
}
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of scanMap) { if (now - v.first > SCAN_WINDOW) scanMap.delete(k); }
}, 5 * 60 * 1000).unref();

// --- v10.0.0 签发端点配置（云端 secret 只从 env 来，源码零硬编码；缺失即 503 降级不崩服务）---
const CLOUD = {
  name: String(process.env.CLOUDINARY_CLOUD || ''),
  key: String(process.env.CLOUDINARY_KEY || ''),
  secret: String(process.env.CLOUDINARY_SECRET || ''),
};
const UPSIGN_FOLDER = String(process.env.CLOUDINARY_FOLDER || 'notesync');
const UPSIGN_PRESET = String(process.env.CLOUDINARY_PRESET || 'notesync-signed');
const UPSIGN_TTL = 120;                                        // 一次一签，秒级时间戳由 Cloudinary 侧判过期
const UPSIGN_PER_MIN = Number(process.env.CLOUDINARY_UPSIGN_PER_MIN || 20);
const UPSIGN_PER_DAY = Number(process.env.CLOUDINARY_UPSIGN_PER_DAY || 2000);
// 白名单（逗号分隔的 IP）享十倍额度——真实用户撞不到默认值，这条只防哪天把自己限死。
const UPSIGN_WHITELIST = new Set(String(process.env.NOTESYNC_UPSIGN_WHITELIST || '').split(',').map(s => s.trim()).filter(Boolean));
const upsignMap = new Map(); // ip -> { m, ms, d, ds }
// 【闸 R2-A】配额主键只按 IP：原先掺了请求体里的 note，而 note 客户端可任意编——
// 每换一个假名字额度就翻一倍，限流形同虚设。note 只用于日志归属，白名单也只认 IP，
// 否则「猜中一个已加白的笔记名」就能提十倍。
function upsignQuota(ip) {
  const now = Date.now();
  const mult = UPSIGN_WHITELIST.has(ip) ? 10 : 1;
  let r = upsignMap.get(ip);
  if (!r) { r = { m: 0, ms: now, d: 0, ds: now }; upsignMap.set(ip, r); }
  if (now - r.ms > 60000) { r.m = 0; r.ms = now; }
  if (now - r.ds > 86400000) { r.d = 0; r.ds = now; }
  if (r.m >= UPSIGN_PER_MIN * mult) return { ok: false, retryAfter: Math.ceil((60000 - (now - r.ms)) / 1000) };
  if (r.d >= UPSIGN_PER_DAY * mult) return { ok: false, retryAfter: Math.ceil((86400000 - (now - r.ds)) / 1000) };
  r.m++; r.d++;
  if (upsignMap.size > 5000) { for (const [k, v] of upsignMap) { if (now - v.ms > 120000) upsignMap.delete(k); } } // 同 arcWrites：无界增长=内存泄漏
  return { ok: true };
}
// Cloudinary 签名规则：除 file/cloud_name/api_key/signature/resource_type 外的参数按 key 升序拼 k=v&...，
// 尾部直接接 api_secret（无分隔符）取 SHA1 hex。我们刻意只签这三项——多签一个参数就多一分算不一致的概率，
// 而 public_id 交给 Cloudinary 随机生成（前端不传），攻击者拿到一次签名也只能往固定目录塞一张 jpg。
function cloudSign(ts) {
  const params = { folder: UPSIGN_FOLDER, timestamp: ts, upload_preset: UPSIGN_PRESET };
  const str = Object.keys(params).sort().map(k => k + '=' + params[k]).join('&');
  return crypto.createHash('sha1').update(str + CLOUD.secret).digest('hex');
}

// noteId 校验：英文/数字/下划线/短横线，1-64 字符（v5.19 恢复 _ 与 -：
// v5.15 为禁中文收紧成纯字母数字，误伤了早期带 _/- 的旧笔记；中文仍被拒绝）
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
// v9.0.0：十个彩蛋门牌为专属保留字。只挡前端不够——MCP 工具与直接 PUT 仍能建出同名笔记，
// 而那条笔记会被路由永久遮蔽（用户视角=笔记蒸发）。只挡「新建」，已存在的存量仍可 GET，不毁数据。
const RESERVED_IDS = new Set(['mirror', 'snake', 'dragon', 'brick', 'satoshi', 'bitcoin', 'tank', 'spacex', 'tesla', 'pet']);

// --- 限流参数 ---
// v10.0.0：这道锁此前是死的（客户端上报请求不带 JSON 头 → 恒定 400 → 计数从未增加），本版修好后
// 它第一次真的会落锁，所以阈值同步放宽：真防口令爆破靠的是 PBKDF2 20 万次迭代，不是靠锁人；
// 而锁一旦落下连 GET 都挡，太容易把连错几次口令的正常用户关在自己笔记外面。20 次/10 分钟、锁 10 分钟。
const FAIL_LIMIT = 20;                   // 失败阈值
const FAIL_WINDOW = 10 * 60 * 1000;      // 计数窗口 10 分钟
const LOCK_DURATION = 10 * 60 * 1000;    // 锁定 10 分钟
// Map<key, { count, firstFail, lockedAt }>
const failMap = new Map();

function getClientIP(req) {
  // v5.52：Caddy 反代把真实客户端 IP 追加在 XFF 末尾，首段是客户端可伪造的。
  // 取首段等于任何人都能靠轮换 XFF 头绕过失败锁定，必须取末段。
  const xff = req.headers['x-forwarded-for'];
  if (xff) {
    const parts = xff.split(',').map(s => s.trim()).filter(Boolean);
    if (parts.length) return parts[parts.length - 1];
  }
  return req.socket.remoteAddress || 'unknown';
}

function checkLimit(ip, noteId) {
  const key = ip + ':' + noteId;
  const now = Date.now();
  const rec = failMap.get(key);
  if (rec && rec.lockedAt) {
    if (now - rec.lockedAt < LOCK_DURATION) {
      return { locked: true, retryAfter: Math.ceil((LOCK_DURATION - (now - rec.lockedAt)) / 1000) };
    } else {
      failMap.delete(key); // 锁定过期，清除
    }
  }
  return { locked: false };
}

function recordFail(ip, noteId) {
  const key = ip + ':' + noteId;
  const now = Date.now();
  let rec = failMap.get(key);
  // 已锁定，直接返回
  if (rec && rec.lockedAt) {
    return checkLimit(ip, noteId);
  }
  // 无记录或窗口过期，重置
  if (!rec || (now - rec.firstFail > FAIL_WINDOW)) {
    rec = { count: 0, firstFail: now, lockedAt: null };
  }
  rec.count++;
  if (rec.count >= FAIL_LIMIT) {
    rec.lockedAt = now;
  }
  failMap.set(key, rec);
  return checkLimit(ip, noteId);
}

// 定期清理过期记录（每 5 分钟）
setInterval(() => {
  const now = Date.now();
  for (const [key, rec] of failMap) {
    if (rec.lockedAt) {
      if (now - rec.lockedAt >= LOCK_DURATION) failMap.delete(key);
    } else if (now - rec.firstFail >= FAIL_WINDOW) {
      failMap.delete(key);
    }
  }
}, 5 * 60 * 1000).unref();

// --- SSE 推送 ---
// Map<noteId, Set<res>> 存所有 SSE 连接
const sseClients = new Map();
let sseActive = 0;                  // v5.52：当前活跃 SSE 连接数
const MAX_SSE = 2000;               // 上限，超出返回 429

function sseBroadcast(noteId, data) {
  const clients = sseClients.get(noteId);
  if (!clients) return;
  const msg = 'data: ' + JSON.stringify(data) + '\n\n';
  for (const res of clients) {
    try { res.write(msg); } catch (e) {}
  }
}

function notePath(id) {
  return path.join(NOTES_DIR, id + '.json');
}

function readNote(id) {
  try {
    return JSON.parse(fs.readFileSync(notePath(id), 'utf8'));
  } catch {
    return { ...EMPTY };
  }
}

function writeNote(id, obj) {
  const tmp = notePath(id) + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(obj));
  fs.renameSync(tmp, notePath(id));
}

// v6.0：历史版本快照环——FIFO 上限 HISTORY_MAX 条，独立文件 <id>.hist.json。
// 只存密文（零知识不变）；手动打点不参与挤出（优先挤自动），相同密文不重复入栈。
const HISTORY_MAX = 10;
function histPath(id) { return path.join(NOTES_DIR, id + '.hist.json'); }
function readHist(id) {
  try {
    const h = JSON.parse(fs.readFileSync(histPath(id), 'utf8'));
    if (h && Array.isArray(h.list)) return h;
  } catch {}
  return { list: [] };
}
function writeHist(id, h) {
  const tmp = histPath(id) + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(h));
  fs.renameSync(tmp, histPath(id));
}

function sendJSON(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}

function extractId(url, prefix) {
  // /api/note/abc123 → abc123（路径段可能含中文等，需先 decodeURIComponent）
  const m = url.match(new RegExp('^' + prefix + '/([^/]+)'));
  if (!m) return null;
  try { return decodeURIComponent(m[1]).toLowerCase(); } catch { return null; }
  // v10.1.1（T1）：id 一律归一化小写——NTFS 大小写不敏感，/XL 与 /xl 在 Windows 部署上是同一篇
  // 笔记，但写入凭据按名字逐字符派生（notesync-write-v1:<id>），大小写变体会被凭据闸判 403
  // （用户实锤：AI 用大写 XL 改 xl 笔记失败）。GET/PUT/fail/保留字检查全走本函数，出口一处归一。
  // 现网档案名全为小写/数字（NTFS 显示名取创建时形态），归一化零破坏；Linux 迁移时大写档案
  // 不再可达——归一化后也不会再产生大写档，语义自洽。
}

const server = http.createServer((req, res) => {
  const url = req.url.split('?')[0];
  const ip = getClientIP(req);

  // v8.0.9（§K1）：HEAD 与 GET 等效——此前所有路由只接 GET，监控探针/CDN 探活
  // 打 HEAD 会落到末尾 404，被误判「服务挂了」。这里把方法改写进既有 GET 分支，
  // 并吞掉 body 写入（HEAD 响应按规范只回状态行+头部，不依赖运行时隐式行为）。
  // 闸R2-P1：/api/note/:id/stream 除外——SSE 分支只 write 从不 end，HEAD 归一化进来
  // 会永久挂起还白占 sseActive 连接名额；该路由维持旧行为（落末尾 404，探活不该打流）。
  if (req.method === 'HEAD' && !(url.startsWith('/api/note/') && url.endsWith('/stream'))) {
    req.method = 'GET';
    res.write = () => true;
    const realEnd = res.end.bind(res);
    res.end = (...args) => { const cb = args.find(a => typeof a === 'function'); realEnd(cb); };
  }

  // --- API: SSE 流 ---
  if (req.method === 'GET' && url.startsWith('/api/note/') && url.endsWith('/stream')) {
    const id = decodeURIComponent(url.replace(/\/stream$/, '').replace(/^\/api\/note\//, '')).toLowerCase(); // v10.1.1：与 extractId 同口径归一，防大小写变体订阅错频道收不到推送
    if (!id || !ID_RE.test(id)) return sendJSON(res, 400, { error: 'bad id' });
    // v5.52：全局连接上限，防恶意客户端开大量长连接耗尽 fd / 内存。
    // v9.5.5 修：上限检查必须在 writeHead(200) 之前——原放在其后，触发 429 时 sendJSON 再写头直接抛 ERR_HTTP_HEADERS_SENT。
    if (sseActive >= MAX_SSE) return sendJSON(res, 429, { error: 'too many streams' });
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no'
    });
    res.write(': connected\n\n');
    if (!sseClients.has(id)) sseClients.set(id, new Set());
    sseClients.get(id).add(res);
    sseActive++;
    // SSE 心跳：每 15 秒发送 ping，防止代理/运营商中断长连接
    const heartbeat = setInterval(() => {
      try { res.write(': ping\n\n'); } catch (e) { clearInterval(heartbeat); }
    }, 15000);
    req.on('close', () => {
      clearInterval(heartbeat);
      if (sseActive > 0) sseActive--;
      const clients = sseClients.get(id);
      if (clients) { clients.delete(res); if (clients.size === 0) sseClients.delete(id); }
    });
    return;
  }

  // --- API: 认领笔记（v10.0.0 B1）---
  // 客户端首次解锁即调用，把「本机从口令派生出的写入凭据」登记到服务端。
  // 这是一次纯登记：不改正文、不递增版本，所以任何内容写入路径都不被它牵连；
  // 已认领且凭据相符=幂等成功；已认领而凭据不符=硬 403（绝不静默换绑，那是 B1 拒绝的"可卸掉的防护"）。
  // 不建档：名字不存在直接 404，建档仍由落盐那一枪负责。三种模式都允许认领——off 档提前登记，
  // 正是为了让发版当天扫一遍笔记之后，切 new-only/full 时存量已经在保护圈内。
  if (req.method === 'POST' && /^\/api\/note\/[^/]+\/claim$/.test(url)) {
    let cid;
    try { cid = decodeURIComponent(url.slice('/api/note/'.length, -'/claim'.length)).toLowerCase(); } catch { return sendJSON(res, 400, { error: 'bad id' }); } // v10.1.1：归一化与 extractId 同口径——大写名认领/写入凭据必须落到同一档案
    if (!cid || !ID_RE.test(cid)) return sendJSON(res, 400, { error: 'bad id' });
    req.resume(); // POST 带体：先抽干，任何分支都不留悬挂请求体
    const limit = checkLimit(ip, cid);
    if (limit.locked) return sendJSON(res, 429, { error: 'locked', retryAfter: limit.retryAfter });
    const wkLock = wkLimited(ip, cid); // 复核⑤：认领端点同样要节流，否则它是绕过凭据锁的枚举入口
    if (wkLock) return sendJSON(res, 429, { error: 'locked', retryAfter: wkLock });
    const wk = wkHashFromReq(req);
    if (!wk) return sendJSON(res, 400, { error: 'no credential' });
    if (!noteExists(cid)) return sendJSON(res, 404, { error: 'not found' });
    const cur = readNote(cid);
    // 复核②：readNote 对损坏/半截文件会静默回落 EMPTY（salt 空）。此时认领会把真档覆写成
    // 「空档 + 外来哈希」= 打开一次即永久毁文。故 EMPTY 回落一律拒写，并用 404 同形不多给信号。
    if (!cur.salt) return sendJSON(res, 404, { error: 'not found' });
    const claimed = typeof cur.wkHash === 'string' && cur.wkHash.length === 64;
    if (claimed && cur.wkHash !== wk) { wkRecordFail(ip, cid); return sendJSON(res, 403, { error: 'forbidden' }); }
    if (!claimed) { cur.wkHash = wk; writeNote(cid, cur); console.log('[claim] ' + cid); } // 只加字段，v/ct/iv/salt/rem 原样不动
    return sendJSON(res, 200, { ok: true, claimed: true, v: cur.v || 0 });
  }

  // --- API: 历史版本（v6.0，必须先于主 /api/note/ 分支——ID_RE 不含斜杠，放后面会被主分支吃掉）---
  // GET  /api/note/:id/history      → 元数据列表（ts/v/manual/size，不含密文，省流量）
  // GET  /api/note/:id/history/:ts  → 单条密文（预览/恢复时才取）
  // PUT  /api/note/:id/history      → 追加快照 {ct, iv, manual}
  if (req.method === 'GET' && url.startsWith('/api/note/') && url.includes('/history')) {
    const m = url.match(/^\/api\/note\/([^/]+)\/history(?:\/(\d+))?$/);
    if (!m) return sendJSON(res, 404, { error: 'not found' });
    let id;
    try { id = decodeURIComponent(m[1]); } catch { return sendJSON(res, 400, { error: 'bad id' }); }
    if (!id || !ID_RE.test(id)) return sendJSON(res, 400, { error: 'bad id' });
    const limit = checkLimit(ip, id);
    if (limit.locked) return sendJSON(res, 429, { error: 'locked', retryAfter: limit.retryAfter });
    const hist = readHist(id);
    if (m[2]) {
      const item = hist.list.find(x => String(x.ts) === m[2]);
      if (!item) return sendJSON(res, 404, { error: 'no such snapshot' });
      return sendJSON(res, 200, { ts: item.ts, ct: item.ct, iv: item.iv });
    }
    return sendJSON(res, 200, { list: hist.list.map(x => ({ ts: x.ts, v: x.v, manual: !!x.manual, size: (x.ct || '').length })) });
  }
  // v6.3：PUT /api/note/:id/history/:ts —— 按 ts 覆写单条快照的密文。
  // 用途：改口令时前端把历史快照逐条「旧钥解→新钥重加」写回，历史不再因换钥集体失效。
  // 只允许替换 ct/iv，ts/v/manual 原样保留——换钥不改变历史的时序语义。
  if (req.method === 'PUT' && /^\/api\/note\/[^/]+\/history\/\d+$/.test(url)) {
    const m = url.match(/^\/api\/note\/([^/]+)\/history\/(\d+)$/);
    let id;
    try { id = decodeURIComponent(m[1]); } catch { return sendJSON(res, 400, { error: 'bad id' }); }
    if (!id || !ID_RE.test(id)) return sendJSON(res, 400, { error: 'bad id' });
    const limit = checkLimit(ip, id);
    if (limit.locked) return sendJSON(res, 429, { error: 'locked', retryAfter: limit.retryAfter });
    let body = '';
    req.on('data', c => { body += c; if (body.length > 1024 * 1024) req.destroy(); });
    req.on('end', () => {
      let obj;
      try { obj = JSON.parse(body); } catch { return sendJSON(res, 400, { error: 'bad json' }); }
      if (!obj || typeof obj.ct !== 'string' || !obj.ct || typeof obj.iv !== 'string' || !obj.iv) {
        return sendJSON(res, 400, { error: 'missing fields' });
      }
      // v10.0.0：历史快照按条覆写是主写入的侧门——正门锁了侧门不锁，等于攻击者仍可逐条毁历史。
      const wkc1 = wkCheckNote(req, ip, id, readNote(id));
      if (!wkc1.ok) return sendJSON(res, wkc1.code, wkc1.mode ? { error: wkc1.error, mode: wkc1.mode } : { error: wkc1.error });
      const hist = readHist(id);
      const item = hist.list.find(x => String(x.ts) === m[2]);
      if (!item) return sendJSON(res, 404, { error: 'no such snapshot' });
      item.ct = obj.ct;
      item.iv = obj.iv;
      writeHist(id, hist);
      return sendJSON(res, 200, { ok: true, ts: item.ts });
    });
    return;
  }
  if (req.method === 'PUT' && url.startsWith('/api/note/') && url.endsWith('/history')) {
    let id;
    try { id = decodeURIComponent(url.slice('/api/note/'.length, -'/history'.length)); } catch { return sendJSON(res, 400, { error: 'bad id' }); }
    if (!id || !ID_RE.test(id)) return sendJSON(res, 400, { error: 'bad id' });
    const limit = checkLimit(ip, id);
    if (limit.locked) return sendJSON(res, 429, { error: 'locked', retryAfter: limit.retryAfter });
    let body = '';
    req.on('data', c => { body += c; if (body.length > 1024 * 1024) req.destroy(); });
    req.on('end', () => {
      let obj;
      try { obj = JSON.parse(body); } catch { return sendJSON(res, 400, { error: 'bad json' }); }
      if (!obj || typeof obj.ct !== 'string' || !obj.ct || typeof obj.iv !== 'string' || !obj.iv) {
        return sendJSON(res, 400, { error: 'missing fields' });
      }
      const cur = readNote(id);
      // v10.0.0：历史环追加快照同样是写入，必须过同一道凭据闸。
      const wkc2 = wkCheckNote(req, ip, id, cur);
      if (!wkc2.ok) return sendJSON(res, wkc2.code, wkc2.mode ? { error: wkc2.error, mode: wkc2.mode } : { error: wkc2.error });
      // 笔记档本身不存在时凭空建 <id>.hist.json 是纯磁盘填充面（任意合法名字都能造文件）。
      // 为守住「off 档行为与今天逐字相同」的灰度承诺，只在 new-only/full 起效。
      if (!noteExists(id) && wkMode() !== 'off') return sendJSON(res, 403, { error: 'orphan history' });
      const hist = readHist(id);
      let ts = Date.now();
      while (hist.list.some(x => x.ts === ts)) ts++; // v6.0：同毫秒去重，否则 GET /:ts 永远只命中第一条
      const item = { ts: ts, v: cur.v || 0, ct: obj.ct, iv: obj.iv, manual: !!obj.manual };
      const last = hist.list[hist.list.length - 1];
      if (!last || last.ct !== item.ct || last.iv !== item.iv) {
        hist.list.push(item);
        while (hist.list.length > HISTORY_MAX) {
          let idx = hist.list.findIndex(x => !x.manual); // 手动打点优先保留，先挤自动
          if (idx === -1) idx = 0;
          hist.list.splice(idx, 1);
        }
        writeHist(id, hist);
      }
      return sendJSON(res, 200, { ok: true, ts: item.ts, count: hist.list.length });
    });
    return;
  }

  // --- API: 读取笔记 ---
  if (req.method === 'GET' && url.startsWith('/api/note/')) {
    const id = extractId(url, '/api/note');
    if (!id || !ID_RE.test(id)) return sendJSON(res, 400, { error: 'bad id' });
    const limit = checkLimit(ip, id);
    if (limit.locked) return sendJSON(res, 429, { error: 'locked', retryAfter: limit.retryAfter });
    // v10.0.0：响应形状一字未改（旧客户端靠 200+空密文判新建），只在旁路记 miss 供扫描守卫用。
    const exists = noteExists(id);
    const scan = scanCheck(ip);
    if (scan.blocked) return sendJSON(res, 429, { error: 'locked', retryAfter: scan.retryAfter });
    if (!exists) scanRecordMiss(ip);
    // v10.0.0：凭据哈希不出门（虽不可逆，但「是否已认领」本身就是探测者想要的信号）。
    // readNote 每次返回的都是 JSON.parse 出的新对象，直接 delete 即安全剥除，其余键逐字不变。
    const pub = readNote(id);
    if ('wkHash' in pub) delete pub.wkHash;
    return sendJSON(res, 200, pub);
  }

  // --- API: 写入笔记 ---
  if (req.method === 'PUT' && url.startsWith('/api/note/')) {
    // 门牌专属：新建（服务器无此档）时才挡，存量笔记仍可正常读写，不毁用户数据
    // 必须按「原样名 + 小写名」两处都查：ID_RE 允许大写，v9 之前的存量笔记可能就叫 Snake，
    // 只查小写文件会把这台机器真实存在的笔记判成新建并永久 400（用户保存静默失败）
    { const _raw = String(extractId(url, '/api/note') || ''), _low = _raw.toLowerCase();
      if (RESERVED_IDS.has(_low) && !fs.existsSync(notePath(_raw)) && !fs.existsSync(notePath(_low))) return sendJSON(res, 400, { error: 'reserved name' }); }
    const id = extractId(url, '/api/note');
    if (!id || !ID_RE.test(id)) return sendJSON(res, 400, { error: 'bad id' });
    const limit = checkLimit(ip, id);
    if (limit.locked) return sendJSON(res, 429, { error: 'locked', retryAfter: limit.retryAfter });
    let body = '';
    req.on('data', c => { body += c; if (body.length > 1024 * 1024) req.destroy(); });
    req.on('end', () => {
      let obj;
      try { obj = JSON.parse(body); } catch { return sendJSON(res, 400, { error: 'bad json' }); }
      if (!obj || typeof obj.ct !== 'string' || typeof obj.iv !== 'string' || typeof obj.salt !== 'string') {
        return sendJSON(res, 400, { error: 'missing fields' });
      }
      const cur = readNote(id);
      // ===== v10.0.0 凭据闸（三态：off / new-only / full，判据见 wkCheckNote）=====
      const wkLock = wkLimited(ip, id);
      if (wkLock) return sendJSON(res, 429, { error: 'locked', retryAfter: wkLock });
      const wkc = wkCheckNote(req, ip, id, cur, obj);
      if (!wkc.ok) return sendJSON(res, wkc.code, wkc.mode ? { error: wkc.error, mode: wkc.mode } : { error: wkc.error });
      const wk = wkc.wk, claimed = wkc.claimed;
      // v6.3：opt-in 乐观并发控制——写入带 baseV 时，版本不符返回 409（附当前 v），
      // 客户端重读-改-重写；v7.2.0 起 web 端也带 baseV（baseV=localVer），
      // 不带 baseV 的旧客户端行为完全不变（不破坏任何现有客户端）。
      if (typeof obj.baseV === 'number' && (cur.v || 0) !== obj.baseV) {
        return sendJSON(res, 409, { error: 'version conflict', v: cur.v || 0 });
      }
      // v5.36 提醒字段（rem）：与正文同为密文，服务端零知识不变。
      // 客户端显式传 rem（含 null=取消提醒）时采用之；未传（普通正文保存）时保留原值——
      // 否则任何一台设备的正文保存都会抹掉另一台设备刚设的提醒。
      let rem = cur.rem || null;
      if (obj.rem !== undefined) rem = obj.rem; // null 也是显式意图（取消提醒）
      // v5.58 空盐不覆写（数据级止血）：客户端 serverSalt 为空时 bufToB64(null) 产出空串，
      // 此前服务端无条件采用 obj.salt → 笔记盐被冲成 '' → 下次解锁走随机盐推导 →
      // 正确口令恒定「解密失败」。空值一律保留原盐，盐只由首次初始化写入。
      const saltIn = (typeof obj.salt === 'string' && obj.salt) ? obj.salt : (cur.salt || '');
      // v6.0：空 ct/iv 不覆写（与 v5.58 空盐同理）。旧版客户端落盐时硬发 ct:''/iv:''，
      // 会把并发端刚写入的正文清空——这是数据级破坏，服务端必须无条件兜住（线上仍有旧版在跑）。
      // 真实「清空笔记」经 AES-GCM 后 ct 仍含 16 字节 tag，不为空串，故此保护不会误伤。
      const ctIn = (typeof obj.ct === 'string' && obj.ct) ? obj.ct : (cur.ct || '');
      const ivIn = (typeof obj.iv === 'string' && obj.iv) ? obj.iv : (cur.iv || '');
      const next = { v: (cur.v || 0) + 1, ct: ctIn, iv: ivIn, salt: saltIn, rem: rem, updatedAt: Date.now() };
      // v10.0.0：只有「原子换绑」或「无正文时认领」才落哈希；已认领的沿用。
      // 未认领且已有正文时带来的外来凭据一律不落库——否则 wkCheckNote 里「有正文不接受外来凭据」
      // 这条 P0 防线会在落库环节被绕过（闸 R2-H1）。
      if (wkc.swap || wkc.claim) next.wkHash = wk;
      else if (claimed) next.wkHash = cur.wkHash;
      writeNote(id, next);
      sseBroadcast(id, { v: next.v, updatedAt: next.updatedAt });
      return sendJSON(res, 200, { ok: true, v: next.v, updatedAt: next.updatedAt });
    });
    return;
  }

  // --- API: 上报解密失败 ---
  if (req.method === 'POST' && url.startsWith('/api/fail/')) {
    const id = extractId(url, '/api/fail');
    if (!id || !ID_RE.test(id)) return sendJSON(res, 400, { error: 'bad id' });
    // v5.52：强制要求 JSON content-type，逼浏览器发预检。
    // 否则这是个 simple 请求，任意恶意网页都能连发 10 次锁死别人的笔记，
    // 而 CORS 白名单对 simple 请求无效（预检才拦得住）。
    const ct = req.headers['content-type'] || '';
    if (!ct.includes('application/json')) return sendJSON(res, 400, { error: 'bad content-type' });
    const limit = recordFail(ip, id);
    if (limit.locked) return sendJSON(res, 429, { locked: true, retryAfter: limit.retryAfter });
    const rec = failMap.get(ip + ':' + id);
    return sendJSON(res, 200, { locked: false, count: rec ? rec.count : 0 });
  }

  // --- v10.0.0 图片上传签名签发 ---
  // 背景：前端直传 Cloudinary 用的是免签名 preset，而 cloud_name + preset 名就写在页面源码里
  // （index.html:810-811）——任何人拿它就能往本站 Cloudinary 账号白图：烧配额、塞违规内容连累封号。
  // 改法：preset 转 Signed，签名由本端点签发。云端 secret 只当配额闸门，不碰笔记明文，零知识不破。
  // 已知边界（写进 VERSION_LOG）：本服务零知识，无从判断客户端是否已解锁，所以这一版拦的是
  // 「不经我服务器 + 无限量」，真正的「解锁才能签发」等 writeKey 全量强制后在同一处加一行校验即可。
  if (req.method === 'POST' && url === '/api/upsign') {
    if (!CLOUD.name || !CLOUD.key || !CLOUD.secret) return sendJSON(res, 503, { error: 'signing unavailable' });
    // 强制 JSON content-type：与 /api/fail 的 v5.52 同一手法——不要求的话这是 simple 请求，
    // 任意恶意网页都能跨域连发要签名；要求了就触发预检，而本服务不回 ACAO 头，浏览器直接拦死。
    const ct = req.headers['content-type'] || '';
    if (!ct.includes('application/json')) return sendJSON(res, 400, { error: 'bad content-type' });
    readBody(req, 4096).then(function (body) {
      let o = {}; try { o = JSON.parse(body || '{}'); } catch (e) {}
      const note = (typeof o.note === 'string' && ID_RE.test(o.note)) ? o.note : ''; // 仅日志归属，不参与配额主键
      const q = upsignQuota(ip);
      if (!q.ok) return sendJSON(res, 429, { error: 'too many', retryAfter: q.retryAfter });
      const ts = Math.floor(Date.now() / 1000);
      const sig = cloudSign(ts);
      console.log('[upsign] ts=' + ts + ' note=' + (note || '-')); // 只记时间与归属笔记，绝不记 secret / 签名
      return sendJSON(res, 200, {
        cloud_name: CLOUD.name, api_key: CLOUD.key, timestamp: ts, signature: sig,
        upload_preset: UPSIGN_PRESET, folder: UPSIGN_FOLDER, expires_in: UPSIGN_TTL,
      });
    }).catch(function () { return sendJSON(res, 413, { error: 'too large' }); });
    return;
  }

  // --- API: 最新 release 元数据（v9.3.1 二修）——不做任何外网请求：读发布五件套随部署上传的
  // latest_app.json（本机 gh api releases/latest 生成）。字段与 GitHub API 同形：
  // {tag_name, published_at, body, assets:[{name, browser_download_url, size}]}。缺文件回 502（未发布过）。
  if (url.startsWith('/api/latest') && req.method === 'GET') {
    try {
      const o = fs.readFileSync(path.join(APP_DIR, 'latest_app.json'), 'utf8');
      JSON.parse(o); // 校验再回吐：半截坏文件宁可 502 也不喂前端将错就错
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(o);
    } catch (e) {
      res.writeHead(502, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end('{"error":"no release metadata"}');
    }
    return;
  }

  // --- v9.3.2：APK 走国内域名直下（用户拍板：GitHub releases CDN 国内慢/需翻墙）---
  // biji 域已把非 /api 请求整体反代到本服务，故这里直出、无需改 Caddy。已装旧壳原生 downloadApk 只校验
  // https:// 不锁域名，翻本路由即生效、无需重编 APK。固定文件名覆盖式：只服务 APP_DIR/apk/latest.apk
  // 这一个文件，发版覆盖 = 永远只留最新、不堆旧副本（服务器 C 盘仅 ~8G 余量）。精确 url 匹配无穿越面；
  // 支持 HTTP Range 断点续传（安卓 DownloadManager 在 3Mbps 低带宽下续传/分段必备）。
  // v9.5.4：新增版本固定名 /dl/vX.Y.Z.apk（发版时上传、永不覆盖），latest_app.json 的下载 URL 指向它——
  // 该 URL 内容不可变，根除「手机 Range 续传跨发版读到新旧混装字节」的 packageInfo is null。
  // 同时保留 /dl/latest.apk（覆盖式）兼容旧壳与手输链接。文件名走严格白名单正则，无路径穿越面。
  const dlMatch = /^\/dl\/(latest|v\d+(?:\.\d+)*)\.apk$/.exec(url);
  if (dlMatch && (req.method === 'GET' || req.method === 'HEAD')) {
    const fname = dlMatch[1] + '.apk';
    const f = path.join(APP_DIR, 'apk', fname);
    let st; try { st = fs.statSync(f); } catch (e) { return sendJSON(res, 404, { error: 'no apk' }); }
    const total = st.size;
    const baseHdr = {
      'Content-Type': 'application/vnd.android.package-archive',
      'Content-Disposition': 'attachment; filename="NoteSync-' + fname + '"',
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-cache',
      'Last-Modified': st.mtime.toUTCString(),
    };
    const rm = req.headers.range && /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
    if (rm) {
      let start = rm[1] === '' ? null : parseInt(rm[1], 10);
      let end = rm[2] === '' ? null : parseInt(rm[2], 10);
      if (start === null && end !== null) { start = Math.max(0, total - end); end = total - 1; }
      if (start === null) start = 0;
      if (end === null || end >= total) end = total - 1;
      if (start > end || start >= total) {
        res.writeHead(416, Object.assign({ 'Content-Range': 'bytes */' + total }, baseHdr));
        return res.end();
      }
      res.writeHead(206, Object.assign({
        'Content-Range': 'bytes ' + start + '-' + end + '/' + total,
        'Content-Length': String(end - start + 1),
      }, baseHdr));
      if (req.method === 'HEAD') return res.end();
      return fs.createReadStream(f, { start, end }).pipe(res);
    }
    res.writeHead(200, Object.assign({ 'Content-Length': String(total) }, baseHdr));
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(f).pipe(res);
    return;
  }

  // --- API: 街机档案（彩蛋成绩 / 桌宠）v9.0.0 ---
  if (url.startsWith('/api/arcade')) {
    // 路径段为 '' / 'api' / 'arcade' / '<id>'：必须取 [3]，取 [2] 会拿到字面量 arcade 致全部 404
    const aid = (url.split('?')[0].split('/')[3] || '').toUpperCase();
    if (req.method === 'GET' || req.method === 'PUT') {
      if (!ARC_ID_RE.test(aid)) return sendJSON(res, 404, { error: 'not found' });
      const rec = arcRead(aid);
      const kh = arcAuth(req, aid);
      if (!kh || !rec || rec.keyHash !== kh) return sendJSON(res, 404, { error: 'not found' }); // 钥匙错与不存在同形，防枚举
      if (req.method === 'GET') { // 回档必须剥掉 keyHash 与 id：连哈希都不出门
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      const pub = Object.assign({}, rec); delete pub.keyHash; delete pub.id;
      res.end(JSON.stringify(pub)); return;
    }
      if (arcLimited(aid)) return sendJSON(res, 429, { error: 'too many writes' });
      readBody(req, ARC_MAX_BODY).then(function (body) {
        let inc; try { inc = JSON.parse(body || '{}'); } catch (e) { return sendJSON(res, 400, { error: 'bad json' }); }
        if (!inc || typeof inc !== 'object') return sendJSON(res, 400, { error: 'bad body' });
        const merged = arcMerge(rec, inc);
        merged.id = aid; merged.keyHash = rec.keyHash; delete merged.key;
        const txt = JSON.stringify(merged);
        if (txt.length > ARC_MAX_BODY) return sendJSON(res, 413, { error: 'too large' });
        try { arcSave(aid, merged); } catch (e) { return sendJSON(res, 500, { error: 'write failed' }); }
        return sendJSON(res, 200, { ok: true, updatedAt: merged.updatedAt || 0 });
      }).catch(function () { return sendJSON(res, 413, { error: 'too large' }); });
      return;
    }
    if (req.method === 'POST') { // 建档：客户端自带 id+key，服务端只留哈希
      readBody(req, ARC_MAX_BODY).then(function (body) {
        let inc; try { inc = JSON.parse(body || '{}'); } catch (e) { return sendJSON(res, 400, { error: 'bad json' }); }
        const id = String(inc.id || '').toUpperCase(), k = String(inc.key || '');
        if (!ARC_ID_RE.test(id) || k.length < ARC_KEY_MIN || k.length > 64) return sendJSON(res, 400, { error: 'bad id/key' });
        sweepArcWrites();
        if (arcLimited('post:' + getClientIP(req))) return sendJSON(res, 429, { error: 'too many' }); // 建档按 IP 限速，防公网刷盘占满 inode
        if (arcRead(id)) return sendJSON(res, 200, { ok: true }); // 与新建统一回 {ok:true}：回 exists:true 等于告诉探测者该 id 有人占，破防枚举口径
        const rec = { id: id, keyHash: arcHash(k), counters: {}, shelf: [], updatedAt: Number(inc.updatedAt) || Date.now(), born: Date.now() };
        try { arcSave(id, rec); } catch (e) { return sendJSON(res, 500, { error: 'write failed' }); }
        return sendJSON(res, 200, { ok: true });
      }).catch(function () { return sendJSON(res, 413, { error: 'too large' }); });
      return;
    }
    return sendJSON(res, 405, { error: 'method not allowed' });
  }

  // --- 健康检查 ---
  if (req.method === 'GET' && url === '/healthz') {
    res.writeHead(200); res.end('ok'); return;
  }

  // --- 静态文件 ---
  if (req.method === 'GET' && !url.startsWith('/api/')) {
    // manifest.json 和 sw.js 返回对应文件
    if (url === '/manifest.json') {
      const f = path.join(APP_DIR, 'manifest.json');
      if (fs.existsSync(f)) {
        // 支持 ?start=/noteId 参数，动态设置 start_url 让每个笔记的快捷方式打开正确页面
        const query = req.url.split('?')[1] || '';
        const params = new URLSearchParams(query);
        const start = params.get('start') || '/';
        let manifest = JSON.parse(fs.readFileSync(f, 'utf8'));
        manifest.start_url = encodeURI(start);
        manifest.id = start;
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache, no-store, must-revalidate' });
        res.end(JSON.stringify(manifest));
        return;
      }
    }
    if (url === '/sw.js') {
      const f = path.join(APP_DIR, 'sw.js');
      if (fs.existsSync(f)) {
        res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8', 'Cache-Control': 'no-cache' });
        fs.createReadStream(f).pipe(res);
        return;
      }
    }
    if (url === '/favicon.svg') {
      const f = path.join(APP_DIR, 'favicon.svg');
      if (fs.existsSync(f)) {
        res.writeHead(200, { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'no-cache, no-store, must-revalidate' });
        fs.createReadStream(f).pipe(res);
        return;
      }
    }
    // v7.9.0：品牌图标 PNG 三件（iOS 加桌面 / PWA maskable）——精确文件名白名单，防 SPA 兜底把 PNG 当 HTML
    const BRAND_PNG = { '/apple-touch-icon.png': APP_DIR, '/icons/icon-192.png': path.join(APP_DIR, 'icons'), '/icons/icon-512.png': path.join(APP_DIR, 'icons') };
    if (BRAND_PNG[url]) {
      const f = path.join(BRAND_PNG[url], url.split('/').pop());
      if (fs.existsSync(f)) {
        res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=604800' });
        fs.createReadStream(f).pipe(res);
        return;
      }
    }
    // v6.0：jsQR 纯 JS 解码库（扫码兜底）——桌面 Chrome/Edge 与 iOS Safari 无 BarcodeDetector 时动态加载。
    // 独立文件不内联进 index.html：127KB 只在真正扫码时才拉一次（immutable 缓存）。
    if (url === '/jsQR.js') {
      const f = path.join(APP_DIR, 'jsQR.js');
      if (fs.existsSync(f)) {
        res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8', 'Cache-Control': 'public, max-age=31536000, immutable' });
        fs.createReadStream(f).pipe(res);
        return;
      }
    }
    // v7.5.1：html2canvas 自托管（导出图片用）——替代公共 CDN jsdelivr（大陆常不可达→「图片导出组件未加载」）。
    // 独立文件不内联进 index.html：约 199KB 只在点导出时懒加载一次（immutable 缓存，离线经 SW cache-first 兜底）。
    if (url === '/html2canvas.min.js') {
      const f = path.join(APP_DIR, 'html2canvas.min.js');
      if (fs.existsSync(f)) {
        res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8', 'Cache-Control': 'public, max-age=31536000, immutable' });
        fs.createReadStream(f).pipe(res);
        return;
      }
    }
    // v6.3：MCP 工具公开下载（零知识不破——这两个文件不含任何秘密，口令走调用端 env）。
    // 新机器接入：curl 拿 setup 脚本 → 跑一条命令自动写 mcp.json，免 clone 免手工配置。
    // 精确文件名白名单（url 完全匹配才命中），无路径穿越面；no-cache 保证拿到最新版。
    if (url === '/mcp/notesync-mcp-server.js' || url === '/mcp/setup-notesync-mcp.js') {
      const f = path.join(APP_DIR, 'tools', url.split('/').pop());
      if (fs.existsSync(f)) {
        res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8', 'Cache-Control': 'no-cache' });
        fs.createReadStream(f).pipe(res);
        return;
      }
    }
    if (url === '/bridge.html') {
      const f = path.join(APP_DIR, 'bridge.html');
      if (fs.existsSync(f)) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache, no-store, must-revalidate' });
        fs.createReadStream(f).pipe(res);
        return;
      }
    }
    // v8.0.9（§K2）：/.well-known/* 必须先于 SPA 兜底出结论——此前 assetlinks.json 被兜底
    // 吞成整页 index.html（text/html），安卓 App Links 校验永远不过。v8.1.0 起仓库文件已是
    // 真指纹 statement（release 签名证书 SHA-256，取自 v8.0.8 APK CERT.RSA），本部署上线即
    // 校验通过、点笔记域链接直达 APK——Manifest autoVerify+MainActivity URL 转发同版落地，
    // 真机回归项见发版闸。其余 /.well-known/* 一律 404 JSON，不再伪装 HTML。
    if (url === '/.well-known/assetlinks.json') {
      const f = path.join(APP_DIR, '.well-known', 'assetlinks.json');
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      if (fs.existsSync(f)) { fs.createReadStream(f).pipe(res); } else { res.end('[]'); }
      return;
    }
    if (url.startsWith('/.well-known/')) {
      res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end('{"error":"not found"}');
      return;
    }
    // SPA：其他都返回 index.html。v9.5.5：no-store 改 no-cache + ETag 条件请求——
    // 旧策略每次冷启必全量重下 275KB(gzip)，弱网 1.5~10s 纯白屏的大头；现在复访命中 304 传输≈0，
    // 发版覆盖文件后 mtime/size 变、ETag 自然失效，不会吐旧版（no-cache 仍保证每次带条件问源）。
    let ieTag = '';
    try { const ist = fs.statSync(INDEX_FILE); ieTag = 'W/"' + ist.size.toString(16) + '-' + Math.round(ist.mtimeMs).toString(16) + '"'; } catch (e) {}
    const inm = req.headers['if-none-match'];
    if (ieTag && inm && (inm === ieTag || inm.indexOf(ieTag) >= 0)) {
      res.writeHead(304, { 'Cache-Control': 'no-cache', 'ETag': ieTag });
      res.end();
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache', 'ETag': ieTag });
    fs.createReadStream(INDEX_FILE).pipe(res);
    return;
  }

  res.writeHead(404); res.end('not found');
});

server.listen(PORT, () => console.log('[notesync] listening on :' + PORT));
