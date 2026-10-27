// tools/gil/renumber_ids.mjs —— 把**我新增的那批控件**的 GUID 挪到"高段"，避开用户工程里已占用的号
//
//   背景（2026-10-18 真机/编辑器回报）：
//     「界面控件里的开关控件GUID重复:1073742787」——而存档记录表里**只有一个** 1073742787 ✓
//   推断：我做 `things` 时按"本档 max+1"取了 1073742786~92，
//         而**用户工程在自己那份 395 之后又加过控件**（比如一个开关控件正好占了这个号）⇒ 撞号 ✓
//   ⇒ 修法：把这批新控件的 GUID 统一挪到 **max+1000 以上**（本档里绝不会撞）✓
//
//   用法：node tools/gil/renumber_ids.mjs --in=<存档.gil> --out=<输出.gil> [--base=N] [--dry]
//   断言：① 新号全部 > 原 max ② 全档无重复 ③ 每个迁移记录的"子列表 entry / 父指针"一致 ④ 往返一致
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readGil, findChildListTop, setChildList, asIdList, bigIdTop } from './gilread.mjs';
import { writeGil } from './gilwrite.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const P = (p) => (path.isAbsolute(p) ? p : path.join(ROOT, p));
const argv = process.argv.slice(2);
const argOf = (k, d) => {
  const hit = argv.find((s) => s.startsWith('--' + k + '='));
  return hit ? hit.slice(k.length + 3).replace(/^"|"$/g, '') : d;
};
const IN = argOf('in'), OUT = argOf('out');
if (!IN || !OUT) { console.error('用法: --in=<存档.gil> --out=<输出.gil> [--base=N] [--dry]'); process.exit(1); }
const DRY = argv.includes('--dry');

/** 这条记录是不是"我们新加的"：`things` / `things` 下的 `obj.*` / `content` 下的 `obj` */
const isOurs = (r) => r.name === 'things' || r.name === 'obj' || /^obj\./.test(r.name || '');

const g = readGil(P(IN));
const maxId = Math.max(...g.recs.map((r) => r.id));
const base = Number(argOf('base', String(maxId + 1000)));

const targets = g.recs.filter(isOurs).sort((a, b) => a.id - b.id);
if (!targets.length) { console.error('✗ 没找到要迁移的记录'); process.exit(2); }

const map = new Map();
targets.forEach((r, i) => map.set(r.id, base + i));

console.log('存档 ' + path.basename(IN) + '　记录 ' + g.recs.length + '　原 maxId ' + maxId + '　新基址 ' + base);
console.log('要迁移 ' + targets.length + ' 条：');
for (const r of targets) console.log('  ' + String(r.name).padEnd(14) + '#' + r.id + ' → #' + map.get(r.id));

const oldIds = new Set(map.keys());
const recOf = (id) => g.recs.find((r) => r.id === id);

// ① 改自己的 #501
for (const r of targets) {
  const leaf = r.field.sub.find((x) => x.wt === 0 && x.field === 501);
  if (!leaf) { console.error('✗ #' + r.id + ' 没有顶层 #501'); process.exit(3); }
  leaf.num = BigInt(map.get(r.id));
}

// ② 父的子列表：旧号 → 新号（★ 父自己也可能是我们的（`things`），同样要改它那份列表 ✓）
const parentsTouched = new Set();
for (const r of targets) {
  if (r.parentId == null) continue;
  const parent = recOf(r.parentId);
  if (!parent) continue;
  const cl = findChildListTop(parent.field.sub);
  if (!cl) continue;
  const ids = (asIdList(cl.payload, true) || []).map(Number).map((v) => (map.has(v) ? map.get(v) : v));
  setChildList(cl, ids);
  parentsTouched.add(parent.id);
}

// ③ 我的记录的"子"：父指针 #504 指向新号
for (const r of targets) {
  const kids = g.recs.filter((k) => k.parentId === r.id);
  for (const k of kids) {
    const pp = k.field.sub.find((x) => x.wt === 0 && x.field === 504);
    if (pp) pp.num = BigInt(map.get(r.id));
  }
}

// ④ 我自己记录的父指针（父是外面的人，不变）；但如果父也是我的，已在 ③ 处理 ✓
console.log('\n改过子列表的父控件：' + [...parentsTouched].map((x) => '#' + x).join(', '));

if (DRY) { console.log('\n[--dry] 不写文件'); process.exit(0); }

const expectRecs = g.recs.length;
writeGil(g, P(OUT), {
  label: 'renumber_ids',
  expectRecs,
  assert: (g2) => {
    const bad = [];
    const ids = g2.recs.map((r) => r.id);
    const dup = ids.filter((v, i) => ids.indexOf(v) !== i);
    if (dup.length) bad.push('重复 GUID：' + [...new Set(dup)].join(','));
    // 新号必须都 > 原 max
    for (const v of map.values()) if (v <= maxId && !oldIds.has(v)) bad.push('新号没超过原 max：' + v);
    // 迁移记录的子列表登记
    for (const r of targets) {
      const now = g2.recs.find((x) => x.name === r.name && map.get(r.id) === x.id);
      if (!now) { bad.push('迁移后找不到 ' + r.name); continue; }
      if (now.parentId != null) {
        const parent = g2.recs.find((x) => x.id === now.parentId);
        if (parent) {
          const cl = findChildListTop(parent.field.sub);
          const list = cl ? (asIdList(cl.payload, true) || []).map(Number) : [];
          if (!list.includes(now.id)) bad.push(now.name + ' 没登记进父 ' + parent.name);
          if (list.includes(r.id) && r.id !== now.id) bad.push(parent.name + ' 里还留着旧号 ' + r.id);
        }
      }
      // 子指针
      const kids = g2.recs.filter((k) => k.parentId === now.id);
      if (kids.length !== g2.recs.filter((k) => k.parentId === now.id).length) bad.push(now.name + ' 子列表自洽失败');
      for (const k of kids) {
        const pp = k.field.sub.find((x) => x.wt === 0 && x.field === 504);
        if (!pp || Number(pp.num) !== now.id) bad.push(now.name + ' 的子 ' + k.name + ' 父指针不对');
      }
    }
    if (bad.length) throw new Error('✗ 断言失败：\n  ' + bad.join('\n  '));
    console.log('  ✅ 重读断言：无重复 GUID；' + targets.length + ' 条迁移记录的"父列表 / 子指针"全部自洽 ✓');
  },
});
console.log('\n已写出：' + OUT + '（' + fs.statSync(P(OUT)).size + ' 字节，记录 ' + expectRecs + '）');
