# qianxing-3d-placement · 千星 3D 场景「摆位」主线

**主线口径：插件只做摆位。** 3D 场景不需要 Blender / GIA / 渊星 / 账号权益——
纯 Node 读写 `.gil` 的场景实体变换（`#5 → #6 → #11` 的位置/旋转/缩放），
由编辑器导入验证；这一条已经过真机导入再导出验证（坐标原样保留）。

## 何时使用

- 用户已有一个 3D 场景存档（`.gil`），想按设计图/坐标表**移动、旋转、缩放现有元件**
- 需要先看清存档里有哪些元件、当前坐标
- 「渊星绕过」路线：不导出 GIA、不打开 Blender，直接离线改存档坐标

## 工具

| 工具 | 作用 | 参数 |
|---|---|---|
| `scene3d_list_entities` | 列出场景实体：index / 名字 / 位置(米) / 旋转(度) / 缩放 | `gil` |
| `scene3d_apply_placement` | 按坐标表离线改写（写新档 + 重读校验） | `gil`、`placement`、可选 `out` |

`placement` 每项：

```json
{ "name": "金属桌子", "delta": [2.0, 0.5, 1.5] }
{ "name": "相框", "rotation": [0, 45, 0] }
{ "index": 23, "position": [-6.5, 2.17, -12.17] }
{ "name": "椅子", "scale": [1.2, 1.2, 1.2] }
```

- `position`：绝对坐标（米）
- `delta`：相对位移（米）
- `rotation`：欧拉角（度，稀疏编码，只改存档里已存在的轴）
- `scale`：缩放

## 标准流程

1. 用户发来 `.gil` 3D 存档（QQ 下载到 `~/.dsh-qqbot/media/`）或给路径
2. `scene3d_list_entities(gil=...)` → 看实体清单和当前坐标
3. 按用户要求（或设计图 spec）算出每个元件的目标坐标
4. `scene3d_apply_placement(gil=..., placement=[...])`
   - 原档只读；输出默认 `<名字>.placement.gil`
   - 返回：改了哪些实体、`diffs` 条数、`sha256Before/After`、重读校验结果
5. 把新档用 `qqbot_send_file` 发给用户 → 导入编辑器 → **重载地图**后确认

## 硬限制（必须如实说）

- **只改现有元件的变换**；新增/删除/复制元件没有验证过，不能承诺
- 元件的旋转是稀疏编码：只改存档里已写出的轴；没写的轴不强行生成
- 名字匹配：先精确匹配，再包含匹配；重名时用 `index` 指定
- 导入编辑器后要**先重载地图再保存**，否则可能被旧存档覆盖
- 这是「坐标编排」路线：场景里的元件仍需用户先在编辑器摆好占位

## 与其它插件的关系

- `design-to-scene`（scene_parse_plan / scene_preview / scene_qx_plan）：负责「设计图 → 坐标表」，其 `scene_qx_plan` 的 placement 行就是这个工具要吃的坐标
- `scene_build_blender`：可选的可视化辅助（渲染/GLB），**不是主线**，不需要 GPU 也能只出坐标
- `qianxing-nodegraph`：`.gia` 节点图工具，和 3D 摆位无关

## 判断成功

- `ok: true`、`diffs` 条数与预期一致（每个 position 轴 1 条、每轴旋转 1 条）
- 其它实体的位置/缩放没变（`diffSample` 里只应出现目标实体）
- 用户导入后**元件位置真的变了** → 才算真成功；文件层成功不等于游戏里生效
