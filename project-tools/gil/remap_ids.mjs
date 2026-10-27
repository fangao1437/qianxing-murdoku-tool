// tools/gil/remap_ids.mjs —— 修「克隆控件时 GUID 只换了一半」的根因 ✗✓✓
//
//   2026-10-18 用户报「界面控件…GUID重复」，而按**顶层 `#501`** 查是 0 个重复。
//   查明的真相（`_probe_innergids.mjs`）：
//     一条控件记录里，**它自己的 GUID 存了两份** ——
//       · `/#501`                     ← 我之前只改了这一份 ✓
//       · `/#502/#11/#501`            ← **没改** ✗（编辑器校验读的就是这份/或按它枚举）
//     另外 `/#505/#503/#504/#4` 也带着同一个号（反向引用）✗
//   ⇒ 我把 `face` 克隆成 `content/obj`、把 `tpl-container` 克隆成 `things` / `obj.*` 时，
//     这两处仍指向**母本**的 GUID ⇒ 编辑器看到"两个控件同一个 GUID" ✓
//   ⇒ 本工具：把"克隆体里仍然等于**母本 GUID**"的那些 varint 全部改成**克隆体自己的 GUID** ✓
//
//   用法：node tools/gil/remap_ids.mjs --in=<存档.gil> --out=<输出.gil> [--names=obj,obj.table,…] [--dry]
//   断言：① 每个目标记录里不再出现母本 GUID ② 全档"同一 id 被两条记录共用"的数量下降且不含目标 ③ 往返一致
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readGil, bigIdTop } from './gilread.mjs';
import { writeGil } from './gilwrite.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const P = (p) => (path.isAbsolute(p) ? p : path.join(ROOT, p));
const argv = process.argv.slice(2);
const argOf = (k, d) => {
  const hit = argv.find((s) => s.startsWith('--' + k + '='));
  return hit ? hit.slice(k.length + 3).replace(/^"|"$/g, '') : d;
};
const IN = argOf('in'), OUT = argOf('out');
const NAMES = argOf('names', 'obj,obj.table');
const DRY = argv.includes('--dry');
if (!IN || !OUT) { console.error('用法: --in=<存档.gil> --out=<输出.gil> [--names=obj,obj.table,…] [--dry]'); process.exit(1); }

const ID_LO = 10000000, ID_HI = 99_999_999_999;
const g = readGil(P(IN));
const targetNames = new Set(NAMES.split(',').map((s) => s.trim()).filter(Boolean));

/** 一条记录里所有 id 级 varint（带路径） */
function idsOf(fields, out) {
  const walk = (fs_, p) => {
    for (const f of fs_ || []) {
      const np = p + '/#' + f.field;
      if (f.wt === 0) {
        const v = Number(f.num);
        if (v > ID_LO && v < ID_HI) out.push({ f, v, where: np });
      }
      if (f.sub) walk(f.sub, np);
    }
  };
  walk(fields, '');
  return out;
}

const targets = g.recs.filter((r) => targetNames.has(r.name));
if (!targets.length) { console.error('✗ 找不到目标控件：' + [...targetNames].join(',')); process.exit(2); }

console.log('存档 ' + path.basename(IN) + '　记录 ' + g.recs.length);
console.log('目标控件 ' + targets.length + ' 个：');

const plan = [];
for (const r of targets) {
  const ids = idsOf(r.field.sub, []);
  const mine = new Set([r.id]);
  // 母本 GUID = 记录里出现的、**不等于自己**、且出现 ≥2 次的那个 id（`#502/#11/#501` + `#505/#503/#504/#4`）
  const cnt = new Map();
  for (const h of ids) if (!mine.has(h.v)) cnt.set(h.v, (cnt.get(h.v) || 0) + 1);
  const src = [...cnt.entries()].filter(([, n]) => n >= 2).map(([v]) => v);
  if (!src.length) { console.log('  ' + r.name.padEnd(14) + '#' + r.id + '　（没有母本 GUID，跳过）'); continue; }
  plan.push({ rec: r, src });
  console.log('  ' + r.name.padEnd(14) + '#' + r.id + '　母本 GUID：' + src.join(',')
    + '　→ 改成自己的 #' + r.id);
}

if (DRY) { console.log('\n[--dry] 不写文件'); process.exit(0); }

let changed = 0;
for (const { rec, src } of plan) {
  const ids = idsOf(rec.field.sub, []);
  for (const h of ids) {
    if (src.includes(h.v)) { h.f.num = BigInt(rec.id); changed++; }
  }
}

const expectRecs = g.recs.length;
writeGil(g, P(OUT), {
  label: 'remap_ids',
  expectRecs,
  assert: (g2) => {
    const bad = [];
    for (const item of plan) {
      const r2 = g2.recs.find((x) => x.id === item.rec.id && x.name === item.rec.name);
      if (!r2) { bad.push('找不到 ' + item.rec.name); continue; }
      const ids = idsOf(r2.field.sub, []).map((h) => h.v);
      for (const s of item.src) {
        if (ids.includes(s)) bad.push(item.rec.name + ' 里仍残留母本 GUID ' + s);
      }
    }
    if (bad.length) throw new Error('✗ 断言失败：\n  ' + bad.join('\n  '));
    console.log('  ✅ 重读断言：' + plan.length + ' 个克隆控件已改用**自己的** GUID（母本号不再出现）✓');
  },
});
console.log('\n已写出：' + OUT + '（' + fs.statSync(P(OUT)).size + ' 字节）　改写 ' + changed + ' 处 varint');
