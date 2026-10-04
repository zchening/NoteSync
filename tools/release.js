#!/usr/bin/env node
/**
 * NoteSync 统一发版入口（v10.1.8 起）
 *
 * 以前每发一个版本都要手抄三四个一次性脚本：_bump_pins_vXXXX.js / _bump_docs_XXXX.js /
 * deploy_target_vXXX.json，各自内含上一版的版本号字面，抄漏一处就要回头补、补完还要把
 * 全量测试再跑一遍。这里把它们收成「同一条流水线」，版本号只在一个地方出现（命令行参数）。
 *
 * 安全约束（继承历代约定）：
 *   1. 默认预演，必须显式 --apply 才落盘。
 *   2. pin 替换遵守三条豁免：注释行跳过、左侧 12 字符窗口带 CJK 的说明文字跳过
 *      （assert 消息里的旧版本号是要留给后人考古的）、前邻 V/v 或数字的 1018 是别版用例编号。
 *   3. e2e 目录不参与 pin 替换（那里有 v1004e4 这类与版本数字同形的夹具名）。
 *
 * 用法：
 *   node tools/release.js status            # 看三源版本、双壳字节、手机上查得到的版本
 *   node tools/release.js ota    10.1.8     # 推 App 在线升级元数据（发版五件套第⑤步，别漏）
 *   node tools/release.js bump  10.1.8      # 三源版本号 + BUILD_DATE + 同步双壳（默认预演）
 *   node tools/release.js pins  10.1.8      # unit 里的版本字面随版
 *   node tools/release.js fast              # 受影响子集（秒级，改完马上能知道有没有岔子）
 *   node tools/release.js full              # 全量 unit + e2e
 */
'use strict';
const fs = require('fs');
const path = require('path');

const REPO = path.resolve(__dirname, '..');
const APPLY = process.argv.includes('--apply');
const CJK = /[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/;

const P = {
  index: path.join(REPO, 'index.html'),
  gradle: path.join(REPO, 'android', 'app', 'build.gradle'),
  mcp: path.join(REPO, 'tools', 'notesync-mcp-server.js'),
  www: path.join(REPO, 'www', 'index.html'),
  assets: path.join(REPO, 'android', 'app', 'src', 'main', 'assets', 'public', 'index.html'),
};

const md5 = (() => { const c = require('crypto'); return f => c.createHash('md5').update(fs.readFileSync(f)).digest('hex'); })();
function readVersion(file, re) {
  try { const m = fs.readFileSync(file, 'utf8').match(re); return m ? m[1] : null; } catch (e) { return null; }
}

/* ── status：一眼看清现在处于什么状态 ─────────────────────────────── */
function statusBase() {
  const v = {
    index: readVersion(P.index, /const APP_VERSION = '([\d.]+)'/),
    gradle: readVersion(P.gradle, /versionName "([\d.]+)"/),
    mcp: readVersion(P.mcp, /serverInfo: \{ name: 'notesync', version: '([\d.]+)' \}/),
  };
  const h = { index: md5(P.index), www: md5(P.www), assets: md5(P.assets) };
  const verOk = v.index && v.index === v.gradle && v.index === v.mcp;
  const shellOk = h.index === h.www && h.index === h.assets;
  console.log('三源版本  index=' + v.index + '  gradle=' + v.gradle + '  mcp=' + v.mcp + (verOk ? '   ✅ 一致' : '   ❌ 不一致'));
  console.log('三壳字节  index=' + h.index.slice(0, 8) + '  www=' + h.www.slice(0, 8) + '  assets=' + h.assets.slice(0, 8) + (shellOk ? '   ✅ 一致' : '   ❌ 不同步（双壳测试必红）'));
  console.log('BUILD_DATE=' + readVersion(P.index, /const BUILD_DATE = '([^']+)'/));
  return { ok: verOk && shellOk, ver: v.index };
}

/* ── 第四源：手机上「检查更新」能查到的版本 ───────────────────────── */
// v10.1.8 补进来的一条。上面三源说的是「网页与壳」，但 App 只看 /api/latest —— 它由服务器上的
// latest_app.json 当场产出，而这文件要靠发版五件套第⑤步 push_latest_apk.py 生成并上传。
// 漏做第⑤步的现场特征就是：双域已经是新版、装上 App 点「检查更新」永远回「已是最新」。
// 把它并进 status，就能在下次发版当天发现，而不是等用户来问。（本版就是这样漏了一整晚。）
function probeOta() {
  const https = require('https');
  return new Promise(resolve => {
    const req = https.get('https://note.xuyinji.com.cn/api/latest?ts=' + Date.now(), { timeout: 8000 }, res => {
      let s = '';
      res.on('data', d => { s += d; });
      res.on('end', () => { try { resolve(JSON.parse(s).tag_name || null); } catch (e) { resolve(null); } });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
  });
}

async function status() {
  const base = statusBase();
  const ota = await probeOta();
  if (ota) {
    const ok = ota.replace(/^v/, '') === base.ver;
    console.log('手机可读  /api/latest -> ' + ota +
      (ok ? '   ✅ App 查得到本版' : '   ⚠ App 查不到本版：跑一遍 node tools/release.js ota ' + base.ver));
  } else {
    console.log('手机可读  /api/latest 探测失败（网络不可达或接口异常），本次未校验');
  }
  return base.ok && !!ota && ota.replace(/^v/, '') === base.ver;
}

// 本地日历日，不用 toISOString（那是 UTC，GMT+8 的凌晨会被算成前一天）
const todayLocal = () => {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
};

/* ── bump：三源版本号 + 日期 + 同步双壳 ───────────────────────────── */
function bump(to) {
  const from = readVersion(P.index, /const APP_VERSION = '([\d.]+)'/);
  if (!from) { console.error('index.html 里找不到 APP_VERSION'); process.exit(1); }
  if (from === to) { console.error('已经是 ' + to + '，没动'); return; }
  // 顺序要害：pin 随版必须在改 index.html **之前**跑——它会从 index 里读旧版本号当 FROM，
  // 先把 index 改成新版本，它就认不出哪些 needles 该换了（第一次实测这里静默改了 0 行）。
  console.log('— 先随版 unit 里的版本字面 pin —');
  pins(to, from);
  console.log('\n— 再改三源版本号 —');
  const date = todayLocal();
  const jobs = [
    { name: 'index APP_VERSION', file: P.index, re: /const APP_VERSION = '[\d.]+'/, to: "const APP_VERSION = '" + to + "'" },
    { name: 'index BUILD_DATE', file: P.index, re: /const BUILD_DATE = '[^']+'/, to: "const BUILD_DATE = '" + date + "'" },
    { name: 'gradle versionName', file: P.gradle, re: /versionName "[\d.]+"/, to: 'versionName "' + to + '"' },
    // versionCode = 去点。（v5.55 APK 自报上一版版本号的教训：漏 bump 这一行，装机拿到的 APK
    // 自己报的是旧版本，用户在 Android 设置里看到的与 APP_VERSION 对不上，最难查的那一类。）
    { name: 'gradle versionCode', file: P.gradle, re: /versionCode \d+/, to: 'versionCode ' + to.replace(/\./g, '') },
    { name: 'mcp serverInfo', file: P.mcp, re: /version: '[\d.]+' \}/, to: "version: '" + to + "' }" },
  ];
  for (const j of jobs) {
    const cur = fs.readFileSync(j.file, 'utf8');
    if (!j.re.test(cur)) { console.error('❌ 没匹配到：' + j.name); process.exit(1); }
    const next = cur.replace(j.re, j.to);
    console.log('  ' + j.name + ': ' + cur.match(j.re)[0] + '  →  ' + j.to);
    if (APPLY) fs.writeFileSync(j.file, next, 'utf8');
  }
  // 双壳同步必须紧跟版本号：少同步一处，12 条「逐字节一致」测试当场红
  if (APPLY) {
    const root = fs.readFileSync(P.index);
    fs.writeFileSync(P.www, root);
    fs.writeFileSync(P.assets, root);
    console.log('  双壳已同步  www=' + md5(P.www).slice(0, 8) + '  assets=' + md5(P.assets).slice(0, 8));
  } else {
    console.log('  双壳待同步（--apply 后自动跟着写）');
  }
  console.log('\n' + from + ' → ' + to + (APPLY ? '  已落盘' : '  预演，未落盘'));
}

/* ── pins：unit 测试里的版本字面随版（规则照搬历代脚本，已参数化）───── */
function pins(to, forcedFrom, forcedFromDate) {
  const from = forcedFrom || readVersion(P.index, /const APP_VERSION = '([\d.]+)'/);
  const toFlat = to.replace(/\./g, '');
  const fromFlat = from.replace(/\./g, '');
  // ① 正则形态：断言里写成 /versionName "10\.1\.7"/ 这种转义形式，字面 indexOf 找不到它，
  //    历代由此漏改过（少这一段＝v1011-V1 那种「versionCode 已 1018、versionName 仍是旧版」的半吊子状态）。
  const fromEsc = from.replace(/\./g, '\\.');
  const toEsc = to.replace(/\./g, '\\.');
  // ② BUILD_DATE：每个历史 test 都把当前版本那天的日期写死在 includes 里，日期不跟着走它们必红。
  //    历史上每一步都是靠单独的一次性脚本做的，这里并进来。
  const fromDate = forcedFromDate || readVersion(P.index, /const BUILD_DATE = '([^']+)'/);
  const toDate = todayLocal();
  console.log('版本 ' + from + ' → ' + to + (fromDate !== toDate ? '；日期 ' + fromDate + ' → ' + toDate : ''));
  const dir = path.join(REPO, 'tests', 'unit');
  let changed = 0;
  for (const f of fs.readdirSync(dir).filter(x => x.endsWith('.test.js'))) {
    const fp = path.join(dir, f);
    const lines = fs.readFileSync(fp, 'utf8').split('\n');
    const hits = [];
    for (let i = 0; i < lines.length; i++) {
      const L = lines[i];
      const t = L.trim();
      if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) continue;
      if (!/assert|includes|match|equal|strictEqual|===|indexOf/.test(L)) continue;
      let out = '', idx = 0, touched = false;
      // BUILD_DATE 要单独走一轮：它是 index.html 里被 test 反过来当"被检字面"的字符串，
      // 与上头那三条 version 针的形态不同（日期不带点，也用不到转义/去点变形）。
      if (fromDate !== toDate && L.indexOf("BUILD_DATE = '" + fromDate + "'") >= 0) {
        lines[i] = L.split("BUILD_DATE = '" + fromDate + "'").join("BUILD_DATE = '" + toDate + "'");
        hits.push((i + 1) + ': ' + lines[i].trim().slice(0, 110) + '   ← BUILD_DATE 随版');
        touched = true;
        continue;
      }
      while (idx < L.length) {
        const a = L.indexOf(from, idx), b = L.indexOf(fromFlat, idx), c = L.indexOf(fromEsc, idx);
        let pos = (a < 0) ? (b < 0 ? c : b) : (b < 0 ? a : Math.min(a, b));
        if (c >= 0 && (pos < 0 || c < pos)) pos = c;
        if (pos < 0) { out += L.slice(idx); break; }
        const mode = (c >= 0 && c === pos) ? 'esc' : (a === pos ? 'dotted' : 'flat');
        const literal = mode === 'esc' ? fromEsc : (mode === 'dotted' ? from : fromFlat);
        const replacement = mode === 'esc' ? toEsc : (mode === 'dotted' ? to : toFlat);
        if (mode === 'flat') {
          const before = L[pos - 1], after = L[pos + 4];
          if (/\d/.test(before || '') || /\d/.test(after || '') || /[Vv]/.test(before || '')) { out += L.slice(idx, pos + 4); idx = pos + 4; continue; }
        }
        // 左侧窗口带 CJK = 这是 assert 的说明文字（历代约定：消息文本留着旧版本号做考古线索），跳过。
        // v10.1.8 补：**右**窗口也要查——像「... focusRemItemInput + v10.1.7 换机口令框两处）」这种，
        // 版本号就落在后面的中文句子里，只看左侧 12 字符压根看不见中文（首次实跑就把这条考古线索改掉了）。
        // 判法：版本号右侧到下一个单引号之间若含中文，说明它正躺在一句消息文本里。
        const win = L.slice(Math.max(0, pos - 12), pos);
        const rest = L.slice(pos + literal.length);
        const q = rest.indexOf("'");
        const tailWin = q < 0 ? rest : rest.slice(0, q);
        if (CJK.test(win) || CJK.test(tailWin) || /nsVer(sion)?Cmp/.test(L)) { out += L.slice(idx, pos + literal.length); idx = pos + literal.length; continue; }
        out += L.slice(idx, pos) + replacement;
        idx = pos + literal.length;
        touched = true;
      }
      if (touched) { lines[i] = out; hits.push((i + 1) + ': ' + out.trim().slice(0, 110)); }
    }
    if (hits.length) {
      changed += hits.length;
      console.log('== ' + f + ' (' + hits.length + ' 行)');
      hits.forEach(h => console.log('   ' + h));
      if (APPLY) fs.writeFileSync(fp, lines.join('\n'), 'utf8');
    }
  }
  console.log('\n合计 ' + changed + ' 行' + (APPLY ? ' 已写入' : '（预演，加 --apply 才落盘）'));
}

/* ── fast：受影响子集。改一行备注也把 879 条断言跑一遍是发版慢的大头 ── */
// 映射表：改动落到哪个领域，就只跑那几个守护文件（守 addition 不守无关项）。
const IMPACT = [
  { re: /index\.html|www|assets/, tests: ['fold.test.js', 'v1018.test.js', 'v1011.test.js', 'pwa.test.js'] },
  { re: /tests\/unit\/v1018/, tests: ['v1018.test.js'] },
  { re: /tools\/notesync-mcp-server/, tests: ['v72.test.js'] },
  { re: /\.github|deploy|Caddyfile/, tests: ['pwa.test.js'] },
];
const CORE = ['fold.test.js', 'v1018.test.js', 'userbugs.test.js', 'brand.test.js'];

function fast(files) {
  const picked = new Set(CORE);
  for (const f of files) {
    for (const m of IMPACT) if (m.re.test(f)) m.tests.forEach(t => picked.add(t));
  }
  return Array.from(picked);
}

// 依赖 child_process/spawn 的用例清单。它们要再起一个 node 子进程（真 server.js / 真 mcp-server），
// 在受限会话里 spawnSync 直接返回 status=null（实锤），一旦挂住会把整个套件拖到超时、连汇总行都打不出来。
// 这不是产品质量问题，所以用「排除清单」而不是「删测试」：真机/CI 上该跑照样跑。
const SPAWN_TESTS = ['new_note_version.test.js', 'v1000.test.js', 'v1014.test.js', 'v809_k_routes.test.js', 'v900.test.js'];
const listTests = dir => fs.readdirSync(path.join(REPO, 'tests', dir)).filter(f => f.endsWith('.test.js'));

function run(cmd, args, envLocked) {
  const { execFileSync } = require('child_process');
  const node = process.execPath;
  const t0 = Date.now();
  try {
    execFileSync(node, args, { cwd: path.join(REPO, 'tests'), stdio: 'inherit', timeout: envLocked });
    console.log('  ' + cmd + ' 用时 ' + Math.round((Date.now() - t0) / 1000) + 's：绿');
    return true;
  } catch (e) {
    const killed = e.status === null || e.signal === 'SIGTERM';
    console.error('\n❌ ' + cmd + ' ' + (killed ? '卡到超时（像是 spawn 类环境锁，非产品质量问题）' : '失败 exit ' + e.status));
    return false;
  }
}

/* ── 入口 ────────────────────────────────────────────────────────── */
const cmd = process.argv[2];
const arg = process.argv[3];
if (cmd === 'status') status().then(ok => process.exit(ok ? 0 : 1));
else if (cmd === 'ota') {
  // 发版五件套第⑤步：App 的在线升级元数据。push tag → CI 出 APK → 这一步把它挂到服务器上，
  // 手机「检查更新」才看得到。与部署 index.html 互不隶属，容易漏（v10.1.8 就漏过，靠用户发现）。
  const ver = arg || readVersion(P.index, /const APP_VERSION = '([\d.]+)'/);
  if (!ver) { console.error('读不到版本号，请显式给出，如 node tools/release.js ota 10.1.8'); process.exit(1); }
  const py = process.env.NS_PYTHON || 'python';
  const { spawnSync } = require('child_process');
  const r = spawnSync(py, [path.join(REPO, 'tools', 'push_latest_apk.py'), 'v' + ver.replace(/^v/, '')],
    { stdio: 'inherit', windowsHide: true });
  process.exit(r.status === 0 ? 0 : 1);
}
else if (cmd === 'bump') { if (!arg) { console.error('需要版本号，如 10.1.8'); process.exit(1); } bump(arg); }
else if (cmd === 'pins') {
  if (!arg) { console.error('需要版本号，如 10.1.8'); process.exit(1); }
  const pick = flag => (process.argv.indexOf(flag) >= 0) ? process.argv[process.argv.indexOf(flag) + 1] : null;
  pins(arg, pick('--from'), pick('--fromdate'));
}
else if (cmd === 'fast') {
  // 没传文件时自动取「相对 HEAD 的改动」，省得每次手敲路径
  let files = process.argv.slice(3);
  if (!files.length) {
    try {
      const { execFileSync } = require('child_process');
      files = execFileSync('git', ['-C', REPO, 'diff', '--name-only', 'HEAD'], { encoding: 'utf8' }).split('\n').filter(Boolean);
    } catch (e) { files = []; }
  }
  const list = fast(files);
  console.log('改动 ' + files.length + ' 个文件 → 命中守护子集 ' + list.length + ' 个：' + list.join(' '));
  const t0 = Date.now();
  const ok = run('fast', ['--test'].concat(list.map(t => 'unit/' + t)));
  console.log('\n快速验证用时 ' + Math.round((Date.now() - t0) / 1000) + 's（全量约 35s+）：' + (ok ? '绿' : '红，转 full 定位'));
  process.exit(ok ? 0 : 1);
}
else if (cmd === 'full') {
  // e2e 默认并发 6：本仓的 e2e server 走 listen(0) 随机端口，文件之间不抢端口；实测之前的
  //「并发挂死」是被 spawn 类用例拖出来的（它自己挂住并把 runner 一起卡死），不是并发本身不可用。
  // 机器 16 核，串行一个一个启动 Chromium 是纯浪费。
  const t0 = Date.now();
  // unit 不指定并发：jsdom 加载整份 index.html 是重活，实测默认调度（约 31s）比强制 concurrency=4（56s）
  // 更快——多个进程抢同一份大文件 + CPU 切换，反而不划算。e2e 正好相反（见下）。
  const okU = run('unit(' + listTests('unit').length + '文件)', ['--test']
    .concat(listTests('unit').map(f => 'unit/' + f)), 180000);
  const okE = run('e2e(' + listTests('e2e').length + '文件)', ['--test', '--test-concurrency=6']
    .concat(listTests('e2e').map(f => 'e2e/' + f)), 900000);
  console.log('\n全量合计 ' + Math.round((Date.now() - t0) / 1000) + 's   unit=' + (okU ? '绿' : '红') + '  e2e=' + (okE ? '绿' : '红'));
  process.exit(okU && okE ? 0 : 1);
}
else if (cmd === 'safe') {
  // 本会话可用版：跳过 spawn 类（在受限环境必然挂），其余全跑。
  // 注意这与 full 的差别只有两处：unit 少一个 v72.test.js、e2e 少那 5 个 spawn 文件。真正上 CI/换机器时用 full。
  const t0 = Date.now();
  const okU = run('unit(排除环境锁)', ['--test']
    .concat(listTests('unit').filter(f => f !== 'v72.test.js').map(f => 'unit/' + f)), 180000);
  const files = listTests('e2e').filter(f => SPAWN_TESTS.indexOf(f) < 0);
  console.log('  跳过 ' + SPAWN_TESTS.length + ' 个 spawn 类 e2e：' + SPAWN_TESTS.join(' '));
  const okE = run('e2e(' + files.length + '文件，并发6)', ['--test', '--test-concurrency=6']
    .concat(files.map(f => 'e2e/' + f)), 900000);
  console.log('\n合计 ' + Math.round((Date.now() - t0) / 1000) + 's   unit=' + (okU ? '绿' : '红') + '  e2e=' + (okE ? '绿' : '红'));
  process.exit(okU && okE ? 0 : 1);
}
else {
  console.log('用法：node tools/release.js status|bump|pins|ota|fast|safe|full [版本号] [--apply]');
}
