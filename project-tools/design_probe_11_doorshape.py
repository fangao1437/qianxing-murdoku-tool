# -*- coding: utf-8 -*-
"""design_probe_11_doorshape.py -- per-scanline extent of each door marker so the
"bar on the wall" vs "label plaque" parts can be separated.  ASCII stdout.
"""
import os

import numpy as np
from PIL import Image

D = r"D:\新建文件夹\miHoYo Launcher\murdoku-内容设计-两关布局图"
DOOR_C = (194, 65, 12)


def dump(f, windows, gridx, gridy):
    a = np.asarray(Image.open(os.path.join(D, f)).convert("RGB")).astype(np.int16)
    m = np.all(np.abs(a - np.array(DOOR_C)) <= 10, axis=2)
    print("=" * 92)
    print("FILE", f, " door windows:", windows)
    for (x0, y0, x1, y1, kind, line) in windows:
        print("  %s door bbox window (%d,%d)-(%d,%d)  perpendicular line=%s" % (kind, x0, y0, x1, y1, line))
        if kind == "V":
            for yy in range(y0, y1 + 1, 2):
                idx = np.nonzero(m[yy, x0:x1 + 1])[0]
                if len(idx):
                    print("    y=%4d  x %4d..%-4d  w=%2d" % (yy, x0 + idx.min(), x0 + idx.max(),
                                                            idx.max() - idx.min() + 1))
                else:
                    print("    y=%4d  (none)" % yy)
        else:
            for xx in range(x0, x1 + 1, 2):
                idx = np.nonzero(m[y0:y1 + 1, xx])[0]
                if len(idx):
                    print("    x=%4d  y %4d..%-4d  h=%2d" % (xx, y0 + idx.min(), y0 + idx.max(),
                                                            idx.max() - idx.min() + 1))
                else:
                    print("    x=%4d  (none)" % xx)


dump("案件001-布局图-v2.png",
     [(615, 500, 660, 580, "V", "x=636"), (350, 765, 435, 800, "H", "y=782")],
     636, 782)
dump("案件002-布局图-v5.png",
     [(672, 463, 716, 530, "V", "x=694")],
     694, 496)
