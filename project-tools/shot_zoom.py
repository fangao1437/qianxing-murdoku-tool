# -*- coding: utf-8 -*-
"""1px ASCII map of a rectangle: shows exactly where a wall has a notch/overlap shade."""
import sys
from PIL import Image

path = sys.argv[1]
x0, x1, y0, y1 = [int(v) for v in sys.argv[2:6]]
im = Image.open(path).convert("RGB")
px = im.load()

LEG = {}


def sym(c):
    r, g, b = c
    if abs(r - 0x29) <= 3 and abs(g - 0x28) <= 3 and abs(b - 0x2B) <= 3:
        return "W"          # 墙本色
    if abs(r - 0x29) <= 12 and abs(g - 0x28) <= 12 and abs(b - 0x2B) <= 14:
        return "w"          # 墙的兄弟色（重叠/抗锯齿）
    if abs(r - 0xDC) <= 10 and abs(g - 0x5B) <= 12 and abs(b - 0x28) <= 14:
        return "D"          # 门
    if r + g + b < 120:
        return "#"          # 更黑（背板/格子描边）
    if abs(r - 0x1C) <= 6 and abs(g - 0x1C) <= 6 and abs(b - 0x1C) <= 6:
        return "d"          # 背板
    return "."              # 其它（格子填充/混合）


print("    " + "".join(str(x // 100 % 10) for x in range(x0, x1 + 1)))
print("    " + "".join(str(x // 10 % 10) for x in range(x0, x1 + 1)))
print("    " + "".join(str(x % 10) for x in range(x0, x1 + 1)))
for y in range(y0, y1 + 1):
    row = "".join(sym(px[x, y]) for x in range(x0, x1 + 1))
    print("%4d %s" % (y, row))

print("\n-- 取样 --")
for y in range(y0, y1 + 1, 2):
    row = []
    for x in range(x0, x1 + 1, 3):
        c = px[x, y]
        row.append("%02X%02X%02X" % (c[0], c[1], c[2]))
    print("%4d %s" % (y, " ".join(row)))
