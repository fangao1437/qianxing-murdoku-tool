// tools/gil/renumber_all.mjs —— ★ 把**整份存档**的所有控件 GUID 平滑迁到新号段
//
//   什么时候用：
//     ① 同一个资产被**导入过多次**（旧副本还在工程里）⇒ 新导入的那份与旧的那份**同号**
//        ⇒ 编辑器报"控件 GUID 重复"。把**新的那份**整体换号后再导入，就不会撞。
//     ② 某个资产要在**别的工程**里并存（主界面 + 教程骨架），想让两边号段互不相干。
//
//   与 `renumber_ids.mjs` 的区别：那个只迁 `things` / `obj.*`（写死），这个迁**全部记录**。
//
//   ★ 只改"记录自身 GUID"（顶层 `#501`），然后**全档统一替换**：
//       · 记录自身 GUID 两处（`#501` / `#502/#11/#501`）
//       · 父指针 `#504`
//       · 父的子列表 entry
//       · 反向引用 `#505/#503/#504/#4` 等
//     ⚠️ **不碰** 画布头号段（1073741825–1073741842）和**引擎内置模板索引**
//        （「预设按钮」1073741848、容器 1073741864、动效 1073742014/2015 等）——
//        它们是引擎/画布自带的，改了控件就引不到模板。
//
//   用法：node tools/gil/renumber_all.mjs --in=<存档.gil> --out=<输出.gil> [--base=N] [--dry]
//   断言：① 新号段内自身 GUID 无重复 ② 内置模板索引原样保留 ③ 记录数不变
//         ④ 往返逐字节一致（writeGil 内置）⑤ 子列表/父指针仍指向正确的新号
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readGil, findChildListTop, asIdList, setChildList } from './gilread.mjs';
import { writeGil } from './gilwrite.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const P = (p) => (path.isAbsolute(p) ? p : path.join(ROOT, p));
const argv = process.argv.slice(2);
const argOf = (k, d) => {
  const hit = argv.find((s) => s.startsWith('--' + k + '='));
  return hit ? hit.slice(k.length + 3).replace(/^"|"$/g, '') : d;
};
const IN = argOf('in'), OUT = argOf('out');
const DRY = argv.includes('--dry');
if (!IN || !OUT) { console.error('用法: --in=<存档> --out=<输出> [--base=N] [--dry]'); process.exit(1); }

const LO = 1073741824, HI = 1073800000;     // 本工程 GUID 取值区间
const CANVAS_LO = 1073741825, CANVAS_HI = 1073741842;   // 画布头（每个存档都有，不能改）
// 引擎内置模板索引（改了控件就引不到模板）—— 见 docs/千星存档-gil格式.md
const BUILTIN_TPL = new Set([1073741848, 1073741864, 1073742014, 1073742015]);

const g = readGil(P(IN));
const recIds = g.recs.map((r) => Number(r.id)).sort((a, b) => a - b);
const ownCount = new Map();
for (const r of g.recs) { const n = Number(r.id); ownCount.set(n, (ownCount.get(n) || 0) + 1); }
const dups = [...ownCount.entries()].filter(([, c]) => c > 1);
if (dups.length) {
  console.error('✗ 输入本身就有重复记录 id：' + dups.slice(0, 5).map(([k]) => k).join(',') + '（先修再换号）');
  process.exit(2);
}

const base = Number(argOf('base', String(Math.max(...recIds) + 100000)));
if (base <= CANVAS_HI) { console.error('✗ --base 必须大于画布头段 ' + CANVAS_HI); process.exit(2); }
// ★ 新号必须仍落在读档器/引擎认的 GUID 窗口里（gilread.mjs 的 ID_LO..ID_HI = 1073000000..1074200000）
if (base + recIds.length > 1074200000) {
  console.error('✗ --base 太高：新号段 ' + base + '..' + (base + recIds.length - 1) + ' 超出 1074200000');
  process.exit(2);
}

// 映射：按旧号升序，新号 = base + 序号（保序，便于人肉核对）
const map = new Map();
recIds.forEach((old, i) => map.set(old, base + i));

console.log('存档 ' + path.basename(IN) + '　记录 ' + g.recs.length + '　旧号 ' + recIds[0] + '..' + recIds[recIds.length - 1]);
console.log('新号段 ' + base + '..' + (base + recIds.length - 1) + '（' + recIds.length + ' 条）');

// 全档替换：所有 id 型 varint，命中映射就换；命中画布头/内置模板就保留
let changed = 0, kept = 0;
(function walk(fields) {
  for (const f of fields || []) {
    if (f.wt === 0) {
      const v = Number(f.num);
      if (v >= CANVAS_LO && v <= CANVAS_HI) { kept++; }
      else if (BUILTIN_TPL.has(v)) { kept++; }
      else if (map.has(v)) { f.num = BigInt(map.get(v)); changed++; }
    }
    if (f.sub) walk(f.sub);
  }
})(g.tree);

// ★★★ **子列表是 packed bytes**（不是 varint）⇒ 上面那趟 walk 改不到它，必须单独重写。
//   第一版漏了这一步，结果记录都换了号、父的子列表还指着旧号 ⇒ 读档器报"登记了不存在的 id"。
let listChanged = 0;
for (const r of g.recs) {
  const cl = findChildListTop(r.field.sub);
  if (!cl) continue;
  const ids = (asIdList(cl.payload, true) || []).map(Number);
  let touched = false;
  const out = ids.map((v) => {
    if (map.has(v)) { touched = true; return map.get(v); }
    return v;
  });
  if (touched) { setChildList(cl, out); listChanged++; }
}
console.log('子列表重写 ' + listChanged + ' 条记录');

if (DRY) {
  console.log('[--dry] 会改 ' + changed + ' 处，保留 ' + kept + ' 处（画布头/内置模板）');
  process.exit(0);
}

const expectRecs = g.recs.length;
writeGil(g, P(OUT), {
  label: 'renumber_all',
  expectRecs,
  assert: (g2) => {
    const bad = [];
    const ids = g2.recs.map((r) => Number(r.id));
    if (new Set(ids).size !== ids.length) bad.push('换号后仍有重复记录 id');
    const outside = ids.filter((i) => i < base || i >= base + recIds.length);
    if (outside.length) bad.push('有 ' + outside.length + ' 条记录没换号：' + outside.slice(0, 5).join(','));
    // 内置模板索引必须还在（抽查两个）
    const hasTpl = (v) => {
      let hit = false;
      (function w(fs) { for (const f of fs || []) { if (f.wt === 0 && Number(f.num) === v) { hit = true; return; } if (f.sub) w(f.sub); } })(g2.tree);
      return hit;
    };
    for (const v of [1073741848, 1073741864]) {
      if (BUILTIN_TPL.has(v) && !hasTpl(v)) bad.push('内置模板索引 ' + v + ' 被改掉了');
    }
    if (bad.length) throw new Error('✗ 断言失败：\n  ' + bad.join('\n  '));
    console.log('  ✅ 断言：' + ids.length + ' 条记录全部落进新号段且唯一；内置模板索引保留');
  },
});
console.log('\n已写出：' + path.basename(P(OUT)) + '（' + fs.statSync(P(OUT)).size + ' 字节）　替换 ' + changed + ' 处、保留 ' + kept + ' 处');
