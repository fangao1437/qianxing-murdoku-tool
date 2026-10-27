# -*- coding: utf-8 -*-
"""design_probe_05_cc.py -- connected components of the exact wall colour (#111827) and
of the orange door colour, restricted to the board bbox.  Prints bbox/centre/size so
each wall bar / door marker can be mapped to a grid boundary.  ASCII stdout.
"""
import os
from collections import deque

import numpy as np
from PIL import Image

D = r"D:\新建文件夹\miHoYo Launcher\murdoku-内容设计-两关布局图"
FILES = [("case001", "案件001-布局图-v2.png", 150.0, 296.0, 162.0, 5),
         ("case002", "案件002-布局图-v5.png", 150.0, 292.0, 136.0, 6)]

WALL_C = [(17, 24, 39), (31, 41, 55)]


def ccmask(mask):
    h, w = mask.shape
    lab = np.zeros((h, w), np.int32)
    cur = 0
    out = []
    ys, xs = np.nonzero(mask)
    for y0, x0 in zip(ys, xs):
        if lab[y0, x0]:
            continue
        cur += 1
        q = deque()
        q.append((y0, x0))
        lab[y0, x0] = cur
        miny = maxy = y0
        minx = maxx = x0
        n = 0
        while q:
            y, x = q.popleft()
            n += 1
            if y < miny: miny = y
            if y > maxy: maxy = y
            if x < minx: minx = x
            if x > maxx: maxx = x
            for dy in (-1, 0, 1):
                for dx in (-1, 0, 1):
                    ny, nx = y + dy, x + dx
                    if 0 <= ny < h and 0 <= nx < w and mask[ny, nx] and not lab[ny, nx]:
                        lab[ny, nx] = cur
                        q.append((ny, nx))
        out.append((n, minx, miny, maxx, maxy))
    return out


def patch_census(a, x0, y0, x1, y1, k=6):
    from collections import Counter
    c = Counter()
    for y in range(y0, y1):
        for x in range(x0, x1):
            c[tuple(int(v) for v in a[y, x])] += 1
    print("   patch (%d,%d)-(%d,%d):" % (x0, y0, x1, y1))
    for col, n in c.most_common(k):
        print("      %-16s %5d" % (str(col), n))


for tag, f, x0f, y0f, pitch, n in FILES:
    a = np.asarray(Image.open(os.path.join(D, f)).convert("RGB")).astype(np.int16)
    bx0 = int(x0f) - 4
    by0 = int(y0f) - 4
    bx1 = int(x0f + pitch * n) + 4
    by1 = int(y0f + pitch * n) + 4
    print("=" * 96)
    print("FILE", tag, "board bbox", (bx0, by0, bx1, by1), "pitch", pitch, "n", n)
    sub = a[by0:by1, bx0:bx1]
    wall = np.zeros(sub.shape[:2], bool)
    for c in WALL_C:
        wall |= np.all(np.abs(sub - np.array(c)) <= 6, axis=2)
    comps = [c for c in ccmask(wall) if c[0] >= 250]
    comps.sort(key=lambda c: -c[0])
    print("  wall-colour components with area>=250: %d" % len(comps))
    for (npx, mx0, my0, mx1, my1) in comps:
        w = mx1 - mx0 + 1
        h = my1 - my0 + 1
        cx = bx0 + (mx0 + mx1) / 2.0
        cy = by0 + (my0 + my1) / 2.0
        fill = npx / float(w * h)
        print("   area=%-6d bbox=(%4d,%4d)-(%4d,%4d) w=%-4d h=%-4d centre=(%6.1f,%6.1f) fill=%.2f"
              % (npx, bx0 + mx0, by0 + my0, bx0 + mx1, by0 + my1, w, h, cx, cy, fill))
