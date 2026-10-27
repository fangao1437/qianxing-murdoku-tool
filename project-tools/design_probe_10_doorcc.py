# -*- coding: utf-8 -*-
"""design_probe_10_doorcc.py -- exact door-marker bboxes (colour #C2410C = 194,65,12)
inside the board, plus the self-check numbers quoted in records/design-layout-measure.md.
ASCII stdout.
"""
import os
from collections import deque

import numpy as np
from PIL import Image

D = r"D:\新建文件夹\miHoYo Launcher\murdoku-内容设计-两关布局图"
FILES = [("case001", "案件001-布局图-v2.png", 150.0, 296.0, 162.0, 5),
         ("case002", "案件002-布局图-v5.png", 150.0, 292.0, 136.0, 6)]
DOOR_C = (194, 65, 12)


def cc(mask):
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
        out.append((n, minx, miny, maxx, maxy))
    return out


for tag, f, x0f, y0f, pitch, n in FILES:
    a = np.asarray(Image.open(os.path.join(D, f)).convert("RGB")).astype(np.int16)
    m = np.all(np.abs(a - np.array(DOOR_C)) <= 10, axis=2)
    bx0, by0 = int(x0f) - 10, int(y0f) - 10
    bx1, by1 = int(x0f + pitch * n) + 10, int(y0f + pitch * n) + 10
    sub = m[by0:by1, bx0:bx1]
    print("=" * 92)
    print("FILE", tag, "door-colour components inside board (area>=40):")
    x = [x0f + pitch * k for k in range(n + 1)]
    y = [y0f + pitch * k for k in range(n + 1)]
    for (npx, mx0, my0, mx1, my1) in sorted(cc(sub), key=lambda c: -c[0]):
        if npx < 40:
            continue
        X0, Y0, X1, Y1 = mx0 + bx0, my0 + by0, mx1 + bx0, my1 + by0
        w, h = X1 - X0 + 1, Y1 - Y0 + 1
        cx, cy = (X0 + X1) / 2.0, (Y0 + Y1) / 2.0
        # which edge is it on
        info = ""
        if h > w:   # vertical edge -> x is perpendicular
            k = min(range(n + 1), key=lambda i: abs(x[i] - cx))
            r = min(range(n), key=lambda i: abs((y[i] + y[i + 1]) / 2.0 - cy)) + 1
            info = "vertical  -> v,%d,%d  x_line=%.1f dx=%+.1f | row%d centre y=%.1f dy=%+.1f" % (
                r, k, x[k], cx - x[k], r, (y[r - 1] + y[r]) / 2.0, cy - (y[r - 1] + y[r]) / 2.0)
        else:
            k = min(range(n + 1), key=lambda i: abs(y[i] - cy))
            c = min(range(n), key=lambda i: abs((x[i] + x[i + 1]) / 2.0 - cx)) + 1
            info = "horizontal-> h,%d,%d  y_line=%.1f dy=%+.1f | col%d centre x=%.1f dx=%+.1f" % (
                k, c, y[k], cy - y[k], c, (x[c - 1] + x[c]) / 2.0, cx - (x[c - 1] + x[c]) / 2.0)
        print("   area=%-5d bbox=(%4d,%4d)-(%4d,%4d) along=%-3d across=%-3d centre=(%6.1f,%6.1f)  %s"
              % (npx, X0, Y0, X1, Y1, max(w, h), min(w, h), cx, cy, info))
    print("   ratios: pitch=%.1f  wall_thick=11  door_len=?  door_across=17" % pitch)
