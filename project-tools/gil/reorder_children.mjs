// tools/gil/reorder_children.mjs —— 把一个父控件下的**指定子控件挪到子列表末尾**（= 画在最上层）
//
// 为什么要有它（2026-10-15）：
//   ★ 选关屏的点击靠**命中层**（`hit.select.*`，隐形 ✓）+ **可视层**（`select.card.N` 等 ✓）两层 ✓
//   ★ 而"命中层在最上面"这件事**必须靠父控件的子列表顺序**保证 ✗
//     —— 后加进子列表的 ⇒ **画在上面** ⇒ 先吃到射线 ✓
//   ★★ 本轮的教训 ✓：`place_select.mjs` 新加的 34 个子控件是**追加在末尾**的 ✓
//     ⇒ ★ 它们**压在命中层上面** ✗ —— 牌面文字（文本框）与缩略图（图片控件）都在卡片区域内 ✓
//       ★ 万一它们参与射线（图片类**可能**会 ✓ 官方只保证"按钮/光标检测区域"收事件，
//         没说图片一定不吃射线 ✗），点到卡片就**被它们接走** ✗
//     ⇒ ★ 把命中层**挪到最上层**，这条路就**与"谁在上面"无关了** ✓✓
//
// ★ 只动**一个父控件的子列表顺序** ✓：不增、不删、不改父子关系、不改几何 ✓
//   ⇒ ★ 唯一的字段差异 = 那条 `#503` 的裸 payload（子 ID 序列重排 ✓）✓
//
// 用法：
//   node tools/gil/reorder_children.mjs --in=<存档> --out=<输出> [--parent=root] --to-end=<名字/前缀,逗号分隔> [--dry]
//   例：node tools/gil/reorder_children.mjs --in=a.gil --out=b.gil --parent=root --to-end=hit.select.

import fs from 'node:fs';
import path from 'node:path';
import { readGil, encodeMsg, findChildListTop, setChildList, asIdList } from './gilread.mjs';
import { writeGil } from './gilwrite.mjs';

const argv = process.argv.slice(2);
const argOf = (k) => { const a = argv.find((s) => s.startsWith('--' + k + '=')); return a ? a.slice(k.length + 3).replace(/^"|"$/g, '') : null; };
const DRY = argv.includes('--dry');

const IN = argOf('in'), OUT = argOf('out');
const PARENT = argOf('parent') || 'root';
const SPEC = argOf('to-end');
if (!IN || !OUT || !SPEC) {
  console.error('用法: node tools/gil/reorder_children.mjs --in=<存档> --out=<输出> [--parent=root] --to-end=<名字/前缀,…> [--dry]');
  process.exit(1);
}
const specs = SPEC.split(',').map((s) => s.trim()).filter(Boolean);

const g = readGil(IN);
const parent = g.byName.get(PARENT);
if (!parent) { console.error('❌ 找不到父控件 ' + PARENT); process.exit(2); }
const cl = findChildListTop(parent.field.sub);
if (!cl) { console.error('❌ ' + PARENT + ' 没有顶层子列表（#503）'); process.exit(2); }

const ids = asIdList(cl.payload, true) || [];
const byId = new Map(g.recs.map((r) => [r.id, r]));
const matches = (name) => specs.some((s) => name === s || name.startsWith(s));

const move = [], stay = [];
for (const id of ids) {
  const rec = byId.get(id);
  const nm = rec && rec.name ? rec.name : null;
  if (nm && matches(nm)) move.push(id); else stay.push(id);
}

console.log('存档 ' + path.basename(IN) + '　父=' + PARENT + ' #' + parent.id + '　子控件 ' + ids.length + ' 个');
console.log('规则：' + specs.join(' / ') + '　⇒ 命中 ' + move.length + ' 个：');
for (const id of move) console.log('    · ' + (byId.get(id).name || '#' + id) + '  #' + id);
if (move.length === 0) { console.error('❌ 一个都没命中 —— 检查 --to-end 的写法'); process.exit(3); }

const before = ids.join(',');
const after = stay.concat(move).join(',');
console.log('新顺序里这 ' + move.length + ' 个都在**末尾** ✓（其余 ' + stay.length + ' 个保持原相对顺序 ✓）');

if (DRY) { console.log('--dry：不写文件 ✓'); process.exit(0); }

setChildList(cl, stay.concat(move));
try {
  const rep = writeGil(g, OUT, {
    label: PARENT + ' 子列表重排（命中层置顶）',
    expectRecs: g.recs.length,
    assert: (g2) => {
      const p2 = g2.byName.get(PARENT);
      const cl2 = findChildListTop(p2.field.sub);
      const ids2 = asIdList(cl2.payload, true) || [];
      if (ids2.length !== ids.length) return '子控件个数变了：' + ids.length + ' → ' + ids2.length;
      const setA = [...ids].sort().join(','), setB = [...ids2].sort().join(',');
      if (setA !== setB) return '子控件集合变了（有增删）✗';
      const tail = ids2.slice(ids2.length - move.length);
      for (let i = 0; i < move.length; i++) {
        if (tail[i] !== move[i]) return '末尾顺序不对：期望 ' + move.join(',') + '，实得 ' + tail.join(',');
      }
      return true;
    },
  });
  console.log('\n输出：' + path.basename(OUT) + '（' + rep.bytes + ' 字节，字段差异 ' + rep.diffs + ' 处）');
  console.log('★ 期望差异 = **1 处**（那条 #503 的裸 payload ✓）；多了就说明碰到了别的东西 ✗');
} catch (e) {
  console.error('\n❌ ' + e.message);
  process.exit(5);
}
