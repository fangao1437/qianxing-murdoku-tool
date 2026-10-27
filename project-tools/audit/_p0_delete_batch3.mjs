#!/usr/bin/env node
// tools/audit/_p0_delete_batch3.mjs —— P0 死代码清理第 3 批
//   ① 适配层 5 项：_cells_prefab / make_cursor_data / keyboard_ready / get_text / M.capabilities
//   ② 适配层 EFFECTS.roomwall（与上一批删掉的 M.EFFECTS.ROOMWALL 成对）
//   ③ ui_controller 的 LAYOUT 无读者键（8 个 + actions/action_btn 两个空读键）
//
// 这批用**文本锚点**而不是行号：对端正在改同一个文件（几何调整会挪行），
// 行号会漂，锚点不会。每个锚点必须**恰好命中 1 次**，否则一个字节都不写（fail-closed）。
//
// 用法：
//   node tools/audit/_p0_delete_batch3.mjs            # 只报告（默认）
//   node tools/audit/_p0_delete_batch3.mjs --apply    # 真写盘（写后从磁盘重读核对）
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const APPLY = process.argv.includes('--apply');
const AD = path.join(ROOT, 'lua', 'engine_adapter_qianxing.lua');
const UI = path.join(ROOT, 'lua', 'ui_controller.lua');

/** 每条：file / old（必须恰好出现 1 次）/ new（墓碑或空串）/ 说明 / 名字（用于"prod 只剩定义"的预检，可选） */
const EDITS = [
  // ── 适配层 ──────────────────────────────────────────────────────────────
  {
    file: AD, name: '_cells_prefab',
    why: '兼容旧名的转发壳，全仓 0 调用点（注释里"别处还在用"是过期结论）',
    old: [
      '-- 兼容旧名（别处还在用）',
      'function Adapter:_cells_prefab(g)',
      '  local list = self:_cells_prefabs(g)',
      '  if list[1] ~= nil then return list[1].index end',
      '  return nil',
      'end',
    ].join('\n'),
    new: [
      '-- ★ 2026-10-18（优化组 · P0）：`Adapter:_cells_prefab`（**单数**，兼容旧名的转发壳）**已删除** ✗✓',
      '--   判据：全仓 0 调用点；"兼容旧名（别处还在用）"是过期结论。',
      '--   真正的实现在下面 `Adapter:_cells_prefabs`（**复数**，返回候选列表），仍被 `ensure_cells` 用着 ✓',
    ].join('\n'),
  },
  {
    file: AD, name: 'make_cursor_data',
    why: '文件内 local，0 调用点（原先给离线桩造 CursorEventData 用，那条路已由真引擎事件取代）',
    old: [
      'local function make_cursor_data(x, y, press_x, press_y)',
      '  return {',
      '    x = x, y = y, pressX = press_x, pressY = press_y,',
      '    GetUIPos = function() return x, y end,',
      '    GetPressUIPos = function() return press_x, press_y end,',
      '  }',
      'end',
    ].join('\n'),
    new: [
      '-- ★ 2026-10-18（优化组 · P0）：`make_cursor_data`（连带它返回表里的 `GetPressUIPos` 字段）**已删除** ✗✓',
      '--   判据：文件内 local，全仓 0 调用点。',
      '--   ⚠️ 真引擎回调收到的 `CursorEventData` **自带** `GetUIPos` / `GetPressUIPos`（官方）⇒',
      '--     这个"自己捏一个"的假对象只在早期离线桩阶段用过，早就不需要了。',
    ].join('\n'),
  },
  {
    file: AD, name: 'keyboard_ready',
    why: '0 调用点（键盘是否可用这件事由 `keymap` 本身在别的分支里就地判断，不需要这个查询函数）',
    old: [
      '-- 键盘是否真的可用（要么绑成功过，要么收到过键盘事件）',
      'function Adapter:keyboard_ready()',
      '  if self.keymap ~= nil and next(self.keymap) ~= nil then return true end',
      '  return false',
      'end',
    ].join('\n'),
    new: [
      '-- ★ 2026-10-18（优化组 · P0）：`Adapter:keyboard_ready` **已删除** —— 全仓 0 调用点',
      '--   （需要判断时直接看 `self.keymap` 是否非空即可，不必留一个包装函数）',
    ].join('\n'),
  },
  {
    file: AD, name: 'get_text',
    why: '0 调用点（文案一律走 `set_property(id,"text",…)`，没有本地化表这条路）',
    old: [
      'function Adapter:get_text(text_map_id)',
      '  if game and game.GetText then return game.GetText(text_map_id) end',
      '  return tostring(text_map_id)',
      'end',
    ].join('\n'),
    new: [
      '-- ★ 2026-10-18（优化组 · P0）：`Adapter:get_text` **已删除** —— 全仓 0 调用点',
      '--   文案通道是 `set_property(id, "text", …)`（真机已验证），不存在"本地化文本表"这条路 ✓',
    ].join('\n'),
  },
  {
    file: AD, name: 'capabilities',
    why: '0 调用点（能力自检只在"真机首跑"那一轮用过，结论已写进 docs；不该留在上机包里）',
    anchorStart: '-- 运行时能力自检',
    anchorEnd: '  return text, missing\nend',
    new: [
      '-- ★ 2026-10-18（优化组 · P0）：`M.capabilities`（运行时能力自检，19 条 check）**已删除** ✗✓',
      '--   判据：全仓 0 调用点（底稿里"tools 里 15 处在用"是第三方库污染，已逐个复核为 0）。',
      '--   它是"真机首跑"那一轮的一次性体检，结论已经落在 docs/（API-四方对照、平台边界）；',
      '--   留在上机包里只是白占体积，而且真需要时随时能从 git 历史取回 ✓',
    ].join('\n'),
  },
  {
    file: AD, name: 'roomwall',
    why: '与上一批删掉的 M.EFFECTS.ROOMWALL 成对；现在没有任何调用点会发 "roomwall"',
    old: [
      '  -- 区域墙：轻微一缩（表示"这里隔断"）',
      '  roomwall     = { dur = 0.14, ease = "OutQuad",  ch = "scale",',
      '                   keys = { { 0.00, 0.98 }, { 1.00, 1.00 } } },',
    ].join('\n'),
    new: '  -- ★ 2026-10-18（优化组 · P0）：`roomwall` 动效**已删除** —— 上一批删掉 `M.EFFECTS.ROOMWALL` 后无人再发它',
  },
  {
    file: AD, name: null,
    why: '对应的"清补间"名单里那一行',
    old: '  roomwall     = nil,\n',
    new: '',
  },

  // ── ui_controller：LAYOUT 无读者键 ───────────────────────────────────────
  {
    file: UI, name: null,
    why: 'LAYOUT.stats —— 0 读者',
    old: '  stats  = { x = 1520, y = 26, w = 380, h = 46 },\n',
    new: [
      '  -- ★ 2026-10-18（优化组 · P0）：`M.LAYOUT` 里**这一类"无读者键"已删除** ✗✓',
      '  --   判据（逐个键在代码里数 `L.<键>`，全部为 0，且 tests/ tools/ 里也没有读者）：',
      '  --     `stats` · `tray_item_w` · `cell` · `cell_gap` · `wall_thickness` ·',
      '  --     `back_btn` · `confirm` · `actions` · `action_btn`',
      '  --   ⚠️ `tray_item_h` / `tray_gap_x` / `tray_gap_y` / `tray_per_row` **仍在用**（托盘自适应布局）⇒ 保留 ✓',
    ].join('\n') + '\n',
  },
  {
    file: UI, name: null,
    why: 'LAYOUT.tray_item_w（同行的 tray_item_h 保留，它还在用）',
    old: '  tray_item_w = 112, tray_item_h = 104,             -- tray_item_w 只是参考值，实际按列数均分\n',
    new: '  tray_item_h = 104,                                -- （`tray_item_w` 已删：无读者的参考值）\n',
  },
  { file: UI, name: null, why: 'LAYOUT.cell', old: '  cell   = 160,        -- 仅参考\n', new: '' },
  { file: UI, name: null, why: 'LAYOUT.cell_gap', old: '  cell_gap = 4,        -- 仅参考\n', new: '' },
  { file: UI, name: null, why: 'LAYOUT.wall_thickness', old: '  wall_thickness = 10,\n', new: '' },
  {
    file: UI, name: null, why: 'LAYOUT.actions',
    old: '  actions = { x = 478, y = 944, w = 880, h = 120 },  -- y 944..1064，中心 x=918（与棋盘同）\n',
    new: '',
  },
  { file: UI, name: null, why: 'LAYOUT.action_btn', old: '  action_btn = { w = 168, h = 56, gap = 14 },\n', new: '' },
  { file: UI, name: null, why: 'LAYOUT.back_btn', old: '  back_btn = { x = 161, y = 77, w = 255, h = 28 },\n', new: '' },
  { file: UI, name: null, why: 'LAYOUT.confirm', old: '  confirm  = { x = 344, y = 22, size = 66, gap = 14 },\n', new: '' },
];

// ★ 行尾：这个仓库的工作树是 **CRLF**（我的锚点用 `\n` 写，直接 indexOf 会 0 命中 —— 踩过一次）
//   所以：读进来先归一成 `\n` 做匹配，写回去时**还原成原来的行尾**，
//   否则一次三行改动会变成"整个文件都改了"的 diff ✓
const EOL = {};
function readNorm(p) {
  const raw = fs.readFileSync(p, 'utf8');
  const crlf = (raw.match(/\r\n/g) || []).length;
  const lf = (raw.match(/(?<!\r)\n/g) || []).length;
  EOL[p] = crlf > lf ? '\r\n' : '\n';
  return raw.replace(/\r\n/g, '\n');
}
function writeBack(p, text) {
  const out = EOL[p] === '\r\n' ? text.replace(/\n/g, '\r\n') : text;
  fs.writeFileSync(p, out, 'utf8');
}

const files = { [AD]: readNorm(AD), [UI]: readNorm(UI) };
console.log(`行尾：adapter=${EOL[AD] === '\r\n' ? 'CRLF' : 'LF'}　ui_controller=${EOL[UI] === '\r\n' ? 'CRLF' : 'LF'}`);
const prodCorpus = fs.readdirSync(path.join(ROOT, 'lua')).filter((f) => f.endsWith('.lua'))
  .map((f) => fs.readFileSync(path.join(ROOT, 'lua', f), 'utf8')).join('\n');

function countOcc(hay, needle) { let n = 0, i = 0; while ((i = hay.indexOf(needle, i)) >= 0) { n++; i += needle.length; } return n; }

console.log('模式：' + (APPLY ? 'APPLY（写盘）' : 'DRY（只报告）'));
let bad = 0;
for (const e of EDITS) {
  const src = files[e.file];
  let ok, detail;
  if (e.anchorStart) {
    const s = src.indexOf(e.anchorStart), t = src.indexOf(e.anchorEnd, s);
    ok = s >= 0 && t > s && countOcc(src, e.anchorStart) === 1;
    detail = ok ? `锚点对命中：L${src.slice(0, s).split('\n').length} … L${src.slice(0, t).split('\n').length}` : '锚点对没命中/不唯一';
    e._span = ok ? [s, t + e.anchorEnd.length] : null;
  } else {
    const n = countOcc(src, e.old);
    ok = n === 1;
    detail = `命中 ${n} 次`;
    e._span = ok ? [src.indexOf(e.old), src.indexOf(e.old) + e.old.length] : null;
  }
  if (e.name && ok) {
    const prodN = (prodCorpus.match(new RegExp('\\b' + e.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'g')) || []).length;
    detail += `　｜ 名字在 lua/** 出现 ${prodN} 次（含定义/注释）`;
  }
  console.log(`[${ok ? 'OK' : '✗'}] ${path.basename(e.file)} · ${e.why}\n     ${detail}`);
  if (!ok) bad++;
}
if (bad > 0) { console.error('\n✗ 有 ' + bad + ' 条锚点不成立 ⇒ 一个字节都不写'); process.exit(1); }

// 按文件分组、按偏移倒序应用（同一文件内不互相污染）
const before = { [AD]: files[AD].split('\n').length, [UI]: files[UI].split('\n').length };
for (const file of [AD, UI]) {
  const list = EDITS.filter((e) => e.file === file).sort((a, b) => b._span[0] - a._span[0]);
  let src = files[file];
  for (const e of list) src = src.slice(0, e._span[0]) + e.new + src.slice(e._span[1]);
  files[file] = src;
}
const after = { [AD]: files[AD].split('\n').length, [UI]: files[UI].split('\n').length };
console.log(`\n行数：adapter ${before[AD]} → ${after[AD]}（${after[AD] - before[AD]}）；ui_controller ${before[UI]} → ${after[UI]}（${after[UI] - before[UI]}）`);

if (!APPLY) { console.log('\n（DRY：什么都没写。要真删请加 --apply）'); process.exit(0); }

writeBack(AD, files[AD]);
writeBack(UI, files[UI]);

// 写后从磁盘重读核对
const ad2 = fs.readFileSync(AD, 'utf8').replace(/\r\n/g, '\n'), ui2 = fs.readFileSync(UI, 'utf8').replace(/\r\n/g, '\n');
const codeLines = (s) => s.split('\n').filter((l) => !l.trim().startsWith('--'));
const checks = [
  ['adapter: 无 `function Adapter:_cells_prefab(`', !ad2.includes('function Adapter:_cells_prefab(')],
  // ★ 注意：这两条只能查**代码行** —— 墓碑注释里故意写了名字，用 includes 会误判成"没删掉"（踩过）
  ['adapter: 无 `make_cursor_data`（代码行）', !codeLines(ad2).some((l) => l.includes('make_cursor_data'))],
  ['adapter: 无 `keyboard_ready`（代码行）', !codeLines(ad2).some((l) => l.includes('keyboard_ready'))],
  ['adapter: 无 `function Adapter:get_text(`', !ad2.includes('function Adapter:get_text(')],
  ['adapter: 无 `function M.capabilities`', !ad2.includes('function M.capabilities')],
  ['adapter: EFFECTS 里无 roomwall 定义行', !codeLines(ad2).some((l) => l.includes('roomwall'))],
  ['ui: LAYOUT 里无 stats/cell/cell_gap/wall_thickness/back_btn/confirm/actions/action_btn 赋值',
    !codeLines(ui2).some((l) => /^\s*(stats|cell|cell_gap|wall_thickness|back_btn|confirm|actions|action_btn)\s*=/.test(l))],
  ['ui: tray_item_h 仍在（不能误删）', codeLines(ui2).some((l) => /tray_item_h\s*=\s*104/.test(l))],
];
console.log('\n── 从磁盘重读核对 ──');
let allOk = true;
for (const [label, ok] of checks) { console.log('  ' + (ok ? '✅' : '✗ ') + ' ' + label); if (!ok) allOk = false; }
if (!allOk) { console.error('\n✗ 写盘后核对不通过'); process.exit(1); }
console.log('\n★ 已写盘');
