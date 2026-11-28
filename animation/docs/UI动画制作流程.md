# 千星奇域 · 2D UI 柔性纸张动画制作流程（完整版）

> 本文档完整沉淀自 `qianxing-murdoku` 项目 **749（v1 → v8）** 背包与商店右侧「附上一张新纸」动画从 0 到真机验收的全链路工程方法、数学模型、真机铁律与验收门禁。
>
> 配套工具：`animation/tools/kirchhoff-paper-sim.mjs`、`animation/tools/audit-gil-anim.mjs`、`animation/specs/paper_presets.json`、`project-tools/build_749.mjs`、`project-tools/verify_749_paper_anim.lua`。

---

## 0 流程总览

```
① 能力边界与区域精分    明确千星真机约束；把「静止结构」与「变化纸卡」物理剥离
② 控件树与层序重构      建 anim.under（旧纸）+ anim.sheet（新纸）+ anim.bend（16 段柔性纸带）+ 分区内容容器
③ 基尔霍夫薄板物理建模  双模态解析解（悬臂自由端 + 简支气垫穹拱）+ 严格不可伸长可展板两遍积分
④ 离线求解与 SVG 预演   kirchhoff-paper-sim.mjs --audit --svg=... 60 帧全扫描，先在离线消灭穿模/拉长/台阶
⑤ 落盘构建与静态审计    写 .gil 副本 + 嵌入 OnUpdate(dt) 解析状态机 + audit-gil-anim.mjs 6 道静态门禁
⑥ 高仿真 Lua 回归       verify_749_paper_anim.lua 模拟冷启动关灯、连点打断、离页复位与 0 稳态负载
⑦ 真机录屏逐帧核验      ffmpeg 抽帧 + 像素/边缘/角点测量 → 参数微调闭环
```

---

## 1 千星沙箱 UI 动画硬约束（先查边界再设计）

在写任何动画代码前，必须遵守以下 6 条经实机验证的引擎边界：

| 维度 | 真机实测事实 | 工程决策 |
|---|---|---|
| 驱动方式 | `game.Tween` 在隐藏期后台继续写、连点易双 Tween 争抢，且 `localRotationZ` 读回 `[0, 360)` 导致负角向 0° 绕远路 | **禁用 `game.Tween`**；统一用 `OnUpdate(dt)` 纯数学解析式驱动，支持任意帧无缝打断 |
| 显隐级联 | **父容器 `SetVisible(false)` 不级联隐藏子控件**；且页面隐藏巡检 `_enforce_hidden_subtrees` 会沿父链把深层叶子逐个关灯 | **逐叶子显式开关**：开动画时逐叶子点亮旧纸与全部弯曲带；收尾与离页时逐叶子熄灭 |
| 整组透明与叠加 | 无 `CanvasGroup`；无全局 `Color()`；多片半透明矩形/三角叠放会产生明显视觉杂片与压暗 | **零半透明附加产物**：所有新增动画图元强制 `alpha = 0xFF`（`0xFF000000 + R*65536 + G*256 + B`），用实色朗伯光影表达弯曲起伏 |
| 顶点变形 | 仅支持 `100001` 矩形等基础图元与容器级 `anchoredPosition / localScale / localRotation`，无网格顶点变形 | **16 段等弧长实心弯曲纸带链** + 内框同步切段 + 上/下内容与角钉分区跟随 |
| 运行时坐标回写 | 布局层 `pos_runtime = true` 会在 `render(force)` 时把容器拉回静止坐标 | 排除 `%.anim%.` 容器走 `pos_runtime`，避免整页重绘打断动画 |
| 性能预算 | 切屏/稳态要求零额外引擎 API 调用 | 全部新控件登记 `STATIC_PATH_655` O(1) 静态路由；非动画帧 0 次 `SetPos / SetRot / GetChildren` |

---

## 2 区域精分与控件树架构

以「调查商城右侧」与「调查背包右侧」为例，严格分离**固定结构**与**变化纸卡**：

### 2.1 区域划分原则

1. **必须保持完全静止且层序在上的元素**（留在原父容器 `econ.ui742`）：
   - 外木框 `s8`、右侧大米色展板 `s9`（`#ECE2CC`）；
   - 顶部虚线标题铭牌与道具名称 `s37..s64 / name`；
   - 底部「取消 / 购买」按钮与热区 `s71..s74 / cancel / purchase / hit.*`；
   - 确认弹窗 `s148..`。
2. **独立变化纸卡**（只对内容真正变化的区域做覆纸动画）：
   - 商店独立框出 `468 × 530`（中心 `(444, -19)`）档案纸卡：2px 实心暖棕边框 `#FFB89872` + 象牙纸面 `#FFF7F0DF`，与外底板 `#ECE2CC` 轻色区分；
   - 背包对右侧便签纸 `408.5 × 616.33` 做动画，保持下方原倾斜装饰底纸 `paper.under` 静态不动。

### 2.2 标准双纸层容器树（每处动效一套）

```
econ.ui742
 ├─ [静止背景] s8 / s9 (商店) 或 paper.under (背包)
 ├─ <prefix>anim.under               ← 旧纸层（初始 hidden=true；仅在动画期逐叶子点亮定格上一份内容）
 │   ├─ anim.u.card.border / face    ← 旧纸实心底面（商店）或 anim.u.paper.*（背包）
 │   └─ anim.u.<内容控件...>          ← 旧图标 / 旧文案克隆件
 ├─ <prefix>anim.sheet               ← 新纸层（紧压在 anim.under 之上，静止时处于原中心）
 │   ├─ [静止单底面] card.border / card.face / s66（或 paper.top / label / body）
 │   │   └─ 静止态显示，动画期隐藏交由 anim.bend 接管，0 跳色切换
 │   ├─ <prefix>anim.bend            ← 柔性弯曲纸带层（初始 hidden=true；动画期逐叶子点亮）
 │   │   ├─ anim.b.br1..16           ← 16 条实心外边框带（w+4，相邻内延展重叠防露缝）
 │   │   ├─ anim.b.fc1..16           ← 16 条实心纸面带（w）
 │   │   └─ anim.b.in1..M            ← 内部浅棕说明框/标题框同步切段（商店 10 段 / 背包 3+11 段）
 │   ├─ <prefix>anim.ptop / pbot     ← 上下角钉/图钉容器（采样说明框上下缘弯曲点）
 │   └─ <prefix>anim.top  / bot      ← 上/下内容容器（图标+价格 / 说明+状态，采样对应高度切线）
 └─ [静止前景] 顶部标题铭牌 / 底部按钮 / 确认弹窗（z-order 严格压在 anim.sheet 之上）
```

> **重要实现细节**：在 `.gil` 中修改 `childList` 顺序的同时，**必须同步重排序列化 `holder` 中的记录顺序**，避免不同读取路径产生层序偏差；迁入子容器的原有控件坐标必须精确减去新父容器中心偏移，并通过 4 平台槽位静态世界坐标校验（误差 `< 0.001px`）。

---

## 3 基尔霍夫薄板方程（Kirchhoff-Love）物理建模

沿纸长无量纲弧长 $\xi = s / L \in [0, 1]$，一维圆柱可展薄板受弯运动满足基尔霍夫薄板方程：

$$D \frac{\partial^4 w}{\partial s^4} + \rho h \frac{\partial^2 w}{\partial t^2} + c \frac{\partial w}{\partial t} = q(s, t)$$

### 3.1 双模态精确解析形函数

为在客户端脚本中以极低计算成本实现真实软纸手感，叠加两组精确满足自然边界条件的解析模态：

1. **悬臂-自由端主落置模态**（上沿引导接触 $w(0)=w'(0)=0$，自由底端自然零弯矩 $M(1)=-Dw''(1)=0$、零剪力 $V(1)=-Dw'''(1)=0$）：
   $$P_{\text{kl}}(\xi) = \frac{1}{3}(6\xi^2 - 4\xi^3 + \xi^4), \qquad P_{\text{kl}}'(\xi) = \frac{4}{3}(3\xi - 3\xi^2 + \xi^3)$$
2. **简支气垫穹拱模态**（纸底下落压迫空气形成轻微中段穹拱，$w(0)=w(1)=0,\ M(0)=M(1)=0$）：
   $$P_{\text{air}}(\xi) = \frac{16}{5}(\xi - 2\xi^3 + \xi^4), \qquad P_{\text{air}}'(\xi) = \frac{16}{5}(1 - 6\xi^2 + 4\xi^3)$$

### 3.2 临界阻尼式 $C^1$ 时间包络（时长 `0.36s`）

令归一化进度 $u = t / T \in [0, 1],\ \text{inv} = 1 - u$：
- 头部落位残余：$\text{remPos}(u) = \text{inv}^{2.15}(1 + 0.50 u)$
- 主模态幅值：$q_{\text{kl}}(u) = \text{inv}^{1.60} e^{-0.50 u}(1 + 0.85 u)$
- 气垫模态幅值：$q_{\text{air}}(u) = \text{inv}^{1.80} e^{-1.10 u}(0.40 + 2.20 u)$
- 纸头倾角包络：$q_{\text{tilt}}(u) = \text{inv}^{1.85}(1 + 0.40 u)$
- 轻托抛物弧：$\Delta y_{\text{head}}(u) = \text{headDy}\cdot \text{remPos} + \text{arcLiftY}\cdot \sin(\pi u)\cdot \text{inv}^{1.45}$

### 3.3 两遍不可伸长薄壳积分（核心防拉长 / 防台阶公式）

对第 $i \in \{1,\dots,16\}$ 条纸带（$\xi_i = (i - 0.5) / 16$，基准段高 $\Delta s_0 = H / 16$）：

1. **第一遍（3D 离面法向与高程）**：
   $$\phi_i = \arctan\big(A_{\text{kl}} P_{\text{kl}}'(\xi_i) + A_{\text{air}} P_{\text{air}}'(\xi_i)\big), \qquad w_i = \sum_{k=1}^{i} \Delta s_0 \sin\phi_k$$
   $$\theta_i = \theta_{\text{head}} + \theta_{\text{oblique}} A_{\text{kl}} P_{\text{kl}}'(\xi_i) + \theta_{\text{twist}} q_{\text{air}} (\xi_i - 0.5)$$
   其中 $\theta_{\text{head}} > 0$（右手轻拿上右角顺放，左上角贴底不撞上方铭牌，右上角轻扬自然回落）。

2. **第二遍（严格不可伸长投影与纯透视平滑宽度）**：
   - **纯透视横向宽度**（彻底消除人为 `topPinch` 导致的右上角阶梯断层）：
     $$s_{x,i} = \text{clamp}\!\left(\frac{F_{\text{persp}}}{F_{\text{persp}} - (w_i - w_{\max})} \cdot (1 - \gamma q_{\text{kl}}),\; 0.95,\; 1.00\right), \quad F_{\text{persp}} = 4200$$
   - **外侧零拉长纵向步长护栏**：
     $$s_{y,i} = \text{clamp}\!\left(\min\!\Big(\cos\phi_i,\; 1 - \frac{\tfrac{1}{2}W s_{x,i}\cdot \max(|\Delta\theta_i|)}{\Delta s_0}\Big),\; 0.86,\; 1.00\right)$$
     保证无论在任意帧，纸张左/右两侧边缘折线总长均 **严格 $\le$ 静止纸高**（`stretch = 0.00px`），左下角绝不向下戳出。
   - **纯实色朗伯明暗**：
     $$\Delta L_i = \text{clamp}\big(13\sin\phi_i + 4(\cos\phi_i - 1),\; -8,\; +8\big)$$
     直接调制纸面/边框/内框的 `0xFFRRGGBB` 实色，零半透明叠片。

3. **内容与内框跟随**：
   - 内说明框/标题框条带与 4 个内容/角钉容器（`ptop / pbot / top / bot`）全部通过 `sample_chain(v)` 按自身相对高度插值纸带中心与切线角，保证纸面、内框、图钉、文字浑然一体。

---

## 4 状态机触发与交互边界

1. **触发键收窄**：动画触发键仅绑定**展示对象标识**（如商店选中道具 `pick or ""`、背包选中道具 ID），而不是整页文本哈希。
   - 切换道具、点取消切回默认介绍 → 触发覆纸动画；
   - 重复点击同一道具 → 不重播；
   - 商店购买全流程（未选道具提示、余额不足提示、弹出确认框、确认购买后持有数与状态文案刷新）→ **绝不触发动画**，但在稳态同步刷新快照，保证下次切换时旧纸持有数准确。
2. **首次进入静默**：首次切入商店/背包只记录基线快照，不播动画。
3. **连点无缝打断**：动画进行中再次切换时，旧纸层立刻接管上一份最新快照，新纸重置 `animT = 0` 并交替 `flip` 轻微变换落角。
4. **离页瞬时复位**：离开 `shop / bag` 时立刻执行 `snap_rest(page, true)`，逐叶子熄灭所有弯曲带与旧纸叶子并把新纸容器归位，且**不误点亮**静止底面，防切页闪烁。

---

## 5 离线调参与验收工具链（四道门禁）

### 门禁 1：离线 60 帧物理求解与 SVG 预览（改参数先跑这个）

```bash
node animation/tools/kirchhoff-paper-sim.mjs --preset=shop_card --audit --svg=out/shop.svg
node animation/tools/kirchhoff-paper-sim.mjs --preset=bag_note  --audit --svg=out/bag.svg
```

硬指标（任一不通过即 `exit 1`）：
- `zero_stretch`：全 60 帧左右边拉伸 `<= 0.01px`；
- `bottom_left_no_protrude`：左下角绝不低于静止底边；
- `top_left_clearance` / `top_right_clearance`：顶边绝不撞上方标题铭牌；
- `top_right_smooth_step`：相邻纸带半宽跳变 `<= 0.6px`（消除阶梯感）；
- `all_opaque_255`：全部条带 `alpha === 255`；
- `rest_convergence_u1`：`u = 1` 时所有条带与静止位误差 `< 1e-6`。

### 门禁 2：`.gil` 存档 6 道静态审计

```bash
node animation/tools/audit-gil-anim.mjs \
  --gil=<新存档.gil> --base=<基准存档.gil> \
  --prefix=econ.shop736.,econ.bag741. \
  --above=econ.shop736.s37, --strips=16
```

校验容器完备、16 段弯曲带齐全、新增装饰图元 100% 不透明且无禁止半透明节点、冷启动全隐藏、同父 `z-order` 层序正确、4 平台槽位静态世界坐标误差 `< 0.001px`。

### 门禁 3：Lua 语法 / 全局审计 + 高仿真沙箱回归

在主项目仓运行构建与仿真测试：
```bash
node tools/build_749.mjs --overwrite
lua tests/verify_749_paper_anim.lua <tree749.lua> <749_v8_内嵌脚本.lua> <out.json>
```
必须覆盖：冷启动 `home` 15 帧触发 `_enforce_hidden_subtrees` 后的逐叶子显隐、连点打断、购买全流程静默、`render(force)` 不覆盖动画变换、稳态 120 帧 0 次引擎 API 调用。

### 门禁 4：真机录屏逐帧核验

使用 `ffmpeg` 按 `30fps` 抽帧，重点核查：① 动画第 1~5 帧纸张整体底色像素数与静止帧一致（防隐身穿帮）；② 顶边与标题铭牌留白清晰；③ 右上角 4 倍放大无像素台阶；④ 左下角贴平不压底部按钮。

---

## 6 749（v1 → v8）实战踩坑实录（避免重踩）

| 版本 | 实机暴露的问题 | 根因 | 最终解法 |
|---|---|---|---|
| v1 | 整块展板连同标题一起动 | 未把标题/按钮与变化区域剥离 | v2 起将商店变化区独立框为 `468×530` 象牙纸卡，标题铭牌与按钮留在 `econ.ui742` 且层序居上 |
| v2 | 动画出现额外半透明叠片；购买时误触发动画 | 投影/扫光/卷角使用了半透明图元；触发键绑定全文本 | v3 彻底删除全部半透明节点（`semiTransparent = 0`）；触发键收窄为 `pick or ""` |
| v3 | 纸张移动像硬纸板、僵硬 | 单一刚体矩形四边笔直 | v4 改用 16 段等弧长柔性弯曲纸带 + 上/下内容分区跟随 |
| v4 | 真机动画期纸张底面整张隐身、新旧文字穿透重影 | `_enforce_hidden_subtrees` 冷启动逐叶子关灯，且真机容器 `SetVisible` 不级联 | v5 实现逐叶子显式开/关闭环 + 内部说明框/标题框同步切段弯曲 + 四角钉独立跟随 |
| v5 | 位移偏大、纸张上端偏平直 | 起手位移 `62–68px` | v6 收敛位移并加入上端形变反馈 |
| v6 | 左下角被明显拉长并向下戳近「取消」按钮 | 大面内弯曲角差 `16.9°` 造成外侧几何拉长 `(W/2)·Δθ ≈ +51px` | v7 改用 3D 离面俯仰投影 + 严格不可伸长外侧护栏，全帧 `0px` 拉伸 |
| v7 | 右上角发塌/微锯齿，左上角撞标题铭牌 | 负起始倾角顶撞铭牌 + 局部 `topPinch` 导致相邻条带半宽跳变近 `2px` | v8 引入**基尔霍夫薄板方程双模态解析解** + 右手正倾角轻放 + 纯透视光滑宽度（半宽跳变 `0.44px`） |
