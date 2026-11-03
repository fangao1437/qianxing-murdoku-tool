# 千星客户端控件 / 客户端脚本 API 笔记（多页点击式活动 UI 框架）

> 依据：官方客户端语料（10 篇，抓取时间 2026-09-25）。本文件只记录**文档原文可查**的内容；文档未写的统一进文末 `## 未查到`。
> 已核验来源：
> - 《客户端控件和客户端脚本》(mhbgxf0nynww)
> - 《客户端控件API文档》(mhtakr07vej4)
> - 《客户端控件容器》(mhlz2lrly3dq)
> - 《容器节点控件》(mh3qqq9xc102)
> - 《预设按钮控件》(mhdbkf04v6y8)
> - 《模板引用控件》(mhucb6reudwm)
> - 《光标检测区域控件》(mhd4fxr5v6la)
> - 《文本视窗控件》(mhv38jig94kk)
>
> 用法：本文件里出现的每个 API 名都是从文档表格/代码块原样抄下的；**没有出现的名字都当作不存在**，不要凭记忆补。

---

### 1. 控件类型与继承

- 全部 11 种具体控件都继承 `ClientUIBaseControl`（这是唯一的文档化基类，层级只有两层）  ——《客户端控件API文档》§12(1)继承关系
- 类型名 ↔ 控件名对照（运行时 `typeof`/类判断用左列）：`ClientUIImageControl`=图片，`ClientUITextBoxControl`=文本框，`ClientUITextWindowControl`=文本视窗，`ClientUIPresetButtonControl`=预设按钮，`ClientUICursorEventAreaControl`=光标检测区域，`ClientUIGridScrollerControl`=网格视窗，`ClientUIKeyHintControl`=按键提示，`ClientUIAnimationControl`=界面动效，`ClientUIFullscreenAnimationControl`=全屏动效，`ClientUIContainerControl`=容器节点，`ClientUIReferenceControl`=模板引用控件  ——《客户端控件API文档》§12(1)继承关系
- 编辑器/API 查询用的短名（`ContainerControl`、`TextBoxControl`、`TextWindowControl`、`ImageControl`、`UIAnimationControl`、`FullscreenUIAnimationControl`、`PresetButton`、`UIKeyHintControl`、`CursorEventArea`、`GridScrollerControl`、`ReferenceControl`）只是查接口的索引词，不是类名  ——《客户端控件和客户端脚本》§四.2 客户端控件资产
- 控件身份有两个索引：**模板索引**（`ControlPrefabIndex`，编辑期）与**运行时ID**（`controlId`，运行期）  ——《客户端控件和客户端脚本》§八.1(1)调用客户端控件的模板索引
- 字段名：`prefabIndex`（integer，只读，控件模板索引）与 `id`（integer，只读，运行时ID）  ——《客户端控件API文档》§13(1)字段
- **能否运行时创建**：只有「存为模板的客户端控件的**父节点**」可以被动态创建；「挂载在主屏中的客户端控件」以及「存为模板的客户端控件的**子节点**」都**不支持**通过脚本接口动态创建  ——《客户端控件和客户端脚本》§八.1(1)调用客户端控件的模板索引
- 因此框架的「页」只能做成**独立存为模板的控件（其根节点）**，页内子控件随模板一起生成，不能再单独实例化  ——《客户端控件和客户端脚本》§八.1(1)调用客户端控件的模板索引
- 客户端控件只能在「客户端控件容器」的画布设置或「客户端控件模板」中添加  ——《客户端控件和客户端脚本》§四.2 客户端控件资产
- 客户端脚本**只能**拿到客户端控件的模板索引；**服务器控件的模板索引无法被客户端脚本调用**  ——《客户端控件和客户端脚本》§八 客户端脚本的使用规则
- 11 类里**只有 `ClientUIPresetButtonControl` 与 `ClientUICursorEventAreaControl` 文档化了光标事件方法**；图片/文本框/容器节点等没有光标监听接口  ——《客户端控件API文档》§17(2) / §18(2) 方法

### 2. 客户端控件容器（服务端「客户端控件容器」）

- 「客户端控件容器」**本身是服务器控件**，作用是让客户端控件能在奇域关卡运行时正常显示  ——《客户端控件和客户端脚本》§四.1 服务器控件资产
- 界面布局中**不存在**客户端控件容器时，**所有客户端控件和挂载在控件上的脚本都无法正常运行和显示**  ——《客户端控件容器》§一 客户端控件容器的功能
- 所有客户端控件都必须在客户端控件容器内创建  ——《客户端控件和客户端脚本》§三 客户端控件使用方式
- 运行时**仅当**客户端控件所处的客户端控件容器状态处于**激活且可见**时，客户端控件和脚本才正常生效  ——《客户端控件和客户端脚本》§三 客户端控件使用方式
- 容器隐藏或关闭 → 其中的客户端控件无法正常显示  ——《客户端控件和客户端脚本》§三.3 创建客户端控件
- **销毁规则**：客户端容器控件隐藏或销毁时，**客户端控件被销毁**  ——《客户端控件和客户端脚本》§五.2 客户端控件和客户端容器控件的联动规则
- **脚本挂载规则**：脚本需要与客户端控件关联才能生效——在任意客户端控件的「脚本」页签中为该控件挂载客户端脚本  ——《客户端控件和客户端脚本》§七.3 将脚本与客户端控件关联
- 容器节点控件（客户端控件，可挂客户端脚本）职能是「其他客户端控件的挂点」，可使光标常驻显示、屏蔽按键和点击事件  ——《容器节点控件》§一 容器节点控件的功能
- 结论（框架层）：**容器是「显隐总闸」，页是容器内的控件**。切换页不能靠隐藏容器（会销毁整棵树），只能在容器内做页级显隐/增删  ——《客户端控件和客户端脚本》§五.2

### 3. 运行时创建与查找

```lua
game.InstantiateClientUIControl(controlPrefabIndex: integer, parent: ClientUIBaseControl)  -- -> ClientUIBaseControl
game.DestroyClientUIControl(control: ClientUIBaseControl)
game.GetClientUIControl(controlId: integer)  -- -> ClientUIBaseControl
game.FindClientUIRoot(nodeName: string)  -- -> ClientUIBaseControl
game.GetClientUIRoots()  -- -> ClientUIBaseControl[]
game.GetUICanvasSize()  -- -> x, y: number
game.GetCursorUIPos()  -- -> x, y: number
```
  ——《客户端控件API文档》§6(1)UI 与层级

- `InstantiateClientUIControl` 语义：根据已配置的控件模板索引，**在 parent 下**创建控件实例  ——《客户端控件API文档》§6(1)UI 与层级
- `parent` 参数为必填形态（签名里无 `?`/`|nil`），文档未描述省略或传 nil 的行为  ——《客户端控件API文档》§6(1)UI 与层级
- `GetClientUIRoots()` 返回**全部 UI 根控件**，文档括注为「即实际显示的客户端控件容器画布中的**默认容器节点**」→ 这是框架唯一的官方挂载根  ——《客户端控件API文档》§6(1)UI 与层级
- `FindClientUIRoot(nodeName)` 按**名称**查找 UI 根控件（只查根层）  ——《客户端控件API文档》§6(1)UI 与层级
- 控件树内查找只有三个接口：`GetChildren()`（直接子）、`GetChild(name)`（**名称为 name 的直接子控件**）、`FindChild(path)`（按路径）  ——《客户端控件API文档》§13(2)层级与可见性
- **没有全局/递归按名字查控件的接口**；页内控件定位必须走 `GetChild`/`FindChild` 或自建 name→control 缓存表  ——《客户端控件API文档》§13(2)层级与可见性
- 另一条官方绑定通道（编辑器配置，适合「每页一个脚本」）：客户端脚本变量-「客户端控件ID」，编辑时填**模板索引**，运行时脚本通过变量拿到该模板索引对应的**运行时ID**  ——《客户端控件和客户端脚本》§八.2 客户端脚本变量
- 取名一致性风险：`name` 字段可读**写**，改名后按名查找会失配  ——《客户端控件API文档》§13(1)字段
- 调试：`game.PrintClientUITree()` 把当前客户端控件树按父子层级写入日志  ——《客户端控件API文档》§3(2)日志和调试

### 4. 脚本生命周期

```lua
OnInit()            -- 脚本初始化时调用
OnStart()           -- 脚本启动时调用
OnEnable()          -- 脚本启用时调用
OnDisable()         -- 脚本停用时调用
OnUpdate(dt)        -- dt: number，脚本逐帧更新时调用，不受关卡时停影响
OnLevelUpdate(dt)   -- dt: number，关卡逐帧更新时调用，受关卡时停影响
OnDestroy()         -- 脚本销毁时调用
```
  ——《客户端控件API文档》§1 脚本生命周期

- 官方原话：「运行时按**固定名称**查找并调用下列生命周期回调函数」→ 回调是**全局函数名约定**，不靠 return table 注册  ——《客户端控件API文档》§1 脚本生命周期
- 「已保证」的范围：7 个名字与各自触发时机被文档化；上方顺序即文档表格顺序  ——《客户端控件API文档》§1 脚本生命周期
- **顺序/次数保证**：文档没有写「OnInit 必定早于 OnStart」「OnEnable 必定在首帧前」之类的顺序承诺  ——《客户端控件API文档》§1（未见声明，见 `## 未查到`）
- `OnUpdate` 与 `OnLevelUpdate` 的差别只在是否受关卡时停影响  ——《客户端控件API文档》§1 脚本生命周期
- 逐帧开关：`script:EnableUpdate(enabled: boolean)`，`false` 关闭、`true` 重新启用  ——《客户端控件API文档》§2 逐帧控制
- `script` 字段：`alive`(只读)、`scriptMappingId`(只读)、`object`(只读，脚本所挂载的**宿主对象**)、`path`(只读)、`enabled`(读写)  ——《客户端控件API文档》§5(1)字段
- `script.enabled`（脚本启用）与控件 `active`（控件激活）是两套开关，文档未给二者映射关系  ——《客户端控件API文档》§5(1) / §13(1)
- 控件侧取脚本：`GetScriptByPath(scriptPath)`、`GetScript(scriptMappingId)`、`GetScripts()`；文档要求「返回的脚本实例可能因销毁而不再存活，使用前检查 `script.alive`」  ——《客户端控件API文档》§13(4)脚本访问
- 脚本间调用：`script:Invoke(funcName: string, ...)` 调用当前脚本内名为 funcName 的**全局**函数；跨脚本用「脚本映射ID」`scriptMappingId`  ——《客户端控件API文档》§5(2) / 《客户端控件和客户端脚本》§八.1(2)调用脚本映射ID
- **模板实例化后哪些回调会在新实例上运行**：文档未写  ——《客户端控件API文档》§1（见 `## 未查到`）

### 5. 可见性 / 激活 / 启用

- `visible`：`boolean`，**只读**，官方说明「仅控制可见性，不改变激活状态或脚本逻辑运行状态」  ——《客户端控件API文档》§13(1)字段
- 写可见性必须走方法 `SetVisible(visible)`：「仅设置可见性，不改变激活状态，也不停止脚本逻辑」  ——《客户端控件API文档》§13(2)层级与可见性
- `active`：`boolean`，**只读**；`true` 时控件可见且挂载脚本逻辑运行，`false` 时控件**不可见且脚本逻辑停止运行**，**默认为 false**  ——《客户端控件API文档》§13(1)字段
- 写激活必须走方法 `SetActive(active)`：「关闭后控件不可见且挂载脚本逻辑停止运行」  ——《客户端控件API文档》§13(2)层级与可见性
- 父级继承：`activeInHierarchy` 是「计入**全部父级**后的实际激活状态」（只读）→ 激活状态**有层级继承语义**  ——《客户端控件API文档》§13(1)字段
- `visible` 是否随父级继承：文档只对 `active` 给了 `activeInHierarchy`，**没有**给可见性的层级计算结果  ——《客户端控件API文档》§13(1)（见 `## 未查到`）
- 容器级显隐 → 客户端控件**销毁**（不是变灰）：容器隐藏或销毁时客户端控件销毁  ——《客户端控件和客户端脚本》§五.2
- 脚本级停用：`script.enabled`(读写) 与 `script:EnableUpdate(false)`（只停 Tick，不等于停用脚本）  ——《客户端控件API文档》§5(1)(2)
- 控件**没有**文档化的 `alpha` 字段；半透明只能通过具体控件的颜色字段（如 `imageColor`、`fontColor`、`bgColor` 的 `ColorValue`）间接做  ——《客户端控件API文档》§13(1) / §14(1) / §15(1)（无 alpha，见 `## 未查到`）

### 6. 输入事件

```lua
AddCursorEventListener(eventType, callback)      -- 回调接收 CursorEventData
RemoveCursorEventListener(eventType, callback)
RemoveCursorEventListeners(eventType)
RemoveAllCursorEventListeners()
SimulateCursorClick()                            -- 按顺序模拟 CursorDown、CursorUp 与 CursorClick
```
  ——《客户端控件API文档》§17(2) / §18(2) 方法

```lua
AddKeyEventListener(eventType, callback)
RemoveKeyEventListener(eventType, callback)      -- 回调必须与注册时的引用相同
RemoveKeyEventListeners(eventType)
RemoveAllKeyEventListeners()

AddNavigationEventListener(eventType, callback)
RemoveNavigationEventListener(eventType, callback)
RemoveNavigationEventListeners(eventType)
RemoveAllNavigationEventListeners()
```
  ——《客户端控件API文档》§13(5)键鼠/手柄按键事件 / §13(6)手柄导航事件

- `CursorEventType` 八个值（顺序同文档）：`CursorDown` 按下、`CursorUp` 抬起、`CursorEnter` 进入检测区域、`CursorExit` 离开检测区域、`CursorDrag` 拖拽、`CursorBeginDrag` 开始拖拽、`CursorEndDrag` 结束拖拽、`CursorClick` **完成点击**  ——《客户端控件API文档》§11(7)Enum.CursorEventType
- 「点击」= `CursorClick`（完成点击）；框架的 onClick 应绑 `CursorClick`，不要绑 `CursorDown`  ——《客户端控件API文档》§11(7)
- `CursorEventData` 字段：`dragging`(只读，当前是否在拖拽)、`touchId`(只读，触点 ID)  ——《客户端控件API文档》§19(1)字段
- `CursorEventData` 方法：`GetUIPos()`（以**画布左下角**为原点，坐标比例和布局坐标一致）、`GetPressUIPos()`（按下时的坐标）、`GetUIPosDelta()`（本次事件位移）  ——《客户端控件API文档》§19(2)方法
- **前置条件（硬性）**：容器节点 `showCursor`「CursorEvent 相关方法都需设置该参数为真后才可正常使用」  ——《客户端控件API文档》§24(1)字段
- 命中前提：`raycastTarget`「可被光标射线检测」（`ClientUIPresetButtonControl`、`ClientUICursorEventAreaControl`、`ClientUIGridScrollerControl` 有该字段）  ——《客户端控件API文档》§17(1) / §18(1) / §20(1)
- 容器节点的三个穿透开关：`disableKeyEventPassthrough`（屏蔽按键事件穿透）、`disableCursorEventPassthrough`（屏蔽区域内点击事件穿透）、`isolateNavigation`（隔离手柄导航）  ——《客户端控件API文档》§24(1)字段
- 半官方语义解释（编辑器文案）：「屏蔽按键事件穿透：容器节点内的按键事件交互不会穿透到界面外」「屏蔽区域内光标事件穿透：容器节点内的点击事件不会穿透到界面外」→ 默认行为是**会穿透**  ——《容器节点控件》§二.1 功能设置
- `AddKeyEventListener` 的 boolean 契约：**回调返回 `boolean`**；官方原文「同一个容器中，如果交互按键事件被 lua 回调响应，并标记为已处理，容器内的其他按键不会也响应此次按键事件」→ 返回 true = 已消费，阻止容器内其他控件重复响应  ——《客户端控件API文档》§13(5)键鼠/手柄按键事件
- 按键事件传导顺序（官方明文）：「客户端按键事件按照控件的**渲染顺序**传递，**层级和排序靠前的控件响应优先级更高**」  ——《客户端控件和客户端脚本》§五.4 客户端按键事件响应规则
- 手柄导航前提：仅在当前界面存在**已聚焦控件**时才能响应手柄导航事件；当前界面若无已聚焦控件，**所有手柄导航事件无法正常触发和响应**  ——《客户端控件和客户端脚本》§五.5 手柄导航
- 因此手柄必须由脚本落地：用 `game.SetControllerFocus(control)` / `game.GetControllerFocus()` 规定界面默认选中控件；配合字段 `canControllerFocus`、方法 `SetControllerNavigation(navigationDir, navigationMode, navigationTarget)` / `GetControllerNavigation(navigationDir)`  ——《客户端控件和客户端脚本》§五.5(2)脚本配置方法 / 《客户端控件API文档》§6(2) / §13(7)
- 「点击子控件是否也触发父控件」：文档**没有**冒泡/捕获字样，只有容器级「穿透」开关  ——《客户端控件API文档》§24(1)（见 `## 未查到`）
- 长按：文档**没有**任何长按/双击/按住计时类光标事件或字段  ——《客户端控件API文档》§11(7) / §19（明确：无）
- 射线命中细节（后绘制者优先还是先绘制者优先、`raycastTarget=false` 是否阻断子控件）文档未写  ——《客户端控件API文档》（见 `## 未查到`）

### 7. 布局 API

- 读写**字段**（全部标注 Tweenable 者可直接做补间目标）：`anchoredPositionX/Y` 位置、`sizeDeltaX/Y` 大小差异、`anchorMinX/Y` 最小锚点、`anchorMaxX/Y` 最大锚点、`pivotX/Y` 中心、`localScaleX/Y/Z`、`localRotationX/Y/Z`  ——《客户端控件API文档》§13(1)字段
- 取/设方法成对存在：`GetAnchoredPosition/SetAnchoredPosition`、`GetSizeDelta/SetSizeDelta`、`GetAnchorMin/SetAnchorMin`、`GetAnchorMax/SetAnchorMax`、`GetPivot/SetPivot`、`GetLocalScale/SetLocalScale`、`GetLocalRotation/SetLocalRotation`;`GetSizeDelta()`/`GetAnchoredPosition()` 返回 `x, y` 两个值  ——《客户端控件API文档》§13(3)布局与变换
- **原点/父子相对语义（官方原文）**：`GetAnchoredPosition()`「无父层级时，以**画布左下**为原点获取位置；存在父层级时，获取与**父层级中心**的相对偏移」；`SetAnchoredPosition(x, y)` 同构  ——《客户端控件API文档》§13(3)布局与变换
- 坐标系与千星世界坐标一致（左下原点、Y 向上），与 HTML/CSS 的左上原点、Y 向下**相反**  ——《客户端控件API文档》§13(3) / §19(2)
- 画布尺寸：`game.GetUICanvasSize()` → `x, y: number`;光标位置：`game.GetCursorUIPos()` → `x, y`  ——《客户端控件API文档》§6(1)UI 与层级
- 官方警告：「父子层级中的位移、缩放、可见性、Alpha、镜像与裁剪效果由运行时 UI 层级共同决定；使用**组合布局**时应**验证实际显示结果**」  ——《客户端控件API文档》§13(3)布局与变换
- **读取控件屏幕矩形**：没有 `GetRect`/`GetWorldPosition`/`GetScreenRect` 之类接口；只能由 `GetAnchoredPosition` + `GetSizeDelta` + `GetPivot` 自行推算  ——《客户端控件API文档》§13(3)（见 `## 未查到`）
- 控件方法的**调用语法**（`control:SetVisible()` 还是 `control.SetVisible()`）文档表格只写方法名，未给示例  ——《客户端控件API文档》§13（见 `## 未查到`）

### 8. 文本 / 图片 / 按钮

```lua
SetImage(imageSource, imageId)
SetFillUnused()
SetFillHorizontal(fillHorizontalType, fillAmount)
SetFillVertical(fillVerticalType, fillAmount)
SetFillRadial90(fillRadial90Type, fillAmount)
SetFillRadial180(fillRadialType, fillAmount)
SetFillRadial360(fillRadialType, fillAmount)
```
  ——《客户端控件API文档》§14(2)方法

- 文本：`text`（`string`，读写）；`fontSize`（**`integer`**，读写，Tweenable）→ **字号必须给整数**，传小数不符类型  ——《客户端控件API文档》§15(1) / §16(1)
- 字号自适应：`adaptiveFontSize`(boolean)、`minimumFontSize`(`integer`, Tweenable)  ——《客户端控件API文档》§15(1)
- 文本颜色/对齐：`fontColor`、`bgColor`、`enableOutline`、`outlineColor`、`horizontalAlignment`、`verticalAlignment`  ——《客户端控件API文档》§15(1)
- 文本视窗额外字段就只有 `interactable`、`showScrollBar`（其余与文本框同）；且「`interactable` 与 `showScrollBar` 同时为 `false` 时，手柄无法滚动文本视窗」  ——《客户端控件API文档》§16(1)
- 图片：`SetImage(imageSource, imageId)` 设图片来源与 ID；`imageSource`、`imageId` 均**只读**（换图只能走方法）  ——《客户端控件API文档》§14(1)(2)
- `Enum.ImageSource` 八值：`StaticReference` 静态引用、`Item` 道具、`Equipment` 装备、`Skill` 技能、`UnitStatus` 单位状态、`Faction` 阵营、`Currency` 货币、`Prefab` 元件  ——《客户端控件API文档》§11(17)Enum.ImageSource
- 图片其它可读写：`imageColor`、`imageType`(`Basic`/`Stretch`)、遮罩系列（`enableMask`、`enableSoftEdge`、`softEdgeMode`、`softEdgeWidthX/Y`、`horizontalSoftRange`、`verticalSoftRange`、`reverseMaskArea`）、填充系列（`fillType`、`fillHorizontalType`、`fillVerticalType`、`fillRadial90Type`、`fillRadialType`、`fillAmount`）  ——《客户端控件API文档》§14(1)字段
- 预设按钮**只有三个字段**：`interactable`（是否可交互）、`clickAudioId`（点击音效 ID）、`raycastTarget`（可被光标射线检测）  ——《客户端控件API文档》§17(1)字段
- `clickAudioId` 与编辑器「音效」项对应：按钮发生按下交互事件时播放已配置的对应音效  ——《预设按钮控件》§三.1(4)音效
- `interactable` 对应编辑器「按钮是否可用」：决定与按钮交互时，**是否能正常触发按钮关联的节点和客户端脚本**  ——《预设按钮控件》§三.1(2)按钮是否可用
- 预设按钮四态**是编辑器概念**，官方状态名为：默认（无交互）、悬停（键鼠指针悬停）、按下（键鼠或触屏按下）、不可用（「按钮是否可用」开关关闭时）；每态可引用相同或不同的子控件  ——《预设按钮控件》§三.1(3)按钮状态节点
- **`unavailableChildId` / `hoverChildId` / `pressedChildId` / `selectedChildId` 这类字段名在客户端语料中不存在**；API 的 `ClientUIPresetButtonControl` 只暴露上述三个字段，四态引用无脚本文段  ——《客户端控件API文档》§17(1)（见 `## 未查到`）
- 注意：官方四态里**没有「选中/selected」态**，任何 `selected*` 命名都需自行实现（例如用控件显隐模拟）  ——《预设按钮控件》§三.1(3)
- 光标检测区域字段只有 `raycastTarget`；用途是「可接收光标射线事件的区域，例如：可以与图片，文本框控件一起组成一个最基础的按钮」→ 这是框架做通用热区/按钮的正解  ——《客户端控件API文档》§18 / 《光标检测区域控件》§一
- 模板引用控件字段只有 `referencedPrefabIndex`（只读）；语义「引用已存为客户端模板的控件，运行时模板引用控件的功能和表现与被引用模板一致」→ 可作为「页容器」的轻量替代  ——《客户端控件API文档》§25 / 《模板引用控件》§二.1 模板引用

### 9. 客户端 ↔ 服务器桥

```lua
local sig = game.ServerSignal(signalName)            -- signalName: string，使用服务器约定的信号名称
sig:AddInt(intValue: integer)                        -- 以及 AddIntList/AddFloat/AddFloatList/AddString/
                                                     -- AddStringList/AddVector3/AddVector3List/AddBool/AddBoolList/
                                                     -- AddGuid/AddGuidList/AddEntity/AddEntityList/
                                                     -- AddPrefabId/AddPrefabIdList/AddConfigId/AddConfigIdList
sig:AddParam(paramType: ParamType, paramValue: any)  -- 通用形态
sig:SendSignal()                                     -- 发送已构建的服务器信号
```
  ——《客户端控件API文档》§9 ServerSignal

```lua
script:RegisterServerSignalHandler(signalName: string, callback: fun(signalName: string, signalParams: any[]))
script:UnregisterServerSignalHandler(signalName: string)
script:RegisterCustomVariableChangedHandler(entityType: CustomVariableEntityType, customVariableName: string,
    callback: fun(entityType: CustomVariableEntityType, customVariableName: string))
script:UnregisterCustomVariableChangedHandler(entityType: CustomVariableEntityType, customVariableName: string)
game.GetGlobalCustomVariableValue(entityType: CustomVariableEntityType, customVariableName: string)  -- -> any
```
  ——《客户端控件API文档》§5(2)方法 / §6(3)

- 上行（客户端→服务器）：客户端脚本通过 `ServerSignal:SendSignal()` 方法向服务器发送信号，并通过 ServerSignal 相关方法为信号添加不同参数  ——《客户端控件和客户端脚本》§五.1 客户端和服务器的通信规则
- 下行（服务器→客户端）：通过服务器节点【发送客户端脚本信号】向客户端脚本发送信号，客户端脚本用 `RegisterServerSignalHandler` 监听  ——《客户端控件和客户端脚本》§五.1 客户端和服务器的通信规则
- **信号延迟（官方明文）**：「联机情况下，服务器发送信号的**延迟最低为 100ms**」→ 每次点击往返 ≥100ms，UI 反馈必须本地先行  ——《客户端控件和客户端脚本》§五.1
- **变量变化回调不带新值**：回调仅提供「实体类型」和「变量名称」，当前值需通过 `game.GetGlobalCustomVariableValue` 再读一次  ——《客户端控件API文档》§5(2)方法（表格说明列原文如此）
- `Enum.CustomVariableEntityType` 三个值：`Level` 关卡、`PlayerSelf` 玩家自身、`AvatarSelf` 角色自身  ——《客户端控件API文档》§11(2)Enum.CustomVariableEntityType
- `GetGlobalCustomVariableValue` 支持复杂变量结构（列表、字典、结构体）  ——《客户端控件API文档》§6(3)
- **客户端 Lua 没有任何写自定义变量的接口**：`game` 表与 `Script` 表的全部方法中只存在 Get/Register 形态，不存在 Set/Write 形态  ——《客户端控件API文档》§5(2) / §6（反向核对，见 `## 未查到`）
- `Enum.ParamType` 覆盖信号参数类型：`Entity/EntityList/Int/IntList/Bool/BoolList/Float/FloatList/String/StringList/Vector3/Vector3List/Guid/GuidList/ConfigId/PrefabId/ConfigIdList/PrefabIdList`  ——《客户端控件API文档》§11(6)Enum.ParamType
- 本地化文本：`game.GetText(textMapId: string)` → `string`，配合「多语言文本管理-脚本文本变量」的 TextmapID  ——《客户端控件API文档》§6(4) / 《客户端控件和客户端脚本》§五.6
- 音频：`game.PlayAudio2D(audioId)` 返回音效实例 ID;`game.StopAudio(audioInstanceId)`、`game.IsAudioAlive(audioInstanceId)`  ——《客户端控件API文档》§6(4)

### 10. 同级顺序 / 绘制顺序 / 事件优先级

- `GetSiblingIndex()` → `integer`，范围 0 到父控件子控件数量减一  ——《客户端控件API文档》§13(2)层级与可见性
- `SetSiblingIndex(index)` → `boolean`，index 同范围;**「数值越大通常越靠后、显示越靠上」**  ——《客户端控件API文档》§13(2)层级与可见性
- `SetAsFirstSibling()` → `boolean`、`SetAsLastSibling()` → `boolean`  ——《客户端控件API文档》§13(2)
- 文档**没有** `moveSibling`/`SetAsLastSibling` 之外的搬移 API，也没有 z-order 数值字段;层级调整只有这四个接口  ——《客户端控件API文档》§13(2)
- 按键事件与绘制顺序同向：「按控件的渲染顺序传递，层级和排序靠前的控件响应优先级更高」  ——《客户端控件和客户端脚本》§五.4
- **警告（官方原话）**：「复用列表生成的列表项**不保证同级排序结果稳定**」→ 网格视窗里的项不能靠 siblingIndex 做逻辑  ——《客户端控件API文档》§13(2)
- 动效层级枚举：`Enum.UIAnimationLayer` → `AboveAllControls`（所有控件之上）/ `BelowAllControls`（所有控件之下）  ——《客户端控件API文档》§11(24) / §22(1)
- 光标点击的命中优先规则（与 siblingIndex 的关系）文档未写  ——《客户端控件API文档》（见 `## 未查到`）

### 11. 官方明示的坑

- **`game` 是全局表，以下函数均使用点号调用**（不是 `game:xxx()`）  ——《客户端控件API文档》§6 game
- **`active` 默认 false**：字段说明写「默认为 false」→ 运行期新建/初始控件若不显式 `SetActive(true)`，控件不可见且脚本逻辑不跑  ——《客户端控件API文档》§13(1)字段
- `visible`、`active` 都是**只读字段**，赋值无效，必须调 `SetVisible`/`SetActive`  ——《客户端控件API文档》§13(1)(2)
- **传送/断线重连**：玩家传送、断线重连时**所有客户端控件都会被销毁然后回到初始状态**；若要保留传送前界面，需奇匠自行处理界面恢复逻辑  ——《客户端控件和客户端脚本》§五.3 客户端控件断线重连的处理
- 容器一隐藏就销毁控件 → 不要把「隐藏容器」当页面切换手段  ——《客户端控件和客户端脚本》§五.2
- **脚本上传规则**：只有在千星沙箱里建立了**映射**的 lua 文件才会被打包上传;仅本地创建未建映射的脚本运行时不会上传  ——《客户端控件和客户端脚本》§七.3
- 循环调用可致「进关加载变久或卡死，且正常日志无法报告此情况」;本地日志路径与客户端脚本储存路径一致，文件名 `ErrorLog.txt`（仅在正常日志无法报告时创建）  ——《客户端控件和客户端脚本》§五.8(2)本地日志
- 运行时环境是 **Lua 5.3**；不可用：`string.dump`、`io.*`、`coroutine.*`、除 `os.time/os.date/os.clock/os.difftime` 外的 `os.*`、除 `debug.traceback` 外的 `debug.*`  ——《客户端控件API文档》§三 运行环境
- 补充库：`math.isnan(n)`、`math.isinf(n)`;日志 `print(...)`/`printerr(...)` 均不阻断运行;`debug.traceback` 只返回文本不写日志  ——《客户端控件API文档》§3(2)(3)
- 移除监听必须传**同一函数引用**（`RemoveKeyEventListener` 文档明文）→ 匿名函数一次性注册会泄漏监听  ——《客户端控件API文档》§13(5)
- 服务器控件的模板索引无法被客户端脚本调用 → 客户端脚本无法操作任何服务器控件（包括客户端控件容器本身）  ——《客户端控件和客户端脚本》§八
- 手柄：没有已聚焦控件时所有导航事件不响应;编辑器无法配全，必须脚本 `SetControllerFocus`  ——《客户端控件和客户端脚本》§五.5
- 组合布局（锚点+尺寸+缩放+裁剪）结果由运行时层级共同决定，官方要求实测验证  ——《客户端控件API文档》§13(3)

---

## 框架依赖清单

| 能力 | 官方是否明确 | 依据一节 | 若缺失的风险 |
| --- | --- | --- | --- |
| 页挂载根（容器画布默认容器节点） | 明确 | 《客户端控件API文档》§6(1) `GetClientUIRoots` | 根取空 → 整页不显示且无报错线索 |
| 运行时按模板创建一页 | 明确（含限制） | 《客户端控件和客户端脚本》§八.1(1) | 拿主屏控件或模板子节点去 Instantiate → 创建失败 |
| 销毁一页 | 明确 | 《客户端控件API文档》§6(1) `DestroyClientUIControl` | 泄漏控件树，重进页面叠影 |
| 按名字定位页内控件 | 部分明确（仅 `GetChild`/`FindChild`） | 《客户端控件API文档》§13(2) | 无全局查找 → 需自建 name→control 缓存 |
| 页显隐（不销毁） | 明确 | 《客户端控件API文档》§13(2) `SetVisible`/`SetActive` | `active` 默认 false，忘了 SetActive(true) 就是白屏 |
| 页脚本初始化时机 | 部分明确（回调存在，顺序未承诺） | 《客户端控件API文档》§1 | OnInit/OnStart 依赖顺序 → 首帧取到 nil |
| 点击事件 | 明确（仅 PresetButton / CursorEventArea 有） | 《客户端控件API文档》§17(2)/§18(2) | 用图片/文本框当按钮 → 永远收不到点击 |
| 光标常驻前提 | 明确 | 《客户端控件API文档》§24(1) `showCursor` | 不设 true → 全部 CursorEvent 失效 |
| 键盘事件 + 消费语义 | 明确（回调返回 boolean） | 《客户端控件API文档》§13(5) | 多处监听重复触发、翻页键穿透到下层 |
| 手柄导航可用性 | 部分明确（必须先有聚焦控件） | 《客户端控件和客户端脚本》§五.5 | 不 `SetControllerFocus` → 手柄全失效 |
| 布局读写 | 明确（字段 + Get/Set 成对） | 《客户端控件API文档》§13(1)(3) | 把 HTML 左上原点坐标直接搬进来 → Y 方向全反 |
| 读取控件屏幕矩形 | 未文档化 | 《客户端控件API文档》§13(3) | 命中判定/拖拽锚点需自行用位置+尺寸+中心推算 |
| 服务器信号上行 | 明确 | 《客户端控件API文档》§9;信号延迟见《客户端控件和客户端脚本》§五.1 | 点击后等服务器回包再改 UI → 手感 ≥100ms 卡顿 |
| 自定义变量读取/监听 | 明确（回调不带值） | 《客户端控件API文档》§5(2)/§6(3) | 以为回调带值 → 拿到 nil |
| 自定义变量写入 | 未文档化（客户端无 setter） | 《客户端控件API文档》§5/§6 | 误以为 Lua 能写 → 逻辑架构需改成「信号上行 + 服务端节点图写」 |
| 页内绘制/命中顺序 | 明确（sibling index） | 《客户端控件API文档》§13(2) | 弹窗被遮/被下层抢事件 |
| 父级激活继承 | 明确（`activeInHierarchy`） | 《客户端控件API文档》§13(1) | 隐藏父节点后子脚本静默停跑，误判为「逻辑没触发」 |
| 页可见性继承 | 未文档化 | 《客户端控件API文档》§13(1) | 只用 `SetVisible` 做页切换时，子控件是否跟随需实测 |
| 传送/重连后界面恢复 | 明确要求自行处理 | 《客户端控件和客户端脚本》§五.3 | 传送回来白屏，玩家以为卡死 |
| 四态按钮子控件脚本文段 | 未文档化 | 《预设按钮控件》§三.1(3) | 想用脚本改「悬停/按下」样式 → 无接口，只能自己用显隐/贴图模拟 |
| 长按 / 双击 | 未文档化 | 《客户端控件API文档》§11(7)/§19 | 需求写「长按 0.5s」→ 只能自己在 CursorDown/Up 间计时 |

---

## 未查到

以下是客户端 10 篇语料里**没有**给出答案、必须去模拟器/实机验证或另找官方渠道的问题：

1. **生命周期严格顺序**：`OnInit → OnStart → OnEnable` 的先后与「是否只调用一次」没有任何顺序声明（只有表格罗列）。
2. **模板实例化后的回调范围**：`InstantiateClientUIControl` 生成的实例，其模板内脚本会跑哪些回调（OnInit？OnEnable？还是全部）。
3. **控件方法调用语法**：文档表格只写 `SetVisible(visible)` 形态，未示例 `control:SetVisible()` 还是 `control.SetVisible()`。
4. **控件级 `alpha`**：没有透明度字段，只有各具体控件的颜色字段；整体淡入淡出是否只能靠 `localScale`/颜色。
5. **读取控件屏幕矩形**：无 `GetRect` / `GetWorldPosition` / `GetScreenRect` 类接口。
6. **光标命中规则**：`raycastTarget=false` 的父控件是否阻断子控件命中;多层重叠时按 siblingIndex 正向还是反向命中;`CursorEnter/Exit` 是否会重复触发。
7. **点击是否冒泡**：子控件收到 `CursorClick` 后父控件是否也收到（只有容器级「穿透到界面外」开关）。
8. **长按 / 双击 / 惯性拖拽阈值**：无任何相关事件或字段（`CursorDrag`/`CursorBeginDrag`/`CursorEndDrag` 存在，但无长按语义）。
9. **控件数量上限 / 树深度上限**：语料无数字。
10. **字符串长度上限**：`text`、信号 `String` 参数均未给上限。
11. **「Lua 不能写自定义变量」的明文条款**：只有「客户端 API 无 setter」这一反向证据，没有一句官方禁止原文。
12. **每帧性能红线**：无官方性能警告（未说 OnUpdate 里禁止 Instantiate / 改布局 / 查树）。
13. **`visible` 的层级继承**：只说了 `activeInHierarchy`，未说父 `SetVisible(false)` 是否让子控件不可见。
14. **`GetUICanvasSize` 的适配语义**：是否随设备/分辨率变化、坐标是否需自行缩放、PC 16:9 与手机 19.5:9 的差异如何处理。
15. **`AddCursorEventListener` 回调签名**：只写「回调接收 `CursorEventData`」，未给形参个数（`fun(data)` 还是 `fun(eventType, data)`）。
16. **`id` 复用**：`DestroyClientUIControl` 后运行时 ID 是否回收复用;`GetClientUIControl(id)` 失效判定。
17. **`SetSiblingIndex` 返回 boolean 的含义**：成功/失败还是「是否需要重排」。
18. **服务器信号的名称与参数约定在何处配置**：文档只说「服务器约定的信号名称」，未给配置入口或校验规则。
19. **多页框架的官方推荐做法**：语料没有任何「页面栈 / 翻页 / 屏幕栈」模式或样例工程说明（官方教程 GIA 资产不在本语料内）。
20. **`GetClientUIRoots()` 多容器顺序**：存在多个客户端控件容器时，返回数组的顺序与稳定性。
