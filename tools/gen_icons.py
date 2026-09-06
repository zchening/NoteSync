# -*- coding: utf-8 -*-
"""v5.60 APP 图标全套生成（用户拍板 C 衬线 N 修正版：对角线左上→右下，拉丁 N）
- 暖纸白底 #F7F2E9 + 金色细线 #B7912C
- launcher 48-192 / foreground 108-432（安全区缩小）/ round 圆形 / Play Store 512
- 4x supersample + LANCZOS 缩小抗锯齿，细线无重影（用户视觉铁律）
"""
import os
from PIL import Image, ImageDraw

RES = os.path.join(os.path.dirname(__file__), '..', 'android', 'app', 'src', 'main', 'res')

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

def render(size, n_ratio, lw_ratio, round_mask=False):
    """size=输出尺寸；n_ratio=N 宽占画布比；lw_ratio=线宽占画布比"""
    SS = size * 4
    img = Image.new('RGBA', (SS, SS), BG)
    d = ImageDraw.Draw(img)
    lw = max(6, SS * lw_ratio)
    serif_n(d, SS / 2, SS / 2, SS * n_ratio, SS * n_ratio * 1.28, lw)
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
    # 正方形：N 占 52%（linewidth 随尺寸粗化保可读）
    img = render(size, 0.52, 0.048 if size <= 72 else 0.040)
    img.save(os.path.join(RES, 'mipmap-' + dpi, 'ic_launcher.png'))
    render(size, 0.52, 0.048 if size <= 72 else 0.040, round_mask=True).save(
        os.path.join(RES, 'mipmap-' + dpi, 'ic_launcher_round.png'))

for dpi, size in FOREGROUND:
    # adaptive 前景：内容须落在中心 66dp/108dp 安全区 → N 占 34%
    render(size, 0.34, 0.040).save(os.path.join(RES, 'mipmap-' + dpi, 'ic_launcher_foreground.png'))

# Play Store 512
render(512, 0.46, 0.036).save(os.path.join(RES, 'ic_launcher-playstore.png'))

print('icons generated:')
for root, _, files in os.walk(RES):
    for f in sorted(files):
        if f.endswith('.png'):
            p = os.path.join(root, f)
            print(' ', os.path.relpath(p, RES), os.path.getsize(p), 'bytes')
