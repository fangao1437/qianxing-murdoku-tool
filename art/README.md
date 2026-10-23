# art/ —— 千星奇域 · 2D 家具美术制作管线（零依赖工具）

> 这是主项目「Murdoku 复刻」里美术侧**真正跑通过一遍**的流程的工具化版本：
> 原作参考 → 部件/层表 → **模板逐层规格** → 存档写入（模板 pair + content + 图片层）→ 运行时实例化约定 → 离线预览/校验 → 真机验收。
>
> 本目录**只含 id / 颜色 / 尺寸 / 几何数据**，不含任何官方贴图、`.gil`、`.gia`、截图或外部素材（与仓库 §10 的合规约定一致）。

---

## 1 这是什么 / 不是什么

**是**
- 一份**可校验、可复现**的家具美术数据：`specs/furniture_templates.json`（8 个模板：椅/植物/雕像/方桌/横桌/竖桌/书架/地毯，共 71+3 层）；
- 四个零依赖 Node 工具：**生成规格**、**切件**、**离线预览（SVG）**、**规格自检**；
- 一份把"踩过的坑"写进去的**完整流程文档**（`docs/美术制作流程.md`）。

**不是**
- 不是 `.gil`/`.gia` 的 protobuf 读写器（那是 `src/` 与上游工具的事，本目录只输出"规格 JSON"）；
- 不生成/分发任何官方的图片、存档、贴图（`*.png` / `*.svg` / `*.gil` 都在 `.gitignore` 里，预览输出进 `out/`）。

---

## 2 快速开始

```bash
# ① 规格自检（不需要主项目）
node art/tools/check-spec.mjs

# ② 切件：关卡布局 → 每件家具的模板键 / 锚点格 / 跨格 / 整件中心偏移
node art/tools/slice-layout.mjs --layout=art/examples/level-demo.json --out=out/slice.json

# ③ 离线预览：规格 + 布局 → 1600×900 棋盘 SVG（out/ 不进库）
node art/tools/render-preview.mjs \
  --layout=art/examples/level-demo.json \
  --spec=art/specs/furniture_templates.json \
  --out=out/art-preview.svg

# ④ 从主项目的 lua/furn_art.lua 重新生成规格，并和本目录 spec 比对（需要主项目）
node art/tools/gen-layers.mjs --furn-art=../qianxing-murdoku/lua/furn_art.lua --out=out/gen.json --check

# ⑤ 一条命令跑全部自检
node art/test/run.mjs --furn-art=../qianxing-murdoku/lua/furn_art.lua
```

> 上面的相对路径假设 `art/` 与本工具的兄弟目录里放着主项目 `qianxing-murdoku/`；
> 没有主项目时跑 ①②③⑤（不带 `--furn-art=`）也能全过。

---

## 3 目录

| 路径 | 作用 |
|---|---|
| `specs/furniture_templates.json` | **主交付**：8 个家具模板的逐层规格（imageId / 颜色 / 像素尺寸 / 相对中心位移 / 层序 / 画布） |
| `specs/furniture_hand_layers.json` | "手搭层"旧路线（每件 ≤12 层，回退/对照用） |
| `examples/level-demo.json` | 合成示例布局（4×4、两房间、横/竖/方桌、地毯、椅/植物/书/雕像）——**不是任何真实关卡** |
| `tools/gen-layers.mjs` | 主项目 `lua/furn_art.lua` → 模板逐层规格 JSON（可选 `--check` 与仓库 spec 比对，容差 0.011px） |
| `tools/slice-layout.mjs` | 布局 JSON → 每件家具 `{templateKey, anchor, span, offsetCells}`（= 运行时脚本下发的东西） |
| `tools/render-preview.mjs` | 规格 + 布局 → 1600×900 SVG 观感基准（房间底色 → 逐层矩形/椭圆/圆角板） |
| `tools/check-spec.mjs` | 规格自检（模板集合/层数/画布/颜色格式/尺寸范围/层序/地毯三层规则/手搭层上限 12） |
| `test/run.mjs` | 一键自检 20 条（含切件断言、SVG 断言、可选的主项目生成一致性） |

---

## 4 规格格式（摘要）

`furniture_templates.json`：

```jsonc
{
  "cellTemplatePx": 108,                    // 模板 content 画布基准：1 格 = 108 画布像素
  "imageIds": { "rect": 100001, "ellipse": 100002, "round": 107102, "shadowSoft": 106056 },
  "templates": {
    "furn.chair": {
      "kind": "chair", "variant": "1",
      "sizePx": [108, 108],                 // content 画布（h2=216×108 / v2=108×216）
      "layerCount": 9,
      "layers": [
        { "order": 1, "imageId": 106056, "color": "0x44000000", "w": 76, "h": 80, "dx": 0, "dy_down": 6, "y_up": -6 }
        // … 从下到上；w/h 为"模板画布像素"；dx/dy_down 相对 content 中心；y_up = -dy_down
      ]
    }
    // furn.plant / furn.statue / furn.table.1 / furn.table.h2 / furn.table.v2 / furn.shelf / furn.rug
  }
}
```

- **只允许官方基础形状**：`100001` 矩形、`100002` 椭圆、`107102` 近白圆角板（圆角/桌形）、`106056` 柔光圆（阴影）；
- 颜色 = `0xAARRGGBB`（`imageColor` 的乘算语义，alpha 0–255）；
- 全部**轴对齐**（无旋转）：这是"真机边缘平滑"的前提（早期用旋转细椭圆的版本在真机上发毛）。

布局 JSON / 切件输出格式见 `docs/布局与规格JSON.md`。

---

## 5 边界（与真机/存档的关系）

- 本工具输出的是**规格**；把它写进 `.gil`（模板 pair + content + 图片层）由 `.gil` 工具链负责（见主项目 `tools/gil/`，不在本仓库）；
- 运行时约定（face / 地毯 / 家具的层级、缩放、跨格偏移、切关销毁）见 `docs/层级与缩放规范.md`；
- **已知硬坑**（详见 `docs/美术制作流程.md` §7）：编辑器"打开→保存"会删掉纯手写的模板记录；模板引用控件存的是**模板源** GUID；控件组画布内控件 ≤1000、模板 ≤2000、屏上显示 ≤10000；透明底素材进"图片压缩管线"前要先按 alpha 掩码过滤块。
