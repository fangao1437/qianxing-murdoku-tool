# -*- coding: utf-8 -*-
"""design_probe_07_edges.py -- DEFINITIVE per-edge measurement.

For every grid EDGE of the board it reports, from exact pixel masks:
  * wall coverage fraction along the edge (so wall present / absent / interrupted by door)
  * wall bar thickness (perpendicular px) and bar centre offset from the grid line
  * door-marker coverage, its along-edge length and perpendicular thickness, centre,
    and centre offset from the grid line
  * door length as a fraction of the cell edge length
ASCII stdout only; nothing is written.
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
    """[(start,len)] of runs of True with length >= mn"""
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


def edge_stats(cover, thick, centre, nominal):
    """cover: HxW bool of the edge window (H = along-edge rows), returns dict"""
    along = cover.any(axis=1)
    cov = along.mean() if len(along) else 0.0
    th = [t for t, c in zip(thick, along) if c]
    ct = [c for c, a in zip(centre, along) if a]
    med_t = float(np.median(th)) if th else 0.0
    med_c = float(np.median(ct)) if ct else 0.0
    return cov, med_t, med_c


for tag, f, x0f, y0f, pitch, n in FILES:
    a = np.asarray(Image.open(os.path.join(D, f)).convert("RGB")).astype(np.int16)
    wall = np.zeros(a.shape[:2], bool)
    for c in WALL_C:
        wall |= np.all(np.abs(a - np.array(c)) <= 6, axis=2)
    door = np.all(np.abs(a - np.array(DOOR_C)) <= 10, axis=2)
    print("=" * 104)
    print("FILE %s  pitch=%.1f  n=%d  cell=%s" % (tag, pitch, n, "square"))
    x = [x0f + pitch * k for k in range(n + 1)]
    y = [y0f + pitch * k for k in range(n + 1)]
    print("grid x:", [round(v, 1) for v in x])
    print("grid y:", [round(v, 1) for v in y])
    print()
    print("--- VERTICAL edges  (v,r,c) = between col c and col c+1 in row r ; grid line x[c] ---")
    print(" v,r,c | x_line | wallcover | thickness | bar_centre | dx | doorcover | door_len | door_thick | door_centre | dx | len/cell")
    for c in range(1, n):           # c = 1..n-1  -> line index c
        xk = x[c]
        xi = int(round(xk))
        for r in range(1, n + 1):
            ya, yb = int(round(y[r - 1])) + 5, int(round(y[r])) - 5
            win = wall[ya:yb, xi - 11:xi + 12]
            dwin = door[ya:yb, xi - 11:xi + 12]
            cov, th, ctr = edge_stats(win, [0] * (yb - ya), [0] * (yb - ya), xk)
            # recompute thickness/centre properly
            th, ctr = [], []
            for i in range(win.shape[0]):
                rr = runs_ge(win[i], 4)
                if rr:
                    s, ln = max(rr, key=lambda t: t[1])
                    th.append(ln)
                    ctr.append(xi - 11 + s + (ln - 1) / 2.0)
            mt = float(np.median(th)) if th else 0.0
            mc = float(np.median(ctr)) if ctr else 0.0
            dccov = dwin.any(axis=1).mean() if dwin.size else 0.0
            dth, dctr, dyr = [], [], []
            for i in range(dwin.shape[0]):
                if dwin[i].any():
                    idx = np.nonzero(dwin[i])[0]
                    dth.append(idx.max() - idx.min() + 1)
                    dctr.append(xi - 11 + (idx.max() + idx.min()) / 2.0)
                    dyr.append(ya + i)
            dl = (max(dyr) - min(dyr) + 1) if dyr else 0
            dmid = (max(dyr) + min(dyr)) / 2.0 if dyr else 0.0
            print(" v,%d,%d | %6.1f | %8.2f | %9.1f | %10.1f | %+5.1f | %9.2f | %8d | %10.1f | %11.1f | %+5.1f | %.2f"
                  % (r, c, xk, cov, mt, mc, (mc - xk) if mc else 0.0, dccov, dl,
                     float(np.median(dth)) if dth else 0.0,
                     (max(dctr) + min(dctr)) / 2.0 if dctr else 0.0,
                     ((max(dctr) + min(dctr)) / 2.0 - xk) if dctr else 0.0,
                     dl / pitch if dl else 0.0))
    print()
    print("--- HORIZONTAL edges  (h,r,c) = between row r and row r+1 in col c ; grid line y[r] ---")
    print(" h,r,c | y_line | wallcover | thickness | bar_centre | dy | doorcover | door_len | door_thick | door_centre | dy | len/cell")
    for r in range(1, n):
        yr = y[r]
        yi = int(round(yr))
        for c in range(1, n + 1):
            xa, xb = int(round(x[c - 1])) + 5, int(round(x[c])) - 5
            win = wall[yi - 11:yi + 12, xa:xb]
            dwin = door[yi - 11:yi + 12, xa:xb]
            cov = win.any(axis=0).mean() if win.size else 0.0
            th, ctr = [], []
            for i in range(win.shape[1]):
                rr = runs_ge(win[:, i], 4)
                if rr:
                    s, ln = max(rr, key=lambda t: t[1])
                    th.append(ln)
                    ctr.append(yi - 11 + s + (ln - 1) / 2.0)
            mt = float(np.median(th)) if th else 0.0
            mc = float(np.median(ctr)) if ctr else 0.0
            dccov = dwin.any(axis=0).mean() if dwin.size else 0.0
            dth, dctr, dxr = [], [], []
            for i in range(dwin.shape[1]):
                if dwin[:, i].any():
                    idx = np.nonzero(dwin[:, i])[0]
                    dth.append(idx.max() - idx.min() + 1)
                    dctr.append(yi - 11 + (idx.max() + idx.min()) / 2.0)
                    dxr.append(xa + i)
            dl = (max(dxr) - min(dxr) + 1) if dxr else 0
            print(" h,%d,%d | %6.1f | %8.2f | %9.1f | %10.1f | %+5.1f | %9.2f | %8d | %10.1f | %11.1f | %+5.1f | %.2f"
                  % (r, c, yr, cov, mt, mc, (mc - yr) if mc else 0.0, dccov, dl,
                     float(np.median(dth)) if dth else 0.0,
                     (max(dctr) + min(dctr)) / 2.0 if dctr else 0.0,
                     ((max(dctr) + min(dctr)) / 2.0 - yr) if dctr else 0.0,
                     dl / pitch if dl else 0.0))
