# -*- coding: utf-8 -*-
"""design_probe_08_debug.py -- debug: print the raw wall-colour runs inside two edge
windows so the "7px thick, dx=-8" noise can be identified (cell frame? label box?).
ASCII stdout.
"""
import os

import numpy as np
from PIL import Image

D = r"D:\新建文件夹\miHoYo Launcher\murdoku-内容设计-两关布局图"
WALL_C = [(17, 24, 39), (31, 41, 55)]

a = np.asarray(Image.open(os.path.join(D, "案件001-布局图-v2.png")).convert("RGB")).astype(np.int16)
wall = np.zeros(a.shape[:2], bool)
for c in WALL_C:
    wall |= np.all(np.abs(a - np.array(c)) <= 6, axis=2)


def runs(arr):
    out, s = [], None
    for i, v in enumerate(arr):
        if v:
            if s is None:
                s = i
        else:
            if s is not None:
                out.append((s, i - s))
                s = None
    if s is not None:
        out.append((s, len(arr) - s))
    return out


def dump_v(xk, ya, yb, label):
    print("--- vertical edge window x=%d..%d  %s" % (xk - 11, xk + 11, label))
    for y in range(ya, yb, 8):
        print("   y=%4d runs(s,len):" % y,
              [(xk - 11 + s, ln) for s, ln in runs(wall[y, xk - 11:xk + 12])])


def dump_h(yr, xa, xb, label):
    print("--- horizontal edge window y=%d..%d  %s" % (yr - 11, yr + 11, label))
    for x in range(xa, xb, 12):
        print("   x=%4d runs(s,len):" % x,
              [(yr - 11 + s, ln) for s, ln in runs(wall[yr - 11:yr + 12, x])])


dump_v(312, 301, 460, "case001 v,1,1  (grid x[1]=312, row1)")
dump_v(474, 301, 460, "case001 v,1,2  (grid x[2]=474, row1)")
dump_h(458, 155, 312, "case001 h,1,1 (grid y[1]=458, col1)")
dump_v(636, 301, 460, "case001 v,1,3 (grid x[3]=636, row1) -- known WALL")
dump_h(782, 155, 312, "case001 h,3,1 (grid y[3]=782, col1) -- known WALL")
