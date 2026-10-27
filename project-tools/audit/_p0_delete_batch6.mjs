#!/usr/bin/env node
// tools/audit/_p0_delete_batch6.mjs —— 第 6 批：清掉「老计划里还没实现」的剩下 21 个族
//
// 目标：`check_names` 的 🔴 真缺 **21 → 0**，并消掉 `report_missing` 的两条错误级告警（select / toolbar）。
//
// 删的东西（全部是"计划里有、存档里从来没有、也没有创建路"）：
//   toolbar / left / tray / legend / board / select   6 个**容器**（子级要么已被取代、要么直接挂 root ⇒ 空壳）
//   room.label.1..8        房间名标签（挂在还不存在的 board 下，从没建过）
//   clues.bar/up/down/track/knob/count/more   旧线索栏外壳（已被网格视窗取代；真机日志里 up/down 读回 nil）
//   Controller:tray_layout_canvas()           头像卡重排的入口（容器没了 ⇒ 恒返回 nil，main 里的调用也跟着删）
//
// ⚠️ **不删** `vm.tray`（它是"嫌疑人列表"，`placed_count` 还在用）；
//    ⚠️ **不删** `board.bg`（它挂在 `stage` 下，不是 `board` 的子级）。
//    ⚠️ 适配层 `apply_tray_layout` 那 110 行**本批不动** —— 删它要先把 `_tray_btn_art` 改挂到新入口，
//       并同步改 `tests/btn_art_gate.lua`（那是缺陷 1 的回归）⇒ 单独一批做，避免一次动太多。
//
// 用法：node tools/audit/_p0_delete_batch6.mjs [--apply]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const APPLY = process.argv.includes('--apply');
const UI = path.join(ROOT, 'lua', 'ui_controller.lua');
const MAIN = path.join(ROOT, 'lua', 'main.lua');

const EOL = {};
function readNorm(p) {
  const raw = fs.readFileSync(p, 'utf8');
  const crlf = (raw.match(/\r\n/g) || []).length, lf = (raw.match(/(?<!\r)\n/g) || []).length;
  EOL[p] = crlf > lf ? '\r\n' : '\n';
  return raw.replace(/\r\n/g, '\n');
}
const writeBack = (p, t) => fs.writeFileSync(p, EOL[p] === '\r\n' ? t.replace(/\n/g, '\r\n') : t, 'utf8');

const files = { [UI]: readNorm(UI), [MAIN]: readNorm(MAIN) };

/** 从 id 锚点找到它所属 push(…) 的整段（括号配对，跳过字符串）*/
function spanOfPush(src, idLiteral) {
  const k = src.indexOf(`id = "${idLiteral}"`);
  if (k < 0) return null;
  if (src.indexOf(`id = "${idLiteral}"`, k + 1) >= 0) return { dup: true };
  const p = src.lastIndexOf('push(', k);
  if (p < 0) return null;
  // 从 push( 的 ( 开始配对
  let i = p + 'push'.length, depth = 0, inStr = null;
  for (; i < src.length; i++) {
    const c = src[i];
    if (inStr) { if (c === '\\') { i++; continue; } if (c === inStr) inStr = null; continue; }
    if (c === '"' || c === "'") { inStr = c; continue; }
    if (c === '(' || c === '{' || c === '[') depth++;
    else if (c === ')' || c === '}' || c === ']') { depth--; if (depth === 0) { i++; break; } }
  }
  const lineStart = src.lastIndexOf('\n', p) + 1;
  let end = i;
  if (src[end] === '\n') end++;              // 吃掉行尾换行
  return { start: lineStart, end, text: src.slice(lineStart, end) };
}

const CUTS = [];
const addPush = (id, tag) => CUTS.push({ f: UI, kind: 'push', id, tag });

addPush('toolbar', 'toolbar 容器（子级 tool.* 在 SHOW_TOOL_BUTTONS=false 下根本不 push ⇒ 空容器）');
addPush('left',    'left 容器（旧左栏；子级只剩 tray / legend）');
addPush('legend',  'legend 旧图例');
addPush('board',   'board 旧棋盘容器（子级只剩 room.label.*；`board.bg` 挂在 stage 下，不受影响）');
addPush('select',  'select 选关容器（四张卡等子级都直接挂 root ⇒ 空容器）');
for (const c of ['clues.bar', 'clues.up', 'clues.down', 'clues.track', 'clues.knob', 'clues.count', 'clues.more']) {
  addPush(c, c + '（旧线索栏外壳，已被网格视窗取代）');
}

CUTS.push({
  f: UI, kind: 'range', tag: 'tray 容器 + 头像卡自适应布局 + `tray.*` 循环（n_tray 恒 0，一行都不执行）',
  start: '  push({ id = "tray", kind = "container", parent = "left", rect = rect_of(L.tray),',
  until: '\n  -- ★★★★★ 2026-10-05 **父级必须是 `root`，不能写 `left`**',
  repl: [
    '  -- ★ 2026-10-18（优化组 · C 类清理）：**头像卡容器 `tray` 与它的自适应布局整段删除** ✗✓',
    '  --   判据：① `n_tray` 早在 2026-10-02 就被写成 **0**（头像卡并进滚动线索卡）⇒ 循环一次都不执行；',
    '  --     ② 真机日志每一局都打「找不到头像卡容器（cfg.tray_parent，默认 tray）」；',
    '  --     ③ `check_names` 里 `tray` 是 🔴 真缺（存档里从来没有）。',
    '  --   ⚠️ `vm.tray`（嫌疑人列表）**保留** —— `placed_count` 还在用它 ✓',
    '  --   ⚠️ 适配层 `apply_tray_layout` 那 110 行属下一批（要连 `_tray_btn_art` 与回归一起改）。',
    '',
  ].join('\n'),
});

CUTS.push({
  f: UI, kind: 'range', tag: 'room.label.* 两个 for 循环（房间名标签，8 个从未建成）',
  start: '    local boxes = cur and cur.room_boxes or {}',
  until: '\n  -- ★ 2026-10-12 **行标尺（`ruler.r.*`）已按用户要求删除**',
  repl: [
    '    -- ★ 2026-10-18（优化组 · C 类清理）：**房间名标签 `room.label.1..8` 整段删除** ✗✓',
    '    --   判据：它们挂在 `board` 容器下，而 `board` 在存档里根本不存在 ⇒ 8 个标签**从来没建过**',
    '    --     （`check_names` 里是 8 个 🔴 真缺）；`room_boxes` / `room_names` 仍由关卡数据提供，',
    '    --     以后要做「房间名」时**另开新控件位**，别再复活 `room.label.*` 这套名字 ✓',
    '',
  ].join('\n'),
});

CUTS.push({
  f: UI, kind: 'range', tag: 'Controller:tray_layout_canvas()（头像卡重排入口；容器没了 ⇒ 恒 nil）',
  start: 'function Controller:tray_layout_canvas()',
  until: '\nfunction Controller:placed_count(vm)',
  repl: [
    '-- ★ 2026-10-18（优化组 · C 类清理）：**`Controller:tray_layout_canvas()` 已删除** ✗✓',
    '--   它算的是"头像卡该摆哪"，而头像卡容器 `tray` 已在本次删除 ⇒ 恒返回 nil，',
    '--   `main.lua` 里的调用点（`if adapter.apply_tray_layout and controller.tray_layout_canvas`）也跟着删，',
    '--   ⇒ 真机日志里那行「找不到头像卡容器」不会再出现 ✓',
    '',
  ].join('\n'),
});

CUTS.push({
  f: MAIN, kind: 'range', tag: 'main.lua 里 apply_tray_layout 的调用（随 tray_layout_canvas 一起失效）',
  start: '  -- 头像卡按本关实际人数重新摆正（列数会随人数变，编辑器那套只是"最挤的情况"）',
  // ★ 结束锚点必须**紧贴**这段，否则会把下面的 `diagnose_overlap` / `diagnose_cell` 调用一起吃掉
  //   （第一版写成 `until: '\n  Murdoku.render(true)'` ⇒ 跨度 40 行 —— dry run 才看出来 ✗）
  until: '\n  -- ★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★',
  repl: [
    '  -- ★ 2026-10-18（优化组 · C 类清理）：头像卡重排的调用**已删除**（`tray_layout_canvas` 同时删了）',
    '  --   ⇒ 不再每局打「找不到头像卡容器」；`apply_tray_layout` 本体留到下一批处理 ✓',
    '',
  ].join('\n'),
});

// ── 预检 ──
let bad = 0;
for (const c of CUTS) {
  const src = files[c.f];
  if (c.kind === 'push') {
    const sp = spanOfPush(src, c.id);
    if (sp && !sp.dup && sp.start < sp.end) {
      console.log(`[OK] ${path.basename(c.f)} · ${c.tag}　L${src.slice(0, sp.start).split('\n').length}–L${src.slice(0, sp.end).split('\n').length}（${sp.text.split('\n').length} 行）`);
      c._span = [sp.start, sp.end];
    } else { console.log(`[✗] ${path.basename(c.f)} · ${c.tag}　${sp && sp.dup ? '同名多处' : '没找到'}`); bad++; }
  } else {
    const n = src.split(c.start).length - 1;
    const s = src.indexOf(c.start), t = src.indexOf(c.until, s + 1);
    const ok = n === 1 && s >= 0 && t > s;
    console.log(`[${ok ? 'OK' : '✗'}] ${path.basename(c.f)} · ${c.tag}　跨度 ${ok ? src.slice(s, t).split('\n').length : 0} 行`);
    if (!ok) bad++;
    c._span = ok ? [s, t] : null;
  }
}
if (bad) { console.error(`\n✗ 有 ${bad} 条锚点不成立 ⇒ 一个字节都不写`); process.exit(1); }

// ── 倒序应用（同文件内偏移都基于原文）──
for (const f of [UI, MAIN]) {
  const before = files[f].split('\n').length;
  const list = CUTS.filter((c) => c.f === f).sort((a, b) => b._span[0] - a._span[0]);
  let src = files[f];
  for (const c of list) src = src.slice(0, c._span[0]) + (c.repl ?? '') + src.slice(c._span[1]);
  files[f] = src;
  console.log(`${path.basename(f)}：${before} → ${src.split('\n').length} 行`);
}
if (!APPLY) { console.log('\n（DRY：什么都没写。要真删请加 --apply）'); process.exit(0); }

writeBack(UI, files[UI]);
writeBack(MAIN, files[MAIN]);

// ── 写后重读核对 ──
const ui = fs.readFileSync(UI, 'utf8').replace(/\r\n/g, '\n');
const mn = fs.readFileSync(MAIN, 'utf8').replace(/\r\n/g, '\n');
const code = (s) => s.split('\n').filter((l) => !l.trim().startsWith('--'));
const gone = (name) => !code(ui).some((l) => l.includes(`id = "${name}"`));
const checks = [
  ['toolbar 声明已删', gone('toolbar')],
  ['left 声明已删', gone('left')],
  ['tray 声明已删', gone('tray')],
  ['legend 声明已删', gone('legend')],
  ['board 声明已删', gone('board')],
  ['select 声明已删', gone('select')],
  ['clues.bar/up/down/track/knob/count/more 声明已删', ['clues.bar','clues.up','clues.down','clues.track','clues.knob','clues.count','clues.more'].every(gone)],
  ['room.label 声明已删', !code(ui).some((l) => l.includes('"room.label.'))],
  ['tray_layout_canvas 已删', !code(ui).some((l) => l.includes('tray_layout_canvas'))],
  ['main 里不再调 apply_tray_layout', !code(mn).some((l) => l.includes('apply_tray_layout'))],
  ['vm.tray 仍在使用（不能误删）', code(ui).some((l) => l.includes('vm.tray'))],
  ['placed_count 仍在', code(ui).some((l) => l.includes('function Controller:placed_count'))],
];
console.log('\n── 从磁盘重读核对 ──');
let allOk = true;
for (const [label, ok] of checks) { console.log('  ' + (ok ? '✅' : '✗ ') + ' ' + label); if (!ok) allOk = false; }
if (!allOk) { console.error('\n✗ 写盘后核对不通过'); process.exit(1); }
console.log('\n★ 已写盘');
