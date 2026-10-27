// tools/sim/clue_hint_probe.mjs —— 模拟器证据：选中线索卡 ⇒ 棋盘出现半透明浅蓝高亮
//
//   跑法：node tools/sim/clue_hint_probe.mjs
//   前置：node tools/sim/build_hint_save.mjs（用 layout-plan 建树 + 内联 dist 脚本 ⇒ sim-save/hint-v254.save.json）
//
//   为什么用这个脚本而不是 MCP 的 `qxqy_studio_play`：
//     MCP 每次动作都回吐整份快照（≈12MB），而本探针要连续做 6 个动作、取四张图、读几十个格子颜色 ⇒
//     走**同一个插件 Worker**（`SimulatorController` / `play` / `playScreenshot`），
//     把截图、日志、读数落到磁盘，避免把几百 MB JSON 塞进对话。
//     ★ 证据性质相同：都是 dsh-plugin-beyond-simulator 2.0.8 的试玩 Worker ✓
//   ★ 读数判据（比截图强）：直接读 `cell.r.c.face.imageColor`
//       · 有高亮时：被提示的格子 = 0x809ED8FF（半透明浅蓝）、其它格 = 房间色
//       · 取消选中后：全部回到房间色（不再是 0x809ED8FF）
import fs from 'node:fs';
import path from 'node:path';
import { makeController, OUT } from './kit.mjs';

const SAVE = 'sim-save/hint-v254.save.json';
const TAG = process.argv[2] || 'hint';
const HINT = 0x809ED8FF;
// ★ 引擎把 imageColor 存成**有符号 int32**（0x809ED8FF 读回来是 -2137073409）
//   ⇒ 比较前一律 `>>> 0` 归成无符号，否则"值其实对了"也会判红 ✓
const u = (v) => (typeof v === 'number' ? v >>> 0 : v);
const hex = (v) => (typeof v === 'number' ? '0x' + (v >>> 0).toString(16).toUpperCase().padStart(8, '0') : String(v));

const c = await makeController();
await c.loadArchive(SAVE);
console.log('已载档 ' + SAVE);

const keep = [];
const note = (s) => { keep.push(s); console.log('  ' + s); };
const snap = async () => c.play('get', { compact: true });

// 取若干格子的 face.imageColor（运行时真值）
async function colors(cells) {
  const s = await c.play('get', { inspect: true });
  const out = {};
  const want = new Set(cells.map((x) => 'cell.' + x[0] + '.' + x[1]));
  (function walk(nodes) {
    for (const n of nodes || []) {
      if (n && n.name && n.name === 'face' && n.kind === 'image' && n.__parentWanted) out[n.__cell] = n.imageColor;
      if (n && n.name && want.has(n.name)) {
        for (const ch of n.children || []) {
          if (ch && ch.name === 'face') out[n.name] = ch.imageColor;
        }
      }
      walk(n.children || []);
    }
  })(s.tree || []);
  return out;
}

const pick = async (cells) => {
  const m = await colors(cells);
  const line = cells.map((x) => 'cell.' + x[0] + '.' + x[1] + '=' + hex(m['cell.' + x[0] + '.' + x[1]])).join('  ');
  note(line);
  return m;
};

const click = async (name) => {
  const r = await c.play('click', { name });
  const tail = (r.logs || []).slice(-2).map((x) => x.text);
  note('click ' + name + ' → ' + (tail.join(' | ') || '(无日志)'));
};
const settle = async (dt = 0.5) => { await c.play('pause', {}); await c.play('step', { dt }); };
const shot = async (name) => {
  const img = await c.playScreenshot();
  const file = path.join(OUT, name + '.png');
  fs.writeFileSync(file, Buffer.from(img.data, 'base64'));
  note('截图 → ' + path.basename(file) + '（frame ' + img.frame + '）');
};

let s = await c.play('start', { canvasId: 'mobile-16-9' });
note('start: running=' + s.running + ' mountError=' + JSON.stringify(s.mountError));
await settle(1.0);

// 主页 → 选关 → 第 2 张卡（= case_001；第 1 张是框架自检关）
await click('home.select');
await settle();
await click('hit.select.card.2');
await settle(0.8);
s = await snap();
note('关卡内：canvas=' + s.canvasWidth + 'x' + s.canvasHeight + ' time=' + s.time.toFixed(2));

// 第一关卡 5 的两格 + 一个不该亮的格
const C5 = [[2, 2], [3, 1]];
const OTHER = [[1, 5]];
const ALL = C5.concat(OTHER);
const before = await pick(ALL);
await shot(TAG + '-1-before');

// ★ 模拟器走【老卡片】路径：卡片头像发的是 `suspect id = 卡上文字里那个人`
//   ⇒ 卡 1 的文字是「收藏家 在第 5 列」⇒ 点它 = 选中 V ⇒ focused_clue = 5（V 那一行）
//   （真机走网格列表项：点第 i 张卡 = 选中**第 i 行那个人**，见 _on_grid_item_click）
await click('clue.1.face');       // 选中 V ⇒ focused_clue = 5 ⇒ 卡 5 的两格亮
await settle();
const picked = await pick(ALL);
await shot(TAG + '-2-hint-card5');

await click('clue.1.face');       // 再点一次 = 取消
await settle();
const cleared = await pick(ALL);
await shot(TAG + '-3-cleared');

// 卡 4 的文字是「夜班清洁工 站在 椅子 上」⇒ 点它 = 选中 C ⇒ focused_clue = 3（C 那一行）
//   ⇒ 高亮卡 3 的线索（只有 A 站在地毯上）= 地毯四格
await click('clue.4.face');
await settle();
const card3 = await pick([[3, 1], [3, 2], [2, 4], [2, 5], [4, 2]]);
await shot(TAG + '-4-card3');

// ── 判定（不靠肉眼，直接比数值）──────────────────────────────────────────
const pass = {
  '没选中时没有提示色': u(before['cell.2.2']) !== HINT && u(before['cell.3.1']) !== HINT,
  '选中 V ⇒ 卡 5 的 (2,2) 是半透明浅蓝': u(picked['cell.2.2']) === HINT,
  '选中 V ⇒ 卡 5 的 (3,1) 是半透明浅蓝': u(picked['cell.3.1']) === HINT,
  '选中 V ⇒ 非本卡的 (1,5) 不是提示色': u(picked['cell.1.5']) !== HINT,
  '取消选中 ⇒ (2,2) 回到原色': u(cleared['cell.2.2']) === u(before['cell.2.2']),
  '取消选中 ⇒ (3,1) 回到原色': u(cleared['cell.3.1']) === u(before['cell.3.1']),
  '选中 C ⇒ 卡 3 的地毯四格全亮': [['3','1'],['3','2'],['2','4'],['2','5']].every(([r,cc]) => u(card3['cell.'+r+'.'+cc]) === HINT),
  '换人之后上一张卡的格灭掉': u(card3['cell.4.2']) !== HINT,
};
console.log('\n===== 判定 =====');
let ok = 0, bad = 0;
for (const [k, v] of Object.entries(pass)) { console.log((v ? '  PASS ' : '  FAIL ') + k); v ? ok++ : bad++; }
console.log('  合计 ' + ok + ' 通过 / ' + bad + ' 失败');

const logFile = path.join(OUT, TAG + '.log.txt');
fs.writeFileSync(logFile, keep.join('\n'));
console.log('过程日志 → ' + logFile);

await c.play('stop', {});
await c.dispose();
process.exit(bad === 0 ? 0 : 1);
