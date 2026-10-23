# 布局 / 切件 / 规格 JSON 格式

本目录所有工具都吃/吐 JSON，格式如下（**合成示例**见 `examples/level-demo.json`；真实关卡数据不入库）。

---

## 1 关卡布局 `layout`（`slice-layout.mjs` 的输入）

```jsonc
{
  "name": "art-demo-4x4",              // 任意名字（工具日志用）
  "canvas": [1600, 900],               // 设计画布（固定 16:9，PC 基准）
  "frame": { "x": 608, "y": 138, "size": 584, "ruler": 12, "gap": 4 },
  "rows": 4, "cols": 4,
  "rooms": [ { "id": 0, "name": "大屋", "color": "#D9CDB4" },
             { "id": 1, "name": "内室", "color": "#BFD8B8" } ],
  "cells": [                           // rows 行，每行 cols 个字符 = 房间 id
    "0000", "0000", "0011", "0011"
  ],
  "objects": [
    { "name": "长桌", "kind": "table",  "cells": [[1,1],[1,2]] },   // 1-based 行列
    { "name": "地毯", "kind": "carpet", "cells": [[3,1],[4,1]] },
    { "name": "椅子", "kind": "chair",  "cells": [[2,1]] }
  ]
}
```

- `kind` 只允许：`table` / `chair` / `plant` / `statue` / `shelf` / `carpet`；
- `table` / `carpet` 会按 **4 邻接**合并成"一件"；其它 kind 一格一件；
- 同一格不能被两件占用；越界/未知 kind 会报错（工具退出码非 0）。

**棋盘几何**（`render-preview` 与游戏内一致）：
`avail = size - 2×ruler`；`pitch = floor(avail / n)`；`cell = pitch - gap`；
`grid = n×pitch - gap`；`origin = (x + ruler + floor((avail-grid)/2), y + …)`；`n = max(rows, cols)`。

---

## 2 切件结果 `slice`（`slice-layout.mjs` 的输出）

```jsonc
{
  "level": "art-demo-4x4",
  "rows": 4, "cols": 4, "cellTemplatePx": 108,
  "imageIds": { "rect": 100001, "ellipse": 100002, "round": 107102, "shadowSoft": 106056 },
  "pieces": [
    { "name": "长桌", "kind": "table", "templateKey": "furn.table.h2",
      "anchor": { "r": 1, "c": 2 }, "span": { "r": 1, "c": 2 },
      "offsetCells": { "dx": -0.5, "dy": 0 },
      "cells": [{ "r": 1, "c": 1 }, { "r": 1, "c": 2 }] }
  ],
  "errors": []                          // 非空 = 布局有问题
}
```

**模板键规则**（与主项目 `ui_controller` 的 `TPL_KEY` 一致）：

| kind | span | templateKey |
|---|---|---|
| table | 1×1 | `furn.table.1` |
| table | 1×N（横） | `furn.table.h2` |
| table | N×1（竖） | `furn.table.v2` |
| carpet | 任意 | `furn.rug` |
| chair / plant / statue / shelf | 1×1 | `furn.<kind>` |

- `anchor` 恒为包围盒**右下格**；
- `offsetCells.dx = (c1+c2)/2 − anchor.c`，`dy = (r1+r2)/2 − anchor.r`（单位=格，`dy` 向下为正）；
- 运行时把 `offsetCells` 乘格子尺寸即可得到实例相对锚点格中心的位置（`dy` 写 API 时取负）。

---

## 3 模板层规格 `spec`（`check-spec` / `render-preview` / `.gil` 写入工具的输入）

```jsonc
{
  "cellTemplatePx": 108,
  "imageIds": { "rect": 100001, "ellipse": 100002, "round": 107102, "shadowSoft": 106056 },
  "templates": {
    "furn.table.h2": {
      "kind": "table", "variant": "h2",
      "sizePx": [216, 108],
      "layerCount": 10,
      "layers": [
        { "order": 1, "imageId": 106056, "color": "0x78000000",
          "w": 190.8, "h": 113.4, "dx": 0, "dy_down": 23.76, "y_up": -23.76 }
      ]
    }
  }
}
```

字段含义：

| 字段 | 含义 |
|---|---|
| `sizePx` | 模板 content 画布（1 格 = 108；h2 216×108；v2 108×216） |
| `layers[].order` | 从 1 连续，**从下到上**的绘制顺序 |
| `imageId` | 100001 矩形 / 100002 椭圆 / 107102 圆角板 / 106056 柔光圆 |
| `color` | `0xAARRGGBB`（imageColor 乘算语义） |
| `w/h` | 画布像素（= 格比例 × 108） |
| `dx` | 相对 content 中心，右为正 |
| `dy_down` | 相对 content 中心，**下为正** |
| `y_up` | `= -dy_down`（写盘工具用的画布 y 向上口径） |

自检（`check-spec.mjs`）会校验：模板集合恰好 8 个、层数 9/10/10/10/10/10/12/3、画布尺寸、
颜色格式、尺寸范围、层序连续、`y_up = -dy_down`、地毯三层规则、
以及**手搭层规格每件 ≤12 层**（旧路线回退用）。
