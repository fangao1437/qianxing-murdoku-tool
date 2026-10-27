# -*- coding: utf-8 -*-
"""design_probe_04_scans.py -- run-length encoded pixel scans across the board so the
exact geometry (wall thickness, cell insets, door blocks) is readable as numbers.
ASCII stdout only.
"""
import os

import numpy as np
from PIL import Image

D = r"D:\新建文件夹\miHoYo Launcher\murdoku-内容设计-两关布局图"
FILES = [("case001", "案件001-布局图-v2.png"), ("case002", "案件002-布局图-v5.png")]

WALL = np.array([17, 24, 39])
WALL2 = np.array([31, 41, 55])


def classify(p):
    r, g, b = int(p[0]), int(p[1]), int(p[2])
    if abs(r - 17) <= 10 and abs(g - 24) <= 10 and abs(b - 39) <= 10:
        return "W"        # wall / border dark navy
    if abs(r - 31) <= 10 and abs(g - 41) <= 10 and abs(b - 55) <= 10:
        return "W"
    if r >= 250 and g >= 250 and b >= 250:
        return "."
    if r >= 240 and g >= 240 and b >= 240:
        return ","
    if r > 120 and g > 55 and b < 90 and (r - b) > 70 and (g - b) < 60 and g < 120:
        return "O"        # door orange/brown-red
    if r > 90 and g > 55 and b < 80 and (r - b) > 30 and (r - g) < 70 and g >= b:
        return "F"        # furniture brown
    if g > r + 15 and g > b + 10:
        return "G"        # furniture green
    if b > r and b > g:
        return "b"        # region tint blue
    if g > r and g >= b:
        return "g"        # region tint green
    if r > b:
        return "c"        # region tint cream
    return "?"


def rle(seq, start, label):
    out = []
    if not seq:
        return out
    cur, s = seq[0], 0
    for i in range(1, len(seq)):
        if seq[i] != cur:
            out.append((start + s, start + i - 1, i - s, cur))
            cur, s = seq[i], i
    out.append((start + s, start + len(seq) - 1, len(seq) - s, cur))
    print("  %s from %d:" % (label, start))
    for a, b, w, c in out:
        print("     %5d..%-5d w=%-4d %s" % (a, b, w, c))


def main():
    for tag, f in FILES:
        a = np.asarray(Image.open(os.path.join(D, f)).convert("RGB"))
        h, w, _ = a.shape
        print("=" * 90)
        print("FILE", tag, a.shape)
        if tag == "case001":
            pitch, x0, y0, n = 162.0, 150.0, 296.0, 5
        else:
            pitch, x0, y0, n = 136.0, 150.0, 292.0, 6
        print("  assumed pitch=%.1f x0=%.1f y0=%.1f n=%d" % (pitch, x0, y0, n))
        print("  grid line nominal x:", [round(x0 + pitch * k) for k in range(n + 1)])
        print("  grid line nominal y:", [round(y0 + pitch * k) for k in range(n + 1)])
        # horizontal scans through the middle of each row band
        for r in range(n):
            yscan = int(round(y0 + pitch * (r + 0.30)))
            seq = [classify(a[yscan, x]) for x in range(int(x0) - 20, int(x0 + pitch * n) + 20)]
            rle(seq, int(x0) - 20, "ROW %d horizontal scan y=%d" % (r + 1, yscan))
        for c in range(n):
            xscan = int(round(x0 + pitch * (c + 0.72)))
            seq = [classify(a[y, xscan]) for y in range(int(y0) - 20, int(y0 + pitch * n) + 20)]
            rle(seq, int(y0) - 20, "COL %d vertical scan x=%d" % (c + 1, xscan))


main()
