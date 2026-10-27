# -*- coding: utf-8 -*-
"""Emit zoomed crops for visual inspection."""
import sys
from PIL import Image, ImageDraw

path = sys.argv[1]
outdir = sys.argv[2]
im = Image.open(path).convert("RGB")

crops = [
    ("board", (600, 185, 1200, 795), 2),
    ("corner_tl", (600, 185, 790, 340), 5),
    ("door_v24", (950, 285, 1060, 400), 6),
    ("hwall_row34", (620, 455, 1010, 525), 4),
    ("corner_br", (1040, 640, 1200, 795), 5),
    ("left_wall", (596, 280, 680, 500), 6),
]

for name, box, scale in crops:
    c = im.crop(box)
    c = c.resize((c.width * scale, c.height * scale), Image.NEAREST)
    d = ImageDraw.Draw(c)
    # draw ruler ticks every 10 source px
    for sx in range(box[0], box[2], 10):
        x = (sx - box[0]) * scale
        d.line([(x, 0), (x, 6)], fill=(255, 0, 255))
    for sy in range(box[1], box[3], 10):
        y = (sy - box[1]) * scale
        d.line([(0, y), (6, y)], fill=(255, 0, 255))
    dst = "%s/%s.png" % (outdir, name)
    c.save(dst)
    print(dst, c.size)
