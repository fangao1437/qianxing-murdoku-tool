# -*- coding: utf-8 -*-
"""Print compressed colour runs along given lines, to locate seams/gaps between wall bars."""
import sys
from PIL import Image

path = sys.argv[1]
im = Image.open(path).convert("RGB")
px = im.load()
W, H = im.size


def classify(c):
    r, g, b = c
    # wall family (near #29282B) — 放宽到 ±10，把重叠/抗锯齿的兄弟色一起认出来
    if abs(r - 0x29) <= 10 and abs(g - 0x28) <= 10 and abs(b - 0x2B) <= 12:
        return "WALL"
    if abs(r - 0xDC) <= 10 and abs(g - 0x5B) <= 12 and abs(b - 0x28) <= 14:
        return "DOOR"
    if abs(r - 0x1C) <= 4 and abs(g - 0x1C) <= 4 and abs(b - 0x1C) <= 4:
        return "dark"      # 背板/缝/格子描边
    if abs(r - 0x46) <= 8 and abs(g - 0x47) <= 8 and abs(b - 0x6D) <= 8:
        return "bg"
    return "other"


def runs_h(y, x0, x1):
    out = []
    cur, start = None, x0
    for x in range(x0, x1 + 1):
        k = classify(px[x, y])
        if k != cur:
            if cur is not None:
                out.append((cur, start, x - 1))
            cur, start = k, x
    out.append((cur, start, x1))
    return out


def runs_v(x, y0, y1):
    out = []
    cur, start = None, y0
    for y in range(y0, y1 + 1):
        k = classify(px[x, y])
        if k != cur:
            if cur is not None:
                out.append((cur, start, y - 1))
            cur, start = k, y
    out.append((cur, start, y1))
    return out


def show(title, runs):
    print("\n== " + title + " ==")
    for k, a, b in runs:
        print("  %-6s %4d..%4d  (%d)" % (k, a, b, b - a + 1))


show("横向：第 3/4 行之间（y=488）", runs_h(488, 605, 1200))
show("横向：顶部外框内侧（y=214）", runs_h(214, 605, 1200))
show("横向：底部外框内侧（y=762）", runs_h(762, 605, 1200))
show("竖向：第 4/5 列之间（x=995）", runs_v(995, 190, 790))
show("竖向：左边框（x=629）", runs_v(629, 190, 790))
show("竖向：右边框（x=1175）", runs_v(1175, 190, 790))

# 角落取色：左上角/右上角/左下角/右下角
print("\n== 角部取样 ==")
for name, (x, y) in {
    "TL(629,214)": (629, 214), "TL-内(660,214)": (660, 214),
    "TR(1175,214)": (1175, 214),
    "BL(629,762)": (629, 762), "BR(1175,762)": (1175, 762),
    "T-内接(716,214)": (716, 214), "L-内接(629,394)": (629, 394),
    "框内沿-左(618,350)": (618, 350), "框内沿-上(760,205)": (760, 205),
    "墙外沿-左(624,350)": (624, 350), "墙外沿-上(760,211)": (760, 211),
}.items():
    c = px[x, y]
    print("  %-18s (%4d,%4d) #%02X%02X%02X  %s" % (name, x, y, c[0], c[1], c[2], classify(c)))
