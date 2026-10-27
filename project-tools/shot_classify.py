# -*- coding: utf-8 -*-
"""Classify board pixels: wall colour -> red, door colour -> green, else dim grey """
import sys
from PIL import Image

path = sys.argv[1]
out = sys.argv[2]
im = Image.open(path).convert("RGB")
px = im.load()
W, H = im.size

X0, X1, Y0, Y1 = 590, 1210, 180, 800
w = X1 - X0
h = Y1 - Y0
img = Image.new("RGB", (w, h), (255, 255, 255))
p2 = img.load()
for y in range(Y0, Y1):
    for x in range(X0, X1):
        c = px[x, y]
        r, g, b = c
        if abs(r - 0x29) <= 4 and abs(g - 0x28) <= 4 and abs(b - 0x2B) <= 4:
            p2[x - X0, y - Y0] = (255, 0, 0)       # wall
        elif abs(r - 0xDC) <= 8 and abs(g - 0x5B) <= 8 and abs(b - 0x28) <= 8:
            p2[x - X0, y - Y0] = (0, 160, 0)       # door
        elif abs(r - 0x1C) <= 3 and abs(g - 0x1C) <= 3 and abs(b - 0x1C) <= 3:
            p2[x - X0, y - Y0] = (60, 60, 60)      # frame / gap
        else:
            p2[x - X0, y - Y0] = (235, 235, 235)
img = img.resize((w * 2, h * 2), Image.NEAREST)
img.save(out)
print("saved", out, img.size)

# ASCII map: 1 char per 5 px, wall/door/frame
print("   " + "".join(str((x // 100) % 10) for x in range(X0, X1, 5)))
for y in range(Y0, Y1, 5):
    row = []
    for x in range(X0, X1, 5):
        cnt = {"w": 0, "d": 0, "f": 0}
        for yy in range(y, min(y + 5, Y1)):
            for xx in range(x, min(x + 5, X1)):
                r, g, b = px[xx, yy]
                if abs(r - 0x29) <= 4 and abs(g - 0x28) <= 4 and abs(b - 0x2B) <= 4:
                    cnt["w"] += 1
                elif abs(r - 0xDC) <= 8 and abs(g - 0x5B) <= 8 and abs(b - 0x28) <= 8:
                    cnt["d"] += 1
                elif abs(r - 0x1C) <= 3 and abs(g - 0x1C) <= 3 and abs(b - 0x1C) <= 3:
                    cnt["f"] += 1
        if cnt["d"] >= 3:
            row.append("D")
        elif cnt["w"] >= 6:
            row.append("W")
        elif cnt["f"] >= 10:
            row.append("#")
        elif cnt["w"] + cnt["f"] > 0:
            row.append("+")
        else:
            row.append(".")
    print("%4d %s" % (y, "".join(row)))
