#!/usr/bin/env node
// NoteSync 发版测试闸编排（V4 阶段1）
// 用法: node tests/gate.mjs [--tier smoke|module|full] [--domain <name>]
//   full  (默认) = 发版闸: T1 unit×2 → T2 e2e×2（并发2）→ 全探针
//   module       = 域定向单轮（--domain 必填，须在 gate.manifest.json 的 domains 中）
//   smoke        = 快速失败面: version_pins 自检 + unit 单轮
// 漂移归因: 任一轮红 → 同命令自动重跑 1 次；重跑绿 = 疑似漂移（留 drift 标记不阻塞）；仍红 = 真红中止。
// 双轮口径: 每层至多两轮，任一真红即中止后续层；漂移真伪由清洁环境独立复跑定性（机器不裁决真红放行）。
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const NODE = process.env.NOTESYNC_NODE || 'C:/Users/zchen/.workbuddy/binaries/node/versions/22.22.2-3/node.exe';
const TESTS = path.dirname(fileURLToPath(import.meta.url));
const REPORT = path.join(TESTS, '_gate_report.json');
const manifest = JSON.parse(fs.readFileSync(path.join(TESTS, 'gate.manifest.json'), 'utf8'));

const argv = process.argv.slice(2);
const argVal = (flag) => { const i = argv.indexOf(flag); return i >= 0 ? argv[i + 1] : null; };
const TIER = ['smoke', 'module', 'full'].includes(argVal('--tier')) ? argVal('--tier') : 'full';
const DOMAIN = argVal('--domain');

const TIMEOUT = { pins: 120000, unit: 300000, e2e: 900000, probe: 600000 };

function runOnce(args, timeoutMs) {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(NODE, args, { cwd: TESTS, stdio: 'inherit' });
    const timer = setTimeout(() => child.kill(), timeoutMs);
    child.on('error', (err) => { clearTimeout(timer); resolve({ code: -1, ms: Date.now() - started, err: err.message }); });
    child.on('exit', (code) => { clearTimeout(timer); resolve({ code, ms: Date.now() - started }); });
  });
}

async function runLayer(label, args, { rounds = 2, timeout = TIMEOUT.unit } = {}) {
  const roundsLog = [];
  let drift = false;
  for (let r = 1; r <= rounds; r++) {
    const res = await runOnce(args, timeout);
    roundsLog.push({ round: r, exitCode: res.code, durationMs: res.ms, note: res.err || null });
    if (res.code === 0) continue;
    const rerun = await runOnce(args, timeout);
    roundsLog.push({ round: `${r}-rerun`, exitCode: rerun.code, durationMs: rerun.ms, note: '漂移归因重跑' });
    if (rerun.code !== 0) return { label, args, roundsLog, pass: false, drift, abort: true };
    drift = true;
  }
  return { label, args, roundsLog, pass: true, drift, abort: false };
}

async function main() {
  const startedAt = new Date().toISOString();
  const layers = [];
  try {
    if (TIER === 'smoke') {
      layers.push(await runLayer('pins', ['--test', 'unit/version_pins.test.js'], { rounds: 1, timeout: TIMEOUT.pins }));
      if (!layers.some((l) => l.abort)) layers.push(await runLayer('unit', ['--test', 'unit/*.test.js'], { rounds: 1, timeout: TIMEOUT.unit }));
    } else if (TIER === 'module') {
      if (!DOMAIN || !manifest.domains[DOMAIN]) throw new Error(`--domain 必填且须在 manifest.domains 中: ${Object.keys(manifest.domains).join(', ')}`);
      const d = manifest.domains[DOMAIN];
      if (d.unit.length) layers.push(await runLayer(`unit:${DOMAIN}`, ['--test', ...d.unit.map((f) => `unit/${f}`)], { rounds: 1, timeout: TIMEOUT.unit }));
      if (!layers.some((l) => l.abort) && d.e2e.length) layers.push(await runLayer(`e2e:${DOMAIN}`, ['--test', '--test-concurrency=2', '--test-force-exit', ...d.e2e.map((f) => `e2e/${f}`)], { rounds: 1, timeout: TIMEOUT.e2e }));
      if (!layers.some((l) => l.abort)) {
        for (const p of d.probes) layers.push(await runLayer(`probe:${p}`, [`e2e/_probe_${p}.js`], { rounds: 1, timeout: TIMEOUT.probe }));
      }
    } else {
      layers.push(await runLayer('unit', ['--test', 'unit/*.test.js'], { rounds: 2, timeout: TIMEOUT.unit }));
      if (!layers.some((l) => l.abort)) layers.push(await runLayer('e2e', ['--test', '--test-concurrency=2', '--test-force-exit', 'e2e/*.test.js'], { rounds: 2, timeout: TIMEOUT.e2e }));
      if (!layers.some((l) => l.abort)) {
        for (const p of manifest.allProbes) layers.push(await runLayer(`probe:${p}`, [`e2e/_probe_${p}.js`], { rounds: 1, timeout: TIMEOUT.probe }));
      }
    }
  } catch (err) {
    layers.push({ label: 'error', args: [], roundsLog: [], pass: false, drift: false, abort: true, error: String(err.message || err) });
  }
  const overall = layers.every((l) => l.pass) ? 'pass' : 'fail';
  const report = {
    tier: TIER, domain: DOMAIN || null, startedAt, endedAt: new Date().toISOString(), overall,
    layers: layers.map((l) => ({ label: l.label, pass: l.pass, drift: l.drift, abort: l.abort, error: l.error || null, command: [NODE, ...l.args].join(' '), rounds: l.roundsLog })),
  };
  fs.writeFileSync(REPORT, JSON.stringify(report, null, 2), 'utf8');
  console.log(`\n[gate] tier=${TIER} domain=${DOMAIN || '-'} → ${overall.toUpperCase()}（报告: ${REPORT}）`);
  process.exit(overall === 'pass' ? 0 : 1);
}

main();
