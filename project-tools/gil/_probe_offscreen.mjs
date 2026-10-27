// tools/gil/_probe_offscreen.mjs —— ★ 只读：把 `.gil` 里**每个控件**按"引擎那样"累加父级偏移，
//   算出它在画布上的绝对位置，然后**点名跑出画布的控件** ✗
//
// ════════════════════════════════════════════════════════════════════════════
// ★★★ 为什么必须有它（2026-10-16 立 ✓ 用户报「首页四个按键不见了」）
// ════════════════════════════════════════════════════════════════════════════
//   ★ 教训 ✓：★ 上一轮我只对着**转换器读出来的存档**做对照 ✗ ——
//     而 `gil_to_save.mjs` 会**把 6 条"设计空间"记录救回来**（它自己报 `designNodes: 6` ✓）
//     ⇒ ★ 那 6 条在**真机**上是照原值用的 ✗（引擎不做这个救场 ✓）
//     ⇒ ★★ 「模拟器看着没事、真机跑出屏幕」的那种缺口，就是这么漏过去的 ✓✓
//   ⇒ ★ 本工具**只读 `.gil` 原始值**、不经过任何转换器 ✓ —— 引擎怎么读，它就怎么算 ✓
//
// ★ 口径（与 `gil_to_save.mjs` 头部写的一致 ✓）：
//   ★ `#504`（offset）= **控件中心在画布里的绝对坐标 − 画布中心**（画布 1600×900、y 向上 ✓）
//     —— ★ 也就是说：**它跟父级无关** ✗ ⇒ ★ 绝对位置 = 画布中心 + offset ✓（不累加父级 ✓）
//   ★ `#505`（size）= 画布像素 ✓
//   ⚠️ 本工具**两种口径都算**（`引擎口径A` 不累加 / `叠加口径B` 累加父级 ✓），
//     并**点名两者结论不一致的控件** ✓ —— ★ 那正是"记录的语义与引擎的读法打架"的地方 ✓
//
// ★ 用法：node tools/gil/_probe_offscreen.mjs <存档.gil> [--all]
//   ★ 默认只打「跑出画布」的 + 汇总；`--all` 打全部 ✓
// ════════════════════════════════════════════════════════════════════════════

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readGil, findChildListTop, asIdList } from './gilread.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const file = process.argv[2];
const ALL = process.argv.includes('--all');
if (!file) { console.error('用法: node tools/gil/_probe_offscreen.mjs <存档.gil> [--all]'); process.exit(2); }
// ★★★ 口径的最终判定（2026-10-16 ✓ 本条是**实测推断**，写清楚免得下一位再纠结）：
//   ★ `.gil` 的 `#504` = **绝对**（控件中心在画布里的位置 − 画布中心 ✓ 与父级无关 ✓）
//     · 依据①：本项目写 `.gil` 的工具（`add_button.mjs` / `set_control_size.mjs` / 本工具）
//       一直按"画布绝对中心"写 ✓，而它们写出来的控件**在真机上位置是对的** ✓
//     · 依据②：卡片的 `#504` 实测 = `(-374.175,-4.5)`，而它父级是 `root`（在 (0,0)）✓
//       —— 这一条两种口径**分不开** ✗，真正分开的是 `hud.progress`（父级 `right` 不在原点 ✓）：
//       ★ 它 `#504=(400,-265)` 按**绝对**读 = 屏幕右上角那块（进度文字该在的地方 ✓），
//         按"叠加父级"读 = 跑到画布外 ✗ ⇒ ★ **绝对** ✓✓
//   ★ 而**运行时的 `SetAnchoredPosition` 是"相对父级中心"** ✓（官方原文 ✓ 适配器为此专门做了
//     "减去父级中心"的换算 ✓）—— ★ 两者**不矛盾**：★ 引擎在读档时做一次转换 ✓，
//     脚本运行时写的是**另一套 API** ✓
//   ⇒ ★ 本工具**主判据 = 绝对口径** ✓；★ "叠加口径"只作为**提示**（两者结论不同时打一行 ✓）
const CW = 1600, CH = 900;

const g = readGil(path.isAbsolute(file) ? file : path.join(ROOT, file));
const byId = new Map(g.recs.map((r) => [r.id, r]));
const kids = (r) => {
  const cl = findChildListTop(r.field.sub);
  return cl ? (asIdList(cl.payload, true) || []).map((i) => byId.get(Number(i))).filter(Boolean) : [];
};

// #504 = 位置对（两个 float），#505 = 尺寸对
// ★ 2026-10-16 修 ✗：**分量缺失 = 0，不是"没有"** ✓（protobuf 稀疏编码：0 不写 ✓）
//   —— 旧写法要求两个分量都在，于是「x=0 的居中控件」被**静默跳过** ✗（本轮漏过一整片弹窗 ✓）
function msg2(blk, field) {
  const hit = (function w(fs) {
    for (const x of fs) {
      if (x.field === field && x.sub) return x.sub;
      if (x.sub) { const r2 = w(x.sub); if (r2) return r2; }
    }
    return null;
  })(blk.sub);
  if (!hit) return null;                       // 连"对"字段都没有 ⇒ 真没有
  const get = (n) => { const y = hit.find((z) => z.field === n); return y && typeof z_num(y) === 'number' ? z_num(y) : 0; };
  function z_num(y) { return typeof y.f === 'number' ? y.f : undefined; }
  return { a: get(501), b: get(502) };
}

const info = new Map();
for (const r of g.recs) {
  if (!r.name || !r.states || !r.states.length) continue;
  // ★ 2026-10-16 修 ✗：**不能只看第一个状态块** —— 「另存为模板」生成的按钮常常
  //   只有部分状态块带几何 ⇒ ★ 只看第一块会**静默跳过**它 ✗（本轮就这么漏掉过 `modal.exit` ✓）
  let off = null, size = null, blkIdx = -1;
  for (let i = 0; i < r.states.length; i++) {
    const o = msg2(r.states[i], 504), s2 = msg2(r.states[i], 505);
    if (o && s2) { off = o; size = s2; blkIdx = i; break; }
  }
  if (!off || !size) continue;
  const parent = (function find(rec) {
    for (const p of g.recs) if (kids(p).some((k) => k.id === rec.id)) return p;
    return null;
  })(r);
  info.set(r.id, { rec: r, name: r.name, off, size, blkIdx, parentId: parent ? parent.id : null, parentName: parent ? parent.name : null });
}
console.log('存档 ' + path.basename(file) + '　记录 ' + g.recs.length + '　带位置+尺寸的 ' + info.size
  + '（★ 取**第一个带几何的状态块** ✓）');

const abs = new Map();   // id -> {x,y} 叠加口径
function absOf(id, guard) {
  if (abs.has(id)) return abs.get(id);
  const me = info.get(id);
  if (!me) return { x: 0, y: 0 };
  if (guard > 24 || me.parentId == null) { const v = { x: me.off.a, y: me.off.b }; abs.set(id, v); return v; }
  const p = absOf(me.parentId, guard + 1);
  const v = { x: p.x + me.off.a, y: p.y + me.off.b };
  abs.set(id, v);
  return v;
}

const rows = [];
for (const [id, m] of info) {
  const a = absOf(id, 0);                                  // 叠加口径（引擎若按父级相对读）
  const c = { x: m.off.a, y: m.off.b };                    // 不叠加（引擎若按绝对读）
  const judge = (p) => {
    const cx = CW / 2 + p.x, cy = CH / 2 + p.y;             // 画布中心为原点，y 向上
    const L = cx - m.size.a / 2, R = cx + m.size.a / 2;
    const B = CH - (cy - m.size.b / 2), T = CH - (cy + m.size.b / 2);
    const inside = (R > 0 && L < CW && T > 0 && B < CH);          // 有没有一点点落在画布里
    const full = (L >= 0 && R <= CW && T >= 0 && B <= CH);        // ★ 是否**完全**在画布里
    return { L, R, T, B, inside, full };
  };
  const jA = judge(a), jC = judge(c);
  rows.push({ name: m.name, parent: m.parentName, off: m.off, size: m.size, abs: a, jAbs: jA, jRaw: jC,
    disagree: jA.inside !== jC.inside });
}

const outside = rows.filter((r) => !r.jRaw.full);
console.log('★ 合计：**完全在画布内**的 ' + (rows.length - outside.length) + ' 个'
  + '；★ **部分或完全出界**的 ' + outside.length + ' 个'
  + '（其中完全看不见的 ' + rows.filter((r) => !r.jRaw.inside).length + ' 个）');
console.log('  （主判据 = 绝对口径 ✓ 见文件头那段；"叠加口径结论不同"的 '
  + rows.filter((r) => r.disagree).length + ' 个，只作提示 ✓）');
console.log('');
const show = ALL ? rows : outside;
for (const r of show) {
  const f = (j) => `X[${j.L.toFixed(0)}..${j.R.toFixed(0)}] Y[${j.T.toFixed(0)}..${j.B.toFixed(0)}]`;
  const kind = r.jRaw.full ? '   ' : (r.jRaw.inside ? ' ⚠ ' : ' ✗ ');
  console.log(kind + r.name + '  父=' + (r.parent || '—')
    + '  记录 off=(' + r.off.a + ',' + r.off.b + ') size=' + r.size.a + '×' + r.size.b);
  console.log('      绝对口径 ' + f(r.jRaw) + (r.jRaw.full ? '' : (r.jRaw.inside ? ' ⚠部分出界' : ' ✗完全出界'))
    + (r.disagree ? '　（叠加口径给的是 ' + f(r.jAbs) + ' ⇒ 两者结论不同，本工具主判据取绝对 ✓）' : ''));
}

// ── ② ★ NaN 普查（★ 2026-10-16 追加）────────────────────────────────────────
//   ★ 为什么也要看：★ `SetAnchor/SetSize` 只要有一个是 NaN ⇒ ★ 这颗控件的矩形**算不出来** ✗
//     ⇒ ★ 真机上表现成"**看不见却吃整屏点击**" ✓（本项目 2026-10-15 为这个查了一整晚 ✓）
//   ★ 以前脚本每帧写几何 ⇒ 顺手把 NaN 盖掉了 ✗；★ 现在几何归编辑器 ⇒ **NaN 会露出来** ✓
function nanCount(blk) {
  let n = 0;
  const scan = (fs, inPair) => {
    for (const x of fs) {
      if (x.wt === 5 && inPair) { const v = x.f; if (typeof v === 'number' && Number.isNaN(v)) n += 1; }
      if (x.sub) scan(x.sub, x.field === 504 || x.field === 505);
    }
  };
  scan(blk.sub, false);
  return n;
}
const nanRecs = [];
for (const r of g.recs) {
  if (!r.name || !r.states) continue;
  let n = 0;
  for (const b of r.states) n += nanCount(b);
  if (n > 0) nanRecs.push({ name: r.name, n });
}
nanRecs.sort((a, b) => b.n - a.n);
console.log('');
console.log('── NaN 位置/尺寸浮点普查 ──');
console.log('★ 有 NaN 的控件 ' + nanRecs.length + ' 个，NaN 浮点合计 '
  + nanRecs.reduce((s, r2) => s + r2.n, 0) + ' 个');
for (const r of nanRecs.slice(0, ALL ? nanRecs.length : 20)) console.log('   ' + r.name + '  NaN×' + r.n);
