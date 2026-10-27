// ############################################################################
// ❌❌❌ 【遗留实现 · 请勿使用】pre-2026-09-30 的旧生成器 ❌❌❌
//
//   本文件**没有** 2026-09-30 那次"导不进去"的修复，具体两处：
//     · 第 ~247 行用**递归** `findChildList` 取子列表 ⇒ 给"原本没有子控件"的容器挂子控件时，
//       会把子控件 ID 写进**无关的嵌套字段** ⇒ 容器在编辑器眼里是空的 + **整个文件导不进去**；
//     · 自带的 `setPair` **不做稀疏编码**（0 分量照样写），与引擎的写法不一致。
//
//   ⇒ **请改用现在这条链**：
//        node tools/gil/gen_protos.mjs        # 建原型
//        node tools/gil/gen_template_subs.mjs # 补模板子控件
//        node tools/gil/gen_bulk.mjs          # 批量建界面控件
//     需要"改 .gil"的其它场景看 tools/gil/ 下的专用工具（sync_plan / reparent / set_positions …）。
//
//   ⇒ 要复活本文件：必须把 `findChildList` 换成 `gilread.mjs` 的 `findChildListTop` /
//     `ensureChildListTop`、把 `setPair` 换成公共库那份，然后跑 `check_childlist_top.mjs` 与
//     `roundtrip.mjs` + `check_names.mjs` 两道闸。
//
// ★★★★ 2026-10-10 补充（★ 逐行比对 ✓）：本文件的 `encode` 还有**一处已知静默损坏** ✗
//   · ★ 第 121 行 `else if (f.wt === 1) parts.push(Buffer.alloc(8));`
//     ⇒ ★ **wt1（fixed64）被无条件写成 8 个零** ✗ ⇒ ★ 递归到的 wt1 字段**值全部清零** ✓
//     ★ 实测：`290` / `295` / `296` 各有 **2 个** wt1 字段、**原始 8 字节非零** ✗
//       （`#134217824 c786808004c68680` / `#134217829 af86808004ad8680`，depth 3 ✓）
//   · ★ **`#503` 这一条本文件是【对的】✓** —— 第 122 行 `f.sub !== null ? encode(f.sub) : payload`
//     ★ **没有**那个冻结 96% 子树的 `#503` 特例 ✗ ⇒ ★ 未受 2026-10-10 回归影响 ✓
//   · ★ 修法与完整背景见 `gen_bulk.mjs` 头部同一段警告 ✓（两份是同源副本 ✓）
//
//   运行时守卫在下面（必须显式加 `--i-know-this-is-legacy` 才会继续）。
// ############################################################################
//
// tools/gil/gen.mjs —— 生成 .gil 存档：**克隆原型记录 + 打补丁**
//
// 依据（全部实测验证，见 docs/千星存档-gil格式.md）：
//   · 体是单个 protobuf 消息，重编码**逐字节可还原**（roundtrip.mjs 已证）；
//   · 控件记录 = 含"≥2 个状态块"的子树；每个状态块同时含 #504(位置) 与 #505(尺寸)；
//   · 记录内有：控件ID(#501 varint)、父ID(#504 varint)、实例名(字符串)、四个状态；
//   · **位置是 #504 子消息，值为 (0,0) 时它是空消息**（protobuf 稀疏编码）——
//     这是第一版误判 "pos 0 组" 的原因；
//   · 同层级 ID 连续递增；varint 在此量级固定 5 字节 → 换 ID 不改变记录长度；
//   · 几何是固定 4 字节浮点 → 改坐标/尺寸也不改变记录长度
//     （唯一例外：位置从"空"变成"非空"会多 12 字节，重编码会正确重算长度）。
//
// 原型按**实例名**选（用户在编辑器里亲手命名，最可靠）：
//   proto.container / proto.btn / proto.text，回退 root / board。
//
// 用法：
//   node tools/gil/gen.mjs --in=<基准.gil> --probe
//   node tools/gil/gen.mjs --in=<基准.gil> --out=<输出.gil>

import fs from 'node:fs';
import path from 'node:path';

const DIR = path.join(process.env.LOCALAPPDATA + 'Low', 'miHoYo', '原神', 'BeyondLocal', '153793556', 'Beyond_Local_Save_Level');
const pickBase = () => {
  const local = path.join(process.cwd(), '存档.gil');
  if (fs.existsSync(local)) return local;
  for (const d of fs.readdirSync(DIR)) {
    const p = path.join(DIR, d);
    if (fs.statSync(p).isDirectory()) {
      const g = fs.readdirSync(p).find((f) => f.endsWith('.gil'));
      if (g) return path.join(p, g);
    }
  }
  const g = fs.readdirSync(DIR).find((f) => f.endsWith('.gil'));
  return g ? path.join(DIR, g) : null;
};

const argv = process.argv.slice(2);
const argOf = (k) => { const a = argv.find((s) => s.startsWith('--' + k + '=')); return a ? a.slice(k.length + 3) : null; };
const DRY = argv.includes('--probe');

// ── ★★★ 遗留实现守卫（2026-10-07 加）★★★ ───────────────────────────────────
// 见文件头：本文件内置【递归 findChildList】+【非稀疏 setPair】，会产生"导不进去"的存档。
// 故意不删实现（历史可追溯 / 万一要对照），但**默认不许跑**。
if (!argv.includes('--i-know-this-is-legacy')) {
  console.error('❌ gen.mjs 是 pre-2026-09-30 的【遗留实现】：递归 findChildList（子控件 ID 会写进\n'
    + '   无关的嵌套字段 ⇒ 容器空 + 文件导不进去）+ 非稀疏 setPair。\n'
    + '   请改用现在这条链：\n'
    + '     node tools/gil/gen_protos.mjs --in=<基准.gil> --out=<a.gil>\n'
    + '     node tools/gil/gen_template_subs.mjs --in=<a.gil> --out=<b.gil>\n'
    + '     node tools/gil/gen_bulk.mjs --in=<b.gil> --out=<c.gil>\n'
    + '   确实要用它：在命令后追加 --i-know-this-is-legacy');
  process.exit(64);
}

const BASE = argOf('in') || pickBase();
const OUT = argOf('out') || path.join(process.cwd(), 'tools', 'gil', 'out', 'gen-test.gil');
if (!BASE) { console.error('找不到基准 .gil'); process.exit(1); }

const src = fs.readFileSync(BASE);
const HEAD = 20;
const hdr = []; for (let i = 0; i < 5; i++) hdr.push(src.readUInt32BE(i * 4));
const BODY_END = HEAD + hdr[4];
const TRAILER = src.subarray(BODY_END);
console.log('基准：' + path.basename(BASE) + '（' + src.length + ' 字节）体 [20,' + BODY_END + ') 尾 ' + TRAILER.toString('hex'));

// ── protobuf ──────────────────────────────────────────────────────────────
function readVarint(b, p, lim) {
  let r = 0n, s = 0n, n = 0;
  const e = lim === undefined ? b.length : lim;
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
console.log('体解析成功：顶层 ' + tree.length + ' 个字段');

// ── 找控件记录：含"≥2 个状态块"的子树 ─────────────────────────────────────
function geomPairs(fields, out) {
  for (const f of fields) {
    if (f.sub && f.sub.length === 2 && f.sub[0].wt === 5 && f.sub[1].wt === 5) out.push(f);
    if (f.sub) geomPairs(f.sub, out);
  }
  return out;
}
function stateBlocks(fields, out) {
  // ★ 判据收紧（第一版只要求"同时含 #504 与 #505 孩子"，结果 root 的尺寸读不到、
  //   proto.text 还多匹配出 1 块）。
  //   从 board / proto.btn 两条 dump 看，一个**状态块**的形状是：
  //     { #501{1,1,1}(锚点), #502, #503, #504(位置), #505(**两个浮点** = 尺寸), #506, #508 }
  //   即：孩子数 ≥ 5，且 #505 必须**恰好有两个浮点孩子**。
  for (const f of fields) {
    if (!f.sub) continue;
    const p504 = f.sub.find((g) => g.field === 504);
    const p505 = f.sub.find((g) => g.field === 505);
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
const KNOWN_TYPES = new Set(['容器节点', '客户端控件容器', '预设按钮', '交互按钮', '文本框', '文本视窗',
  '图片', '光标检测区域', '网格视窗', '按键提示', '模板引用控件', '界面动效', '全屏动效']);

const recs = [];
(function walk(fields) {
  for (let i = 0; i < fields.length; i++) {
    const f = fields[i]; if (!f.sub) continue;
    const g = geomPairs(f.sub, []);
    if (g.length >= 2 && bigIds(f.sub, []).length >= 1) {
      let deeper = 0;
      for (const c of f.sub) if (c.sub && geomPairs(c.sub, []).length >= 2 && bigIds(c.sub, []).length >= 1) deeper++;
      if (deeper === 0) {
        let parent = null;
        (function s2(fs2) { for (const g of fs2) { if (g.wt === 0 && g.field === 504 && parent === null) parent = Number(g.num); if (g.sub) s2(g.sub); } })(f.sub);
        recs.push({
          field: f, holder: fields, index: i,
          id: Number(bigIds(f.sub, [])[0].num),
          parentId: parent, states: stateBlocks(f.sub, []),
          strs: texts(f.sub, []),
        });
        continue;
      }
    }
    walk(f.sub);
  }
})(tree);
console.log('控件记录 ' + recs.length + ' 条');
const maxId = Math.max(...recs.map((r) => r.id));
console.log('控件 ID 最大值 ' + maxId + ' → 新控件从 ' + (maxId + 1) + ' 起');

// ── 按实例名选原型 ────────────────────────────────────────────────────────
// 实例名 = 记录里**第一个不是已知类型名**的字符串。
// （实测：proto.btn 的记录里只有一个字符串 "proto.btn"；board 的是 "board"；
//   而模板画布里那些默认名就叫类型名 —— 所以必须排除类型名。）
function instName(r) {
  // ⚠️ r.strs 是**字段对象**数组（不是字符串）—— 第一版直接拿对象去比 KNOWN_TYPES，
  //    结果永远返回第一个对象当名字，按名字查原型全部落空。
  for (const t of r.strs) {
    const s = t.payload.toString('utf8');
    if (!KNOWN_TYPES.has(s)) return s;
  }
  return null;
}
for (const r of recs) r.name = instName(r);
const byName = new Map();
for (const r of recs) if (r.name) byName.set(r.name, r);

const proto = {
  // root 的几何形状与 board 不同（状态块判据匹配不到），所以容器原型优先用 board。
  container: byName.get('proto.container') || byName.get('board') || byName.get('root') || null,
  button: byName.get('proto.btn') || null,
  text: byName.get('proto.text') || null,
};
console.log('\n原型（按实例名）：');
for (const [k, r] of Object.entries(proto)) {
  if (!r) { console.log('  ' + k.padEnd(10) + '**没找到**'); continue; }
  const pos = r.states.map((s) => { const p = s.sub.find((g) => g.field === 504); return p ? (p.sub ? p.sub.filter((x) => x.wt === 5).map((x) => x.f.toFixed(0)).join(',') : '0,0') : '?'; });
  const size = r.states.map((s) => { const q = s.sub.find((g) => g.field === 505); return q && q.sub ? q.sub.filter((x) => x.wt === 5).map((x) => x.f.toFixed(0)).join('×') : '?'; });
  console.log('  ' + k.padEnd(10) + '#' + r.id + ' @' + r.field.s0
    + '  名字="' + r.name + '"  父#' + r.parentId
    + '  状态块 ' + r.states.length
    + '  位置[' + pos.join(' | ') + ']  尺寸[' + size.join(' | ') + ']');
}
if (!proto.container || !proto.button || !proto.text) {
  console.error('\n缺原型。需要在**同一个容器画布**（有 root/board 的那套）里放好并命名：');
  console.error('  proto.container（容器节点）/ proto.btn（预设按钮）/ proto.text（文本框）');
  process.exit(3);
}
for (const [k, r] of Object.entries(proto)) {
  if (r.states.length !== 4) {
    console.error('\n⚠️ 原型 `' + k + '` 的状态块是 ' + r.states.length + ' 个（预期 4）—— 几何补丁会不可靠，停止。');
    process.exit(4);
  }
}

// ── 深拷贝 + 打补丁 ───────────────────────────────────────────────────────
function cloneField(f) {
  const c = { ...f };
  if (f.payload) c.payload = Buffer.from(f.payload);
  if (f.sub) c.sub = f.sub.map(cloneField);
  return c;
}
// ── 子控件 ID 列表 ────────────────────────────────────────────────────────
// ★★ 这一步是"新控件能不能出现"的关键（2026-09-27 实测）：
//   只把记录插进文件 → 文件能重新解析、记录数 +3，但**导入后编辑器里一个都没多出来**。
//   原因：还有一份**子控件 ID 列表**（payload 是一串纯 varint ID）。
//   实测 `root` 的列表在偏移 34143：`1073741915, 1073741914, 1073741847`
//                                      = proto.text, proto.btn, board ✅
//   所以要：① 新控件 ID **追加进父控件的列表**；
//          ② 克隆原型时**清空原型自己的子列表** —— 否则副本会连原型的子控件一起"认领"
//             （克隆 board 会把 tpl.cell 也带走，它就等于有两个父亲）。
const ID_LO = 1073000000n, ID_HI = 1074200000n;
function asIdList(pay, allowEmpty) {
  if (pay.length === 0) return allowEmpty ? [] : null;
  const ids = []; let p = 0;
  while (p < pay.length) {
    const v = readVarint(pay, p, pay.length);
    if (!v) return null;
    if (v.v < ID_LO || v.v > ID_HI) return null;
    ids.push(Number(v.v)); p = v.p;
  }
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
function setChildList(f, ids) {
  f.payload = ids.length ? Buffer.concat(ids.map((i) => writeVarint(i))) : Buffer.alloc(0);
  f.len = f.payload.length;
}
for (const r of recs) r.childList = findChildList(r.field.sub);

function setPair(pairField, x, y) {
  // 位置/尺寸都是 2 浮点对；空 sub-message → 补出两个浮点
  if (!pairField) return 'missing';
  let a = null, b = null;
  if (pairField.sub) for (const g of pairField.sub) { if (g.field === 501 && g.wt === 5) a = g; if (g.field === 502 && g.wt === 5) b = g; }
  if (a && b) { a.f = x; b.f = y; return 'set'; }
  pairField.sub = [{ field: 501, wt: 5, f: x }, { field: 502, wt: 5, f: y }];
  pairField.len = 12;
  return 'built';
}

function patch(rec, spec) {
  const clone = cloneField(rec.field);
  const oldId = rec.id;
  let nId = 0, nName = 0, nPos = 0, nSize = 0;

  (function fixId(fs) {
    for (const f of fs) {
      if (f.wt === 0 && Number(f.num) === oldId) { f.num = BigInt(spec.id); nId++; }
      else if (f.wt === 2 && f.sub === null && !f.isText && f.payload && f.payload.length >= 1 && f.payload.length <= 8) {
        const d = readVarint(f.payload, 0, f.payload.length);
        if (d && Number(d.v) === oldId && d.p === f.payload.length) { f.payload = writeVarint(spec.id); f.len = f.payload.length; nId++; }
      }
      if (f.sub) fixId(f.sub);
    }
  })(clone.sub);

  if (spec.parentId != null) {
    let done = false;
    (function fixParent(fs) {
      for (const f of fs) { if (!done && f.wt === 0 && f.field === 504 && Number(f.num) === rec.parentId) { f.num = BigInt(spec.parentId); done = true; } if (f.sub) fixParent(f.sub); }
    })(clone.sub);
  }

  // 名字：找"值等于原型实例名"的那个文本字段
  const ts = texts(clone.sub, []);
  const nameField = ts.find((t) => t.payload.toString('utf8') === rec.name);
  if (nameField) { nameField.payload = Buffer.from(spec.name, 'utf8'); nameField.len = nameField.payload.length; nName = 1; }

  // 几何：四个状态块各设 位置/尺寸
  const sb = stateBlocks(clone.sub, []);
  for (const block of sb) {
    nPos += (setPair(block.sub.find((g) => g.field === 504), spec.pos[0], spec.pos[1]) !== 'missing') ? 1 : 0;
    nSize += (setPair(block.sub.find((g) => g.field === 505), spec.size[0], spec.size[1]) !== 'missing') ? 1 : 0;
  }
  // ★ 清空"原型的子控件列表" —— 否则副本会把原型的子控件一起认领
  //   （克隆 board 会把 tpl.cell 带走 → tpl.cell 等于有两个父亲）
  let myChildList = null;
  {
    let hit = null;
    (function scan(fs) {
      for (const f of fs) {
        if (hit) return;
        if (f.wt === 2 && f.sub === null && !f.isText && f.payload && asIdList(f.payload, true) !== null) { hit = f; return; }
        if (f.sub) scan(f.sub);
      }
    })(clone.sub);
    if (hit) { setChildList(hit, []); myChildList = hit; }
  }

  return { clone, nId, nName, nPos, nSize, blocks: sb.length, childList: myChildList };
}

// ── 要生成什么 ────────────────────────────────────────────────────────────
// 第一步：3 个测试控件，放在 root 下、屏幕中央偏上，尺寸显眼。
const P = proto.container.parentId;             // root 的父（= 画布）
const TEST = [
  { kind: 'container', protoRec: proto.container, name: 'test.box', id: maxId + 1, parentId: P, pos: [0, 0], size: [420, 260] },
  { kind: 'button', protoRec: proto.button, name: 'test.btn', id: maxId + 2, parentId: maxId + 1, pos: [0, 60], size: [200, 70] },
  { kind: 'text', protoRec: proto.text, name: 'test.label', id: maxId + 3, parentId: maxId + 1, pos: [0, -60], size: [360, 60] },
];

const inserts = [];
for (const spec of TEST) {
  const patched = patch(spec.protoRec, spec);
  inserts.push({ rec: spec.protoRec, spec, patched });
  console.log('  ' + spec.kind.padEnd(10) + spec.name.padEnd(12)
    + ' 原型#' + spec.protoRec.id + ' → 新#' + spec.id + ' 父#' + spec.parentId
    + ' 位置(' + spec.pos + ') 尺寸(' + spec.size + ')'
    + '  补丁: ID×' + patched.nId + ' 名×' + patched.nName
    + ' 位置×' + patched.nPos + ' 尺寸×' + patched.nSize + '（状态块 ' + patched.blocks + '）'
    + '  子列表' + (patched.childList ? '已清空' : '**没找到**'));
}

// ── ★★ 把新 ID 登记进父控件的子控件列表 ──────────────────────────────────
// 不做这一步，文件里"有记录"但游戏**不认**（2026-09-27 实测：导入后一个控件都没多出来）。
// 父控件的列表从哪来：
//   · 父是已有控件 → 用 `recs` 里那条记录的 `childList`，**追加**新 ID；
//   · 父是这次新建的控件（如 test.box）→ 用它克隆出来的（已清空的）`childList`，**依次加入**。
console.log('\n登记进父控件的子控件列表：');
const newChildListOf = new Map();       // 新控件ID → 它的（已清空的）子列表字段
for (const it of inserts) if (it.patched.childList) newChildListOf.set(it.spec.id, it.patched.childList);

for (const it of inserts) {
  const pid = it.spec.parentId;
  const parentRec = recs.find((r) => r.id === pid);
  const list = newChildListOf.get(pid) || (parentRec ? parentRec.childList : null);
  if (!list) {
    console.log('  ⚠️ ' + it.spec.name + '：父#' + pid + ' 的子列表**没找到** → 它不会出现，必须排查');
    continue;
  }
  const cur = asIdList(list.payload, true) || [];
  if (!cur.includes(it.spec.id)) cur.push(it.spec.id);
  setChildList(list, cur);
  console.log('  ' + it.spec.name.padEnd(12) + '→ 父#' + pid
    + (newChildListOf.get(pid) ? '（新建父）' : '（已有控件）')
    + '  列表长度 ' + cur.length + '：' + cur.join(', '));
}
if (DRY) { console.log('\n--probe：不写文件'); process.exit(0); }

const byHolder = new Map();
for (const it of inserts) { if (!byHolder.has(it.rec.holder)) byHolder.set(it.rec.holder, []); byHolder.get(it.rec.holder).push(it); }
for (const [holder, items] of byHolder) {
  items.sort((a, b) => b.rec.index - a.rec.index);
  for (const it of items) holder.splice(it.rec.index + 1, 0, it.patched.clone);
}

const body = encode(tree);
const head = Buffer.alloc(20);
head.writeUInt32BE(20 + body.length + TRAILER.length - 4, 0);
head.writeUInt32BE(hdr[1], 4); head.writeUInt32BE(hdr[2], 8); head.writeUInt32BE(hdr[3], 12);
head.writeUInt32BE(body.length, 16);
const outBuf = Buffer.concat([head, body, TRAILER]);

console.log('\n输出：' + OUT);
console.log('  体 ' + body.length + '（原 ' + hdr[4] + '，+' + (body.length - hdr[4]) + '）  文件 ' + outBuf.length + '（+' + (outBuf.length - src.length) + '）');
console.log('  头 ' + [0, 4, 8, 12, 16].map((o) => outBuf.readUInt32BE(o)).join(', '));
const tr = outBuf.subarray(outBuf.length - TRAILER.length);
console.log('  尾 ' + tr.toString('hex') + (tr.equals(TRAILER) ? '  ✅' : '  ❌'));

const reEnd = 20 + outBuf.readUInt32BE(16);
const reTree = parse(outBuf, 20, reEnd, 0);
if (!reTree) { console.error('❌ 生成的体无法重新解析'); process.exit(5); }
const reRecs = [];
(function cnt(fields) {
  for (const f of fields) {
    if (!f.sub) continue;
    if (geomPairs(f.sub, []).length >= 2 && bigIds(f.sub, []).length >= 1) {
      let deeper = 0;
      for (const c of f.sub) if (c.sub && geomPairs(c.sub, []).length >= 2 && bigIds(c.sub, []).length >= 1) deeper++;
      if (deeper === 0) { reRecs.push({ f, strs: texts(f.sub, []), states: stateBlocks(f.sub, []) }); continue; }
    }
    cnt(f.sub);
  }
})(reTree);
console.log('  重新解析 ✅ 控件记录 ' + reRecs.length + '（原 ' + recs.length + '，应 +3）');
for (const spec of TEST) {
  const hit = reRecs.find((r) => r.strs.some((t) => t.payload.toString('utf8') === spec.name));
  let geom = '';
  if (hit) {
    const posok = hit.states.every((s) => {
      const p = s.sub.find((g) => g.field === 504);
      if (!p || !p.sub) return false;
      const fs2 = p.sub.filter((x) => x.wt === 5);
      return fs2.length === 2 && Math.abs(fs2[0].f - spec.pos[0]) < 0.6 && Math.abs(fs2[1].f - spec.pos[1]) < 0.6;
    });
    const szok = hit.states.every((s) => {
      const q = s.sub.find((g) => g.field === 505);
      if (!q || !q.sub) return false;
      const fs2 = q.sub.filter((x) => x.wt === 5);
      return fs2.length === 2 && Math.abs(fs2[0].f - spec.size[0]) < 0.6 && Math.abs(fs2[1].f - spec.size[1]) < 0.6;
    });
    geom = '  4 状态几何 ' + (posok ? '✅位置' : '❌位置') + ' ' + (szok ? '✅尺寸' : '❌尺寸');
  }
  console.log('    ' + (hit ? '✅' : '❌') + ' ' + spec.name + geom);
}

fs.writeFileSync(OUT, outBuf);
console.log('\n导入：原神 → 派蒙菜单 → 我的奇遇 → 存档界面 → 右下角【导入存档】（**导入成新存档**）');
