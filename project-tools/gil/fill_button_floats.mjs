// tools/gil/copy_state_floats.mjs —— 把【原型】状态块里的浮点补进【目标】（★ 只补缺失 / NaN ✓）
//
// ════════════════════════════════════════════════════════════════════════════
// 为什么需要它（2026-10-15 / 10-16 真机判决，两轮 ✓）
// ════════════════════════════════════════════════════════════════════════════
//
//   ★★ 起因：`add_button.mjs` 克隆 `home.select` 造 `settle.btn` 时，
//     **只克隆了记录本身与子控件** ✗ —— ★ 状态块里那几对"布局浮点"是 **NaN** ✓
//
//   ★ 对照实测（`374`，四个状态块完全一致 ✓）：
//       home.select : #501=1,1,1  #502=0.5,0.5  #503=0.5,0.5  #506=0.5,0.5
//       settle.btn  : #501=NaN…   #502=NaN…     #503=NaN…     #506=NaN…
//   ⇒ ★★ 结局一（v244 修）：★ **位置/尺寸我写对了、设备回读也对** ✓
//      ★ 但**锚点/轴心是 NaN** ✗ ⇒ ★ 矩形算不出来 ⇒ ★ **整屏都算命中** ✓✓
//
//   ★★ 结局二（v245 修，本轮）：★ 修好按钮自己之后，用户回报
//      「★ **全屏问题解决了，四个方块删掉了，但两颗结算按钮还是没出现**」✓
//      ⇒ ★ 一查子控件 ✓：★ **`bg` / `label` 十二个浮点全是 NaN** ✗（**位置和尺寸都含在内** ✓）
//        ★ 而原型那边（`home.select.bg` pos=0.000061 size=97×43 ✓ / `label` size=59×40 ✓）**一个 NaN 都没有** ✓
//      ⇒ ★★ **子控件画不出来 ⇒ 按钮上什么都没有** ✓（★ 同一个病，落在下一层 ✓）
//
// ⚠️ 规矩（本仓老规矩 ✓）：
//   · ★ **只补 NaN / 缺失** ✓ —— 有值的**一个字都不动** ✓
//   · ★ 目标自己的 `#504`/`#505`（位置/尺寸）**不碰** ✓（那是脚本/工具写进去的正确值 ✓）
//   · ★ 子控件走 `--also` **按点名给值** ✓（它们本来就该由我们定 ✓）
//   · ★ 写盘走 `writeGil()`（往返 ＋ 从磁盘重读 ＋ 字段 diff 三道闸 ✓）
//
// ════════════════════════════════════════════════════════════════════════════
// 用法
// ════════════════════════════════════════════════════════════════════════════
//   node tools/gil/copy_state_floats.mjs --in=<in.gil> --out=<out.gil> \
//        --from=<原型名> --to=<目标名> \
//        [--also="bg=217x60@0,0;label=28x28@0,0"] [--dry]
//
//   ★ `--also` 的值 = `<宽>x<高>@<x>,<y>` ✓（位置相对**目标控件的中心** ✓ 省略 `@` 即 0,0 ✓）
//   ★ 多条子控件用 **`;`** 分隔 ✓ —— ★ 别用逗号 ✗（逗号是 `@x,y` 里面的分隔符 ✓ 我踩过 ✓）
//   ★ ⚠️ `readGil` 的记录**没有** `children` 字段 ✗ —— 子控件要按**子列表**取 ✓（也踩过 ✓）
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readGil, findChildListTop, asIdList } from './gilread.mjs';
import { writeGil } from './gilwrite.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const argv = process.argv.slice(2);
const argOf = (k) => { const a = argv.find((s) => s.startsWith('--' + k + '=')); return a ? a.slice(k.length + 3).replace(/^"|"$/g, '') : null; };
const DRY = argv.includes('--dry');

const IN = argOf('in'), OUT = argOf('out'), FROM = argOf('from'), TO = argOf('to');
if (!IN || !OUT || !FROM || !TO) {
  console.error('用法: node tools/gil/copy_state_floats.mjs --in=<in.gil> --out=<out.gil> --from=<原型名> --to=<目标名> [--also="bg=WxH@x,y;label=WxH@x,y"] [--dry]');
  process.exit(1);
}

const g = readGil(path.isAbsolute(IN) ? IN : path.join(ROOT, IN));
const src = g.byName.get(FROM), dst = g.byName.get(TO);
if (!src) { console.error('找不到原型 ' + FROM); process.exit(2); }
if (!dst) { console.error('找不到目标 ' + TO); process.exit(3); }
const byId = new Map(g.recs.map((r) => [r.id, r]));

// ── 子控件：★ 按【子列表】取，不用 `children` ✗（记录没这个字段）──────────────
function kidsOf(rec) {
  const cl = findChildListTop(rec.field.sub);
  if (!cl) return [];
  return (asIdList(cl.payload, true) || []).map((i) => byId.get(Number(i))).filter(Boolean);
}

// ── `--also` 解析（多条用 `;` ✓）────────────────────────────────────────────
const ALSO = (argOf('also') || '').split(';').map((s) => s.trim()).filter(Boolean).map((spec) => {
  const eq = spec.indexOf('=');
  if (eq < 0) { console.error('--also 语法：名字=<宽>x<高>@<x>,<y>'); process.exit(7); }
  const name = spec.slice(0, eq).trim();
  const val = spec.slice(eq + 1).trim();
  const m = /^([\d.]+)x([\d.]+)(?:@(-?[\d.]+),(-?[\d.]+))?$/.exec(val);
  if (!m) { console.error('--also 的值看不懂：' + val); process.exit(7); }
  return { name, w: Number(m[1]), h: Number(m[2]),
           x: m[3] !== undefined ? Number(m[3]) : 0, y: m[4] !== undefined ? Number(m[4]) : 0 };
});

// ── 把一个状态块摊平成 path → wt5 字段 ──────────────────────────────────────
function floats_(blk) {
  const m = new Map();
  (function w(fs, p) {
    for (const f of fs) {
      if (f.wt === 5) m.set(p + '/#' + f.field, f);
      if (f.sub) w(f.sub, p + '/#' + f.field);
    }
  })(blk.sub, '');
  return m;
}

// ── 给一条记录补浮点（只补 NaN/缺失 ✓；`over` 优先于原型 ✓）────────────────
const detail = [];
function fillOne(target, proto, over, tag) {
  let n = 0;
  for (let i = 0; i < target.states.length; i++) {
    const a = proto && proto.states[i] ? floats_(proto.states[i]) : new Map();
    const b = floats_(target.states[i]);
    for (const [p, bs] of b) {
      if (Number.isFinite(bs.f)) continue;
      let v = null;
      if (over && over.has(p)) v = over.get(p);
      else if (a.has(p) && Number.isFinite(a.get(p).f)) v = a.get(p).f;
      if (v === null) continue;
      detail.push('blk' + i + ' ' + tag + ' ' + p + ' : NaN → ' + v);
      bs.f = v; n++;
    }
  }
  return n;
}

if (src.states.length !== dst.states.length) {
  console.error('状态块数量不同：原型 ' + src.states.length + ' 目标 ' + dst.states.length);
  process.exit(4);
}

let filled = 0, kept = 0, missing = 0;

// ① 目标自己：只补"布局浮点" ✓（`#504`/`#505` 不碰 ✓）
for (let i = 0; i < dst.states.length; i++) {
  const a = floats_(src.states[i]);
  const b = floats_(dst.states[i]);
  for (const [p, bs] of b) {
    if (p.indexOf('/#504/') === 0 || p.indexOf('/#505/') === 0) { kept++; continue; }
    if (Number.isFinite(bs.f)) { kept++; continue; }
    const as = a.get(p);
    if (!as || !Number.isFinite(as.f)) { missing++; continue; }
    detail.push('blk' + i + ' ' + TO + ' ' + p + ' : NaN → ' + as.f);
    bs.f = as.f; filled++;
  }
}

// ② 子控件：★ 连 `#504`/`#505` 一起补 ✓（它们本来就是 NaN ✓）
for (const spec of ALSO) {
  const dstKid = kidsOf(dst).find((c) => c.name === spec.name);
  if (!dstKid) { console.error('目标 ' + TO + ' 下面找不到子控件 ' + spec.name); process.exit(8); }
  const protoKid = kidsOf(src).find((c) => c.name === spec.name) || null;
  const over = new Map([
    ['/#504/#501', spec.x], ['/#504/#502', spec.y],
    ['/#505/#501', spec.w], ['/#505/#502', spec.h],
  ]);
  const n = fillOne(dstKid, protoKid, over, TO + '.' + spec.name);
  console.log('    └ ' + spec.name + '：补 ' + n + ' 个（pos ' + spec.x + ',' + spec.y
    + ' size ' + spec.w + 'x' + spec.h + '）');
  filled += n;
}

console.log('原型 ' + FROM + ' #' + src.id + ' → 目标 ' + TO + ' #' + dst.id);
console.log('  补上 ' + filled + ' 个浮点 / 保持 ' + kept + ' 个 / 原型也没有 ' + missing + ' 个');
for (const d of detail.slice(0, 12)) console.log('    ' + d);
if (detail.length > 12) console.log('    …（共 ' + detail.length + ' 条）');

if (DRY) { console.log('--dry：不写文件'); process.exit(0); }
if (filled === 0) { console.log('（没有需要补的，不写文件）'); process.exit(0); }

const rep = writeGil(g, path.isAbsolute(OUT) ? OUT : path.join(ROOT, OUT), {
  label: '补状态块浮点：' + TO + ' ← ' + FROM,
  assert: (g2) => {
    const bad = [];
    const s2 = g2.byName.get(FROM), d2 = g2.byName.get(TO);
    const geom = (r) => r.states.map((blk) => {
      const pair = (n) => { const p = blk.sub.find((x) => x.field === n); if (!p || !p.sub) return 'null';
        return p.sub.filter((x) => x.wt === 5).map((x) => x.f).join(','); };
      return pair(504) + '|' + pair(505);
    }).join('  ');
    // ① 目标自己：位置/尺寸一位不许变 ✓
    if (geom(dst) !== geom(d2)) bad.push('目标几何被改动了 ✗');
    // ② 原型（含其子控件）一字不许动 ✓
    if (geom(src) !== geom(s2)) bad.push('原型被改动了 ✗');
    for (const spec of ALSO) {
      const sk0 = kidsOf(src).find((c) => c.name === spec.name);
      const sk1 = kidsOf(s2).find((c) => c.name === spec.name);
      if (sk0 && sk1 && geom(sk0) !== geom(sk1)) bad.push('原型的子控件 ' + spec.name + ' 被改动了 ✗');
      const dk1 = kidsOf(d2).find((c) => c.name === spec.name);
      if (!dk1) { bad.push('子控件 ' + spec.name + ' 回读不到'); continue; }
      // ③ 子控件回读必须**一个 NaN 都不剩** ✓（这正是本轮的目的 ✓）
      let nan = 0;
      for (const [, f] of floats_(dk1.states[0])) if (!Number.isFinite(f.f)) nan++;
      if (nan > 0) bad.push('子控件 ' + spec.name + ' 回读仍有 ' + nan + ' 个 NaN');
    }
    return bad.length ? bad.join('；') : true;
  },
});
console.log('  输出：' + path.basename(OUT) + '（' + rep.bytes + ' 字节，记录 ' + rep.recs
  + ' 条，字段差异 ' + rep.diffs + ' 处）');
