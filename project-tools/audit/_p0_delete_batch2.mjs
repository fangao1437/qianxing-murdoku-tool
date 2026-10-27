#!/usr/bin/env node
// tools/audit/_p0_delete_batch2.mjs —— P0 死代码清理第 2 批（HEX 家族 + 空壳块 + sk_x/sk_y）
//
// 为什么用脚本而不是手改：这几段是**整段既有代码 + 大段注释**，手抄 old_string 容易漏字符；
// 改成"按行区间删 + 每段首尾各断言一次"更稳，而且**默认只报告**，要 `--apply` 才写盘。
//
// 按**倒序**应用（先删靠后的），这样前面的行号不会漂。
//
// 用法：
//   node tools/audit/_p0_delete_batch2.mjs            # 只报告（默认）
//   node tools/audit/_p0_delete_batch2.mjs --apply    # 真写盘（写前打印、写后从磁盘重读核对）
//
// 每条的判据见 `.repl` 里的墓碑注释；总结论见 docs/回执-优化组-死代码清理-第2批.md
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const FILE = path.join(ROOT, 'lua', 'ui_controller.lua');
const APPLY = process.argv.includes('--apply');

/** 行号从 1 开始；first/last 是**必须匹配**的边界断言（用 trim 后 startsWith 比） */
const EDITS = [
  {
    tag: 'D · 网格几何探针空壳（三个未使用 local + 一句"已删"注释）',
    start: 5460, end: 5478,
    first: 'if (self._grid_geom_log or 0) < 3 and print then',
    last: 'end',
    repl: [
      '  -- ★ 2026-10-18（优化组 · P0）：**网格几何探针的"空壳"整段删除** ✗✓',
      '  --   原文是一个 `if (self._grid_geom_log or 0) < 3 and print then … end`：',
      '  --     里面只声明了 `_f` / `_one` / `_cg2` 三个**从未被读**的 local，',
      '  --     外加一句"网格几何1/2/3 已删（原 L4060..L4077）"的注释 ⇒ 一段什么也不做的壳。',
      '  --   判据：三个 local 在本文件**零引用**（只出现在这个 if 体内）⇒ 整块是死代码。',
      '  --   ⚠️ 真正的网格体检另有实现（`_grid_*` 家族 + `tests/grid_cost.lua` 守着），不受影响。',
    ],
  },
  {
    tag: 'C · `if HEX_PREFAB then … end` 空壳',
    start: 2621, end: 2672,
    first: '-- 六边形底图（三个键各一层）',
    last: 'end',
    repl: [
      '  -- ★ 2026-10-18（优化组 · P0）：`if HEX_PREFAB then … end` **整段删除** ✗✓',
      '  --   判据：`HEX_PREFAB` 自 2026-10-03 起是**常量 false**（原因写在下面墓碑里），',
      '  --     而块内**两条分支都不建任何节点**（注释自己也写着"现在两条分支都不再建任何节点"）',
      '  --     ⇒ 这段是恒假分支 + 空壳 ✓ 删掉零行为变化 ✓',
    ],
  },
  {
    tag: 'B · `SK` / `sk_x` / `sk_y` 三个只服务于上面那段死代码的 local',
    start: 2618, end: 2620,
    first: 'local SK = L.side_key',
    last: 'local sk_y =',
    repl: [
      '  -- ★ 2026-10-18（优化组 · P0）：`SK` / `sk_x` / `sk_y` 三个 local **已删除** ——',
      '  --   它们唯一的使用点是上面那段被删掉的六边形底图（`hex_bg("action.back", sk_x + 55, sk_y[1] + 55, …)`）',
      '  --   判据：删完 HEX 段后全文件对这三个名字的引用为 **0**（含注释）✓',
    ],
  },
  {
    tag: 'A · HEX 家族：HEX_RECT/HEX_TRI + HEX_PARTS + HEX_PREFAB + hex_bg',
    start: 2517, end: 2611,
    first: '-- ★★★ 2026-10-01：**右侧三个按钮的深色六边形底图**（参考图里就是六边形）。',
    last: 'end',
    repl: [
      '  -- ★ 2026-10-18（优化组 · P0）：**「用基础图元拼六边形按钮底图」整段删除** ✗✓',
      '  --',
      '  --   删的是：`HEX_RECT/HEX_TRI` 常量 + `HEX_PARTS`（6 块拼片）+ `HEX_PREFAB` 开关 + `hex_bg()` 函数。',
      '  --   判据（三条都要成立才算死代码）：',
      '  --     ① `hex_bg(` 全文件 **0 个调用点**（只剩注释里的历史写法）；',
      '  --     ② `HEX_PREFAB` 是 **常量 false**（2026-10-03 真机探针实测：',
      '  --        `InstantiateClientUIControl(1073742333, root)` pcall 成功但**返回 nil** ⇒',
      '  --        "按模板索引实例化素材"这条路走不通 ⇒ 之后改走「在编辑器里摆现成图片」',
      '  --     ③ 三个目标的父控件（`action.back/redo/hint`）**已按用户指令从存档删除** ⇒',
      '  --        底图节点就算建出来也是悬空节点（正是当年 T3 要避免的那种）。',
      '  --   ⇒ 现在这三个按钮的外观**全部由存档里的 `hex.*` 图片控件承担**（`ICON_ASSETS` 那条路），',
      '  --     脚本这一侧不再需要任何"拼图元"的代码 ✓',
      '  --   ⚠️ 历史理由（六边形怎么拼、"两个三角会得到八角星"那条教训）已在 git 历史与',
      '  --     `docs/外部资产-怎么用与我做了什么.md` 里，需要时能查回来 ✓',
    ],
  },
];

const lines = fs.readFileSync(FILE, 'utf8').replace(/^\uFEFF/, '').split('\n');
console.log('文件：lua/ui_controller.lua　共 ' + lines.length + ' 行　模式：' + (APPLY ? 'APPLY（写盘）' : 'DRY（只报告）'));

// ── 先全部断言，任一不成立就整体不写（fail-closed）──
let bad = 0;
for (const e of EDITS) {
  const firstLine = (lines[e.start - 1] ?? '').trim();
  const lastLine = (lines[e.end - 1] ?? '').trim();
  const okFirst = firstLine.startsWith(e.first);
  const okLast = lastLine === e.last || lastLine.startsWith(e.last);
  const span = e.end - e.start + 1;
  console.log(`\n[${okFirst && okLast ? 'OK' : '✗'}] ${e.tag}`);
  console.log(`   区间 L${e.start}–L${e.end}（${span} 行）`);
  console.log(`   首行: ${okFirst ? '✓' : '✗'} ${firstLine.slice(0, 80)}`);
  console.log(`   尾行: ${okLast ? '✓' : '✗'} ${lastLine.slice(0, 80)}`);
  if (!okFirst || !okLast) bad++;
}
if (bad > 0) { console.error('\n✗ 有 ' + bad + ' 段边界不符 ⇒ 一个字节都不写'); process.exit(1); }

// ── 倒序应用 ──
const out = lines.slice();
for (const e of EDITS.slice().sort((a, b) => b.start - a.start)) {
  out.splice(e.start - 1, e.end - e.start + 1, ...e.repl);
}
const removed = lines.length - out.length;
console.log(`\n合计：删除 ${removed} 行，替换为 ${EDITS.reduce((s, e) => s + e.repl.length, 0)} 行墓碑注释`);

if (APPLY) {
  fs.writeFileSync(FILE, out.join('\n'), 'utf8');
  // 从磁盘重读核对
  const back = fs.readFileSync(FILE, 'utf8').split('\n');
  const checks = [
    ['hex_bg( 调用点应为 0', back.filter((l) => !l.trim().startsWith('--') && l.includes('hex_bg(')).length === 0],
    ['HEX_PARTS 应为 0', back.filter((l) => !l.trim().startsWith('--') && l.includes('HEX_PARTS')).length === 0],
    ['if HEX_PREFAB 应为 0', back.filter((l) => !l.trim().startsWith('--') && l.includes('if HEX_PREFAB')).length === 0],
    ['sk_x 应为 0', back.filter((l) => !l.trim().startsWith('--') && /\bsk_x\b/.test(l)).length === 0],
    ['局部 _f 声明应为 0', back.filter((l) => !l.trim().startsWith('--') && /local\s+_f\s*=/.test(l)).length === 0],
    ['墓碑注释已写入', back.some((l) => l.includes('HEX 家族：「用基础图元拼六边形按钮底图」') || l.includes('「用基础图元拼六边形按钮底图」整段删除'))],
    ['行数对得上', back.length === lines.length - removed],
  ];
  console.log('\n── 从磁盘重读核对 ──');
  let allOk = true;
  for (const [label, ok] of checks) { console.log('  ' + (ok ? '✅' : '✗ ') + ' ' + label); if (!ok) allOk = false; }
  if (!allOk) { console.error('\n✗ 写盘后核对不通过'); process.exit(1); }
  console.log('\n★ 已写盘');
} else {
  console.log('\n（DRY：什么都没写。要真删请加 --apply）');
}
