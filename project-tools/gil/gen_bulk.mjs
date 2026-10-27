// tools/gil/gen_bulk.mjs —— **批量生成界面控件存档**（101 个控件）
//
// 依据（全部真机验证过，见 docs/千星存档-gil格式.md 第四之二/四之三节）：
//   · 体是单个 protobuf 消息，重编码逐字节可还原；
//   · 控件记录：控件ID(#501) / 父ID(#504 varint) / 实例名(字符串) / 四个状态块；
//   · 状态块 = 同时含 #504(位置, 空消息表示 0,0) 与 #505(尺寸, 两浮点) 的节点；
//   · **必须同时写两处**：① 控件记录；② **父控件的子控件 ID 列表**(纯 varint 的字段)。
//     只写①→文件能解析但游戏里看不见（踩过）。
//   · 克隆原型时**必须清空原型自己的子列表**，否则副本会认领原型的子控件。
//   · 几何映射：面板 Y = 父中心 Y + 存储的 y（用 box/btn/label 三点验证）。
//
// 数据来源：`tools/sim/out/layout-plan.json`（150 节点 = 8 容器 + 2 面板 + 91 按钮 + 49 文本）
//   · 49 个 `cell.*` 按钮由**脚本运行时**从 tpl.cell 生成 → **跳过**，不写进存档；
//   · 其余 101 个要写；
//   · 存档里已存在且位置已与规划一致的（`root` / `board`）→ **复用，不重建**。
//
// 原型（用户在编辑器里亲手命名，实测可用）：
//   container/panel → `board`    button → `proto.btn`    text → `proto.text`
//
// 用法：
//   node tools/gil/gen_bulk.mjs --probe
//   node tools/gil/gen_bulk.mjs --out=<路径>
//
// ★★★★ 2026-10-07：**本文件是自包含的** —— 它【不 import gilread.mjs】，自己抄了一套
//   readVarint/writeVarint/parse/encode/geomPairs/stateBlocks/bigIds/texts/asIdList/
//   findChildList/setChildList/findChildListTop/ensureChildListTop/cloneField/setPair。
//   ⇒ **改 gilread.mjs 不会影响本文件**；两边的临界函数只能手动保持同步。
//   ⇒ 每次改完公共库或本文件，跑 `node tools/gil/check_childlist_top.mjs`
//     （它会比对 gen_bulk 的副本与公共库是否仍然同构，并扫出旧写法）。
//
// ════════════════════════════════════════════════════════════════════════════
// ★★★★ 2026-10-10 **本文件的 `encode` 有一个【已知静默损坏】✗✓（动手前必读）**
// ════════════════════════════════════════════════════════════════════════════
//
//   ★ 逐行比对结论（★ 精确 ✓，别照抄别人的传言 ✗）：
//     · ★ **`#503` 这一条：本文件是【对的】✓** —— 第 102 行是
//         `f.sub !== null ? encode(f.sub) : payload`
//       ★ 它**没有**那个把 96% 的树冻死的 `#503` 特例 ✗ ⇒ ★ **本文件未受那次回归影响** ✓
//       （★ `gilread.mjs` 是**先**被加上 `field !== 503` 特例、**再**被我改回按类型判定 ✓；
//        本文件从来没同步过那个特例 ⇒ ★ 反而避开了 ✓）
//     · ★★ **`wt1` 这一条：本文件【是错的】✗** —— 第 101 行
//         `else if (f.wt === 1) parts.push(Buffer.alloc(8));`
//       ★ **wt1（fixed64）被无条件写成 8 个零** ✗ ⇒ ★ 凡被递归到的 wt1 字段**值全部清零** ✗
//       ★ 实测证据 ✓：`290.gil` / `295` / `296` 里各有 **2 个** wt1 字段，
//         **原始 8 字节非零** ✗：
//             #134217824  c786808004c68680
//             #134217829  af86808004ad8680
//       ★ 位置：**depth 3**，在一个**真消息 `#503`** 底下 ✓
//     ⇒ ★★★ **后果**：★ 只要用本文件处理**带 wt1 字段的存档**，
//       ★ **这 16 字节会被静默清零** ✗ —— ★ 不报错、不提示 ✓（★ 这正是"静默损坏" ✓）
//     ⇒ ★★ **修法（2 行）**：
//       ① `parse` 的 wt1 分支保留原始字节：`raw: Buffer.from(b.subarray(p, p + 8))`
//       ② `encode` 的 wt1 分支改成：`parts.push(f.raw && f.raw.length === 8 ? f.raw : Buffer.alloc(8))`
//       ★ 对照实现见 `gilread.mjs` 的 `parseMsg`/`encodeMsg`（★ 已修 ✓）
//         与独立闸门 `roundtrip.mjs:114`（它一直是对的做法 ✓）
//     ⇒ ★★★ **根治方向**：★ 把本文件统一到 `gilread.mjs` + `writeGil()` ✓
//       （★ 见 `docs/工具目录.md` ✓）—— ★ **在统一之前，别用本文件去改"已有存档"** ✗，
//       ★ 尤其别改 `290` 之后的存档 ✓
//     ⚠️ ★ 本警告**只写了事实与修法，没有动代码** ✗ ——
//       ★ 因为改编码器**必须**配一次端到端验证 ✓（★ 本项目铁律 ✓）；
//       ★ 未验证就改 = 可能再造一次 2026-10-10 的事故 ✗

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// ⚠️ 不能用 new URL(import.meta.url).pathname —— 路径含中文时会被百分号编码
//    （实测报 "缺基准存档：D:\%E6%96%B0..."）。必须用 fileURLToPath。
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const argv = process.argv.slice(2);
const argOf = (k) => { const a = argv.find((s) => s.startsWith('--' + k + '=')); return a ? a.slice(k.length + 3) : null; };
const DRY = argv.includes('--probe');

const BASE = argOf('in') || path.join(ROOT, '存档.gil');
const OUT = argOf('out') || path.join(ROOT, '完整界面.gil');
const PLAN = argOf('plan') || path.join(ROOT, 'tools', 'sim', 'out', 'layout-plan.json');
// ★ 2026-10-07 新增 `--exclude=`：逗号分隔的**排除名单**，`名字*` 表示前缀匹配。
//   用途：`hex.*` / `hit.*` 这 14 个在 `entry_client_script.lua` 的 `auto_create_only`
//   白名单里，是**脚本唯一的自动创建通道** —— 脚本建它们时会自己挂底图子控件；
//   我们若也建一份，就变成"编辑器静态控件、没有子控件结构"⇒ SetImage 大量失败 + 按键消失。
//   例：--exclude="hex.*,hit.*"
const EXCLUDE = (argOf('exclude') || '').split(',').map((s) => s.trim()).filter(Boolean);
const excludedBy = (id) => EXCLUDE.some((pat) => pat.endsWith('*') ? id.startsWith(pat.slice(0, -1)) : id === pat);
// ★ 2026-10-07 新增 `--only=`：逗号分隔的**白名单**（`名字*` 前缀匹配）。
//   为什么必须有它：规划是**全关卡的并集**（369 个节点），直接跑 gen_bulk 会一次建 300 个控件 ——
//   而本轮只允许建 `modal` 那一套（19 个）。`--only=modal` 就只建 `modal` + `modal.*`。
//   （`--exclude` 用来挡"脚本会自动创建"的那 14 个；两者可同时给。）
const ONLY = (argOf('only') || '').split(',').map((s) => s.trim()).filter(Boolean);
const onlyBy = (id) => ONLY.length === 0 || ONLY.some((pat) => pat.endsWith('*') ? id.startsWith(pat.slice(0, -1)) : id === pat);
for (const [k, p] of Object.entries({ 基准存档: BASE, 布局计划: PLAN })) {
  if (!fs.existsSync(p)) { console.error('缺' + k + '：' + p); process.exit(1); }
}

const src = fs.readFileSync(BASE);
const HEAD = 20;
const hdr = []; for (let i = 0; i < 5; i++) hdr.push(src.readUInt32BE(i * 4));
const BODY_END = HEAD + hdr[4];
const TRAILER = src.subarray(BODY_END);
console.log('基准：' + path.basename(BASE) + '（' + src.length + ' 字节）  尾 ' + TRAILER.toString('hex'));

// ── protobuf 线格式 ───────────────────────────────────────────────────────
function readVarint(b, p, lim) {
  let r = 0n, s = 0n, n = 0; const e = lim === undefined ? b.length : lim;
  while (p < e) { const x = b[p++]; n++; r |= BigInt(x & 0x7f) << s; if ((x & 0x80) === 0) return { v: r, p }; s += 7n; if (n > 10) return null; }
  return null;
}
function writeVarint(v) { const o = []; let x = BigInt(v); do { let b = Number(x & 0x7fn); x >>= 7n; if (x > 0n) b |= 0x80; o.push(b); } while (x > 0n); return Buffer.from(o); }
function parse(b, from, to, d) {
  const out = []; let p = from;
  while (p < to) {
    const s0 = p; const t = readVarint(b, p, to); if (!t || t.v === 0n) return null;
    const field = Number(t.v >> 3n), wt = Number(t.v & 7n); if (!field) return null; p = t.p;
    if (wt === 0) { const v = readVarint(b, p, to); if (!v) return null; p = v.p; out.push({ field, wt, num: v.v, s0, s1: p }); }
    else if (wt === 2) {
      const l = readVarint(b, p, to); if (!l) return null; const bs = l.p, be = bs + Number(l.v); if (be > to) return null; p = be;
      const pay = b.subarray(bs, be); let bad = 0;
      for (let i = 0; i < pay.length; i++) { const c = pay[i]; if (c < 9 || (c > 13 && c < 32)) bad++; }
      const isText = bad === 0 && pay.length > 0 && !pay.toString('utf8').includes('\ufffd');
      let sub = null; if (!isText && d < 18 && pay.length >= 2) sub = parse(b, bs, be, d + 1);
      out.push({ field, wt, len: Number(l.v), payload: pay, isText, sub, s0, s1: p, bs, be });
    } else if (wt === 5) { if (p + 4 > to) return null; out.push({ field, wt, f: b.readFloatLE(p), s0, s1: p + 4 }); p += 4; }
    else if (wt === 1) { if (p + 8 > to) return null; out.push({ field, wt, s0, s1: p + 8 }); p += 8; }
    else return null;
  }
  return p === to ? out : null;
}
function encode(fields) {
  const parts = [];
  for (const f of fields) {
    parts.push(writeVarint(BigInt(f.field) * 8n + BigInt(f.wt)));
    if (f.wt === 0) parts.push(writeVarint(f.num));
    else if (f.wt === 5) { const b = Buffer.alloc(4); b.writeFloatLE(f.f); parts.push(b); }
    else if (f.wt === 1) parts.push(Buffer.alloc(8));
    else { const body = f.sub !== null ? encode(f.sub) : (f.payload || Buffer.alloc(0)); parts.push(writeVarint(BigInt(body.length))); parts.push(body); }
  }
  return Buffer.concat(parts);
}

const tree = parse(src, HEAD, BODY_END, 0);
if (!tree) { console.error('基准体解析失败'); process.exit(2); }

// ── 找控件记录 ────────────────────────────────────────────────────────────
function geomPairs(fields, out) {
  for (const f of fields) { if (f.sub && f.sub.length === 2 && f.sub[0].wt === 5 && f.sub[1].wt === 5) out.push(f); if (f.sub) geomPairs(f.sub, out); }
  return out;
}
function stateBlocks(fields, out) {
  for (const f of fields) {
    if (!f.sub) continue;
    const p504 = f.sub.find((g) => g.field === 504), p505 = f.sub.find((g) => g.field === 505);
    if (p504 && p505 && p505.sub) {
      const fl = p505.sub.filter((x) => x.wt === 5);
      if (fl.length === 2 && f.sub.length >= 5) { out.push(f); continue; }
    }
    stateBlocks(f.sub, out);
  }
  return out;
}
function bigIds(fields, out) {
  for (const f of fields) { if (f.wt === 0 && f.field === 501 && f.num > 1073000000n && f.num < 1074200000n) out.push(f); if (f.sub) bigIds(f.sub, out); }
  return out;
}
function texts(fields, out) {
  for (const f of fields) { if (f.wt === 2 && f.isText && f.len <= 64) out.push(f); if (f.sub) texts(f.sub, out); }
  return out;
}
const ID_LO = 1073000000n, ID_HI = 1074200000n;
function asIdList(pay, allowEmpty) {
  if (pay.length === 0) return allowEmpty ? [] : null;
  const ids = []; let p = 0;
  while (p < pay.length) { const v = readVarint(pay, p, pay.length); if (!v) return null; if (v.v < ID_LO || v.v > ID_HI) return null; ids.push(Number(v.v)); p = v.p; }
  return ids;
}
function findChildList(fields) {
  let hit = null;
  (function scan(fs) {
    for (const f of fs) {
      if (hit) return;
      if (f.wt === 2 && f.sub === null && !f.isText && f.payload && asIdList(f.payload, false) !== null) { hit = f; return; }
      if (f.sub) scan(f.sub);
    }
  })(fields);
  return hit;
}
function setChildList(f, ids) { f.payload = ids.length ? Buffer.concat(ids.map((i) => writeVarint(i))) : Buffer.alloc(0); f.len = f.payload.length; }
// ★★★★★ 2026-10-07 **只认【顶层】的子列表** ✗✓ —— 修"导不进去"的关键 ✓
//
//   ★ 踩过的坑（★ 206 轮就记过 ✓ 2026-09-30 ✓ 我 2026-10-07 又踩了一次 ✓）：
//     indChildList 是**递归**的 ✗ ⇒ 给一个"原本没有子控件"的容器挂子控件时，
//     顶层没有 #503 ⇒ 它**递归到嵌套的 #505 块里** ✗ ⇒ 找到一个
//     "碰巧能解析成 ID 列表"的字段 ⇒ **把子控件 ID 写进了那个无关的嵌套字段** ✓
//   ★ 两个后果 ✓：
//     · 容器顶层仍然没有 #503 ⇒ 编辑器眼里它是**空容器**（子控件全不见）
//     · 那个无辜的嵌套字段被覆写成 ID 数据 ⇒ ★ **文件直接导不进去** ✓✓
//   ★ 为什么只有新容器中招 ✓：oard/ction.undo 天生有顶层 #503 ✓
//     ⇒ 递归"先撞上正确的那个" ⇒ 所以症状只出现在我新建的控件上 ✓
//
//   ⇒ 规则 ✓：**子列表只在记录顶层找**；找不到就**新建一个插在 #502 之后**
//     （★ 与 oard 的字段顺序一致：#501 #502 #503 #504 #505… ✓）
function findChildListTop(fields) {
  for (const f of fields) {
    if (f.wt === 2 && f.sub === null && !f.isText && f.payload && asIdList(f.payload, true) !== null) return f;
  }
  return null;
}
function ensureChildListTop(rec, proto) {
  let l = findChildListTop(rec.field.sub);
  if (l) return l;
  // 用现成的 #503 当模板（字段号照抄），没有就用最小结构 —— 与 gilread.ensureChildListTop 一致
  const src = proto || { field: 503, wt: 2 };
  l = { field: src.field || 503, wt: 2, sub: null, num: 0n, payload: Buffer.alloc(0), len: 0, isText: false };
  // ★★★ 2026-10-07 修：**这里不能加 `wt === 0` 条件**！
  //   记录顶层 `#502` 是**消息**（实测 223-批量.gil 全部 408 条都是 wt2）⇒ 加了条件就**永不命中**
  //   ⇒ 退化成下面的 `unshift` ⇒ `#503` 跑到**位置 0**（要求是位置 2，与 board 同构）。
  //   上一版正是这么写的，只因当时每个容器都已有顶层 #503 才没炸。
  const at = rec.field.sub.findIndex((f) => f.field === 502);
  if (at >= 0) rec.field.sub.splice(at + 1, 0, l);
  else {
    const at501 = rec.field.sub.findIndex((f) => f.field === 501);
    rec.field.sub.splice(at501 + 1, 0, l);
  }
  return l;
}

const KNOWN_TYPES = new Set(['容器节点', '客户端控件容器', '预设按钮', '交互按钮', '文本框', '文本视窗',
  '图片', '光标检测区域', '网格视窗', '按键提示', '模板引用控件', '界面动效', '全屏动效']);

const recs = [];
(function walk(fields) {
  for (let i = 0; i < fields.length; i++) {
    const f = fields[i]; if (!f.sub) continue;
    if (geomPairs(f.sub, []).length >= 2 && bigIds(f.sub, []).length >= 1) {
      let deeper = 0;
      for (const c of f.sub) if (c.sub && geomPairs(c.sub, []).length >= 2 && bigIds(c.sub, []).length >= 1) deeper++;
      if (deeper === 0) {
        let parent = null;
        (function s2(fs2) { for (const g of fs2) { if (g.wt === 0 && g.field === 504 && parent === null) parent = Number(g.num); if (g.sub) s2(g.sub); } })(f.sub);
        const strs = texts(f.sub, []);
        let name = null;
        for (const t of strs) { const s = t.payload.toString('utf8'); if (!KNOWN_TYPES.has(s)) { name = s; break; } }
        recs.push({ field: f, holder: fields, index: i, id: Number(bigIds(f.sub, [])[0].num), parentId: parent, name,
          states: stateBlocks(f.sub, []), childList: findChildList(f.sub), nameField: strs.find((t) => t.payload.toString('utf8') === name) || null });
        continue;
      }
    }
    walk(f.sub);
  }
})(tree);
console.log('存档里的控件记录 ' + recs.length + ' 条');
const byName = new Map(); for (const r of recs) if (r.name) byName.set(r.name, r);
const maxId = Math.max(...recs.map((r) => r.id));

// ── 读规划 ────────────────────────────────────────────────────────────────
const plan = JSON.parse(fs.readFileSync(PLAN, 'utf8'));
const planById = new Map(plan.nodes.map((n) => [n.id, n]));

// ★★★★★ 2026-10-07 **原型解析带兜底** ✗✓
//   ★ 原因：专用原型 oard/proto.btn/proto.text 在用户存档里【不一定存在】✗
//     （实测 208.1.gil 里三个都没有 ⇒ 直接退 3 ✓）
//   ★ 做法：优先用专用原型；缺则从【已有的同类控件】里挑一个 ✓
//     · 容器/面板 → clues / root / home / stage
//     · 按钮      → home.select / action.back / selbtn.1 / home.bag
//     · 文本      → home.title / hud.title / label / home.subtitle
//   ★ 只要状态块 ≥1 就能克隆 ✓（4 个是理想值，缺了也照抄副本 ✓ 由 REQUIRED_BLOCKS 控制）
const REQUIRED_BLOCKS = Number(argOf('blocks') || 1);
const pick = (cands) => cands.map((n) => byName.get(n)).find(Boolean) || null;
const proto = {
  container: pick(['proto.box', 'board', 'clues', 'root', 'home', 'stage']),
  button: pick(['proto.btn', 'home.select', 'action.back', 'selbtn.1', 'home.bag', 'home.continue']),
  text: pick(['proto.text', 'home.title', 'hud.title', 'label', 'home.subtitle']),
};
for (const [k, r] of Object.entries(proto)) {
  if (!r) { console.error('缺原型：' + k); process.exit(3); }
  if (r.states.length < REQUIRED_BLOCKS) { console.error('原型 ' + k + ' 状态块 ' + r.states.length + ' < ' + REQUIRED_BLOCKS); process.exit(4); }
}
console.log('原型：容器/面板→board#' + proto.container.id
  + '  按钮→proto.btn#' + proto.button.name + '#' + proto.button.id + '  文本→' + proto.text.name + '#' + proto.text.id);

const skipCell = (n) => /^cell\./.test(n.id);
const reuse = (n) => byName.has(n.id);                      // 存档里已有同名控件 → 复用
const todo = plan.nodes.filter((n) => !skipCell(n) && !reuse(n) && !excludedBy(n.id) && onlyBy(n.id));
const reused = plan.nodes.filter((n) => !skipCell(n) && reuse(n));
const skipped = plan.nodes.filter((n) => !skipCell(n) && !reuse(n) && excludedBy(n.id));
const offScope = plan.nodes.filter((n) => !skipCell(n) && !reuse(n) && !excludedBy(n.id) && !onlyBy(n.id));
console.log('规划 ' + plan.nodes.length + ' 节点：跳过 cell.* ' + plan.nodes.filter(skipCell).length
  + '，复用已有 ' + reused.length + '（' + reused.map((n) => n.id).join(', ') + '），**新建 ' + todo.length + '**');
if (ONLY.length) {
  console.log('  ★ --only=' + ONLY.join(',') + ' 限定范围：范围内待建 ' + todo.length
    + ' 个；被挡在范围外 ' + offScope.length + ' 个（本轮不碰）');
}
if (skipped.length) {
  console.log('  ★ --exclude 排除 ' + skipped.length + ' 个（脚本运行时会自动创建，不进 gil）：'
    + skipped.map((n) => n.id).join(', '));
  const dead = EXCLUDE.filter((p) => !skipped.some((n) => excludedBy(n.id) && (p.endsWith('*') ? n.id.startsWith(p.slice(0, -1)) : n.id === p)));
  if (dead.length) console.log('  ⚠️ 排除名单里没匹配到任何规划节点的项：' + dead.join(', '));
}

// 父先于子：按"父链深度"排序
const depthOf = (n) => { let d = 0, cur = n, guard = 0; while (cur && cur.parent && planById.has(cur.parent) && guard++ < 50) { d++; cur = planById.get(cur.parent); } return d; };
todo.sort((a, b) => depthOf(a) - depthOf(b));

const protoOf = (kind) => (kind === 'container' || kind === 'panel') ? proto.container : (kind === 'button' ? proto.button : proto.text);
const protoKind = (kind) => (kind === 'container' || kind === 'panel') ? 'container' : (kind === 'button' ? 'button' : 'text');

// ── 打补丁 ────────────────────────────────────────────────────────────────
function cloneField(f) { const c = { ...f }; if (f.payload) c.payload = Buffer.from(f.payload); if (f.sub) c.sub = f.sub.map(cloneField); return c; }
function setPair(pairField, x, y) {
  if (!pairField) return false;
  let a = null, b = null;
  if (pairField.sub) for (const g of pairField.sub) { if (g.field === 501 && g.wt === 5) a = g; if (g.field === 502 && g.wt === 5) b = g; }
  if (a && b) { a.f = x; b.f = y; return true; }
  pairField.sub = [{ field: 501, wt: 5, f: x }, { field: 502, wt: 5, f: y }];
  pairField.len = 12;
  return true;
}
function patch(rec, spec) {
  const clone = cloneField(rec.field);
  const oldId = rec.id;
  (function fixId(fs) {
    for (const f of fs) {
      if (f.wt === 0 && Number(f.num) === oldId) f.num = BigInt(spec.id);
      else if (f.wt === 2 && f.sub === null && !f.isText && f.payload && f.payload.length >= 1 && f.payload.length <= 8) {
        const d = readVarint(f.payload, 0, f.payload.length);
        if (d && Number(d.v) === oldId && d.p === f.payload.length) { f.payload = writeVarint(spec.id); f.len = f.payload.length; }
      }
      if (f.sub) fixId(f.sub);
    }
  })(clone.sub);
  let parentOk = false;
  (function fixParent(fs) {
    for (const f of fs) { if (!parentOk && f.wt === 0 && f.field === 504 && Number(f.num) === rec.parentId) { f.num = BigInt(spec.parentId); parentOk = true; } if (f.sub) fixParent(f.sub); }
  })(clone.sub);
  let nameOk = false;
  if (rec.nameField) {
    const ts = texts(clone.sub, []);
    const nf = ts.find((t) => t.payload.toString('utf8') === rec.name);
    if (nf) { nf.payload = Buffer.from(spec.name, 'utf8'); nf.len = nf.payload.length; nameOk = true; }
  }
  let geo = 0;
  const sb = stateBlocks(clone.sub, []);
  for (const block of sb) {
    if (setPair(block.sub.find((g) => g.field === 504), spec.pos[0], spec.pos[1])) geo++;
    setPair(block.sub.find((g) => g.field === 505), spec.size[0], spec.size[1]);
  }
  // 清空原型自己的子列表
  // ★★★★★ 2026-10-07 **只清【顶层】的子列表** ✗✓
  //   ★ 踩过的坑（★ 206 轮就记过 ✓ 我又踩了一次 ✓）：
  //     indChildList 是**递归**的 ✗ ⇒ 给"原本没有子控件"的容器挂子控件时，
  //     它会在**嵌套的 #505 块里**找一个"碰巧能解析成 ID 列表"的字段 ✗
  //     ⇒ ID 被写进那个**无关的嵌套字段** ⇒ ★ **文件直接导不进去** ✓
  //   ★ 所以这里一律用 indChildListTop（★ 只看记录顶层 ✓），
  //     没有就由 ensureChildListTop **新建一个插在 #502 之后**（★ 与 board 同构 ✓）。
  const myChild = ensureChildListTop({ field: clone }, null);
  setChildList(myChild, []);
  return { clone, parentOk, nameOk, geo, blocks: sb.length, childList: myChild };
}

// ── 逐条生成 ──────────────────────────────────────────────────────────────
let nextId = maxId + 1;
const newIdOf = new Map();          // 规划节点 id → 新控件 ID
const newChildOf = new Map();       // 新控件 ID → 它克隆出来的（已清空的）子列表字段
const inserts = [];
const problems = [];
for (const n of todo) {
  const kind = protoKind(n.kind);
  const rec = proto[kind];
  const kindName = n.kind;
  const parentPlanId = n.parent;
  let parentId;
  if (!parentPlanId || parentPlanId === n.id) parentId = proto.container.parentId;      // 顶层 → 挂在画布下
  else if (newIdOf.has(parentPlanId)) parentId = newIdOf.get(parentPlanId);              // 父是本次新建的
  else if (byName.has(parentPlanId)) parentId = byName.get(parentPlanId).id;              // 父是存档里已有的（root/board）
  else { problems.push(n.id + '：找不到父 ' + parentPlanId); continue; }
  const parentNode = parentPlanId && planById.has(parentPlanId) ? planById.get(parentPlanId) : null;
  const pos = parentNode ? [n.cx - parentNode.cx, n.cy - parentNode.cy] : [n.cx, n.cy];
  const spec = { id: nextId, name: n.id, parentId, pos, size: [n.w, n.h], kind: kindName };
  const p = patch(rec, spec);
  if (!p.parentOk) problems.push(n.id + '：父 ID 没打上补丁');
  if (!p.nameOk) problems.push(n.id + '：名字没打上补丁');
  if (p.geo !== 4) problems.push(n.id + '：状态块几何只改了 ' + p.geo + ' 个');
  newIdOf.set(n.id, nextId);
  if (p.childList) newChildOf.set(nextId, p.childList);
  inserts.push({ n, spec, patched: p });
  nextId++;
}
console.log('已构造 ' + inserts.length + ' 条新控件记录；问题 ' + problems.length + ' 条');
for (const q of problems.slice(0, 12)) console.log('  ⚠️ ' + q);

// ── 登记进父控件的子控件列表 ──────────────────────────────────────────────
const listOf = (pid) => newChildOf.get(pid) || findChildListTop((recs.find((r) => r.id === pid) || { field: { sub: [] } }).field.sub);
let regFail = 0;
for (const it of inserts) {                        // 按父先子后的顺序登记即可
  const list = listOf(it.spec.parentId);
  if (!list) { regFail++; console.log('  ⚠️ ' + it.spec.name + '：父#' + it.spec.parentId + ' 的子列表没找到'); continue; }
  const cur = asIdList(list.payload, true) || [];
  if (!cur.includes(it.spec.id)) cur.push(it.spec.id);
  setChildList(list, cur);
}
console.log('登记完成，失败 ' + regFail + ' 条');

if (DRY) {
  console.log('\n--probe：不写文件。抽样（前 8 条 + 后 4 条）：');
  for (const it of [...inserts.slice(0, 8), ...inserts.slice(-4)]) {
    console.log('  ' + String(it.n.kind).padEnd(10) + it.spec.name.padEnd(22) + '#' + it.spec.id
      + ' 父#' + it.spec.parentId + ' 相对(' + it.spec.pos.map((v) => v.toFixed(0)).join(',') + ') ' + it.spec.size.join('×'));
  }
  process.exit(problems.length || regFail ? 6 : 0);
}

// ── 插入 + 编码 ───────────────────────────────────────────────────────────
// 全部插到"最后一个原型记录"之后（同一个 holder），保持同组。
const anchorRec = inserts.length ? recs.find((r) => r.name === 'tpl.cell') || recs[recs.length - 1] : null;
if (!anchorRec) { console.error('找不到插入锚点'); process.exit(7); }
const holder = anchorRec.holder;
const at = anchorRec.index + 1;
holder.splice(at, 0, ...inserts.map((it) => it.patched.clone));

const body = encode(tree);
const head = Buffer.alloc(20);
head.writeUInt32BE(20 + body.length + TRAILER.length - 4, 0);
head.writeUInt32BE(hdr[1], 4); head.writeUInt32BE(hdr[2], 8); head.writeUInt32BE(hdr[3], 12);
head.writeUInt32BE(body.length, 16);
const outBuf = Buffer.concat([head, body, TRAILER]);
fs.writeFileSync(OUT, outBuf);

// ── 离线自检 ──────────────────────────────────────────────────────────────
const reEnd = 20 + outBuf.readUInt32BE(16);
const reTree = parse(outBuf, 20, reEnd, 0);
console.log('\n输出：' + OUT);
console.log('  体 ' + body.length + '（原 ' + hdr[4] + '，+' + (body.length - hdr[4]) + '）  文件 ' + outBuf.length + '（+' + (outBuf.length - src.length) + '）');
console.log('  头 ' + [0, 4, 8, 12, 16].map((o) => outBuf.readUInt32BE(o)).join(', '));
console.log('  尾 ' + outBuf.subarray(outBuf.length - TRAILER.length).toString('hex') + (outBuf.subarray(outBuf.length - TRAILER.length).equals(TRAILER) ? '  ✅' : '  ❌'));
if (!reTree) { console.error('❌ 生成的体无法重新解析'); process.exit(8); }

const reRecs = [];
(function cnt(fields) {
  for (const f of fields) {
    if (!f.sub) continue;
    if (geomPairs(f.sub, []).length >= 2 && bigIds(f.sub, []).length >= 1) {
      let deeper = 0;
      for (const c of f.sub) if (c.sub && geomPairs(c.sub, []).length >= 2 && bigIds(c.sub, []).length >= 1) deeper++;
      if (deeper === 0) {
        let parent = null;
        (function s2(fs2) { for (const g of fs2) { if (g.wt === 0 && g.field === 504 && parent === null) parent = Number(g.num); if (g.sub) s2(g.sub); } })(f.sub);
        const strs = texts(f.sub, []);
        let name = null; for (const t of strs) { const s = t.payload.toString('utf8'); if (!KNOWN_TYPES.has(s)) { name = s; break; } }
        reRecs.push({ name, id: Number(bigIds(f.sub, [])[0].num), parentId: parent, states: stateBlocks(f.sub, []) });
        continue;
      }
    }
    cnt(f.sub);
  }
})(reTree);
console.log('  重新解析 ✅ 控件记录 ' + reRecs.length + '（原 ' + recs.length + '，应 +' + inserts.length + '）');
let okName = 0, okParent = 0, okPos = 0, okSize = 0;
for (const it of inserts) {
  const hit = reRecs.find((r) => r.name === it.spec.name);
  if (!hit) continue;
  okName++;
  if (hit.parentId === it.spec.parentId) okParent++;
  const posOk = hit.states.every((s) => { const p = s.sub.find((g) => g.field === 504); if (!p) return false; const fl = (p.sub || []).filter((x) => x.wt === 5); return fl.length === 2 && Math.abs(fl[0].f - it.spec.pos[0]) < 0.6 && Math.abs(fl[1].f - it.spec.pos[1]) < 0.6; });
  const szOk = hit.states.every((s) => { const q = s.sub.find((g) => g.field === 505); if (!q || !q.sub) return false; const fl = q.sub.filter((x) => x.wt === 5); return fl.length === 2 && Math.abs(fl[0].f - it.spec.size[0]) < 0.6 && Math.abs(fl[1].f - it.spec.size[1]) < 0.6; });
  if (posOk) okPos++;
  if (szOk) okSize++;
}
console.log('  逐条核对（共 ' + inserts.length + '）：名字 ' + okName + ' ✅  父ID ' + okParent + ' ✅  四状态位置 ' + okPos + ' ✅  四状态尺寸 ' + okSize + ' ✅');
const bad = inserts.length - Math.min(okName, okParent, okPos, okSize);
console.log(bad === 0 ? '\n★ 全部 ' + inserts.length + ' 个控件离线自检通过' : '\n❌ 有 ' + bad + ' 条不自洽，**先别导入**');
process.exit(bad === 0 ? 0 : 9);
