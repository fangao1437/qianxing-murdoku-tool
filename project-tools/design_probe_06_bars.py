# -*- coding: utf-8 -*-
"""design_probe_06_bars.py -- separate thick wall bars from thin (1-2px) cell outlines by
eroding the wall-colour mask, then connected-component the eroded mask and map every bar
to a grid boundary.  Also censuses a few probe windows (door fill, cell tint, furniture).
ASCII stdout.
"""
import os
from collections import Counter, deque

import numpy as np
from PIL import Image

D = r"D:\新建文件夹\miHoYo Launcher\murdoku-内容设计-两关布局图"
FILES = [("case001", "案件001-布局图-v2.png", 150.0, 296.0, 162.0, 5),
         ("case002", "案件002-布局图-v5.png", 150.0, 292.0, 136.0, 6)]
WALL_C = [(17, 24, 39), (31, 41, 55)]


def erode(m, k):
    out = m.copy()
    h, w = m.shape
    for dy in range(-k, k + 1):
        for dx in range(-k, k + 1):
            if dy == 0 and dx == 0:
                continue
            sh = np.zeros_like(m)
            ys = slice(max(0, dy), h + min(0, dy))
            yd = slice(max(0, -dy), h + min(0, -dy))
            xs = slice(max(0, dx), w + min(0, dx))
            xd = slice(max(0, -dx), w + min(0, -dx))
            sh[yd, xd] = m[ys, xs]
            out &= sh
    return out


def cc(mask, minpix=30):
    h, w = mask.shape
    lab = np.zeros((h, w), bool)
    out = []
    ys, xs = np.nonzero(mask)
    for y0, x0 in zip(ys, xs):
        if lab[y0, x0]:
            continue
        q = deque([(y0, x0)])
        lab[y0, x0] = True
        miny = maxy = y0
        minx = maxx = x0
        n = 0
        while q:
            y, x = q.popleft()
            n += 1
            miny = min(miny, y); maxy = max(maxy, y)
            minx = min(minx, x); maxx = max(maxx, x)
            for dy in (-1, 0, 1):
                for dx in (-1, 0, 1):
                    ny, nx = y + dy, x + dx
                    if 0 <= ny < h and 0 <= nx < w and mask[ny, nx] and not lab[ny, nx]:
                        lab[ny, nx] = True
                        q.append((ny, nx))
        if n >= minpix:
            out.append((n, minx, miny, maxx, maxy))
    return out


def census(a, x0, y0, x1, y1, k=5, label=""):
    c = Counter()
    for y in range(y0, y1):
        for x in range(x0, x1):
            c[tuple(int(v) for v in a[y, x])] += 1
    print("   %s (%d,%d)-(%d,%d):" % (label, x0, y0, x1, y1))
    for col, n in c.most_common(k):
        print("      %-18s %5d" % (str(col), n))


for tag, f, x0f, y0f, pitch, n in FILES:
    a = np.asarray(Image.open(os.path.join(D, f)).convert("RGB")).astype(np.int16)
    bx0, by0 = int(x0f) - 6, int(y0f) - 6
    bx1, by1 = int(x0f + pitch * n) + 6, int(y0f + pitch * n) + 6
    sub = a[by0:by1, bx0:bx1]
    wall = np.zeros(sub.shape[:2], bool)
    for c in WALL_C:
        wall |= np.all(np.abs(sub - np.array(c)) <= 6, axis=2)
    er = erode(wall, 3)
    print("=" * 100)
    print("FILE", tag, "pitch", pitch, "n", n, "wall px", int(wall.sum()), "eroded px", int(er.sum()))
    print("   grid x nominal:", [round(x0f + pitch * k, 1) for k in range(n + 1)])
    print("   grid y nominal:", [round(y0f + pitch * k, 1) for k in range(n + 1)])
    bars = cc(er, 25)
    bars.sort(key=lambda c: (c[2], c[1]))
    print("   THICK bars (eroded core, area>=25): %d" % len(bars))
    for (npx, mx0, my0, mx1, my1) in bars:
        # dilate bbox back by 3 px (the eroded margin)
        X0, Y0, X1, Y1 = bx0 + mx0 - 3, by0 + my0 - 3, bx0 + mx1 + 3, by0 + my1 + 3
        w = X1 - X0 + 1
        h = Y1 - Y0 + 1
        cx, cy = (X0 + X1) / 2.0, (Y0 + Y1) / 2.0
        kind = "V(vert)" if h > w else "H(horz)"
        # nearest grid line
        gx = min(range(n + 1), key=lambda k: abs(x0f + pitch * k - cx))
        gy = min(range(n + 1), key=lambda k: abs(y0f + pitch * k - cy))
        if h > w:
            note = "on vertical grid x[%d]=%.1f  dx=%+.1f" % (gx, x0f + pitch * gx, cx - (x0f + pitch * gx))
        else:
            note = "on horizontal grid y[%d]=%.1f  dy=%+.1f" % (gy, y0f + pitch * gy, cy - (y0f + pitch * gy))
        print("    %-8s bbox=(%4d,%4d)-(%4d,%4d) w=%-3d h=%-3d centre=(%6.1f,%6.1f) core=%d  %s"
              % (kind, X0, Y0, X1, Y1, w, h, cx, cy, npx, note))
    # probe windows
    if tag == "case001":
        census(a, 615, 515, 660, 575, 4, "DOOR v,2,3 area")
        census(a, 355, 765, 425, 800, 4, "DOOR h,3,2 area")
        census(a, 170, 900, 220, 940, 3, "cell (4,1) tint")
    else:
        census(a, 330, 600, 380, 650, 4, "DOOR? v,2,4 area (x=286..)")
        census(a, 600, 470, 660, 520, 4, "cell (2,4)..(2,5) area")
        census(a, 200, 1000, 250, 1040, 3, "cell (6,1) tint")
