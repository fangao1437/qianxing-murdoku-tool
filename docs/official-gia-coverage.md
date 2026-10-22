# 官方/社区 `.gia` 样本覆盖度报告

> 由 `node src/coverage.mjs --in=assets` 生成。**别手改**，改了下次跑就没了。
> 证据标签口径：`[实测]` 跑出来的 / `[推断]` 有依据没验证 / `UNKNOWN` 真不知道。

## 0. 这份报告在回答什么

我们的「节点图 → 规格/IR」读取算法（`giaread.mjs`）和「规格 → gts 源码」翻译算法（`read2spec.mjs` + `emit.mjs`）
到底能覆盖官方图多少？哪些地方一碰就碎？这份报告用 5 份真实样本给出**可复现的数字**。

## 1. 样本读数表　[实测]

命令：`node src/coverage.mjs --in=assets --md=docs/official-gia-coverage.md`

| # | 样本 | 字节 | 单元(which) | 节点图 | 节点定义(复合) | 节点 | 连线(执行/数据) | 图变量 | 信号 | 复合引用 | 未知类型 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | `fall-protect`<br>保护玩家防止坠崖掉落自动传送.gia | 1010 | 7×1 9×1 | 1 | 0 | 7 | 8（2/6） | — | — | 0 | 0 |
| 2 | `composite-atlas`<br>常用复合节点大全v1.7(补充包同步更新中).gia | 160021 | 9×87 12×87 | 87 | 87 | 473 | 523（77/446） | `time` | — | 52 | 0 |
| 3 | `projectile-coords`<br>实时获取投射物坐标（最快每0.06s获取一次）.gia | 10407 | 9×4 12×3 | 4 | 3 | 34 | 42（2/40） | — | — | 6 | 0 |
| 4 | `disconnect-detect`<br>玩家掉线检测、重连检测、断网检测.gia | 19777 | 9×2 12×5 14×4 15×1 21×1 69×1 | 2 | 9 | 33 | 37（14/23） | `NOLOC_isDisconnect` | `[玩家]检测掉线-心跳包` `[玩家]检测掉线-广播信号` | 4 | 0 |
| 5 | `double-jump`<br>只按空格实现二段跳.gia | 21607 | 1×1 9×1 18×1 19×1 | 1 | 0 | 40 | 60（20/40） | `平台` | — | 0 | 0 |

### 逐份结论

#### fall-protect —— `保护玩家防止坠崖掉落自动传送.gia`

最简单的官方图（7 节点）—— 反向回编译主用例

- 单元：2 个（which=7×1，which=9×1）　[实测]
- 信封：header=[1006, 1, 806, 3, 986]，body=986 B，trailer=4 B　[实测]

| 图 | graphId | 节点 | 连线 | 执行/数据 | 复合引用 | 未知 | 可译 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 坠崖保护 | 1073741845 | 7 | 8 | — | — | — | ❌ MULTI_OUT_PIN/CROSS_HANDLER_REF ⚠️1 |

#### composite-atlas —— `常用复合节点大全v1.7(补充包同步更新中).gia`

87 个复合节点定义 + 87 张实现图

- 单元：174 个（which=9×87，which=12×87）　[实测]
- 信封：header=[160017, 1, 806, 3, 159997]，body=159997 B，trailer=4 B　[实测]
- 节点定义（复合节点）：**87** 个；其中 80 个能对上实现图（graphId == guid）　[实测]

| 图 | graphId | 节点 | 连线 | 执行/数据 | 复合引用 | 未知 | 可译 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| [随机]范围内取随机点（矩形） | 1073741825 | 11 | 10 | — | — | — | ❌ NO_TRIGGER_ROOT |
| [时间]等待时间/延时 | 1073741849 | 6 | 5 | — | — | — | ❌ CONTROL_FLOW_NODE |
| [变量]节点图变量自减-浮点数 | 1073741857 | 3 | 2 | — | — | — | ❌ NO_TRIGGER_ROOT |
| [时间]自身定时器触发时 | 1073741856 | 3 | 3 | — | — | — | ❌ CONTROL_FLOW_NODE |
| [变量]更新时间 | 1073741855 | 2 | 1 | — | — | — | ❌ COMPOSITE_NODE/NO_TRIGGER_ROOT |
| [时间]获取关卡计时器时间 | 1073741852 | 2 | 1 | — | — | — | ❌ COMPOSITE_NODE/NO_TRIGGER_ROOT |
| [查询]获取关卡实体 | 1073741853 | 1 | 0 | — | — | — | ❌ NO_TRIGGER_ROOT |
| [时间]定时器设置与触发 | 1073741834 | 5 | 4 | — | — | — | ❌ CONTROL_FLOW_NODE |
| [事件]指定实体创建时 | 1073741854 | 3 | 3 | — | — | — | ❌ UNKNOWN_CONSTANT/CROSS_HANDLER_REF |
| [遍历]遍历场上特定实体 | 1073741835 | 5 | 5 | — | — | — | ❌ NO_DSL_NAME/NO_METHOD/NO_TRIGGER_ROOT |
| [时间]循环数据更新 | 1073741851 | 12 | 10 | — | — | — | ❌ COMPOSITE_NODE/MISSING_ARG/CROSS_HANDLER_REF |
| [变量]自定义变量自增-整数 | 1073741836 | 3 | 2 | — | — | — | ❌ NO_TRIGGER_ROOT |
| [执行]角色碰撞死亡 | 1073741843 | 2 | 2 | — | — | — | ✅ |
| [查询]查询场上指定元件的实体 | 1073741839 | 3 | 2 | — | — | — | ❌ NO_TRIGGER_ROOT |
| [变量]节点图变量自增-整数 | 1073741844 | 3 | 2 | — | — | — | ❌ NO_TRIGGER_ROOT |
| [查询]序号获取玩家及对应角色 | 1073741845 | 4 | 3 | — | — | — | ❌ NO_TRIGGER_ROOT |
| [随机]获取随机玩家 | 1073741838 | 5 | 5 | — | — | — | ❌ NO_TRIGGER_ROOT |
| [查询]在场玩家数量 | 1073741846 | 2 | 1 | — | — | — | ❌ NO_TRIGGER_ROOT |
| [变量]自定义变量自减-整数 | 1073741847 | 3 | 2 | — | — | — | ❌ NO_TRIGGER_ROOT |
| [遍历]遍历场上角色 | 1073741837 | 4 | 3 | — | — | — | ❌ NO_TRIGGER_ROOT |
| [运算]获得特定浮点数 | 1073741848 | 1 | 0 | — | — | — | ❌ NO_TRIGGER_ROOT |
| [变量]节点图变量自增-浮点数 | 1073741832 | 3 | 2 | — | — | — | ❌ NO_TRIGGER_ROOT |
| [查询]获取目标实体的指定变量 | 1073741872 | 2 | 1 | — | — | — | ❌ NO_TRIGGER_ROOT |
| [执行]结算展示处理 | 1073741850 | 6 | 5 | — | — | — | ❌ NO_TRIGGER_ROOT |
| [遍历]遍历场上玩家 | 1073741842 | 2 | 1 | — | — | — | ❌ NO_TRIGGER_ROOT |
| [查询]通过玩家查询对应角色 | 1073741840 | 3 | 2 | — | — | — | ❌ NO_TRIGGER_ROOT |
| [运算]获得特定整数 | 1073741858 | 1 | 0 | — | — | — | ❌ NO_TRIGGER_ROOT |
| [执行]延时销毁 | 1073741833 | 4 | 3 | — | — | — | ❌ COMPOSITE_NODE/NO_TRIGGER_ROOT |
| [变量]自定义变量自减-浮点数 | 1073741859 | 3 | 2 | — | — | — | ❌ NO_TRIGGER_ROOT |
| [运算]数值是否在闭区间内-整数 | 1073741864 | 3 | 2 | — | — | — | ❌ NO_TRIGGER_ROOT |
| [运算]多次或运算 | 1073741871 | 3 | 2 | — | — | — | ❌ NO_TRIGGER_ROOT |
| [随机]随机百分比判定 | 1073741826 | 3 | 1 | — | — | — | ❌ NO_TRIGGER_ROOT |
| [运算]同或运算 | 1073741870 | 5 | 4 | — | — | — | ❌ NO_TRIGGER_ROOT |
| [运算]数值是否在开区间内-整数 | 1073741869 | 3 | 2 | — | — | — | ❌ NO_TRIGGER_ROOT |
| [执行]隐藏玩家模型 | 1073741827 | 2 | 2 | — | — | — | ✅ |
| [运算]多次与运算 | 1073741868 | 3 | 2 | — | — | — | ❌ NO_TRIGGER_ROOT |
| [查询]指定范围筛选玩家 | 1073741860 | 5 | 2 | — | — | — | ❌ NO_TRIGGER_ROOT |
| [事件]任一玩家退出时2 | 1610612740 | 4 | 4 | — | — | — | ❌ UNKNOWN_CONSTANT/CROSS_HANDLER_REF |
| [遍历]遍历范围内特定实体 | 1073741830 | 2 | 1 | — | — | — | ❌ COMPOSITE_NODE/NO_TRIGGER_ROOT |
| [查询]指定范围筛选实体 | 1073741831 | 6 | 3 | — | — | — | ❌ NO_DSL_NAME/NO_METHOD/NO_TRIGGER_ROOT |
| [变量]节点图变量自减-整数 | 1073741863 | 3 | 2 | — | — | — | ❌ NO_TRIGGER_ROOT |
| [随机]权重随机-5位 | 1073741861 | 2 | 1 | — | — | — | ❌ NO_TRIGGER_ROOT |
| [变量]自定义变量自增-浮点数 | 1073741841 | 3 | 2 | — | — | — | ❌ NO_TRIGGER_ROOT |
| [事件]玩家点击交互/道具按钮 | 1073741829 | 3 | 3 | — | — | — | ❌ CONTROL_FLOW_NODE |
| [运算]数值是否在开区间内-浮点 | 1073741865 | 3 | 2 | — | — | — | ❌ NO_TRIGGER_ROOT |
| [技能]技能资源随时间增加 | 1073741866 | 7 | 7 | — | — | — | ❌ COMPOSITE_NODE/NO_TRIGGER_ROOT |
| [执行]对在场玩家分数排名1 | 1073741828 | 18 | 29 | — | — | — | ❌ NO_DSL_NAME/NO_METHOD/NO_TRIGGER_ROOT |
| [随机]矩形区域内随机位置刷元件 | 1073741867 | 3 | 2 | — | — | — | ❌ COMPOSITE_NODE/NO_TRIGGER_ROOT |
| [事件]任一玩家退出时1 | 1610612739 | 9 | 8 | — | — | — | ❌ COMPOSITE_NODE/MULTI_OUT_PIN |
| [执行]脱离卡死传送玩家至预设点 | 1610612738 | 5 | 7 | — | — | — | ❌ MISSING_ARG/CONTROL_FLOW_NODE/CROSS_HANDLER_REF |
| [随机]随机执行一个节点-5位 | 1610612748 | 3 | 2 | — | — | — | ❌ NO_TRIGGER_ROOT |
| (无名) | 1610612741 | 9 | 11 | — | — | — | ❌ COMPOSITE_NODE/NO_TRIGGER_ROOT |
| [执行]销毁指定元件的所有实体1 | 1610612743 | 4 | 4 | — | — | — | ❌ NO_TRIGGER_ROOT |
| (无名) | 1610612742 | 6 | 5 | — | — | — | ❌ NO_TRIGGER_ROOT |
| [查询]以序号查询玩家/角色实体 | 1610612745 | 2 | 1 | — | — | — | ❌ NO_TRIGGER_ROOT |
| [执行]角色高度处于特定范围即死 | 1610612744 | 3 | 3 | — | — | — | ❌ NO_TRIGGER_ROOT |
| [执行]在某实体相对位置生成元件 | 1610612746 | 2 | 1 | — | — | — | ❌ COMPOSITE_NODE/NO_TRIGGER_ROOT |
| [随机]随机执行一个节点-20位 | 1610612747 | 2 | 1 | — | — | — | ❌ COMPOSITE_NODE/NO_TRIGGER_ROOT |
| (无名) | 1610612737 | 5 | 7 | — | — | — | ❌ NO_DSL_NAME/NO_METHOD/NO_TRIGGER_ROOT |
| [查询]获取关卡自定义变量 | 1610612749 | 7 | 9 | — | — | — | ❌ NO_DSL_NAME/NO_METHOD/NO_TRIGGER_ROOT |
| [运算]实体类型枚举转字符串 | 1610612761 | 4 | 9 | — | — | — | ❌ NO_TRIGGER_ROOT |
| [执行]]根据输入设备类型执行 | 1610612760 | 3 | 0 | — | — | — | ❌ NO_TRIGGER_ROOT |
| [执行]根据实体类型执行节点 | 1610612759 | 11 | 10 | — | — | — | ❌ NO_TRIGGER_ROOT |
| [运算]实体类型枚举转整数 | 1610612758 | 21 | 20 | — | — | — | ❌ NO_TRIGGER_ROOT |
| [执行]对在场玩家分数排名0 | 1610612757 | 5 | 3 | — | — | — | ❌ NO_TRIGGER_ROOT |
| [执行]销毁指定元件的所有实体0 | 1610612756 | 2 | 1 | — | — | — | ❌ COMPOSITE_NODE/NO_TRIGGER_ROOT |
| [变量]设置特定实体自定义变量 | 1610612755 | 19 | 18 | — | — | — | ❌ NO_TRIGGER_ROOT |
| [查询]获取特定实体自定义变量 | 1610612754 | 17 | 27 | — | — | — | ❌ NO_DSL_NAME/NO_METHOD/NO_TRIGGER_ROOT |
| [变量]设置关卡自定义变量 | 1610612750 | 12 | 12 | — | — | — | ❌ COMPOSITE_NODE/NO_TRIGGER_ROOT |
| [执行]销毁指定元件的所有实体2 | 1610612752 | 2 | 1 | — | — | — | ❌ NO_TRIGGER_ROOT |
| [查询]获取某实体相对位置 | 1610612751 | 2 | 1 | — | — | — | ❌ NO_TRIGGER_ROOT |
| [执行]保持元件对应实体数量 | 1610612753 | 9 | 10 | — | — | — | ❌ NO_DSL_NAME/NO_METHOD/COMPOSITE_NODE/NO_TRIGGER_ROOT |
| [运算]结算状态枚举转整数 | 1610612762 | 3 | 0 | — | — | — | ❌ NO_TRIGGER_ROOT |
| [矩阵]三阶矩阵加法 | 1610612763 | 6 | 9 | — | — | — | ❌ NO_TRIGGER_ROOT |
| [矩阵]三阶矩阵向量转列表 | 1610612764 | 8 | 12 | — | — | — | ❌ NO_TRIGGER_ROOT |
| [矩阵]三阶矩阵减法 | 1610612765 | 3 | 0 | — | — | — | ❌ NO_TRIGGER_ROOT |
| [矩阵]三阶矩阵数乘2 | 1610612767 | 11 | 22 | — | — | — | ❌ COMPOSITE_NODE/NO_TRIGGER_ROOT |
| [矩阵]三阶矩阵数乘1 | 1610612768 | 3 | 2 | — | — | — | ❌ NO_TRIGGER_ROOT |
| (无名) | 1610612769 | 15 | 45 | — | — | — | ❌ COMPOSITE_NODE/NO_TRIGGER_ROOT |
| [矩阵]三阶矩阵转置 | 1610612766 | 3 | 2 | — | — | — | ❌ NO_TRIGGER_ROOT |
| [矩阵]二阶矩阵求值 | 1610612771 | 5 | 4 | — | — | — | ❌ COMPOSITE_NODE/NO_TRIGGER_ROOT |
| [矩阵]三阶矩阵求伴随矩阵 | 1610612772 | 4 | 3 | — | — | — | ❌ COMPOSITE_NODE/NO_TRIGGER_ROOT |
| [矩阵]三阶矩阵求逆矩阵 | 1610612773 | 4 | 3 | — | — | — | ❌ COMPOSITE_NODE/NO_TRIGGER_ROOT |
| [矩阵]三阶矩阵求值 | 1610612770 | 17 | 49 | — | — | — | ❌ COMPOSITE_NODE/NO_TRIGGER_ROOT |
| (无名) | 1610612776 | 30 | 35 | — | — | — | ❌ COMPOSITE_NODE/CONTROL_FLOW_NODE/MISSING_ARG/CROSS_HANDLER_REF/LIST_CONSTANT |
| (无名) | 1610612775 | 6 | 8 | — | — | — | ❌ COMPOSITE_NODE/CONTROL_FLOW_NODE/MISSING_ARG |
| (无名) | 1610612774 | 3 | 3 | — | — | — | ❌ NO_TRIGGER_ROOT |

#### projectile-coords —— `实时获取投射物坐标（最快每0.06s获取一次）.gia`

定时器 + 拼装列表 + 3 个复合节点

- 单元：7 个（which=9×4，which=12×3）　[实测]
- 信封：header=[10403, 1, 806, 3, 10383]，body=10383 B，trailer=4 B　[实测]
- 节点定义（复合节点）：**3** 个；其中 0 个能对上实现图（graphId == guid）　[实测]

| 图 | graphId | 节点 | 连线 | 执行/数据 | 复合引用 | 未知 | 可译 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 示例-每0.1秒获取一次投射物坐标 | 1073741862 | 12 | 14 | — | — | — | ❌ COMPOSITE_NODE/CROSS_HANDLER_REF/MISSING_ARG/UPSTREAM_FAILED |
| (无名) | 1073741864 | 1 | 0 | — | — | — | ❌ NO_TRIGGER_ROOT |
| (无名) | 1073741863 | 14 | 20 | — | — | — | ❌ COMPOSITE_NODE/NO_TRIGGER_ROOT |
| (无名) | 1073741865 | 7 | 8 | — | — | — | ❌ COMPOSITE_NODE/NO_TRIGGER_ROOT |

#### disconnect-detect —— `玩家掉线检测、重连检测、断网检测.gia`

信号（监听/发送）+ 界面控件组 + 客户端脚本

- 单元：14 个（which=9×2，which=12×5，which=14×4，which=15×1，which=21×1，which=69×1）　[实测]
- 信封：header=[19773, 1, 806, 3, 19753]，body=19753 B，trailer=4 B　[实测]
- 节点定义（复合节点）：**9** 个；其中 0 个能对上实现图（graphId == guid）　[实测]

| 图 | graphId | 节点 | 连线 | 执行/数据 | 复合引用 | 未知 | 可译 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| [玩家]掉线检测 | 1073741924 | 31 | 35 | — | — | — | ❌ COMPOSITE_NODE/NO_DSL_NAME/NO_METHOD/MISSING_ARG/CROSS_HANDLER_REF/CONTROL_FLOW_NODE/LIST_CONSTANT |
| (无名) | 1610612807 | 2 | 2 | — | — | — | ❌ COMPOSITE_NODE/NO_TRIGGER_ROOT |

#### double-jump —— `只按空格实现二段跳.gia`

40 节点大图 + 节点图变量 + 枚举常量

- 单元：4 个（which=1×1，which=9×1，which=18×1，which=19×1）　[实测]
- 信封：header=[21603, 1, 806, 3, 21583]，body=21583 B，trailer=4 B　[实测]

| 图 | graphId | 节点 | 连线 | 执行/数据 | 复合引用 | 未知 | 可译 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 跟随 | 1073741825 | 40 | 60 | — | — | — | ❌ MULTI_OUT_PIN/UNKNOWN_CONSTANT/CROSS_HANDLER_REF/MISSING_ARG/CONTROL_FLOW_NODE/ENUM_CONSTANT/LIST_CONSTANT |

## 2. 节点类型覆盖度　[实测]

5 份样本一共用到 **107** 个不同的节点类型 id，其中 **82** 个能被识别（命中率 **76.6%**），**25** 个有问题。按类分组：

| 类别 | 种类数 | 含义 | 处置 |
| --- | --- | --- | --- |
| `SERVER_OK` | 79 | 服务端节点，有中文名 + gts 方法名 → 可直接翻译 | 直接翻译（`nodes.json` 的 `method`） |
| `CLIENT_OK` | 0 | 客户端节点，有中文名（无 gts 方法名）→ 只能读，不能翻成 gts | 只读，不生成 gts（gts 客户端节点表另算） |
| `ALIAS_OK` | 3 | nodes.json 里没有方法名，靠 node-aliases.json 人工签名核对补上 → 可翻译（[推断]） | 查 `node-aliases.json` 的 `gts_method`（**[推断]**，需 compile 兜底） |
| `NO_METHOD` | 0 | 在 nodes.json 里但**没有 gts 方法名**（上游措辞漂移）→ 拒绝生成 | **拒绝生成**；可在 `node-aliases.json` 里按签名核对后补 |
| `NO_DSL` | 3 | 在 nodes.json 里但**没有中文名**（只有英文显示名）→ 拒绝生成 | **拒绝生成**；同上 |
| `COMPOSITE` | 22 | 本文件内定义的**复合节点**（type 元组 scope=22001）→ 拒绝生成（需展开实现图） | **拒绝生成**；要么展开实现图（本工具没做），要么当黑盒 |
| `UNKNOWN` | 0 | 两边都没有 → UNKNOWN，拒绝生成 | **拒绝生成**，标 UNKNOWN |

### SERVER_OK（79 种）

| type_id | 次数 | 中文名 | 英文名 | 方法名 |
| --- | --- | --- | --- | --- |
| 204 | 35 | 乘法运算 | Multiplication | `multiplication` |
| 2 | 29 | 双分支 | Double Branch | `doubleBranch` |
| 200 | 26 | 加法运算 | Addition | `addition` |
| 169 | 17 | 拼装列表 | Assembly List | `assemblyList` |
| 73 | 16 | 获取自身实体 | Get Self Entity | `getSelfEntity` |
| 50 | 16 | 获取自定义变量 | Get Custom Variable | `getCustomVariable` |
| 180 | 16 | 数据类型转换 | Data Type Conversion | `dataTypeConversion` |
| 475 | 16 | 枚举是否相等 | Enumerations Equal | `enumerationsEqual` |
| 14 | 15 | 是否相等 | Equal | `equal` |
| 22 | 15 | 设置自定义变量 | Set Custom Variable | `setCustomVariable` |
| 323 | 13 | 设置节点图变量 | Set Node Graph Variable | `setNodeGraphVariable` |
| 128 | 13 | 获取列表对应值 | Get Corresponding Value From List | `getCorrespondingValueFromList` |
| 337 | 12 | 获取节点图变量 | Get Node Graph Variable | `getNodeGraphVariable` |
| 202 | 12 | 减法运算 | Subtraction | `subtraction` |
| 99 | 10 | 获取实体位置与旋转 | Get Entity Location and Rotation | `getEntityLocationAndRotation` |
| 79 | 10 | 启动定时器 | Start Timer | `startTimer` |
| 509 | 10 | 列表迭代循环 | List Iteration Loop | `listIterationLoop` |
| 75 | 9 | 以GUID查询实体 | Query Entity by GUID | `queryEntityByGuid` |
| 248 | 9 | 获取在场玩家实体列表 | Get List of Player Entities on the Field | `getListOfPlayerEntitiesOnTheField` |
| 83 | 8 | 定时器触发时 | When Timer Is Triggered | `whenTimerIsTriggered` |
| 142 | 8 | 获取列表长度 | Get List Length | `getListLength` |
| 19 | 8 | 设置局部变量 | Set Local Variable | `setLocalVariable` |
| 18 | 8 | 获取局部变量 | Get Local Variable | `getLocalVariable` |
| 226 | 8 | 逻辑与运算 | Logical AND Operation | `logicalAndOperation` |
| 10 | 7 | 三维向量加法 | 3D Vector Addition | `_3dVectorAddition` |
| 71 | 7 | 实体创建时 | When Entity Is Created | `whenEntityIsCreated` |
| 3 | 7 | 多分支 | Multiple Branches | `multipleBranches` |
| 82 | 7 | 终止定时器 | Stop Timer | `stopTimer` |
| 69 | 6 | 销毁实体 | Destroy Entity | `destroyEntity` |
| 802 | 6 | 设置玩家聊天语音权限 | Set Voice Chat Permissions | `setVoiceChatPermissions` |
| 231 | 5 | 数值小于等于 | Less Than or Equal To | `lessThanOrEqualTo` |
| 227 | 5 | 逻辑或运算 | Logical OR Operation | `logicalOrOperation` |
| 232 | 5 | 数值大于 | Greater Than | `greaterThan` |
| 270 | 4 | 查询预设点位置旋转 | Query Preset Point Position Rotation | `queryPresetPointPositionRotation` |
| 258 | 4 | 获取指定玩家所有角色实体 | Get All Character Entities of Specified Player | `getAllCharacterEntitiesOfSpecifiedPlayer` |
| 257 | 4 | 获取随机整数 | Get Random Integer | `getRandomInteger` |
| 316 | 4 | 界面控件组触发时 | When UI Control Group Is Triggered | `whenUiControlGroupIsTriggered` |
| 252 | 4 | 创建元件 | Create Prefab | `createPrefab` |
| 11 | 4 | 三维向量减法 | 3D Vector Subtraction | `_3dVectorSubtraction` |
| 7 | 3 | 获取随机浮点数 | Get Random Floating Point Number | `getRandomFloatingPointNumber` |
| 647 | 3 | 设置玩家结算计分板展示数据 | Set Player Settlement Scoreboard Data Display | `setPlayerSettlementScoreboardDataDisplay` |
| 76 | 3 | 以实体查询GUID | Query GUID by Entity | `queryGuidByEntity` |
| 230 | 3 | 数值小于 | Less Than | `lessThan` |
| 474 | 3 | 三维向量旋转 | 3D Vector Rotation | `_3dVectorRotation` |
| 12 | 3 | 三维向量缩放 | 3D Vector Zoom | `_3dVectorZoom` |
| 668 | 3 | 以实体切换跟随运动器的目标 | Switch Follow Motion Device Target by Entity | `switchFollowMotionDeviceTargetByEntity` |
| 5 | 2 | 有限循环 | Finite Loop | `finiteLoop` |
| 233 | 2 | 数值大于等于 | Greater Than or Equal To | `greaterThanOrEqualTo` |
| 229 | 2 | 逻辑非运算 | Logical NOT Operation | `logicalNotOperation` |
| 380 | 2 | 获取指定范围的实体列表 | Get Entity List by Specified Range | `getEntityListBySpecifiedRange` |
| 114 | 2 | 列表是否包含该值 | List Includes This Value | `listIncludesThisValue` |
| 1088 | 2 | 建立字典 | Create Dictionary | `createDictionary` |
| 1938 | 2 | 对字典按值排序 | Sort Dictionary by Value | `sortDictionaryByValue` |
| 650 | 2 | 设置玩家结算排名数值 | Set Player Settlement Ranking Value | `setPlayerSettlementRankingValue` |
| 240 | 2 | 激活关闭原生碰撞 | Activate/Disable Native Collision | `activateDisableNativeCollision` |
| 946 | 1 | 角色移动速度达到条件时 | When Character Movement SPD Meets Condition | `whenCharacterMovementSpdMeetsCondition` |
| 259 | 1 | 获取角色归属的玩家实体 | Get Player Entity to Which the Character Belongs | `getPlayerEntityToWhichTheCharacterBelongs` |
| 310 | 1 | 获取全局计时器当前时间 | Get Current Global Timer Time | `getCurrentGlobalTimerTime` |
| 92 | 1 | 进入碰撞触发器时 | When Entering Collision Trigger | `whenEnteringCollisionTrigger` |
| 378 | 1 | 获取指定元件ID的实体列表 | Get Entity List by Specified Prefab ID | `getEntityListBySpecifiedPrefabId` |
| 318 | 1 | 获取场上所有实体 | Get All Entities on the Field | `getAllEntitiesOnTheField` |
| 372 | 1 | 移除实体 | Remove Entity | `removeEntity` |
| 308 | 1 | 激活关闭模型显示 | Activate/Disable Model Display | `activateDisableModelDisplay` |
| 72 | 1 | 实体移除销毁时 | When Entity Is Removed/Destroyed | `whenEntityIsRemovedDestroyed` |
| 8 | 1 | 权重随机 | Weighted Random | `weightedRandom` |
| 213 | 1 | 取较小值 | Take Smaller Value | `takeSmallerValue` |
| 766 | 1 | 查询对局游玩方式及人数 | Query Game Mode and Player Number | `queryGameModeAndPlayerNumber` |
| 135 | 1 | 对列表插入值 | Insert Value Into List | `insertValueIntoList` |
| 767 | 1 | 获取玩家昵称 | Get Player Nickname | `getPlayerNickname` |
| 652 | 1 | 设置玩家结算成功状态 | Set Player Settlement Success Status | `setPlayerSettlementSuccessStatus` |
| 77 | 1 | 结算关卡 | Settle Stage | `settleStage` |
| 94 | 1 | 挂载循环特效 | Mount Looping Special Effect | `mountLoopingSpecialEffect` |
| 617 | 1 | 设置实体生效铭牌 | Set Entity Active Nameplate | `setEntityActiveNameplate` |
| 351 | 1 | 节点图变量变化时 | When Node Graph Variable Changes | `whenNodeGraphVariableChanges` |
| 1 | 1 | 打印字符串 | Print String | `printString` |
| 291 | 1 | 正弦函数 | Sine Function | `sineFunction` |
| 292 | 1 | 余弦函数 | Cosine Function | `cosineFunction` |
| 383 | 1 | 激活控件组库内界面控件组 | Activate UI Control Group in Control Group Library | `activateUiControlGroupInControlGroupLibrary` |
| 36 | 1 | 自定义变量变化时 | When Custom Variable Changes | `whenCustomVariableChanges` |

### ALIAS_OK（3 种）

| type_id | 次数 | 中文名 | 英文名 | 方法名 |
| --- | --- | --- | --- | --- |
| 9 | 20 | 拆分三维向量 | Split 3D Vector | `split3dVector` |
| 225 | 13 | 创建三维向量 | Create 3D Vector | `create3dVector` |
| 288 | 2 | 传送玩家 | Teleport Player (Beyond Mode) | `teleportPlayer` |

### NO_METHOD（0 种）

（本轮样本里没有）

### NO_DSL（3 种）

| type_id | 次数 | 中文名 | 英文名 | 端口(入→出) | 处置 |
| --- | --- | --- | --- | --- | --- |
| 320 | 5 |  | Get Entity With Specified Prefab ID on the Field | Pfb → L<Ety> | **拒绝生成**；同上 |
| 160 | 2 |  | Set List Value | L<R<T>>,Int,R<T> → — | **拒绝生成**；同上 |
| 755 | 2 |  | Query Timestamp (UTC+0) | — → Int | **拒绝生成**；同上 |

### UNKNOWN（0 种）

（本轮样本里没有）

### COMPOSITE（22 种）

| type_id | 次数 | 中文名 | 英文名 | 端口(入→出) | 处置 |
| --- | --- | --- | --- | --- | --- |
| 1610612771 | 21 |  |  | — → — | **拒绝生成**；要么展开实现图（本工具没做），要么当黑盒 |
| 1073741826 | 5 |  |  | — → — | **拒绝生成**；要么展开实现图（本工具没做），要么当黑盒 |
| 1073741834 | 4 |  |  | — → — | **拒绝生成**；要么展开实现图（本工具没做），要么当黑盒 |
| 1073741853 | 3 |  |  | — → — | **拒绝生成**；要么展开实现图（本工具没做），要么当黑盒 |
| 1073741851 | 3 |  |  | — → — | **拒绝生成**；要么展开实现图（本工具没做），要么当黑盒 |
| 1073741825 | 3 |  |  | — → — | **拒绝生成**；要么展开实现图（本工具没做），要么当黑盒 |
| 1610612779 | 3 |  |  | — → — | **拒绝生成**；要么展开实现图（本工具没做），要么当黑盒 |
| 1073741852 | 2 |  |  | — → — | **拒绝生成**；要么展开实现图（本工具没做），要么当黑盒 |
| 1073741855 | 2 |  |  | — → — | **拒绝生成**；要么展开实现图（本工具没做），要么当黑盒 |
| 1073741840 | 2 |  |  | — → — | **拒绝生成**；要么展开实现图（本工具没做），要么当黑盒 |
| 1073741849 | 2 |  |  | — → — | **拒绝生成**；要么展开实现图（本工具没做），要么当黑盒 |
| 1610613068 | 2 |  |  | — → — | **拒绝生成**；要么展开实现图（本工具没做），要么当黑盒 |
| 1073741856 | 1 |  |  | — → — | **拒绝生成**；要么展开实现图（本工具没做），要么当黑盒 |
| 1073741831 | 1 |  |  | — → — | **拒绝生成**；要么展开实现图（本工具没做），要么当黑盒 |
| 1073741846 | 1 |  |  | — → — | **拒绝生成**；要么展开实现图（本工具没做），要么当黑盒 |
| 1073741837 | 1 |  |  | — → — | **拒绝生成**；要么展开实现图（本工具没做），要么当黑盒 |
| 1610612758 | 1 |  |  | — → — | **拒绝生成**；要么展开实现图（本工具没做），要么当黑盒 |
| 1073741839 | 1 |  |  | — → — | **拒绝生成**；要么展开实现图（本工具没做），要么当黑盒 |
| 1610612770 | 1 |  |  | — → — | **拒绝生成**；要么展开实现图（本工具没做），要么当黑盒 |
| 1610612768 | 1 |  |  | — → — | **拒绝生成**；要么展开实现图（本工具没做），要么当黑盒 |
| 1610613065 | 1 |  |  | — → — | **拒绝生成**；要么展开实现图（本工具没做），要么当黑盒 |
| 1610613069 | 1 |  |  | — → — | **拒绝生成**；要么展开实现图（本工具没做），要么当黑盒 |

### 2b. 复合节点（本文件内定义的类型）

5 份样本一共定义 **99** 个本文件内节点单元（which=12/14，type 元组 scope=22001），
`nodes.json` 里当然没有这些 id —— 它们**不是缺失**，而是「定义在这儿」。
我们的读法：按 `guid` 建表 → 实例的 `type_id == guid` 时从表里取**名字 + 引脚名**。
⇒ 复合节点在**读**的层面是**全解**的（名字、端口、连线都在），在**译**的层面一律拒绝（要展开实现图）。

| 样本 | 定义数 | 名字样例 |
| --- | --- | --- |
| composite-atlas | 87 | [随机]范围内取随机点（矩形） / [时间]等待时间/延时 / [变量]节点图变量自减-浮点数 / [时间]自身定时器触发时 … |
| projectile-coords | 3 | 空节点-浮点数 / 运算-投射物位置函数 / 速度矢量转化 … |
| disconnect-detect | 9 | 发送信号 / 发送信号 / [玩家]掉线检测-信号事件 / 监听信号 … |

## 3. 多出参节点：`out_fields` 缺口

`emit` 的 spec 里 `out` 只能命名「整个返回值」；取第 N 个出参要靠**属性名**（gts 返回对象）。
属性名不在 `nodes.json` 里（端口名常常是 `null`）⇒ 必须在 `node-aliases.json` 的 `out_fields` 里登记，否则报 `MULTI_OUT_PIN` 拒绝生成。

| type_id | 出参序号 | 英文名 | 方法名 | 出参数 | 已登记 out_fields |
| --- | --- | --- | --- | --- | --- |
| 946 | 0 | When Character Movement SPD Meets Condition | `whenCharacterMovementSpdMeetsCondition` | 6 | ❌ |
| 99 | 0 | Get Entity Location and Rotation | `getEntityLocationAndRotation` | 2 | ✅ |
| 9 | 1 | Split 3D Vector | — | 3 | ✅ |
| 83 | 2 | When Timer Is Triggered | `whenTimerIsTriggered` | 6 | ❌ |
| 71 | 1 | When Entity Is Created | `whenEntityIsCreated` | 2 | ❌ |
| 18 | 0 | Get Local Variable | `getLocalVariable` | 2 | ❌ |
| 92 | 0 | When Entering Collision Trigger | `whenEnteringCollisionTrigger` | 5 | ❌ |
| 71 | 0 | When Entity Is Created | `whenEntityIsCreated` | 2 | ❌ |
| 316 | 3 | When UI Control Group Is Triggered | `whenUiControlGroupIsTriggered` | 4 | ❌ |
| 1938 | 0 | Sort Dictionary by Value | `sortDictionaryByValue` | 2 | ❌ |
| 766 | 0 | Query Game Mode and Player Number | `queryGameModeAndPlayerNumber` | 2 | ❌ |
| 316 | 0 | When UI Control Group Is Triggered | `whenUiControlGroupIsTriggered` | 4 | ❌ |
| 270 | 0 | Query Preset Point Position Rotation | `queryPresetPointPositionRotation` | 2 | ❌ |
| 270 | 1 | Query Preset Point Position Rotation | `queryPresetPointPositionRotation` | 2 | ❌ |
| 99 | 1 | Get Entity Location and Rotation | `getEntityLocationAndRotation` | 2 | ✅ |
| 18 | 1 | Get Local Variable | `getLocalVariable` | 2 | ❌ |
| 9 | 0 | Split 3D Vector | — | 3 | ✅ |
| 9 | 2 | Split 3D Vector | — | 3 | ✅ |
| 351 | 4 | When Node Graph Variable Changes | `whenNodeGraphVariableChanges` | 5 | ❌ |
| 351 | 2 | When Node Graph Variable Changes | `whenNodeGraphVariableChanges` | 5 | ❌ |
| 83 | 4 | When Timer Is Triggered | `whenTimerIsTriggered` | 6 | ❌ |
| 83 | 1 | When Timer Is Triggered | `whenTimerIsTriggered` | 6 | ❌ |
| 83 | 0 | When Timer Is Triggered | `whenTimerIsTriggered` | 6 | ❌ |
| 36 | 0 | When Custom Variable Changes | `whenCustomVariableChanges` | 5 | ❌ |
| 36 | 2 | When Custom Variable Changes | `whenCustomVariableChanges` | 5 | ❌ |
| 36 | 4 | When Custom Variable Changes | `whenCustomVariableChanges` | 5 | ❌ |
| 36 | 3 | When Custom Variable Changes | `whenCustomVariableChanges` | 5 | ❌ |
| 83 | 3 | When Timer Is Triggered | `whenTimerIsTriggered` | 6 | ❌ |

## 4. 仍缺什么（未解项）

1. **多出参属性名**：只有 `node-aliases.json` 里登记过的才译得出（见 §3），其余一律 `MULTI_OUT_PIN`。
2. **109 个服务端节点没有 gts 方法名**：`nodes.json` 的 `counts.server_without_dsl = 109`，本报告只对样本里用到的做了签名核对。
3. **枚举常量**：`#106` 里的枚举项（如 `1200`）没映射到 gts 枚举成员 ⇒ `ENUM_CONSTANT`。
4. **列表 / 字典常量**：`#109` 能拆出元素，但 gts 的列表字面量写法没验证 ⇒ `LIST_CONSTANT`；字典布局未解 ⇒ `DICT_CONSTANT`。
5. **语义等价**：`emit` 的 spec 是「一串顺序调用」，表达不了双分支/多分支/遍历的控制流，也表达不了图的注释分组。
   能读到、能生成、能编译，但**语义不等价** —— 这一层没做，也不假装做了。
6. **`which` 的种类语义**：`7`（`#15` 载荷，样本里叫「监听移动速率」）、`61`、`69` 的完整语义未解，只按原样记录。
7. **图头的 `tag2`(20000/20002) / `tag3`(21001/21002)** 到底是不是「服务端/客户端」，**没验证出来**，只原样记录。
8. **图变量 / 信号没有独立表**：现在的读法是「看引用它们的节点 + 那个字符串常量」，是**间接**证据。
