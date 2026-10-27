# -*- coding: utf-8 -*-
"""Precise board measurement: walls (#29282B) and doors (#DC5B28) vs grid lines."""
import io
import sys
from collections import Counter

from PIL import Image

path = sys.argv[1]
out = sys.argv[2]
im = Image.open(path).convert("RGB")
W, H = im.size
px = im.load()

BX0, BX1, BY0, BY1 = 600, 1200, 190, 795

buf = io.StringIO()


def w(*a):
    buf.write(" ".join(str(x) for x in a) + "\n")


# ---- colour census inside board ----
cnt = Counter()
for y in range(BY0, BY1):
    for x in range(BX0, BX1):
        cnt[px[x, y]] += 1
w("== colour census (board area) top 25 ==")
for c, n in cnt.most_common(25):
    w("  #%02X%02X%02X %6d" % (c[0], c[1], c[2], n))


def clusters_of(pred, minpx=20):
    ptset = set()
    for y in range(BY0, BY1):
        for x in range(BX0, BX1):
            if pred(px[x, y]):
                ptset.add((x, y))
    seen = set()
    out_list = []
    for p in ptset:
        if p in seen:
            continue
        stack = [p]
        seen.add(p)
        comp = []
        while stack:
            cx, cy = stack.pop()
            comp.append((cx, cy))
            for dx in (-1, 0, 1):
                for dy in (-1, 0, 1):
                    q = (cx + dx, cy + dy)
                    if q in ptset and q not in seen:
                        seen.add(q)
                        stack.append(q)
        if len(comp) >= minpx:
            xs = [c[0] for c in comp]
            ys = [c[1] for c in comp]
            out_list.append((len(comp), min(xs), min(ys), max(xs), max(ys)))
    return sorted(out_list, key=lambda t: (t[2], t[1]))


def show(title, lst):
    w("\n== %s : %d clusters ==" % (title, len(lst)))
    for n, x0, y0, x1, y1 in lst:
        w("  n=%5d x %4d..%4d (w=%3d) y %4d..%4d (h=%3d) centre %7.1f,%7.1f"
          % (n, x0, x1, x1 - x0 + 1, y0, y1, y1 - y0 + 1, (x0 + x1) / 2.0, (y0 + y1) / 2.0))


WALL = (0x29, 0x28, 0x2B)
DOOR = (0xDC, 0x5B, 0x28)


def near(c, t, tol=6):
    return abs(c[0] - t[0]) <= tol and abs(c[1] - t[1]) <= tol and abs(c[2] - t[2]) <= tol


wall_cl = clusters_of(lambda c: near(c, WALL, 3))
show("WALL #29282B", wall_cl)
door_cl = clusters_of(lambda c: near(c, DOOR, 6))
show("DOOR #DC5B28", door_cl)

# ---- grid geometry from a green cell colour (#4BAF4F) ----
GREEN = (0x4B, 0xAF, 0x4F)
gcl = clusters_of(lambda c: near(c, GREEN, 4), 200)
show("GREEN cells", gcl)
TAN = (0xD6, 0xC4, 0xA0)
tcl = clusters_of(lambda c: near(c, TAN, 2), 200)
show("TAN cells", tcl)
PINK = (0xCE, 0xB2, 0xC8)
pcl = clusters_of(lambda c: near(c, PINK, 2), 200)
show("PINK cells", pcl)
BLUE = (0xB2, 0xC8, 0xD0)
bcl = clusters_of(lambda c: near(c, BLUE, 2), 200)
show("BLUE cells", bcl)

# derive pitch from green cell bboxes (rows 3-6)
w("\n== pitch from cell boxes ==")
for name, lst in (("green", gcl), ("tan", tcl), ("pink", pcl), ("blue", bcl)):
    for n, x0, y0, x1, y1 in lst:
        w("  %s cell x0=%d y0=%d w=%d h=%d" % (name, x0, y0, x1 - x0 + 1, y1 - y0 + 1))

with open(out, "w", encoding="utf-8") as f:
    f.write(buf.getvalue())
print("written", out)
