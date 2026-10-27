// tools/gil/build_rows.mjs —— 按用户示例 `row.1.1` 克隆出其余 row（★ 换名重建 ✓ 旧文件已删 ✓）
//
// ════════════════════════════════════════════════════════════════════════════
// ★★★★★ 2026-10-10 **两次失败换来的配方 —— 照抄 `gen_palette.mjs`（项目里跑通过的 ✓）**
// ════════════════════════════════════════════════════════════════════════════
//
//   ★ 用户规格 ✓：「backrop/gray 是模板内的、无差异 ⇒ **只建另外四个** ✓」
//     「示例我做好了，剩下的**由你直接编辑 gil 建**」✓
//     「**1.1-1.5、2.1-2.6、3.1-3.9** 建出来，我自己填内容」✓
//
//   ✗ 失败一（`264` ✓）：★ **在每个循环里写一次父级子列表** ✗ ⇒ **后一次覆盖前一次** ✓
//      ⇒ 用户实测：「**只剩一个 `row.3.9`** ✗，连我的 `1.1` 都没有」✓
//   ✗ 失败二（`267` ✓）：★ 改成**只追加记录、一个字段都不碰** ✗
//      ⇒ 用户实测：「**这次只有我的 `1.1`**」✗ ⇒ ★ **新记录根本没进树** ✓✓
//
//   ★★★ 真因（照 `gen_palette.mjs` 对照出来 ✓）：
//     ★ **一条"记录"= 树里一个【字段对象】** ✓（★ 不是 `{id,name,...}` 那种结构 ✗）
//     ★ 必须做**两件事** ✓，我两次各漏一件 ✗：
//       ① ★ **`setChildList(父级子列表, 【全部】新 id)`** ✓ —— **只写一次** ✓
//       ② ★★ **`holderArr.splice(holderIndex+1, 0, 新字段对象)`** ✓✓
//          ⇒ ★ **把记录【插进树】** ✗ —— ★ 光改进 `g.recs` 没用 ✓（★ 那不参与编码 ✓）
//     ★ 还有一件容易漏 ✓：★ **`#504` 必须改成**父级 id ✗（★ `gen_palette.mjs` 原注释：
//       「★ 关键：改写克隆体的 `#504`（父引用）⇒ 否则记录在、却没挂到 assets 下 ✗」✓）
//
//   ★ 教训 ✓：★ **"我以为的结构"连错两次** ✗ ——
//     ★ 项目里有**跑通过的同类工具**时，★ **照抄它** ✓ 比按理解重写安全得多 ✓✓
//
// 用法：
//   node tools/gil/build_rows.mjs --in=261.gil --out=268.gil \
//     --spec="1.2,1.3,1.4,1.5,2.1,2.2,2.3,2.4,2.5,2.6,3.1,3.2,3.3,3.4,3.5,3.6,3.7,3.8,3.9"

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  readGil, encodeMsg, cloneField, findChildListTop, setChildList, asIdList, bigIds, textsOf,
} from './gilread.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const arg = (k, d) => {
  const h = process.argv.find((s) => s.startsWith('--' + k + '='));
  return h ? h.slice(k.length + 3).replace(/^"|"$/g, '') : d;
};
const P = (p) => (path.isAbsolute(p) ? p : path.resolve(ROOT, p));

const IN = arg('in', arg('base'));
const OUT = arg('out');
const PROTO = arg('proto', 'row.1.1');
const PARENT = arg('parent', 'assets');
const SPEC = arg('spec', '');
if (!IN || !OUT || !SPEC) { console.error('用法: --in=<存档> --out=<输出> --spec="1.2,1.3,..."'); process.exit(1); }

const g = readGil(P(IN));
const proto = g.recs.find((r) => r.name === PROTO);
if (!proto) { console.error('✗ 找不到原型 ' + PROTO); process.exit(2); }
const parent = g.recs.find((r) => r.name === PARENT);
if (!parent) { console.error('✗ 找不到父级 ' + PARENT); process.exit(2); }
console.log('  原型 `' + PROTO + '` #' + proto.id + '　父级 `' + PARENT + '` #' + parent.id);

function holderOf(id) {
  const stack = [g.tree];
  while (stack.length) {
    const arr = stack.pop();
    if (!Array.isArray(arr)) continue;
    for (let i = 0; i < arr.length; i++) {
      const f = arr[i];
      if (f.sub) {
        if (((bigIds(f.sub, [])[0] || {}).num) === BigInt(id)) return { arr, index: i };
        stack.push(f.sub);
      }
    }
  }
  return null;
}
const ph = holderOf(proto.id);
if (!ph) { console.error('✗ 找不到原型 holder'); process.exit(2); }
const ah = holderOf(parent.id);
if (!ah) { console.error('✗ 找不到父级 holder'); process.exit(2); }
console.log('  原型 holder idx=' + ph.index + '（数组长 ' + ph.arr.length + '）');
console.log('  父级 holder idx=' + ah.index + '（数组长 ' + ah.arr.length + '）');

let maxId = 0n;
for (const r of g.recs) if (BigInt(r.id) > maxId) maxId = BigInt(r.id);
console.log('  当前最大 id=' + maxId);

const cl = findChildListTop(parent.field.sub);
if (!cl) { console.error('✗ 父级没有子列表字段'); process.exit(2); }
const ids = (asIdList(cl.payload, true) || []).slice();
console.log('  父级原子里表 ' + ids.length + ' 项');

const childrenOf = (id) => g.recs.filter((r) => String(r.parentId) === String(id));
const subtree = [];
const collect = (rec) => { subtree.push(rec); childrenOf(rec.id).forEach(collect); };
collect(proto);
console.log('  原型子树 ' + subtree.length + ' 条：' + subtree.map((r) => r.name).join(', '));

const holders = new Map();
for (const rec of subtree) {
  const h = holderOf(rec.id);
  if (!h) { console.error('✗ 找不到 ' + rec.name + ' 的 holder'); process.exit(2); }
  holders.set(String(rec.id), h);
}

let nextId = maxId + 1n;
const specs = SPEC.split(',').map((s) => s.trim()).filter(Boolean);
const made = [];

for (const sp of specs) {
  const parts = sp.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) { console.log('  ⚠️ 跳过 `' + sp + '`'); continue; }
  const idMap = new Map();
  for (const rec of subtree) idMap.set(String(rec.id), nextId++);

  for (const rec of subtree) {
    const isRoot = (rec.id === proto.id);
    const h = holders.get(String(rec.id));
    const cf = cloneField(h.arr[h.index]);
    const bid = bigIds(cf.sub, [])[0];
    if (!bid) { console.error('✗ 克隆体里找不到 #501（' + rec.name + '）'); process.exit(2); }
    const newId = idMap.get(String(rec.id));
    bid.num = newId;
    const slot = String(rec.name || '').split('.')[0];
    const newName = isRoot ? ('row.' + sp) : (slot + '.' + sp);
    const txt = textsOf(cf.sub, []).find((t) => t.payload && t.payload.toString('utf8') === String(rec.name));
    if (!txt) { console.error('✗ ' + rec.name + ' 克隆体里找不到名字字段'); process.exit(2); }
    txt.payload = Buffer.from(newName, 'utf8');
    const newParent = isRoot ? parent.id : idMap.get(String(rec.parentId));
    const pf = cf.sub.find((x) => x.field === 504 && x.wt === 0);
    if (!pf) { console.error('✗ ' + rec.name + ' 克隆体里找不到 #504'); process.exit(2); }
    pf.num = BigInt(newParent);
    // ★★★★★ 2026-10-10 **条件写反过一次（用户实测抓出 ✓）** ✗✓
    //   ★ 症状 ✓：「四个子控件**没改序号且重复了两遍**」✗
    //   ★ 对照实证 ✓：`row.1.2` 的 `#503` 与 `row.1.1` **一模一样** ✗
    //     ⇒ ★ **编辑器把同一批子控件显示了两遍** ✓
    //   ★ 根因 ✓：★ **该重映射的是【row 自己】的 `#503`** ✗ ——
    //     ★ 我写成了 `!isRoot` ✗ ⇒ ★ **row 的 `#503` 一直是克隆来的原型值** ✓
    //     （★ 而 `who` 这些**叶子根本没有 `#503`** ✓ —— dump 实证 ✓ ⇒ 那个分支纯属空转 ✓）
    const clc = findChildListTop(cf.sub);
    if (clc && isRoot) {
      const oldCl = findChildListTop(rec.field.sub);
      const oldIds = oldCl ? (asIdList(oldCl.payload, true) || []) : [];
      const mapped = oldIds.map((oid) => Number(idMap.get(String(oid))));
      const bad2 = mapped.filter((v) => !Number.isFinite(v));
      if (bad2.length) { console.error('✗ ' + rec.name + ' 的子列表有 ' + bad2.length + ' 个 id 映射不到 ⇒ 中止'); process.exit(2); }
      setChildList(clc, mapped);
      console.log('      ' + newName + ' 的 #503 → ' + mapped.length + ' 项（已换成自己的 ✓）');
    }
    made.push({ field: cf, id: Number(newId), holderArr: h.arr, holderIndex: h.index, isRoot });
  }
}
if (made.length === 0) { console.error('✗ 什么都没造，不写文件'); process.exit(3); }

const newRootIds = made.filter((m) => m.isRoot).map((m) => m.id);
for (const id of newRootIds) if (!ids.map(String).includes(String(id))) ids.push(id);
setChildList(cl, ids);
console.log('  父级子列表 → ' + ids.length + ' 项（＋新 ' + newRootIds.length + '）');

const byArr = new Map();
for (const m of made) {
  if (!byArr.has(m.holderArr)) byArr.set(m.holderArr, []);
  byArr.get(m.holderArr).push(m);
}
for (const [arr, list] of byArr) {
  list.sort((a, b) => b.holderIndex - a.holderIndex);
  for (const m of list) arr.splice(m.holderIndex + 1, 0, m.field);
}
console.log('  ★ 已把 ' + made.length + ' 个字段插进树（' + byArr.size + ' 个数组）✓');

const buf = g.pack(encodeMsg(g.tree));
fs.writeFileSync(P(OUT), buf);
console.log('  写出 ' + path.basename(P(OUT)) + '  ' + Math.round(buf.length / 1024) + ' KB');

const g2 = readGil(P(OUT));
const p2 = g2.recs.find((r) => r.name === PARENT);
const kids2 = g2.recs.filter((r) => r.parentId === p2.id).map((r) => r.name);
console.log('  回读：' + PARENT + ' 的子控件 ' + kids2.length + ' 个');
console.log('    row: ' + kids2.filter((n) => /^row\./.test(n)).sort().join(', '));
let bad = 0;
for (const sp of specs) {
  for (const pre of ['row', 'who', 'what', 'face', 'letter']) {
    if (!g2.recs.find((x) => x.name === pre + '.' + sp)) { console.log('  ✗ 回读找不到 ' + pre + '.' + sp); bad++; }
  }
}
const pa = g.recs.find((r) => r.name === PROTO);
const pb = g2.recs.find((r) => r.name === PROTO);
if (!pb || pa.id !== pb.id) { console.log('  ✗ 原型被动过 ✗'); bad++; }
console.log(bad ? ('  ❌ 回读有 ' + bad + ' 个不对') : '  ★ 回读全部就位、原型未动 ✅');
console.log('⚠️ 交付前必须跑：node tools/gil/roundtrip.mjs ' + path.basename(P(OUT)));
