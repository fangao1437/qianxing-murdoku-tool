# -*- coding: utf-8 -*-
"""design_probe_03_wallmask.py -- use ONLY the exact wall colour (#111827 / #1F2937)
to find board borders and wall bars, so brown/green furniture hatching cannot pollute.
Also writes a 2x zoom crop of the board into tools/design_probe_crop_*.png for eyeballing.
"""
import os

import numpy as np
from PIL import Image

D = r"D:\新建文件夹\miHoYo Launcher\murdoku-内容设计-两关布局图"
OUT = r"D:\新建文件夹\miHoYo Launcher\qianxing-murdoku\tools"
FILES = [("case001", "案件001-布局图-v2.png", (120, 260, 1000, 1130)),
         ("case002", "案件002-布局图-v5.png", (120, 260, 1000, 1200))]

WALL = np.array([17, 24, 39])
WALL2 = np.array([31, 41, 55])


def wallmask(a):
    m = np.all(np.abs(a - WALL) <= 8, axis=2) | np.all(np.abs(a - WALL2) <= 8, axis=2)
    return m


def runs(mask1d, mn):
    on = mask1d >= mn
    out, i = [], 0
    while i < len(on):
        if on[i]:
            j = i
            while j + 1 < len(on) and on[j + 1]:
                j += 1
            out.append((i, j, j - i + 1))
            i = j + 1
        else:
            i += 1
    return out


for tag, f, (x0, y0, x1, y1) in FILES:
    a = np.asarray(Image.open(os.path.join(D, f)).convert("RGB")).astype(np.int16)
    m = wallmask(a)
    sub = m[y0:y1, x0:x1]
    cp = sub.sum(axis=0)
    rp = sub.sum(axis=1)
    print("=" * 76)
    print("FILE", tag, "crop", (x0, y0, x1, y1), "wallmask px in crop", int(sub.sum()))
    print("  peak col", int(cp.max()), "peak row", int(rp.max()))
    print("  -- columns with >=60%% of crop height of wall colour --")
    for r in runs(cp, int((y1 - y0) * 0.60)):
        print("     x %4d..%-4d w=%-3d cnt(min/max)=%d/%d" % (x0 + r[0], x0 + r[1], r[2],
              int(cp[r[0]:r[1] + 1].min()), int(cp[r[0]:r[1] + 1].max())))
    print("  -- rows with >=60%% of crop width of wall colour --")
    for r in runs(rp, int((x1 - x0) * 0.60)):
        print("     y %4d..%-4d w=%-3d cnt(min/max)=%d/%d" % (y0 + r[0], y0 + r[1], r[2],
              int(rp[r[0]:r[1] + 1].min()), int(rp[r[0]:r[1] + 1].max())))
    # zoom crop for visual inspection
    im = Image.open(os.path.join(D, f)).convert("RGB").crop((x0, y0, x1, y1))
    im = im.resize((im.width // 1, im.height // 1), Image.LANCZOS)
    im.save(os.path.join(OUT, "design_probe_crop_%s.png" % tag))
    print("  wrote crop ->", "design_probe_crop_%s.png" % tag, im.size)
