// tools/gil_dupid.mjs —— 查 .gil 里 GUID 的重复"认领"（判据照 qianxing-murdoku/docs/回执-GUID根因-v259.md）
//
// 一条控件在 .gil 里存了不止一份 GUID，至少三处：
//   /#9/#502/#501            记录顶层 id              → 认领
//   …/#502/#11/#501          info 里的 guid 包装      → 认领
//   …/#505/…/#503/#504/#4    槽 details 里的 nodeRef  → 回指（不算认领）
//   /#9/#502/#503 (打包列表)  父控件的子 id 列表        → 引用（不算认领）
// 编辑器报「GUID 重复」= **同一个 id 被 ≥2 条记录认领**（历史上就是"克隆只改顶层 #501，
// info guid 还指着母本"）。所以本工具按"记录"聚合认领，而不是简单数出现次数。
//
// 用法：node tools/gil_dupid.mjs <file.gil> [--id=1073742041]
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readGil } from '../../../qianxing-murdoku/tools/gil/gilread.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..', '..');
const argv = process.argv.slice(2);
const FILE = argv.find((a) => !a.startsWith('--'));
const argOf = (k) => {
  const a = argv.find((s) => s.startsWith('--' + k + '='));
  return a ? a.slice(k.length + 3) : null;
};
if (!FILE) {
  console.error('用法: node tools/gil_dupid.mjs <file.gil> [--id=…]');
  process.exit(2);
}
const ONLY = argOf('id');
const ID_LO = 1073000000n;
const ID_HI = 1074200000n;

const g = readGil(path.resolve(REPO, FILE));

/** 认领类型：recordId（记录顶层 #501）/ infoGuid（#502 里的 guid 包装）/ nodeRef（槽内回指）
 *  注意：这里的路径 p 是**相对记录体**的（`rec.field.sub` 起算），所以是 `/#501` 而不是 `/#9/#502/#501`。 */
function claimKind(p) {
  if (p === '/#501') return 'recordId';
  if (p === '/#502/#11/#501') return 'infoGuid';
  if (p.endsWith('/#503/#504/#4')) return 'nodeRef';
  if (p.endsWith('/#504/#4')) return 'nodeRef';
  return null;
}

const claims = new Map(); // id -> [ {recId, name, kind, path} ]
const mentions = new Map(); // id -> count

/** 逐条记录扫描：readGil().recs[].field.sub 就是记录体 */
for (const rec of g.recs) {
  (function walk(fields, p) {
    for (const f of fields) {
      const here = `${p}/#${f.field}`;
      if (f.wt === 0 && f.num >= ID_LO && f.num <= ID_HI) {
        const id = Number(f.num);
        mentions.set(id, (mentions.get(id) || 0) + 1);
        const kind = claimKind(here);
        if (kind) {
          if (!claims.has(id)) claims.set(id, []);
          claims.get(id).push({ recId: rec.id, name: rec.name || '(无名)', kind, path: here });
        }
        continue;
      }
      if (f.wt === 2 && f.payload && !f.isText) {
        // 打包 id 列表（子列表 / 相关列表）
        let ids = null;
        try {
          let q = 0;
          const out = [];
          while (q < f.payload.length) {
            let r = 0n, s = 0n;
            for (;;) {
              const byte = f.payload[q++];
              r |= BigInt(byte & 0x7f) << s;
              if ((byte & 0x80) === 0) break;
              s += 7n;
              if (s > 63n) throw new Error('long');
            }
            out.push(r);
          }
          ids = out;
        } catch {
          ids = null;
        }
        if (ids && ids.length && ids.every((v) => v >= ID_LO && v <= ID_HI)) {
          for (const v of ids) mentions.set(Number(v), (mentions.get(Number(v)) || 0) + 1);
          continue;
        }
      }
      if (f.sub) walk(f.sub, here);
    }
  })(rec.field.sub, '');
}

// ★ 2026-10-21 修正：**nodeRef 也算"认领"**。
//   依据 qianxing-murdoku/docs/回执-GUID根因-v259.md 的实测表：编辑器把
//   `/#501`、`/#502/#11/#501`、`/#505/…#503/#504/#4` 三处**都**当作"这条控件用着这个 GUID"。
//   上一版只把前两处算认领 ⇒ 漏掉了"克隆体里 nodeRef 还指着母本"这类真重复（正是 v259 的真因）。
const owners = new Map(); // id -> Set(recId)
for (const [id, arr] of claims) {
  const set = new Set(arr.map((c) => c.recId));
  if (set.size) owners.set(id, set);
}

const dup = [...owners.entries()].filter(([, s]) => s.size > 1);
console.log(`文件：${path.basename(g.file)}（${g.src.length} 字节，记录 ${g.recs.length} 条）`);
console.log(`★ 被 ≥2 条记录认领的 id：${dup.length} 个`);

for (const [id, set] of (ONLY ? dup.filter(([i]) => i === Number(ONLY)) : dup).slice(0, 15)) {
  console.log(`\nid ${id} 被 ${set.size} 条记录认领：`);
  for (const c of claims.get(id)) {
    console.log(`   ${c.kind.padEnd(9)} record #${c.recId} ${c.name}   ← ${c.path}`);
  }
}

// 单条记录内部是否自洽（recordId / infoGuid / nodeRef 是否都等于自己的 id）
console.log('\n—— 逐条自检（recordId 与 infoGuid 必须都等于记录自身 id）——');
let bad = 0;
for (const rec of g.recs) {
  const arr = (claims.get(rec.id) || []).filter((c) => c.recId === rec.id);
  const ids = arr.filter((c) => c.kind === 'recordId').length;
  const infos = arr.filter((c) => c.kind === 'infoGuid').length;
  const foreignNodeRefs = (claims.get(rec.id) || []).length === 0;
  if (ids !== 1 || infos < 1) {
    bad++;
    if (bad <= 12) console.log(`   ⚠ #${rec.id} ${rec.name || '(无名)'}  recordId=${ids} infoGuid=${infos}`);
  }
}
if (!bad) console.log('   全部记录都恰好 1 个 recordId + ≥1 个 infoGuid ✓');

if (ONLY) {
  const id = Number(ONLY);
  console.log(`\nid ${id} 的总出现次数（含引用/回指/列表）：${mentions.get(id) || 0}`);
  console.log(`记录名：${g.recs.find((r) => r.id === id)?.name || '(不是被识别出的记录)'}`);
}
