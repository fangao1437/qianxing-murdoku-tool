# -*- coding: utf-8 -*-
"""design_probe_12_zoom.py -- 3x zoom crops for eyeball confirmation:
  * case002 door v,2,4 straddling the wall
  * case001 door v,2,3 + h,3,2
  * case002 furniture labels around (1,4)/(2,4)
Writes tools/design_probe_zoom_*.png (temp artefacts, regenerable).
"""
import os

from PIL import Image

D = r"D:\新建文件夹\miHoYo Launcher\murdoku-内容设计-两关布局图"
OUT = r"D:\新建文件夹\miHoYo Launcher\qianxing-murdoku\tools"
JOBS = [("案件002-布局图-v5.png", (655, 440, 745, 560), "case002_door_v24"),
        ("案件001-布局图-v2.png", (595, 490, 680, 600), "case001_door_v23"),
        ("案件001-布局图-v2.png", (330, 745, 460, 820), "case001_door_h32"),
        ("案件002-布局图-v5.png", (545, 280, 720, 600), "case002_cell14_24")]

for f, box, name in JOBS:
    im = Image.open(os.path.join(D, f)).convert("RGB").crop(box)
    im = im.resize((im.width * 4, im.height * 4), Image.NEAREST)
    p = os.path.join(OUT, "design_probe_zoom_%s.png" % name)
    im.save(p)
    print("wrote", os.path.basename(p), im.size, "from", box)
