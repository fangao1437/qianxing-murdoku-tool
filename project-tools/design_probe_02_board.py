# -*- coding: utf-8 -*-
"""design_probe_02_board.py -- locate the 5x5 / 6x6 board inside the poster,
classify wall vs door colours, dump projections.  ASCII stdout.
Optional --crop writes zoom crops to tools/design_probe_crop_*.png (temp, prefixed).
"""
import os
import sys

import numpy as np
from PIL import Image

D = r"D:\新建文件夹\miHoYo Launcher\murdoku-内容设计-两关布局图"
OUT = r"D:\新建文件夹\miHoYo Launcher\qianxing-murdoku\tools"
FILES = [("case001", "案件001-布局图-v2.png"), ("case002", "案件002-布局图-v5.png")]

WALL = np.array([17, 24, 39])
WALL2 = np.array([31, 41, 55])


def load(f):
    return np.asarray(Image.open(os.path.join(D, f)).convert("RGB")).astype(np.int16)


def masks(a):
    d1 = np.all(np.abs(a - WALL) <= 6, axis=2)
    d2 = np.all(np.abs(a - WALL2) <= 6, axis=2)
    dark = (0.299 * a[:, :, 0] + 0.587 * a[:, :, 1] + 0.114 * a[:, :, 2]) < 110
    return d1 | d2, dark


for tag, f in FILES:
    a = load(f)
    h, w, _ = a.shape
    exact, dark = masks(a)
    print("=" * 76)
    print("FILE", tag, "size", w, h, "exact-wall-colour px", int(exact.sum()), "dark px", int(dark.sum()))

    # restrict to the left half (the board lives there), drop title rows
    sub = dark[:1300, 60:1150]
    colprof = sub.sum(axis=0)
    rowprof = sub.sum(axis=1)
    # board border = long straight runs; use 300 px threshold
    print("-- col profile (dark>=300), x offset by 60 --")
    onc = colprof >= 300
    i = 0
    runs = []
    while i < len(onc):
        if onc[i]:
            j = i
            while j + 1 < len(onc) and onc[j + 1]:
                j += 1
            runs.append((i + 60, j + 60, j - i + 1, int(colprof[i:j + 1].max())))
            i = j + 1
        else:
            i += 1
    for r in runs:
        print("   x %4d..%-4d w=%-3d peak=%d" % r)
    print("-- row profile (dark>=300) --")
    onr = rowprof >= 300
    i = 0
    while i < len(onr):
        if onr[i]:
            j = i
            while j + 1 < len(onr) and onr[j + 1]:
                j += 1
            print("   y %4d..%-4d w=%-3d peak=%d" % (i, j, j - i + 1, int(rowprof[i:j + 1].max())))
            i = j + 1
        else:
            i += 1
