# tools/check_all.ps1 —— 一键全量自检
#
# 跑法（在工程根目录）：
#   powershell -ExecutionPolicy Bypass -File tools\check_all.ps1
#   powershell -ExecutionPolicy Bypass -File tools\check_all.ps1 -SkipSim   # 跳过模拟器（省时间）
#
# 依次做：
#   1.  规则引擎自测            tests/selftest.lua          （55 断言）
#   2.  界面坐标自洽性回归      tests/ui_math.lua           （47 断言）
#   2b. 动效接线一致性          tests/effects_wiring.lua    （41 断言）
#   2c. 文件编码归一（BOM）     tools/normalize_encoding.ps1 -Check
#   2j. Lua 静态检查 + 格式体检 tools/lua_lint.ps1         （selene/stylua，只报告不判失败）
#   3.  关卡批量校验（唯一解）  tools/validate_levels.lua
#   4.  打包客户端脚本          tools/bundle_client_script.lua
#   5.  Lua 5.3 编译 + 顶层执行 tools/lua53check/check.cjs
#   5b. 入口离线冒烟            tests/entry_smoke.lua       （20 断言，浮点画布）
#   6.  导出界面布局计划        tools/dump_layout.lua
#   7.  重新生成真机控件坐标表  tools/gen_editor_guide.mjs
#   8.  模拟器完整交互回归      tools/sim/play_test.mjs     （27 断言 + 截图）
#   8b. 输入与设备适配          tools/sim/probe_input.mjs   （12 断言，键鼠/触屏/手柄）
#   9~11. 三关完整通关          tools/sim/win_path.mjs      （5×5 / 6×6 / 7×7 打到破案）
#   12. 选关 / 切关             tools/sim/probe_levels.mjs  （28 断言）
#   13. 光标门控自愈            tools/sim/probe_cursor.mjs  （4 断言）
#
# 任何一步失败都会明确报出来，最后汇总。
#
# ⚠️ 改过本文件（或任何含中文的 .ps1）之后，先跑一次
#      powershell -ExecutionPolicy Bypass -File tools\normalize_encoding.ps1
#    因为编辑工具会剥掉 BOM，而 PowerShell 5.1 会把无 BOM 的文件按 GBK 读 → 直接解析失败。
#    （2c 步会以 -Check 模式复查这一点，但它自己得先能被解析才行。）

param(
  [switch]$SkipSim,
  [int]$SolveLimit = 3
)

$ErrorActionPreference = 'Continue'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

function Find-Lua {
  $candidates = @(
    (Join-Path $env:LOCALAPPDATA 'Programs\Lua\bin\lua.exe'),
    'lua.exe'
  )
  foreach ($c in $candidates) {
    try {
      $null = & $c -v 2>&1
      if ($LASTEXITCODE -eq 0 -or $?) { return $c }
    } catch { }
  }
  return $null
}

$lua = Find-Lua
if (-not $lua) {
  Write-Host "!! 找不到 Lua 解释器。装一个（https://luabinaries.sourceforge.net/）或把路径加进 PATH。" -ForegroundColor Red
  exit 1
}
Write-Host "Lua: $lua" -ForegroundColor DarkGray
Write-Host "Node: $(node -v)" -ForegroundColor DarkGray
Write-Host ""

$results = @()

function Run-Step {
  # ⚠️ 参数名不能叫 $Args —— 那是 PowerShell 的自动变量，
  #    撞名会让传进来的数组丢掉，lua 收到空参数直接进 REPL，然后"退出码 0"假绿。
  param([string]$Name, [string]$Exe, [string[]]$ArgList, [switch]$Soft)

  Write-Host ("=" * 70)
  Write-Host ">> $Name" -ForegroundColor Cyan
  Write-Host ("=" * 70)
  & $Exe @ArgList 2>&1 | ForEach-Object { Write-Host $_ }
  $code = $LASTEXITCODE
  $okFlag = ($code -eq 0)
  if (-not $okFlag -and $Soft) {
    Write-Host "   （这一步是可选的，失败不阻塞）" -ForegroundColor Yellow
    $okFlag = $true
  }
  $script:results += [pscustomobject]@{ Step = $Name; Exit = $code; OK = $okFlag }
  Write-Host ""
  return $okFlag
}

$ok1 = Run-Step '1/13 规则引擎自测'            $lua @('tests\selftest.lua')
$ok2 = Run-Step '2/13 界面坐标自洽性回归'       $lua @('tests\ui_math.lua')
# 2b：动效接线一致性。界面层的语义名（M.EFFECTS）与适配器的实现表（EFFECTS）
#     分处两个文件、靠字符串对上；对不上时**不动也不报错**，只能靠肉眼发现。
#     portrait_slide_up 就是这么漏的。
Run-Step '2b/13 动效接线一致性'                 $lua @('tests\effects_wiring.lua') | Out-Null
# 2c：文件编码归一（BOM 状态）。两条相反的规则都会踩：
#     · 含中文的 .ps1 **必须**有 BOM，否则 PS 5.1 按 GBK 读会解析失败；
#     · .lua / .md **必须没有** BOM，否则打包成单文件后 Lua 5.3 报
#       "unexpected symbol near '<\239>'" 且行号指向文件末尾。
#     `edit` 工具每次写入都会剥掉 BOM，所以这一步基本每次都会抓到东西。
Run-Step '2c/13 文件编码归一（BOM）' 'powershell' @('-ExecutionPolicy', 'Bypass',
  '-File', 'tools\normalize_encoding.ps1', '-Check') | Out-Null
# 2d：输入手势状态机（纯 Lua）。模拟器的 pointer 只有 down/up、**没有 move**，
#     所以 CursorDrag 那条"按住移动就当场取消长按"的分支在模拟器里永远走不到。
#     这里直接造 Controller 调 on_cell_down / on_cell_drag / on_cell_up 把它钉死，
#     顺带复验长按=放置、抑制尾随点击、键盘光标与回车放置。
Run-Step '2d/13 输入手势状态机'                 $lua @('tests\input_logic.lua') | Out-Null
# 2d2：**选关屏的命中层与翻页箭头**（2026-10-15 真机那两件事 ✓）
#   为什么必须进闸门：★ 这一条**只有"点击有没有反应"一个可观察差异** ✗ ——
#     命中层本来就是隐形的 ⇒ "被藏了"与"正常隐藏"在屏幕上**长得一模一样** ✓
#   判据（两条都是"能红能绿"的 ✓）：
#     · `hit.select.*` 在选关屏必须 `visible = true`（修前 7 条红 ✓）
#     · 只有一页时左右箭头**仍要可见、只是变暗**（旧写法是整组隐藏 ✗）
Run-Step '2d2/13 选关屏命中层与箭头'            $lua @('tests\select_hit_visible.lua') | Out-Null
# 2d3：**主页/选关左下角那颗「结算」＋ 四个方块已删**（2026-10-15 用户要求 ✓）
#   为什么必须进闸门 ✗：★ 这两条**在屏幕上都没有可观察差异** ✓
#     · 「不接存档线」⇒ ★ 点了都有反应 ✓ 差别只在**存档有没有被写** ✓（看不出来 ✓）
#     · 「四个方块删掉」⇒ ★ 东西没了 ✓ 而"哪天被改回来"同样看不出来 ✓
#   判据（★ 都能红能绿 ✓）：
#     · `settle.btn` 在主页/选关都在、事件是 `settle_only`、触发它**`on_save` 一次都不调** ✓
#     · `widgets = false` ⇒ `selbar`/`selbtn.*` 不建（在 `entry_smoke` §6e，带对照 ✓）
Run-Step '2d3/13 结算按钮（不接存档线）'          $lua @('tests\settle_button.lua') | Out-Null
# 2c2：**构建标记有没有递增**（接手待办 P1 ✓）
#   为什么要当闸门：`PLAN.md` D2 那次事故 —— 标记停在 v076 而 `versions/` 到 v092
#     ⇒ 十几次安装之后**无法从日志分辨跑的是哪一版** ✗ 根因就是"靠人记得递增" ✓
#   判据：`--check` 拿 `git show HEAD:lua/entry_client_script.lua` 里的标记比一比 ✓
#     · 不一样 ⇒ 通过（说明本轮递增过 ✓）
#     · 一样   ⇒ **失败 exit 2** ⇒ 跑 `node tools/bump_build_marker.mjs --note="…"` ✓
#   ⚠️ 它**只查"递增了没有"**，不管说明写得好不好 ✓ 那是人写的，工具管不了 ✓
Run-Step '2c2/13 构建标记已递增（P1）' 'node' @('tools\bump_build_marker.mjs', '--check') | Out-Null
# 2e：四方对照（我的代码 / 模拟器 / 官方文档 / 真机实测）。
#     ① sim_surface：**机械提取**模拟器插件的 API 面（不再靠读源码猜 ——
#        我曾因此断言"模拟器没有 InstantiateClientUIControl"，其实是有的）
#     ② reconcile  ：把四者摊在一起 + 生成 docs/未验证清单.md
#     这一步保证「我代码里的假设」和「文档/模拟器」始终对齐；纯离线，不联网。
#     ⚠️ 联网抓社区知识库是手动的（tools\audit\fetch_kb.mjs），不进自检。
Run-Step '2e/13 四方对照（代码/模拟器/文档）' 'node' @('tools\audit\sim_surface.mjs') | Out-Null
Run-Step '2f/13 生成四方对照表 + 未验证清单' 'node' @('tools\audit\reconcile.mjs') | Out-Null
# 2g：Lua 源码"奇数 ASCII 双引号"扫描。
#     这个坑我踩了 4 次：把 ASCII 双引号当中文引号写进 Lua 字符串 →
#     字符串提前结束 → 语法错误，而**报错行号指向别处**，极难一眼看出。
#     判据很硬：那行的 ASCII 双引号个数必为奇数。
Run-Step '2g/13 Lua 引号隐患扫描' 'powershell' @('-ExecutionPolicy', 'Bypass',
  '-File', 'tools\lua_quote_scan.ps1') | Out-Null
# 2i：结构哨兵 —— 「嵌套配错」与「节流退化」。**只读**，机械判据，不联网。
#
#   起因（2026-10-05，本项目真实踩到的两个静默坑 ✗）：
#     ① `lua/engine_adapter_qianxing.lua` 里 `if self.cfg.btn_art == true and print then` **没闭合** ✗
#        ⇒ `apply_ruler_layout` / `diagnose_overlap` 被嵌成了 `apply_tray_layout` 的子闭包 ✗
#        ⇒ 它们**从未被定义** ⇒ `main.lua` 的 `~= nil` 守卫恒假 ⇒ **行标/列标对齐、相交诊断从来没跑过**
#        （Lua 不报错、不崩溃 —— 功能静默失效 ✗）。
#     ② `lua/main.lua` 的 `if (current.frames or 0) % 300 == 0 then` **没闭合** ✗
#        ⇒ 底下"**每帧**压住 selbar / selbtn / tpl-container + 25 个 cell"实际**每 300 帧**才跑 ✗
#        ⇒ 玩家**点到棋盘就回选关**的老 bug 随时复发（那正是当初加这段的原因 ✗）。
#
#   判据（tools/audit/check_nesting.mjs）：
#     `[嵌套]`      = 顶格写的 `function`/`if` 实际落在别的块里 ⇒ `end` 配对错位；
#     `[节流嵌套]`  = `if (frames % N) == 0` 套在更大的 `% M == 0` 里 ⇒ 内层节流退化。
#
#   ★ 状态（2026-10-05 Round 50 更新）：**两处嵌套已经修好了** ✓✓
#     · `apply_ruler_layout` / `diagnose_overlap` 现在是**真正的顶层方法** ✓
#       修法：把落底的上色循环抽成顶层 helper `Adapter:_tray_btn_art(moved, names, done, miss)` ✓，
#             再让 `apply_tray_layout` 在它们**之前**收 `end` ✓
#       （为什么不能只补一个 `end` ✗：那段循环用着 `apply_tray_layout` 的局部变量 ✓，
#        它必须整段移出去 ⇒ 只能抽 helper ✓）
#     · **独立硬证据**：`luac -l -p` 里两个 prototype 从「落在 `apply_tray_layout` 的
#       `2244,2598` 之内」✗ 变成**互不包含**的 `2474,2547` / `2557,2608` ✓✓
#     · **另一条独立判据**：`tests/perframe_throttle.lua` 第 0 节
#       **`[PASS] 全部存在（37 个守卫型调用点）`** ✓（修前是「缺失 2 个」✗）
#   ⇒ 本步骤**剩下的唯一红**是 `[节流嵌套] lua/main.lua:*` ✗ ——
#     那是**另一个已登记的任务**（"每帧压住 selbar"实际每 300 帧 ⇒ 按口径改成
#     进关/换屏**强压窗口** + 之后**变化才写** ✓ 稳态 0 次/帧 ✓），
#     **不是**这一步的判据失效 ✓ ⇒ 看到它红请去修 `main.lua`，**不要**动这里的判据 ✗
#   ⚠️ **不许**为了让它变绿而放宽判据 / 加白名单（那是挪球门 ✗，
#      也正是社区知识 §5.11「假绿」清单里点名要防的 ✗）。
Run-Step '2i/13 结构哨兵（嵌套/节流）' 'node' @('tools\audit\check_nesting.mjs') | Out-Null
# 2k：**编码 / BOM 哨兵** —— 本项目 BOM 的规则是**相反的** ✗，为它单独设一步。
#
#   规则（两条相反，务必记牢 ✓）：
#     · `lua/**/*.lua`、`*.mjs`、`*.md`、`*.json` ⇒ **必须【没有】BOM** ✓（Lua 引擎解析器）
#     · `tools/**/*.ps1`、`tests/**/*.ps1`     ⇒ **必须【有】BOM** ✓
#        原因：**PowerShell 5.1 靠 BOM 判编码** —— 无 BOM 且含中文时它按 **GBK** 解码
#        ⇒ **整份脚本解析失败** ✗✗（真发生过：`tools/check_all.ps1` 一度完全跑不起来 ✓）
#
#   ⚠️ **隐身雷**：`edit` / `write` 工具写出的文件**不带 BOM** ✓
#     ⇒ **每次用它们改 `.ps1` 都会悄悄剥掉 BOM** ✗ ⇒ 改完**必须**再看一眼这一步 ✓
#     （这就是本步骤存在的理由 ✓ —— 我为此栽过两次 ✓）
#
#   首跑抓到 7 项真违规并全部修掉 ✓：5 个 `tools/*.ps1` 缺 BOM（有解析失败风险 ✗）
#   + 2 个文件多了 BOM ✗ ⇒ 现在 300 个文件 0 违规 ✓
Run-Step '2k/13 编码/BOM 哨兵' 'node' @('tools\check_encoding.mjs') | Out-Null
# 2h：「本次搭建要求」也从**代码**生成。
#     起因：用户说"因为改了很多次脚本，重新确认一下本次实验的搭建要求" ——
#     散落在各 .md 里的搭建说明必然会和代码脱节，靠人同步一定漏。
#     这里从 cfg / MANAGED / ui_controller 的容器层级 / layout-plan 抠事实再生成，
#     所以它**不可能过期**。
Run-Step '2h/13 生成「本次搭建要求」' 'node' @('tools\gen_setup_requirements.mjs') | Out-Null
# 2m：界面发出的 action vs 分发器分支 —— 抓"点了没反应"的死按钮。
#     首跑就抓到 `focus_clue` 发了却没分支（2026-09-27 已修），固化成步骤防回归。
#   ★ 2026-10-05 Round 65 改标签：**它原来叫 `2i`，与结构哨兵那一步重名** ✗
#     ⇒ 日志里两条都显示 `2i/13`，红了分不清是哪条 ✓ ⇒ 本步改为 **2m** ✓
#     （编号历史：2h 搭建要求 / 2i 结构哨兵 / 2j 静态检查 / **2k 编码哨兵** / **2m 本步**）
$okAct = Run-Step '2m/13 交互 action 对账' 'node' @('tools\audit\check_actions.mjs')
# 2j：Lua 静态检查 + 格式体检（**只报告**）。
#
#   ★ 2026-10-05 新增。工具与装法见 docs/插件与工具-调研与安装记录.md。
#     量的是"读代码就能发现"的那一类问题 —— 漏写 local（会把变量泄进引擎全局表）、
#     空 if/elseif 分支（条件写了、分支忘了写）、未用变量。这三类都是**人眼会漏**的。
#
#   为什么这一步**不判失败**（而不是像别的步骤那样失败就红）：
#     · 本工程 lua/** 现存 1 处 BOM parse_error + 2 处漏写 local，
#       它们**先于这一步存在**，修不修是代码作者的决定，不是自检能替的；
#     · 本工程反复吃过"断言锁死现状"的亏（见 14/14 素材自检那段注释）：
#       历史遗留导致的红，会把**新出现的**红淹掉。
#     ⇒ 默认只把清单打出来。等清单清干净了，把下面这行换成
#       `tools\lua_lint.ps1 -Strict` 就能升级成守门（-Strict 有 error 时 exit 1）。
#   ⚠️ 它还有个**副作用是好事**：selene 的解析器比 lua53check 严格，
#      能抓到"文件开头多了 BOM"这种 Lua 语法之外的问题（BOM 会让打包后的
#      Lua 5.3 报 unexpected symbol，且行号指向文件末尾 —— 见 2c 的注释）。
Run-Step '2j/13 Lua 静态检查（selene/stylua，只报告）' 'powershell' @('-ExecutionPolicy', 'Bypass',
  '-File', 'tools\lua_lint.ps1') | Out-Null
$ok3 = Run-Step '3/13 关卡批量校验（唯一解）'   $lua @('tools\validate_levels.lua', "$SolveLimit")
$ok4 = Run-Step '4/13 打包客户端脚本'           $lua @('tools\bundle_client_script.lua')

if ($ok4) {
  $ok5 = Run-Step '5/13 Lua 5.3 编译 + 顶层执行' 'node' @('tools\lua53check\check.cjs', 'dist\client_script.lua', '--run')
  # 5b：离线把**真机入口**完整跑一遍（假游戏环境，画布尺寸故意返回浮点）。
  #     2026-09-26 真机事故：check_canvas 用 %d 格式化浮点画布尺寸 → 抛错 →
  #     整个 OnInit 被打断 → 日志表现成一大串"控件未找到"。这条就是防它复发的。
  if ($ok5) {
    $ok5 = Run-Step '5b/13 入口离线冒烟（浮点画布/空控件树/惰性重试）' $lua @('tests\entry_smoke.lua')
  }
} else {
  Write-Host "（跳过 5/13：上一步没产出 dist\client_script.lua）" -ForegroundColor Yellow
  $results += [pscustomobject]@{ Step = '5/13 Lua 5.3 编译 + 顶层执行'; Exit = 'SKIP'; OK = 'SKIP' }
  $ok5 = $false
}

# 6 依赖 3：关卡数据不合法时导出的布局计划不可信
if ($ok3) {
  $ok6 = Run-Step '6/13 导出界面布局计划' $lua @('tools\dump_layout.lua')
} else {
  Write-Host "（跳过 6/13：关卡校验没过，导出的布局计划不可信）" -ForegroundColor Yellow
  $results += [pscustomobject]@{ Step = '6/13 导出界面布局计划'; Exit = 'SKIP'; OK = 'SKIP' }
  $ok6 = $false
}

# 7 依赖 6：否则会拿**上一次的**陈旧计划生成指南 —— 这种"假绿"最危险
if ($ok6) {
  $ok7 = Run-Step '7/13 生成真机控件坐标表' 'node' @('tools\gen_editor_guide.mjs')
} else {
  Write-Host "（跳过 7/13：布局计划没刷新，会生成陈旧的坐标表）" -ForegroundColor Yellow
  $results += [pscustomobject]@{ Step = '7/13 生成真机控件坐标表'; Exit = 'SKIP'; OK = 'SKIP' }
  $ok7 = $false
}

if ($SkipSim) {
  Write-Host "（已跳过 8~13、8b：模拟器相关）" -ForegroundColor Yellow
  $results += [pscustomobject]@{ Step = '8/13 模拟器交互回归'; Exit = 'SKIP'; OK = 'SKIP' }
  $results += [pscustomobject]@{ Step = '8b/13 输入与设备适配'; Exit = 'SKIP'; OK = 'SKIP' }
  $results += [pscustomobject]@{ Step = '9/13 完整通关 case_001'; Exit = 'SKIP'; OK = 'SKIP' }
  $results += [pscustomobject]@{ Step = '10/13 完整通关 case_002'; Exit = 'SKIP'; OK = 'SKIP' }
  $results += [pscustomobject]@{ Step = '11/13 完整通关 case_003'; Exit = 'SKIP'; OK = 'SKIP' }
  $results += [pscustomobject]@{ Step = '12/13 选关/切关'; Exit = 'SKIP'; OK = 'SKIP' }
  $results += [pscustomobject]@{ Step = '13/13 光标门控自愈'; Exit = 'SKIP'; OK = 'SKIP' }
} else {
  if ($ok7) {
    $ok8 = Run-Step '8/13 模拟器交互回归（27 断言）' 'node' @('tools\sim\play_test.mjs')
# ★ 新增：**美术验证**（按钮底色/按钮文字/行标列标对齐/头像卡底图/落子头像/棋盘无遮挡）
#   为什么单列一步：行为回归全绿≠外观正确。前几轮"按钮还是白的""没有名字""ruler 没对齐"
#   全是靠用户真机截图才发现的 —— 这一步把它们挡在交付之前。
$okArt = Run-Step '8c/13 美术验证（外观/对齐/头像）' 'node' @('tools\sim\verify_art.mjs')

    # 9~11：按答案**真打一遍**到破案结算
    #   case_001 = 5×5 无同伙 · case_002 = 6×6 有同伙 · case_003 = 7×7 有同伙+假话不告知
    # 8b：输入与设备适配。7.1 要求同一套界面同时吃 PC 键鼠和移动端触屏，
    #     这里同时验：设备识别 → 图例文案、长按落子、双击落子、单击笔记、
    #     长按后抑制尾随点击、键盘 Digit/Arrow/Return 落子。任何一条挂了都会
    #     让真机某类设备玩不动，所以在通关测试之前先卡住。
    if ($ok8) {
      Run-Step '8b/13 输入与设备适配（键鼠/触屏/手柄）' 'node' @('tools\sim\probe_input.mjs') | Out-Null
    } else {
      Write-Host "（跳过 8b/13：界面回归没过）" -ForegroundColor Yellow
      $results += [pscustomobject]@{ Step = '8b/13 输入与设备适配'; Exit = 'SKIP'; OK = 'SKIP' }
    }

    if ($ok8) {
      $ok9 = Run-Step '9/13 完整通关 case_001（5×5 无同伙）' 'node' @('tools\sim\win_path.mjs', '--level=case_001')
    } else {
      Write-Host "（跳过 9/13：界面回归没过）" -ForegroundColor Yellow
      $results += [pscustomobject]@{ Step = '9/13 完整通关 case_001'; Exit = 'SKIP'; OK = 'SKIP' }
      $ok9 = $false
    }
    if ($ok9) {
      $ok10 = Run-Step '10/13 完整通关 case_002（6×6 有同伙）' 'node' @('tools\sim\win_path.mjs', '--level=case_002')
    } else {
      Write-Host "（跳过 10/13：上一关没通过）" -ForegroundColor Yellow
      $results += [pscustomobject]@{ Step = '10/13 完整通关 case_002'; Exit = 'SKIP'; OK = 'SKIP' }
      $ok10 = $false
    }
    if ($ok10) {
      $ok11 = Run-Step '11/13 完整通关 case_003（7×7）' 'node' @('tools\sim\win_path.mjs', '--level=case_003')
    } else {
      Write-Host "（跳过 11/13：上一关没通过）" -ForegroundColor Yellow
      $results += [pscustomobject]@{ Step = '11/13 完整通关 case_003'; Exit = 'SKIP'; OK = 'SKIP' }
      $ok11 = $false
    }
    if ($ok11) {
      Run-Step '12/13 选关/切关' 'node' @('tools\sim\probe_levels.mjs') | Out-Null
    } else {
      Write-Host "（跳过 12/13：上一关没通过）" -ForegroundColor Yellow
      $results += [pscustomobject]@{ Step = '12/13 选关/切关'; Exit = 'SKIP'; OK = 'SKIP' }
    }
    # 13：验证脚本能否**自己**打开容器的「显示常驻光标」。
    #     能的话真机上就不用手动勾这一项；不能也会明确报出来，而不是让你去猜。
    Run-Step '13/13 光标门控自愈' 'node' @('tools\sim\probe_cursor.mjs') | Out-Null

    # 14：**素材自检**（美术改造 ⑤/⑥ 的待办追踪）。
    #
    #   ★★ 2026-09-30：这一步用 `--warn-only` —— **只报告，永远不判失败**。
    #
    #   为什么：现在 `obj.*`（家具）和 `btn.hex`（六边形）这些美术素材**还没做**，
    #   那是**预期内的待办**，不该让 check_all 变红 —— 否则真出错时会被淹没在
    #   "缺素材"的噪音里（本项目已经吃过好几次"断言锁死现状"的亏）。
    #   它会把"关卡已经在用、但 assets 里还没有的"和"界面一次性素材待办"**分开报**。
    #
    #   ⇒ 素材齐了之后，把这行的 `--warn-only` 去掉即可变成守门。
    Run-Step '14/14 素材自检（只报告）' 'node' @('tools\gil\check_assets.mjs', '--warn-only') | Out-Null

    # 15：**操作动线审计**（主页/选关/关卡的进出、切关、重置）。
    #
    #   ★ 2026-10-01：布局审计（audit_layout）看的是"东西摆在哪"，
    #     这一条看的是"点进去出不出得来、切关后状态有没有残留" ——
    #     后者是**状态机**的问题，布局审计看不见。
    Run-Step '15/15 操作动线审计' 'node' @('tools\sim\audit_flow.mjs') | Out-Null
  } else {
    Write-Host "（跳过 8~13：布局计划不可信）" -ForegroundColor Yellow
    $results += [pscustomobject]@{ Step = '8/13 模拟器交互回归'; Exit = 'SKIP'; OK = 'SKIP' }
    $results += [pscustomobject]@{ Step = '9/13 完整通关 case_001'; Exit = 'SKIP'; OK = 'SKIP' }
    $results += [pscustomobject]@{ Step = '10/13 完整通关 case_002'; Exit = 'SKIP'; OK = 'SKIP' }
    $results += [pscustomobject]@{ Step = '11/13 完整通关 case_003'; Exit = 'SKIP'; OK = 'SKIP' }
    $results += [pscustomobject]@{ Step = '12/13 选关/切关'; Exit = 'SKIP'; OK = 'SKIP' }
    $results += [pscustomobject]@{ Step = '13/13 光标门控自愈'; Exit = 'SKIP'; OK = 'SKIP' }
  }
}

Write-Host ("=" * 70)
Write-Host "汇总" -ForegroundColor Cyan
Write-Host ("=" * 70)
$bad = 0
$skipped = 0
foreach ($r in $results) {
  # 三态：通过 / 失败 / 跳过。跳过**不能显示成 OK** —— 否则 -SkipSim 跑出来一片
  # 绿色，看起来"全绿"其实模拟器那几步根本没跑（这正是本脚本一直在防的假绿）。
  # ⚠️ 顺序与左右位置都有讲究：
  #    `$bool -eq 'SKIP'` 在 PowerShell 里是 **$true** —— `-eq` 按**左操作数**的类型
  #    做强制转换，于是 'SKIP' 被转成 [bool] = $true，字符串比较根本没发生。
  #    所以先用 `-eq $false` 判失败，再把**字符串写在左边**判跳过
  #    （右侧的 $true 会被转成 'True'，才正确地不等于 'SKIP'）。
  $mark = '  OK  '; $color = 'Green'
  if ($r.OK -eq $false) { $mark = ' FAIL '; $color = 'Red'; $bad++ }
  elseif ('SKIP' -eq $r.OK) { $mark = ' SKIP '; $color = 'DarkGray'; $skipped++ }
  Write-Host ("[$mark] {0,-32} exit={1}" -f $r.Step, $r.Exit) -ForegroundColor $color
}
Write-Host ""
if ($skipped -gt 0) {
  Write-Host "有 $skipped 步被跳过 —— 不算失败，但也**不算通过**。" -ForegroundColor Yellow
}
if ($bad -gt 0) {
  Write-Host "有 $bad 步失败。" -ForegroundColor Red
  exit 1
}
Write-Host "全部通过。" -ForegroundColor Green
exit 0










