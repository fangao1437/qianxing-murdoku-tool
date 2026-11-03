// tools/gia_recs.mjs — 逐记录列出槽位签名，按签名分组，重建层级
// 用法: node gia_recs.mjs <file.gia> [--tree] [--json out.json]
import fs from 'node:fs';
import * as pb from './pb.mjs';

const argv = process.argv.slice(2);
const IN = argv[0];
const WANT_TREE = argv.includes('--tree');
const JSON_OUT = (() => {
  const i = argv.indexOf('--json');
  return i >= 0 ? argv[i + 1] : null;
})();

const buf = fs.readFileSync(IN);
const bodyLen = buf.readUInt32BE(16);
const root = pb.decodeDeep(buf.subarray(20, 20 + bodyLen));

// 官方/插件侧槽位表（worker.js br/wa 两族）
const SLOT_NAME = {
  '1/12': 'transform',
  '1/11': 'transformAlt',
  '2/15': 'name',
  '4/23': 'field14',
  '4/86': 'field14',
  '62/82': 'rootChildRef',
  '63/83': 'genericSlot',
  '64/84': 'textConfig',
  '65/85': 'cursorConfig',
  '66/89': 'templateRefSlot',
  '67/90': 'footerSlot',
  '68/91': 'containerNodeSlot',
  '69/92': 'gridView',
  '70/93': 'buttonPreset',
  '71/94': 'textConfigTw',
  '72/95': 'keyHint',
  '73/96': 'imageSlot',
  '74/97': 'image',
  '75/98': 'effectSlot',
  '76/99': 'fullscreenEffectSlot',
};
// Details oneof 内层字段号（_gia_schema.proto）
const DET_SLOT = {
  13: 'transform', 14: 'field14', 73: 'rootChildRef', 74: 'genericSlot', 75: 'textConfig',
  76: 'cursorConfig', 77: 'templateRefSlot', 78: 'footerSlot', 79: 'containerNodeSlot',
  80: 'gridView', 81: 'buttonPreset', 83: 'keyHint', 84: 'imageSlot', 85: 'image',
  86: 'effectSlot', 87: 'fullscreenEffectSlot',
};

function txtOf(f) {
  const s = pb.txt([f], f.field);
  return s == null ? null : s;
}

const units = [];
for (const [bucket, field] of [['graph', 1], ['accessories', 2]]) {
  for (const u of pb.msgs(root, field)) {
    const s = u.sub || [];
    const idM = pb.msg(s, 1) || [];
    const rec = {
      bucket,
      guid: pb.num(idM, 4),
      class: pb.num(idM, 2),
      type: pb.num(idM, 3),
      name: pb.txt(s, 3),
      which: pb.num(s, 5),
      related: pb.msgs(s, 2).map((r) => pb.num(r.sub || [], 4)),
      slots: [],
      text: null,
      childrenInWrapper: [],
      parentInWrapper: null,
    };
    const ui = pb.msg(s, 19);
    const content = ui ? pb.msg(ui, 1) : null;
    if (content) {
      for (const d of pb.msgs(content, 505)) {
        const ds = d.sub || [];
        const a = pb.num(ds, 501);
        const b = pb.num(ds, 502);
        const key = `${a}/${b}`;
        const det = pb.msg(ds, 503);
        const detField = det ? ((det.sub || []).find((f) => DET_SLOT[f.field]) || {}).field : null;
        rec.slots.push({ key, name: SLOT_NAME[key] || `?${key}`, detField, detName: detField ? DET_SLOT[detField] : null });
        // name 槽
        if (key === '2/15') {
          const w = ds.find((f) => f.field === 12);
          const inner = w ? pb.msg(w.sub || [], 501) : null;
          rec.text = inner ? pb.txt(inner, 501) : null;
        }
        // 文本类槽里的字符串
        if (det) {
          const walk = (fields) => {
            for (const f of fields || []) {
              if (f.wt === 2) {
                const t = txtOf(f);
                if (t && t.length > 1 && t.length < 200) (rec.strings || (rec.strings = [])).push(t);
                else if (f.sub) walk(f.sub);
              }
            }
          };
          walk(det.sub || []);
        }
      }
      // 包装层 children（#503）与 parent（#504）
      for (const c of pb.msgs(content, 503)) {
        if (c.payload && !c.sub) {
          try {
            let p = 0;
            const ids = [];
            while (p < c.payload.length) {
              const v = pb.readVarint(c.payload, p);
              p = v.pos;
              ids.push(Number(v.value));
            }
            rec.childrenInWrapper.push(...ids);
          } catch { /* 非 ID 列表 */ }
        }
      }
      for (const p of pb.msgs(content, 504)) {
        if (p.wt === 0) rec.parentInWrapper = Number(p.num);
        else if (p.sub) rec.parentRef = { class: pb.num(p.sub, 2), type: pb.num(p.sub, 3), id: pb.num(p.sub, 4) };
      }
    }
    units.push(rec);
  }
}

// 槽位签名分组
const bySig = new Map();
for (const r of units) {
  const sig = r.slots.map((x) => x.name).sort().join('+') || '(无 ui)';
  bySig.set(sig, (bySig.get(sig) || 0) + 1);
}
console.log('# 记录数 =', units.length);
console.log('\n# 槽位签名分组');
for (const [sig, c] of [...bySig.entries()].sort((x, y) => y[1] - x[1])) console.log(`  ${String(c).padStart(3)} × ${sig}`);

console.log('\n# 逐条（bucket guid which name 槽位 related 数）');
for (const r of units) {
  console.log(
    `  [${r.bucket}] ${r.guid} which=${r.which} name=${JSON.stringify(r.name ?? r.text)} slots=${r.slots.map((s) => s.name).join(',')} rel=${r.related.length} chW=${r.childrenInWrapper.length}`,
  );
}

if (WANT_TREE) {
  const byGuid = new Map(units.map((r) => [r.guid, r]));
  const roots = [];
  for (const r of units) {
    const parents = units.filter((p) => p.related.includes(r.guid));
    r.parents = parents.map((p) => p.guid);
    if (!parents.length) roots.push(r);
  }
  console.log('\n# 树（按 relatedIds 反查父）');
  const seen = new Set();
  const walk = (r, d) => {
    if (seen.has(r.guid)) return;
    seen.add(r.guid);
    const extra = r.parents && r.parents.length > 1 ? `  ⚠多父:${r.parents.join(',')}` : '';
    console.log(`${'  '.repeat(d)}- ${r.name ?? r.text ?? r.guid} [${r.guid}] ${r.which} ${r.slots.map((s) => s.name).join(',')}${extra}`);
    for (const g of r.related) {
      const c = byGuid.get(g);
      if (c) walk(c, d + 1);
      else console.log(`${'  '.repeat(d + 1)}- (缺失引用 ${g})`);
    }
  };
  for (const r of roots) walk(r, 1);
  const orphans = units.filter((r) => !seen.has(r.guid));
  if (orphans.length) {
    console.log(`\n# 未被挂上树的记录 ${orphans.length} 条`);
    for (const o of orphans.slice(0, 20)) console.log(`  - ${o.name ?? o.text ?? o.guid} [${o.guid}]`);
  }
}

if (JSON_OUT) {
  fs.writeFileSync(JSON_OUT, JSON.stringify({ units }, null, 1));
  console.log('\n已写', JSON_OUT);
}
