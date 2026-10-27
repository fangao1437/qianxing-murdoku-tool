# -*- coding: utf-8 -*-
"""Sample colours + emit zoomed crops of interesting spots."""
import sys
from PIL import Image

path = sys.argv[1]
im = Image.open(path).convert("RGB")
px = im.load()

spots = {
    "door_v_c45_r2": (1001, 347),
    "near_grid_v4": (994, 347),
    "below": (1001, 353),
    "cell22": (760, 345),
    "cell_tan1": (760, 250),
    "cell_green": (760, 440),
    "cell_pink": (760, 530),
    "frame_left_inner": (628, 500),
    "grid_v3": (901, 450),
    "grid_h3": (760, 487),
}

for name, (x, y) in spots.items():
    c = px[x, y]
    print("%-18s (%4d,%4d)  #%02X%02X%02X" % (name, x, y, c[0], c[1], c[2]))

# scan a horizontal line across the vertical door to see the profile
print("\n-- profile y=347, x 975..1015 --")
for x in range(975, 1016):
    c = px[x, 347]
    print("  x=%d #%02X%02X%02X" % (x, c[0], c[1], c[2]))

print("\n-- profile x=760, y 480..500 (horizontal grid area) --")
for y in range(478, 500):
    c = px[760, y]
    print("  y=%d #%02X%02X%02X" % (y, c[0], c[1], c[2]))

# what colours exist near the suspected horizontal door at (668..681, 494)
print("\n-- region x 640..730 y 480..510 unique colours --")
from collections import Counter
cnt = Counter()
for y in range(478, 512):
    for x in range(630, 740):
        cnt[px[x, y]] += 1
for c, n in cnt.most_common(10):
    print("  #%02X%02X%02X %d" % (c[0], c[1], c[2], n))
