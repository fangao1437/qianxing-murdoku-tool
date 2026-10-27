// tools/gil/add_row14_children.mjs —— 补 `row.1.4` 缺的 `what` / `letter`（★ 只加不改 ✓）
//
// ★ 依据（修好读法后的实测 ✓）：
//   `row.1.4` 的 `#503` **只有 2 项**（`who.1.4` / `face.1.4`）✗
//   ⇒ ★ 这是**真丢**（不是占位 ✗）—— ★ lead 2026-10-10 确认 ✓：
//     ★ `row.1.4` 当时的**原型选错了** ✓ ⇒ ★ 只拿到了 `who`/`face` ✓
//     ★ 而用户后续所有 `row.*` 都按 4 项使用 ✓（★ 实测 20 个里 19 个是 4 项 ✓）
//   ⇒ ★ 从 `row.1.5` 的 `what.1.5` / `letter.1.5` 克隆两份 ✓ 改名 ✓ 改父级 ✓
//
// 用法：
//   node tools/gil/add_row14_children.mjs --in=297-clue全归零-v150.gil --out=298-补row14-v151.gil
//
// ★★ 验收（★ 判据，不是建议 ✓）：
//   ★ 必须打印 "✅ ⑧ 断言：row.1.4 子列表 4 项 ✓ 父引用 ✓ 名字 ✓ **自身 7 处引用 ✓**"
//   ★ 必须打印 "✅ ④ 已从磁盘重读 …（记录 298 条）"（★ 296 + 2 ✓）
//   ★ 独立复核（★ 这套编辑是**新增记录** ⇒ ★ 别按 diff 条数判死 ✗）：
//     node tools/gil/inspect_gil.mjs "297-…"   → 看 row.1.4 是 2 项
//     node tools/gil/inspect_gil.mjs "298-…"   → 看 row.1.4 是 4 项 ✓
//     node tools/gil/roundtrip.mjs "298-…"     → 逐字节往返一致 ✓
//
// ★★★★ 2026-10-10 迁移到 `writeGil()` ＋ 修一处**真缺陷** ✗✓
//   ★ 缺陷（★ 实测发现 ✓）：★ 原版只改 `bigIds(cf.sub, [])[0]`（★ **第一个** `#501` ✓）✗
//     ★ 而实测：★ 每条记录有 **7 处**指向自己的 id ✗：
//       `#501` ×1 ＋ `#502/#11/#501` ×1 ＋ `#505/#503/#504/#4` ×5
//     ⇒ ★★ 原来的克隆体**只有 1 处改对**，★ **另外 6 处仍指向原型**（`letter.1.5`/`what.1.5`）✗✓
//       ⇒ ★ 那会让新记录在**内部自称是 1.5 的东西** ✓ —— ★ 典型的"看着对、其实半对" ✗
//     ⇒ ★ 修法 ✓：★ **克隆体子树里，所有值 == 原型 id 的 wt0 叶子，一律改成新 id** ✓
//       ★ 另外把"仅含原型 id 的 ID 列表 payload"也一并改（★ 本存档里没有，但留着保险 ✓）
//   ★ 原版还有两点 ✓：★ 直接 `fs.writeFileSync` ✗ ＋ ★ 自检只比名字 ✓
//     ⇒ ★ 现在走 `writeGil()`：★ 落盘 → **重读磁盘** → 往返闸门 → 字段级 diff → **结构化断言** ✓
//   ★ 为什么**不用** `expectDiffs: N` ✗：★ 这是**新增 2 条记录** ✓ ⇒
//     ★ 按位置比对会报大量连带差异 ✓（★ 见 `diff_fields.mjs` 头部 ✓）
//     ⇒ ★ 判据用 ★ **记录数断言（+2）＋ 结构化断言** ✓✓
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  readGil, cloneField, findChildListTop, setChildList, asIdList, bigIds, textsOf, pairValue, pairOf,
} from './gilread.mjs';
import { writeGil } from './gilwrite.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const P = (p) => (path.isAbsolute(p) ? p : path.resolve(ROOT, p));
const argv = process.argv.slice(2);
const arg = (k, d) => { const h = argv.find((s) => s.startsWith('--' + k + '=')); return h ? h.slice(k.length + 3) : d; };
const IN = arg('in'), OUT = arg('out', IN);
const DRY = argv.includes('--probe');
if (!IN) { console.error('用法: --in=<存档> [--out=] [--probe]'); process.exit(1); }

/** ★ 把克隆体子树里"所有指向 oldId 的地方"改成 newId ✓（wt0 叶子 ＋ 纯 id 列表 payload ✓） */
function retargetIds(fields, oldId, newId) {
  let n = 0;
  (function w(fs2) {
    for (const f of fs2) {
      if (f.wt === 0 && f.num === oldId) { f.num = newId; n++; }
      else if (f.wt === 2 && !f.isText && f.payload && f.payload.length >= 1 && f.payload.length <= 64) {
        const ids = asIdList(f.payload, false);
        if (ids && ids.length && ids.every((v) => BigInt(v) === oldId)) {
          f.payload = Buffer.concat(ids.map(() => {
            const out = []; let x = newId;
            do { let b = Number(x & 0x7fn); x >>= 7n; if (x > 0n) b |= 0x80; out.push(b); } while (x > 0n);
            return Buffer.from(out);
          }));
          f.len = f.payload.length;
          f.sub = null;              // ★ payload 变了 ⇒ 旧的假 sub 必须作废 ✗
          n += ids.length;
        }
      }
      if (f.sub) w(f.sub);
    }
  })(fields);
  return n;
}

const g = readGil(P(IN));
const target = g.recs.find((r) => r.name === 'row.1.4');
if (!target) { console.error('✗ 找不到 row.1.4'); process.exit(2); }
const cl = findChildListTop(target.field.sub);
if (!cl) { console.error('✗ row.1.4 没有 #503'); process.exit(2); }
const have = (asIdList(cl.payload, true) || []).map((id) => (g.recs.find((x) => String(x.id) === String(id)) || {}).name);
console.log('  row.1.4 现有子控件: ' + have.join(', '));

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

let maxId = 0n;
for (const r of g.recs) if (BigInt(r.id) > maxId) maxId = BigInt(r.id);

const ids = (asIdList(cl.payload, true) || []).slice();
const planned = [];
let made = 0;
for (const slot of ['what', 'letter']) {
  if (have.includes(slot + '.1.4')) { console.log('  ↷ ' + slot + '.1.4 已存在，跳过'); continue; }
  const proto = g.recs.find((r) => r.name === slot + '.1.5');
  if (!proto) { console.error('✗ 找不到原型 ' + slot + '.1.5'); process.exit(2); }
  const h = holderOf(proto.id);
  if (!h) { console.error('✗ 找不到 ' + slot + '.1.5 的 holder'); process.exit(2); }
  const cf = cloneField(h.arr[h.index]);
  const bid = bigIds(cf.sub, [])[0];
  if (!bid) { console.error('✗ 克隆体没有 #501'); process.exit(2); }
  const newId = maxId + BigInt(made + 1);
  // ★★ 先改【所有】自身引用 ✓（★ 不是只改第一个 ✗ —— 见头部"真缺陷" ✓）
  const nRef = retargetIds(cf.sub, BigInt(proto.id), newId);
  if (!nRef) { console.error('✗ ' + slot + '.1.5 里没有指向自己的 id ⇒ 结构不符，拒绝 ✗'); process.exit(2); }
  const newName = slot + '.1.4';
  const txt = textsOf(cf.sub, []).find((t) => t.payload && t.payload.toString('utf8') === slot + '.1.5');
  if (!txt) { console.error('✗ 克隆体里找不到名字字段 ' + slot + '.1.5 ⇒ 拒绝（★ 静默跳过是敌人 ✗）'); process.exit(2); }
  txt.payload = Buffer.from(newName, 'utf8');
  txt.len = txt.payload.length;
  const pf = cf.sub.find((x) => x.field === 504 && x.wt === 0);
  if (!pf) { console.error('✗ 克隆体没有 #504'); process.exit(2); }
  pf.num = BigInt(target.id);
  h.arr.splice(h.index + 1, 0, cf);          // ★ 插进树 ✓
  ids.push(Number(newId));
  planned.push({ name: newName, id: Number(newId), refs: nRef });
  made++;
  console.log('  ✅ 建了 ' + newName + '  #' + newId + '（原型 ' + slot + '.1.5 #' + proto.id + '，★ 自身引用改了 ' + nRef + ' 处 ✓）');
}
if (made === 0) { console.log('  没有要建的，不写文件 ✓'); process.exit(0); }
setChildList(cl, ids);                        // ★ 父级 #503 写全 ✓（只写一次 ✓）
console.log('  row.1.4 的 #503 → ' + ids.length + ' 项');

if (DRY) { console.log('\n--probe：不写文件 ✓'); process.exit(0); }

// ★★★ 走唯一安全通道 ✓ —— ★ 新增 2 条记录 ⇒ ★ 用【记录数 + 结构化断言】判据 ✓
try {
  const rep = writeGil(g, P(OUT), {
    label: '补 row.1.4 的 what/letter（+2 条记录）',
    expectRecs: g.recs.length + made,        // ★ 记录数必须正好 +2 ✓
    // ★ 不加 expectDiffs ✗ —— ★ 新增记录会让"按位置比对"报大量连带差异 ✓（见 diff_fields 头部 ✓）
    assert: (g2) => {
      const t2 = g2.recs.find((r) => r.name === 'row.1.4');
      if (!t2) return '重读后找不到 row.1.4 ✗';
      const cl2 = findChildListTop(t2.field.sub);
      if (!cl2) return '重读后 row.1.4 没有 #503 ✗';
      const kidIds = asIdList(cl2.payload, true) || [];
      // ① 子列表必须【正好 4 项】✓
      if (kidIds.length !== 4) return 'row.1.4 子列表 ' + kidIds.length + ' 项，应为 4 项 ✗';
      const kids = kidIds.map((id) => g2.recs.find((r) => r.id === id));
      if (kids.some((k) => !k)) return '子列表里有 id 找不到记录 ✗';
      // ② 名字必须正好是这 4 个 ✓
      const names = kids.map((k) => k.name).sort().join(',');
      const want = ['face.1.4', 'letter.1.4', 'what.1.4', 'who.1.4'].join(',');
      if (names !== want) return 'row.1.4 子控件 = [' + names + ']，应为 [' + want + '] ✗';
      // ③ 每个子控件的父引用必须 == row.1.4 ✓
      for (const k of kids) if (k.parentId !== t2.id) return k.name + ' 父引用 = ' + k.parentId + '，应为 row.1.4 ' + t2.id + ' ✗';
      // ④ ★ 新记录里**所有**自身引用必须 == 自己的 id ✓（★ 这是这次修掉的那个缺陷 ✓）
      for (const k of kids.slice()) {
        const wrong = [];
        (function w(fs2, p2) {
          for (const f of fs2) {
            const here = p2 + '/#' + f.field;
            if (f.wt === 0 && f.num === BigInt(k.id)) wrong.push('ok');
            if (f.sub) w(f.sub, here);
          }
        })(k.field.sub, '');
        const selfRefs = wrong.length;
        if (selfRefs !== 7) return k.name + ' 的自身引用 = ' + selfRefs + ' 处，应为 7 处 ✗（★ 说明还有引用指向原型 ✗）';
      }
      // ⑤ 不能再有"指向 1.5 原型"的引用残留 ✓
      for (const k of kids) {
        const strayProtos = [];
        (function w(fs2) {
          for (const f of fs2) {
            if (f.wt === 0) {
              const hit = ['letter.1.5', 'what.1.5'].some((n) => (g2.byName.get(n) || {}).id === Number(f.num));
              if (hit) strayProtos.push(Number(f.num));
            }
            if (f.sub) w(f.sub);
          }
        })(k.field.sub);
        if (strayProtos.length) return k.name + ' 里还有 ' + strayProtos.length + ' 处指向 1.5 原型 ✗';
      }
      return true;
    },
  });
  console.log('  ✅ ⑧ 断言：row.1.4 子列表 4 项 ✓ 父引用 ✓ 名字 ✓ **每个子控件自身引用 7 处 ✓** 无 1.5 残留 ✓');
  console.log('  写出 ' + path.basename(P(OUT)) + '  ' + rep.bytes + ' 字节　记录 ' + rep.recs + '（原 ' + g.recs.length + '，+' + made + '）');
  console.log('  ★ 独立复核：node tools/gil/roundtrip.mjs ' + path.basename(P(OUT)));
  console.log('  ★ 体检对照：node tools/gil/inspect_gil.mjs ' + path.basename(P(OUT)));
} catch (e) {
  console.error('\n❌ ' + e.message);
  process.exit(4);
}
