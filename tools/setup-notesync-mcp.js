#!/usr/bin/env node
'use strict';
// NoteSync MCP 一键接入脚本（新机器用，零依赖，任何 node 都能跑）。
//
// 用法（三行）：
//   curl -O https://biji.xuyinji.com.cn/mcp/setup-notesync-mcp.js
//   node setup-notesync-mcp.js
//   （按提示输入默认笔记名与口令）
//
// 它做三件事：
//   1) 同目录没有 notesync-mcp-server.js 时自动从站点下载（本脚本与它都不含任何秘密，
//      公开下载是安全的——口令只走调用端 env，零知识不破）；
//   2) 询问默认笔记名（可留空）与口令（必填；只写进本机 ~/.workbuddy/mcp.json，不回传任何地方）；
//   3) 把 notesync 条目合并进 mcp.json：备份原文件、保留其他 server 配置、command 用
//      当前运行本脚本的 node 绝对路径（WorkBuddy 机器上自带 node，无需另装）。
//
// 多个口令不同的笔记：重跑本脚本会覆盖 notesync 条目（有备份），或手工在 mcp.json 里
// 复制条目改名（如 notesync-工作 / notesync-私人）各自配口令。
// 下载源可用 NOTESYNC_BASE 覆盖（默认 https://biji.xuyinji.com.cn），供本地测试指向自建服务。

const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const https = require('https');
const readline = require('readline');

const SITE = (process.env.NOTESYNC_BASE || 'https://biji.xuyinji.com.cn').replace(/\/+$/, '');
const SERVER_FILE = path.join(__dirname, 'notesync-mcp-server.js');
const WB_DIR = path.join(os.homedir(), '.workbuddy');
const MCP_JSON = path.join(WB_DIR, 'mcp.json');

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    lib.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return resolve(download(res.headers.location, dest)); // 跟一次重定向
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error('下载失败 HTTP ' + res.statusCode + '：' + url));
      }
      const out = fs.createWriteStream(dest);
      res.pipe(out);
      out.on('finish', () => out.close(() => resolve()));
      out.on('error', reject);
    }).on('error', reject);
  });
}

function ts() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
}

async function main() {
  // 1) MCP 服务器文件
  if (fs.existsSync(SERVER_FILE)) {
    console.log('[1/3] 已检测到 notesync-mcp-server.js，跳过下载');
  } else {
    console.log('[1/3] 下载 notesync-mcp-server.js ← ' + SITE);
    await download(SITE + '/mcp/notesync-mcp-server.js', SERVER_FILE);
  }
  const probe = fs.readFileSync(SERVER_FILE, 'utf8');
  if (!probe.includes('NOTESYNC_PASSPHRASE')) throw new Error('下载的文件不像 NoteSync MCP 服务器，已中止');

  // 2) 输入笔记名与口令。🔴 Windows 坑：管道 stdin 下第二个 rl.question 永不 resolve
  // （数据+EOF 同 chunk 到达时 readline 在第二个 question 注册前就 close，挂起静默退出）。
  // 非 TTY 一律走 terminal:false 的 line/close 事件读全行（第一行=笔记名，第二行=口令）。
  let note, pass;
  if (!process.stdin.isTTY) {
    const lines = await new Promise((resolve) => {
      const buf = [];
      const rl = readline.createInterface({ input: process.stdin, terminal: false });
      rl.on('line', (l) => buf.push(l));
      rl.on('close', () => resolve(buf));
    });
    note = (lines[0] || '').trim();
    pass = (lines[1] || '').trim();
  } else {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const ask = (q) => new Promise((r) => rl.question(q, r));
    note = (await ask('[2/3] 默认笔记名（可留空，之后调用时可逐次指定）：')).trim();
    pass = (await ask('[2/3] 笔记口令（必填，仅写入本机 mcp.json，不上传）：')).trim();
    rl.close();
  }
  if (!pass) { console.error('口令不能为空，未写入任何配置'); process.exit(1); }

  // 3) 合并 mcp.json（坏文件先备份再从空开始；存在旧 notesync 条目会覆盖——重跑即重配）
  fs.mkdirSync(WB_DIR, { recursive: true });
  let cfg = {};
  if (fs.existsSync(MCP_JSON)) {
    const bak = MCP_JSON + '.bak-' + ts();
    fs.copyFileSync(MCP_JSON, bak);
    console.log('      已备份原 mcp.json → ' + bak);
    try { cfg = JSON.parse(fs.readFileSync(MCP_JSON, 'utf8')); }
    catch (e) { console.log('      原 mcp.json 无法解析，按空配置重建（备份已留）'); cfg = {}; }
  }
  cfg.mcpServers = cfg.mcpServers || {};
  const replacing = !!cfg.mcpServers.notesync;
  cfg.mcpServers.notesync = {
    command: process.execPath,
    args: [SERVER_FILE],
    env: Object.assign(note ? { NOTESYNC_NOTE: note } : {}, { NOTESYNC_PASSPHRASE: pass }),
  };
  fs.writeFileSync(MCP_JSON, JSON.stringify(cfg, null, 2) + '\n');

  console.log('[3/3] 已' + (replacing ? '覆盖' : '写入') + ' notesync 条目 → ' + MCP_JSON);
  console.log('');
  console.log('完成。最后一步：打开 WorkBuddy → 连接管理 → 右上角自定义连接 → 给 notesync 点「信任」。');
  console.log('之后对 WorkBuddy 说：用 notesync 读一下我的笔记 / 给笔记追加一行 / 设个明天 9 点的提醒。');
}

main().catch((e) => { console.error('接入失败：' + e.message); process.exit(1); });
