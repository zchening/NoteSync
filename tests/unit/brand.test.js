// v7.9.0 品牌统一「3A 双弧环 N」（用户拍板：A1 衬线 N + F2 16px 保环弃尖）
//
// 症状：双头标并存——网页=双弧箭头同步标（favicon 3.4/顶栏 2.6/首页 2.2 三套描边漂移），
// Android/通知=v6.0 衬线 N；manifest 遗留蓝 #2b6cff；iOS 加桌面=截图缩略。
// 修法：全触点统一 3A——双弧同步环+直角箭头尖+环心衬线 N（三档：全细节/F2 弃尖/单字），
// favicon 纸白底 F2、首页 hero 全细节、顶栏 F2、App/通知沿用 N 血统、manifest/iOS/PNG 全套补齐。
//
// W1 favicon.svg = F2 档（环+N 无尖、纸白底、描边 4.6）
// W2 index.html 旧几何清零 + landing 全细节 + 顶栏 F2 + head 声明
// W3 图标文件在位且尺寸/透明底正确 + sw 清单 + www 壳同步
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { INDEX_PATH } = require('../helpers');

const REPO = path.join(__dirname, '..', '..');
const SRC = fs.readFileSync(INDEX_PATH, 'utf8');
const FAV = fs.readFileSync(path.join(REPO, 'favicon.svg'), 'utf8');
const RES = path.join(REPO, 'android', 'app', 'src', 'main', 'res');
function pngMeta(p) {
  const b = fs.readFileSync(p);
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20), colorType: b.readUInt8(25) };
}

// ── W1 ─────────────────────────────────────────────────────
test('W1 favicon.svg = 3A F2 档：纸白底+双弧环+衬线 N，16px 形态无箭头尖', () => {
  assert.ok(FAV.includes('fill="#F7F2E9"'), '纸白底（与 App 图标背景同值）');
  assert.ok(!FAV.includes('fill="#0F0F11"'), '黑底红线不回归（备案教训）');
  assert.ok(FAV.includes('stroke="#8F7126"'), '金色描边（v60/server 断言沿用）');
  assert.ok(FAV.includes('stroke-width="4.6"'), '16px 档加粗描边');
  assert.strictEqual((FAV.match(/M40\.5 14\.5A19 19 0 0 1 14\.5 40\.5/) || []).length + (FAV.match(/M7\.5 33\.5A19 19 0 0 1 33\.5 7\.5/) || []).length, 2, '双弧环两段齐');
  assert.ok(!FAV.includes('M14.5 35.5'), 'F2 拍板：16px 档保环弃尖（箭头尖不得回流 favicon）');
  assert.ok(FAV.includes('M18.72 16.96h2.2l6.16 11'), '衬线 N 路径（通知标同族放大）');
});

// ── W2 ─────────────────────────────────────────────────────
test('W2 index.html：旧箭头标清零、hero 全细节、顶栏 F2、head 三声明', () => {
  assert.ok(!SRC.includes('M38.5 21.5'), '旧双弧箭头标几何应全仓清零（hero/顶栏/favicon 三处）');
  assert.ok(!SRC.includes('x1="17.5" y1="24"'), '旧中心横线随旧标退役');
  const hero = SRC.match(/<svg class="logo"[\s\S]*?<\/svg>/);
  assert.ok(hero, 'landing hero svg 在位');
  assert.ok(hero[0].includes('M14.5 35.5v5h-5') && hero[0].includes('M33.5 12.5v-5h5'), 'hero=全细节版：直角箭头尖两段必须在（≥40px 场景）');
  assert.ok(hero[0].includes('M18.72 16.96h2.2l6.16 11'), 'hero 环心衬线 N');
  const brand = SRC.match(/<span class="brand">\s*<svg[\s\S]*?<\/svg>/);
  assert.ok(brand, '顶栏 brand svg 在位');
  assert.ok(brand[0].includes('stroke-width="3.6"'), '顶栏 17px 档描边加粗（F2）');
  assert.ok(!brand[0].includes('M14.5 35.5'), '顶栏 F2：保环弃尖');
  assert.ok(brand[0].includes('M18.72 16.96h2.2l6.16 11'), '顶栏环心 N');
  assert.ok(SRC.includes('/favicon.svg?v=7.9.0'), 'favicon 缓存位升版');
  assert.ok(SRC.includes('rel="apple-touch-icon" href="/apple-touch-icon.png"'), 'iOS 加桌面声明（不再截图缩略）');
});

// ── W3 ─────────────────────────────────────────────────────
test('W3 图标文件全套在位：web 三件尺寸/Android 前景透明底/sw 清单/www 壳同步', () => {
  const at = pngMeta(path.join(REPO, 'apple-touch-icon.png'));
  assert.deepStrictEqual([at.w, at.h], [180, 180], 'apple-touch 180×180');
  const i192 = pngMeta(path.join(REPO, 'icons', 'icon-192.png'));
  const i512 = pngMeta(path.join(REPO, 'icons', 'icon-512.png'));
  assert.deepStrictEqual([i192.w, i192.h], [192, 192], 'icon-192');
  assert.deepStrictEqual([i512.w, i512.h], [512, 512], 'icon-512');
  for (const [dpi, size] of [['mdpi', 108], ['hdpi', 162], ['xhdpi', 216], ['xxhdpi', 324], ['xxxhdpi', 432]]) {
    const fg = pngMeta(path.join(RES, 'mipmap-' + dpi, 'ic_launcher_foreground.png'));
    assert.deepStrictEqual([fg.w, fg.h], [size, size], 'foreground @' + dpi);
    assert.strictEqual(fg.colorType, 6, 'foreground @' + dpi + ' 应 RGBA 透明底（纸白由 adaptive background 层提供）');
  }
  const sw = fs.readFileSync(path.join(REPO, 'sw.js'), 'utf8');
  for (const a of ["'/icons/icon-192.png'", "'/icons/icon-512.png'", "'/apple-touch-icon.png'"]) {
    assert.ok(sw.includes(a), 'SW 预缓存清单应含 ' + a);
  }
  const gen = fs.readFileSync(path.join(REPO, 'tools', 'gen_icons.py'), 'utf8');
  assert.ok(gen.includes('def render_ring'), 'gen_icons.py 应含 3A 环 N 渲染器（可复现铁律）');
  assert.strictEqual(
    fs.readFileSync(path.join(REPO, 'www', 'index.html'), 'utf8'), SRC,
    'www/index.html（APK 内置壳）必须与根 index.html 逐字节一致——改完忘 cp=APK 离线壳带旧标'
  );
});
