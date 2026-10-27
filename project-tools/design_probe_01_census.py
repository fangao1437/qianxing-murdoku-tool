# -*- coding: utf-8 -*-
"""design_probe_01_census.py -- colour census + dark-pixel row/col profiles for the
two design layout PNGs.  Read-ONLY: no file is written.
ASCII-only stdout so the console codepage cannot garble output.
"""
import os
from collections import Counter

from PIL import Image

D = r"D:\新建文件夹\miHoYo Launcher\murdoku-内容设计-两关布局图"
FILES = ["案件001-布局图-v2.png", "案件002-布局图-v5.png"]


def census(path):
    im = Image.open(path).convert("RGB")
    w, h = im.size
    px = im.load()
    c = Counter()
    for y in range(h):
        for x in range(w):
            c[px[x, y]] += 1
    print("=" * 78)
    print("FILE", os.path.basename(path).encode("unicode_escape").decode(), im.size)
    total = w * h
    for col, n in c.most_common(28):
        print("  %-16s %9d  %6.2f%%" % (str(col), n, 100.0 * n / total))
    print("  distinct colours:", len(c))
    return im, c


def profiles(im, thresh=140):
    """count 'dark' pixels per column and per row (luma < thresh)"""
    w, h = im.size
    px = im.load()
    colcnt = [0] * w
    rowcnt = [0] * h
    for y in range(h):
        for x in range(w):
            r, g, b = px[x, y]
            if 0.299 * r + 0.587 * g + 0.114 * b < thresh:
                colcnt[x] += 1
                rowcnt[y] += 1
    return colcnt, rowcnt


def runs(counts, mn):
    out = []
    s = None
    for i, v in enumerate(counts):
        if v >= mn:
            if s is None:
                s = i
        else:
            if s is not None:
                out.append((s, i - 1))
                s = None
    if s is not None:
        out.append((s, len(counts) - 1))
    return out


def show(name, counts, mn):
    print("  --%s runs (>=%d) --" % (name, mn))
    rr = runs(counts, mn)
    for (a, b) in rr:
        print("     x/y %4d..%-4d width=%-3d centre=%.1f peak=%d"
              % (a, b, b - a + 1, (a + b) / 2.0, max(counts[a:b + 1])))
    return rr


for f in FILES:
    p = os.path.join(D, f)
    im, c = census(p)
    w, h = im.size
    for th in (140, 190, 230):
        colcnt, rowcnt = profiles(im, th)
        # strong lines: a grid line column has dark pixels over most of the board height
        mx_c = max(colcnt)
        mx_r = max(rowcnt)
        print("  luma<%d  peak col=%d  peak row=%d" % (th, mx_c, mx_r))
        show("cols", colcnt, int(mx_c * 0.35))
        show("rows", rowcnt, int(mx_r * 0.35))
        break
