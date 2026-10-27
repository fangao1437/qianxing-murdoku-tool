// tools/sim/things_hint_probe.mjs —— 模拟器证据：`hint` 提示层 / `things` 家具素材 / 门墙 三条链
//
//   跑法（先建树；约 20 分钟，建一次就够）：
//     lua tools/dump_layout.lua && node tools/sim/build_hint_save.mjs   # → sim-save/hint-v255.save.json
//     node tools/sim/things_hint_probe.mjs
//
//   ★ 为什么不用"转存 .gil"：① 转存**丢脚本挂载**（运行时没有脚本 = 什么都不动）；
//     ② 模拟器**不实例化模板格子** ⇒ 整块棋盘只剩 cell.1.1。
//     这条链要"整块棋盘 + 脚本在跑" ⇒ 走 `layout-plan` 建树
//     （kit.mjs 2026-10-17 已把 hint / wall.* / door.* / things 按 397 存档**逐项补齐** ✓）
//
//   为什么用这个脚本而不是 MCP：MCP 每个动作回吐整份快照（≈12MB），
//   而这里要连续切两关、点两次卡片、读十几个子控件 ⇒ 走**同一个插件 Worker**，
//   把读数与截图落盘（证据性质相同：dsh-plugin-beyond-simulator 2.0.8 的试玩 Worker ✓）
//
//   ★ 只验**地址通不通**（控件存在 / 可见性 / 颜色），不验美术好不好看 —— 那是真机的事 ✓
import fs from 'node:fs';
import path from 'node:path';
import { makeController, OUT } from './kit.mjs';

const SAVE = process.env.SIM_SAVE || 'sim-save/hint-v256.save.json';
const TAG = process.argv[2] || 'things';
const hex = (v) => (typeof v === 'number' ? '0x' + (v >>> 0).toString(16).toUpperCase().padStart(8, '0') : String(v));

const c = await makeController();
await c.loadArchive(SAVE);
console.log('已载档 ' + SAVE);

const keep = [];
const note = (s) => { keep.push(s); console.log('  ' + s); };

// 从运行树里取 `cell.1.1` → 子控件（名字 / 可见性 / 颜色）
//   ★ 两种树形都要认：真机模板是 `cell → content → 子控件`；
//     模拟器建树（kit）把子控件**直接挂在 cell 下** ⇒ 两边都收 ✓
async function cell11() {
  const s = await c.play('get', { inspect: true });
  // ★ 把"图层贴格"那条日志也带出来（诊断"为什么没缩"）
  for (const l of s.logs || []) if (/图层贴格/.test(l.text) && !keep.includes(l.text)) keep.push('LOG ' + l.text);
  const out = {};
  const take = (ch) => {
    if (!ch || !ch.name) return;
    out[ch.name] = {
      visible: ch.visible, imageId: ch.imageId, imageColor: ch.imageColor,
      w: ch.sizeDeltaX, h: ch.sizeDeltaY,
    };
    for (const g of ch.children || []) if (g.name === 'content') take(g);
  };
  (function walk(nodes) {
    for (const n of nodes || []) {
      if (n && n.name === 'cell.1.1') {
        out.__self = { visible: n.visible, active: n.active, w: n.sizeDeltaX, h: n.sizeDeltaY };
        for (const ch of n.children || []) take(ch);
      }
      walk(n.children || []);
    }
  })(s.tree || []);
  return out;
}

const click = async (name) => {
  const r = await c.play('click', { name });
  const tail = (r.logs || []).slice(-2).map((x) => x.text);
  note('click ' + name + ' → ' + (tail.join(' | ') || '(无日志)'));
};
const settle = async (dt = 0.5) => { await c.play('pause', {}); await c.play('step', { dt }); };
const shot = async (name) => {
  const img = await c.playScreenshot();
  const f = path.join(OUT, name + '.png');
  fs.writeFileSync(f, Buffer.from(img.data, 'base64'));
  note('截图 → ' + path.basename(f));
};

let s = await c.play('start', { canvasId: 'mobile-16-9' });
note('start: running=' + s.running + ' mountError=' + JSON.stringify(s.mountError));
await settle(1.0);
await click('home.select'); await settle();
await click('hit.select.card.2'); await settle(0.8);   // 第 2 张卡 = case_001
let k = await cell11();
note('case_001 cell.1.1：obj=' + JSON.stringify(k.obj) + '  wall.up=' + JSON.stringify(k['wall.up'])
  + '  wall.left=' + JSON.stringify(k['wall.left']) + '  hint=' + JSON.stringify(k.hint));
await shot(TAG + '-1-case001');

const CASE1 = {
  objShown: k.obj && k.obj.visible === true,
  objColor: k.obj && (k.obj.imageColor >>> 0) === 0xFFB07946,     // 桌子 = 0xFFB07946
  wallUp: k['wall.up'] && k['wall.up'].visible === true,
  wallLeft: k['wall.left'] && k['wall.left'].visible === true,
  hintOff: !k.hint || k.hint.visible === false,
  // ★ 2026-10-17：三层必须"和格子一样大"（用户真机回报"溢出格子"）
  cellW: k.__self && k.__self.w,
  hintFit: k.hint && Math.abs(k.hint.w - (k.__self && k.__self.w)) < 0.6
    && Math.abs(k.hint.h - (k.__self && k.__self.h)) < 0.6,
  objFit: k.obj && Math.abs(k.obj.w - (k.__self && k.__self.w)) < 0.6,
  faceFit: k.face && Math.abs(k.face.w - (k.__self && k.__self.w)) < 0.6,
};

// ── 切到 case_002（第 3 张卡）；(1,1) 是椅子，且卡 2 的线索会点亮 (1,1) ──
await click('action.back'); await settle();
await click('hit.select.card.3'); await settle(0.8);
k = await cell11();
note('case_002 cell.1.1：obj=' + JSON.stringify(k.obj) + '  hint=' + JSON.stringify(k.hint));
const CASE2_BEFORE = { objColor: k.obj && (k.obj.imageColor >>> 0) === 0xFFE0A040, hintOff: !k.hint || k.hint.visible === false };

// 卡 1 的文字是「画廊助理 在 桌子 旁边」⇒ 点它选中 B ⇒ focused_clue = 2
//   ⇒ 线索 2 = n_on_object(椅子) ⇒ 高亮 (1,1) 与 (2,4) ⇒ cell.1.1 的 hint 应该亮
await click('clue.1.face'); await settle();
k = await cell11();
note('选中 B 之后：hint=' + JSON.stringify(k.hint));
await shot(TAG + '-2-hint-on');
const HINT_ON = k.hint && k.hint.visible === true;

await click('clue.1.face'); await settle();
k = await cell11();
note('取消选中之后：hint=' + JSON.stringify(k.hint));
await shot(TAG + '-3-hint-off');
const HINT_OFF = !k.hint || k.hint.visible === false;

console.log('\n===== 判定 =====');
const pass = {
  '第一关 (1,1) 是桌子 ⇒ obj 显示': CASE1.objShown,
  '第一关 obj 颜色 = 0xFFB07946（things/obj.table）': CASE1.objColor,
  '第一关 (1,1) 上边是墙 ⇒ wall.up 可见': CASE1.wallUp,
  '第一关 (1,1) 左边是墙 ⇒ wall.left 可见': CASE1.wallLeft,
  '第一关没选中 ⇒ hint 关闭': CASE1.hintOff,
  '第二关 (1,1) 是椅子 ⇒ obj 颜色 = 0xFFE0A040（things/obj.chair）': CASE2_BEFORE.objColor,
  '第二关没选中 ⇒ hint 关闭': CASE2_BEFORE.hintOff,
  '选中 B ⇒ cell.1.1 的 hint 打开': HINT_ON,
  '取消选中 ⇒ hint 关闭': HINT_OFF,
  // ★ 2026-10-17：格子 ' + CASE1.cellW + ' 像素时，三层都必须等于格子尺寸（不溢出）
  'hint 尺寸 == 格子尺寸（不溢出）': CASE1.hintFit,
  'obj 尺寸 == 格子尺寸（不溢出）': CASE1.objFit,
  'face 尺寸 == 格子尺寸（不溢出）': CASE1.faceFit,
};
let ok = 0, bad = 0;
for (const [k2, v] of Object.entries(pass)) { console.log((v ? '  PASS ' : '  FAIL ') + k2); v ? ok++ : bad++; }
console.log('  合计 ' + ok + ' 通过 / ' + bad + ' 失败');

const logFile = path.join(OUT, TAG + '.log.txt');
fs.writeFileSync(logFile, keep.join('\n'));
console.log('过程日志 → ' + logFile);
await c.play('stop', {});
await c.dispose();
process.exit(bad === 0 ? 0 : 1);
