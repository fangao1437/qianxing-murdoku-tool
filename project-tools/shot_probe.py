# -*- coding: utf-8 -*-
"""Measure board / grid / door-wall pixels from a device screenshot (report to utf8 file)."""
import io
import sys
from collections import Counter

from PIL import Image

OUT = sys.argv[2] if len(sys.argv) > 2 else "shot_probe.txt"
buf = io.StringIO()


def w(*a):
    line = " ".join(str(x) for x in a)
    buf.write(line + "\n")


def main():
    path = sys.argv[1]
    im = Image.open(path).convert("RGB")
    W, H = im.size
    px = im.load()
    w("image %dx%d" % (W, H))

    # ---- board frame: dark border ----
    def dark(c):
        return c[0] + c[1] + c[2] < 260

    # find board bbox by scanning a central horizontal/vertical band for the frame
    # first: rows where a long horizontal dark run exists in x 560..1260
    w("\n== horizontal dark runs (len>=200) in x 400..1300 ==")
    for y in range(120, H):
        best = 0
        cur = 0
        start = None
        bs = None
        for x in range(400, 1300):
            if dark(px[x, y]):
                if cur == 0:
                    start = x
                cur += 1
                if cur > best:
                    best = cur
                    bs = start
            else:
                cur = 0
        if best >= 200:
            w("  y=%d run=%d from x=%d to %d" % (y, best, bs, bs + best - 1))

    # ---- vertical dark runs ----
    w("\n== vertical dark runs (len>=200) in y 150..820 ==")
    for x in range(400, 1300):
        best = 0
        cur = 0
        start = None
        bs = None
        for y in range(150, 820):
            if dark(px[x, y]):
                if cur == 0:
                    start = y
                cur += 1
                if cur > best:
                    best = cur
                    bs = start
            else:
                cur = 0
        if best >= 200:
            w("  x=%d run=%d from y=%d to %d" % (x, best, bs, bs + best - 1))

    # ---- warm (door) pixels ----
    def warm(c):
        r, g, b = c
        return r > 120 and r - b > 40 and r - g > 20

    pts = []
    for y in range(150, 830):
        for x in range(560, 1260):
            if warm(px[x, y]):
                pts.append((x, y))
    w("\n== warm pixels: %d ==" % len(pts))
    # cluster by 8-neighbourhood using a simple union over grid buckets
    seen = set()
    ptset = set(pts)
    clusters = []
    for p in pts:
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
        if len(comp) >= 6:
            xs = [c[0] for c in comp]
            ys = [c[1] for c in comp]
            clusters.append((len(comp), min(xs), min(ys), max(xs), max(ys)))
    w("clusters (>=6 px):")
    for n, x0, y0, x1, y1 in sorted(clusters, key=lambda t: -t[0]):
        w("  n=%4d bbox x %d..%d (w=%d) y %d..%d (h=%d) centre %.1f,%.1f"
          % (n, x0, x1, x1 - x0 + 1, y0, y1, y1 - y0 + 1, (x0 + x1) / 2.0, (y0 + y1) / 2.0))

    # ---- cell centres colour survey (6x6 assumed inside a given bbox) ----
    with open(OUT, "w", encoding="utf-8") as f:
        f.write(buf.getvalue())


if __name__ == "__main__":
    main()
