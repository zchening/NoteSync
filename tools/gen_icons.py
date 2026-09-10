# -*- coding: utf-8 -*-
"""v7.9.0 品牌 3A「双弧环 N」全套图标生成（用户拍板：A1 衬线 N + F2 16px 保环弃尖）
- 暖纸白底 #F7F2E9 + 金色 #B7912C（沿用 v6.0 图标专用金，纸白上比 --accent 更醒目）
- 几何 = index.html 内联 SVG 同族：双弧 r0.396/描边 0.048 + 直角箭头尖 + 衬线 N（serif_n 复用）
- launcher 48-192 / foreground 108-432（66% 安全区）/ round / Play Store 512
- 新增 web 档：icons/icon-192.png、icon-512.png（maskable 安全区）、apple-touch-icon.png 180
- 4x supersample + LANCZOS 缩小抗锯齿，细线无重影（用户视觉铁律）
"""
import os
from PIL import Image, ImageDraw

RES = os.path.join(os.path.dirname(__file__), '..', 'android', 'app', 'src', 'main', 'res')
ROOT = os.path.normpath(os.path.join(os.path.dirname(__file__), '..'))
ICONS_DIR = os.path.join(ROOT, 'icons')

BG = (247, 242, 233, 255)     # 暖纸白
FG = (183, 145, 44, 255)      # 金色细线

def serif_n(draw, cx, cy, nw, nh, lw):
    """衬线 N：左右竖线 + 左上→右下对角线 + 四条端点衬线横杠。全部方头，几何精确。"""
    x0 = cx - nw / 2   # 左竖 x
    x1 = cx + nw / 2   # 右竖 x
    y0 = cy - nh / 2   # 顶
    y1 = cy + nh / 2   # 底
    half = lw / 2
    sw = nw * 0.26     # 衬线横杠宽
    # 左右竖线
    for x in (x0, x1):
        draw.rectangle([x - half, y0, x + half, y1], fill=FG)
    # 对角线：左竖顶端 → 右竖底端（拉丁 N 方向，绝不画反）
    draw.line([x0, y0 + half, x1, y1 - half], fill=FG, width=int(round(lw)))
    # 四条衬线横杠（以竖线端点为中心的水平短杠）
    for x in (x0, x1):
        draw.rectangle([x - sw / 2, y0 - half, x + sw / 2, y0 + half], fill=FG)
        draw.rectangle([x - sw / 2, y1 - half, x + sw / 2, y1 + half], fill=FG)

def render_ring(size, scale=1.0, tips=True, bg=True, round_mask=False):
    """3A 环 N：双弧（-30°→120° / 150°→300°）+ 可选切向箭头尖 + 环心衬线 N。
    scale 把整个标缩进安全区（foreground/maskable 用 0.66；launcher 0.92；apple-touch 0.80）。
    比例铁律：N 宽=0.52r 收进环内径；尖=弧端点切向短线（长 4.6r·rad、宽=lwR×1.7），绝不与环相交。"""
    import math
    SS = size * 4
    img = Image.new('RGBA', (SS, SS), BG if bg else (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    cx = cy = SS / 2
    r = SS * 0.396 * scale
    lwR = max(4, SS * 0.048 * scale)
    box = [cx - r, cy - r, cx + r, cy + r]
    d.arc(box, start=-30, end=120, fill=FG, width=int(round(lwR)))
    d.arc(box, start=150, end=300, fill=FG, width=int(round(lwR)))
    if tips:
        # 直角折肘箭头尖（与 SVG hero M14.5 35.5v5h-5 同构）：弧端点两臂各长 a，一竖一横
        a = r * (5.0 / 19.0)
        half = lwR / 2
        # 弧1 终点 θ=120°（左下）：竖臂从端点向上、横臂从端点向左
        th = math.radians(120)
        tx, ty = cx + r * math.cos(th), cy + r * math.sin(th)
        d.rectangle([tx - half, ty - a, tx + half, ty + half], fill=FG)
        d.rectangle([tx - a, ty - half, tx + half, ty + half], fill=FG)
        # 弧2 终点 θ=300°（右上）：竖臂从端点向下、横臂从端点向右
        th = math.radians(300)
        tx, ty = cx + r * math.cos(th), cy + r * math.sin(th)
        d.rectangle([tx - half, ty - half, tx + half, ty + a], fill=FG)
        d.rectangle([tx - half, ty - half, tx + a, ty + half], fill=FG)
    nw = r * 0.52
    d_w = max(4, nw * 0.16)
    serif_n(d, cx, cy, nw, nw * 1.333, d_w)
    img = img.resize((size, size), Image.LANCZOS)
    if round_mask:
        mask = Image.new('L', (size * 4, size * 4), 0)
        ImageDraw.Draw(mask).ellipse([0, 0, size * 4 - 1, size * 4 - 1], fill=255)
        mask = mask.resize((size, size), Image.LANCZOS)
        out = Image.new('RGBA', (size, size), (0, 0, 0, 0))
        out.paste(img, (0, 0), mask)
        return out
    return img

LAUNCHER = [('mdpi', 48), ('hdpi', 72), ('xhdpi', 96), ('xxhdpi', 144), ('xxxhdpi', 192)]
FOREGROUND = [('mdpi', 108), ('hdpi', 162), ('xhdpi', 216), ('xxhdpi', 324), ('xxxhdpi', 432)]

for dpi, size in LAUNCHER:
    # 传统 launcher：纸白底 + 全细节环 N（带尖），标占 92%
    render_ring(size, 0.92).save(os.path.join(RES, 'mipmap-' + dpi, 'ic_launcher.png'))
    render_ring(size, 0.92, round_mask=True).save(
        os.path.join(RES, 'mipmap-' + dpi, 'ic_launcher_round.png'))

for dpi, size in FOREGROUND:
    # adaptive 前景：透明底，内容收进中心 66/108 安全区（scale 0.66）
    render_ring(size, 0.66, bg=False).save(os.path.join(RES, 'mipmap-' + dpi, 'ic_launcher_foreground.png'))

# Play Store 512（全细节）
render_ring(512, 0.92).save(os.path.join(RES, 'ic_launcher-playstore.png'))

# v7.9.0 新增 web 档：PWA maskable PNG（内容在 66% 安全区内）+ iOS 桌面图标
os.makedirs(ICONS_DIR, exist_ok=True)
render_ring(192, 0.66).save(os.path.join(ICONS_DIR, 'icon-192.png'))
render_ring(512, 0.66).save(os.path.join(ICONS_DIR, 'icon-512.png'))
render_ring(180, 0.80).save(os.path.join(ROOT, 'apple-touch-icon.png'))

print('icons generated:')
for root, _, files in os.walk(RES):
    for f in sorted(files):
        if f.endswith('.png'):
            p = os.path.join(root, f)
            print(' ', os.path.relpath(p, RES), os.path.getsize(p), 'bytes')
for p in [os.path.join(ICONS_DIR, 'icon-192.png'), os.path.join(ICONS_DIR, 'icon-512.png'),
          os.path.join(ROOT, 'apple-touch-icon.png')]:
    print(' ', os.path.relpath(p, ROOT), os.path.getsize(p), 'bytes')
