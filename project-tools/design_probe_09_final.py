# -*- coding: utf-8 -*-
"""design_probe_09_final.py -- definitive, noise-free measurement.

Wall bar = run of wall colour with PERPENDICULAR thickness >= 9 px (real walls are 11 px;
the 1 px cell frames and their corner artefacts are therefore excluded).
Reports for every grid edge: wall presence + thickness + centre offset, door marker bbox
(len along edge, thickness across edge, centre offsets), and door/cell length ratio.
Also prints colour samples (border vs wall bar vs cell frame) as an independent check.
ASCII stdout; nothing written.
"""
import os

import numpy as np
from PIL import Image

D = r"D:\新建文件夹\miHoYo Launcher\murdoku-内容设计-两关布局图"
FILES = [("case001", "案件001-布局图-v2.png", 150.0, 296.0, 162.0, 5),
         ("case002", "案件002-布局图-v5.png", 150.0, 292.0, 136.0, 6)]
WALL_C = [(17, 24, 39), (31, 41, 55)]
DOOR_C = (194, 65, 12)


def runs_ge(arr, mn):
    out, s = [], None
    for i, v in enumerate(arr):
        if v:
            if s is None:
                s = i
        else:
            if s is not None:
                if i - s >= mn:
                    out.append((s, i - s))
                s = None
    if s is not None and len(arr) - s >= mn:
        out.append((s, len(arr) - s))
    return out


def show_colours(a, tag, pitch, x0, y0):
    print("   COLOUR SAMPLES (tag: rgb):")
    pts = [("board border L", int(x0) - 3, int(y0 + pitch * 2.5)),
           ("board border T", int(x0 + pitch * 2.5), int(y0) - 3),
           ("inside wall v,1,3", 636 if tag == "case001" else 694, int(y0 + pitch * 0.5)),
           ("cell frame 1px", None, None),
           ("region tint", None, None)]
    for name, x, y in pts:
        if x is None:
            continue
        print("      %-18s (%4d,%4d) = %s" % (name, x, y, tuple(int(v) for v in a[y, x])))
    # frame: at the first vertical grid line of row 1, x = x0+pitch - 5
    xf = int(x0 + pitch) - 5
    yf = int(y0 + pitch * 0.5)
    print("      %-18s (%4d,%4d) = %s" % ("cell frame 1px", xf, yf, tuple(int(v) for v in a[yf, xf])))
    print("      %-18s (%4d,%4d) = %s" % ("frame +5 (grid)", xf + 5, yf, tuple(int(v) for v in a[yf, xf + 5])))
    print("      %-18s (%4d,%4d) = %s" % ("region tint", xf + 15, yf, tuple(int(v) for v in a[yf, xf + 15])))


for tag, f, x0f, y0f, pitch, n in FILES:
    a = np.asarray(Image.open(os.path.join(D, f)).convert("RGB")).astype(np.int16)
    wall = np.zeros(a.shape[:2], bool)
    for c in WALL_C:
        wall |= np.all(np.abs(a - np.array(c)) <= 6, axis=2)
    door = np.all(np.abs(a - np.array(DOOR_C)) <= 10, axis=2)
    x = [x0f + pitch * k for k in range(n + 1)]
    y = [y0f + pitch * k for k in range(n + 1)]
    print("=" * 108)
    print("FILE %s   pitch=%.1f px   n=%d   grid x=%s" % (tag, pitch, n, [round(v, 1) for v in x]))
    print("                                grid y=%s" % [round(v, 1) for v in y])
    print("   outer border bbox: x %.0f..%.0f  y %.0f..%.0f  (width %.0f, height %.0f)"
          % (x[0] - 6, x[n] + 6, y[0] - 6, y[n] + 6, x[n] - x[0] + 12, y[n] - y[0] + 12))
    show_colours(a, tag, pitch, x0f, y0f)
    print()
    hdr = ("  edge  | line   | wall | thick | perp_off | door_len | door_thk | door_along_off | door_perp_off | len/cell")
    print(hdr)
    # vertical edges
    for c in range(1, n):
        xk = int(round(x[c]))
        for r in range(1, n + 1):
            ya, yb = int(round(y[r - 1])) + 7, int(round(y[r])) - 7
            wth, wctr = [], []
            for yy in range(ya, yb + 1):
                rr = runs_ge(wall[yy, xk - 11:xk + 12], 9)
                if rr:
                    s, ln = max(rr, key=lambda t: t[1])
                    wth.append(ln)
                    wctr.append(xk - 11 + s + (ln - 1) / 2.0)
            cov = len(wth) / float(yb - ya + 1)
            nz = [yy for yy in range(ya, yb + 1) if door[yy, xk - 11:xk + 12].any()]
            dlen = (max(nz) - min(nz) + 1) if nz else 0
            dmid = (max(nz) + min(nz)) / 2.0 if nz else 0
            dper = []
            for yy in nz:
                idx = np.nonzero(door[yy, xk - 11:xk + 12])[0]
                dper.append((idx.max() + idx.min()) / 2.0 - 11)
            print("  v,%d,%d | %6.1f | %.2f | %5.1f | %+8.1f | %8d | %8.1f | %+14.1f | %+13.1f | %.3f"
                  % (r, c, x[c], cov, float(np.median(wth)) if wth else 0.0,
                     (np.median(wctr) - x[c]) if wctr else 0.0,
                     dlen, 17.0 if dlen else 0.0,
                     (dmid - (y[r - 1] + y[r]) / 2.0) if dlen else 0.0,
                     (np.median(dper)) if dper else 0.0,
                     dlen / pitch if dlen else 0.0))
    # horizontal edges
    for r in range(1, n):
        yr = int(round(y[r]))
        for c in range(1, n + 1):
            xa, xb = int(round(x[c - 1])) + 7, int(round(x[c])) - 7
            wth, wctr = [], []
            for xx in range(xa, xb + 1):
                rr = runs_ge(wall[yr - 11:yr + 12, xx], 9)
                if rr:
                    s, ln = max(rr, key=lambda t: t[1])
                    wth.append(ln)
                    wctr.append(yr - 11 + s + (ln - 1) / 2.0)
            cov = len(wth) / float(xb - xa + 1)
            nx = [xx for xx in range(xa, xb + 1) if door[yr - 11:yr + 12, xx].any()]
            dlen = (max(nx) - min(nx) + 1) if nx else 0
            dmid = (max(nx) + min(nx)) / 2.0 if nx else 0
            dper = []
            for xx in nx:
                idx = np.nonzero(door[yr - 11:yr + 12, xx])[0]
                dper.append((idx.max() + idx.min()) / 2.0 - 11)
            print("  h,%d,%d | %6.1f | %.2f | %5.1f | %+8.1f | %8d | %8.1f | %+14.1f | %+13.1f | %.3f"
                  % (r, c, y[r], cov, float(np.median(wth)) if wth else 0.0,
                     (np.median(wctr) - y[r]) if wctr else 0.0,
                     dlen, 17.0 if dlen else 0.0,
                     (dmid - (x[c - 1] + x[c]) / 2.0) if dlen else 0.0,
                     (np.median(dper)) if dper else 0.0,
                     dlen / pitch if dlen else 0.0))
