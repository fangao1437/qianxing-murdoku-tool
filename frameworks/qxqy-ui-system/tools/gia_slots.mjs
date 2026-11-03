// tools/gia_slots.mjs — 统计 .gia 里所有 Data 槽位的 (a,b) 标识 → Details 内层字段 → 样本
// 用法: node gia_slots.mjs <file.gia>
import fs from 'node:fs';
import * as pb from './pb.mjs';

const IN = process.argv[2];
const buf = fs.readFileSync(IN);
const bodyLen = buf.readUInt32BE(16);
const root = pb.decodeDeep(buf.subarray(20, 20 + bodyLen));

// DET_SLOT：Details 内层字段号 → 语义（取自 _gia_schema.proto §UiControlGroup.ContentWrapper.Details）
const DET_SLOT = {
  13: 'transform', 14: 'field14', 73: 'rootChildRef', 74: 'genericSlot', 75: 'textConfig',
  76: 'cursorConfig', 77: 'templateRefSlot', 78: 'footerSlot', 79: 'containerNodeSlot',
  80: 'gridView', 81: 'buttonPreset', 83: 'keyHint', 84: 'imageSlot', 85: 'image',
  86: 'effectSlot', 87: 'fullscreenEffectSlot',
};

const units = [...pb.msgs(root, 1), ...pb.msgs(root, 2)];
const slotMap = new Map(); // "a.b" -> { count, dets: Map, samples: [] }

for (const u of units) {
  const s = u.sub || [];
  const ui = pb.msg(s, 19);
  const content = ui ? pb.msg(ui, 1) : null;
  if (!content) continue;
  for (const d of pb.msgs(content, 505)) {
    const ds = d.sub || [];
    const a = pb.num(ds, 501);
    const b = pb.num(ds, 502);
    const key = `${a}.${b}`;
    if (!slotMap.has(key)) slotMap.set(key, { a, b, count: 0, dets: new Map(), topFields: new Map(), samples: [] });
    const rec = slotMap.get(key);
    rec.count++;
    const det = pb.msg(ds, 503);
    const inner = det ? (det.sub || []).map((f) => f.field) : [];
    for (const f of inner) rec.dets.set(f, (rec.dets.get(f) || 0) + 1);
    for (const f of ds.map((x) => x.field)) rec.topFields.set(f, (rec.topFields.get(f) || 0) + 1);
    // 样本：把可能的字符串与数值抓几个
    if (rec.samples.length < 3) {
      const text = [];
      const walk = (fields, d2 = 0) => {
        for (const f of fields || []) {
          if (d2 > 3) return;
          if (f.wt === 0 && f.field === 501 && f.num > 0n && f.num < 100000n) text.push(`#501=${f.num}`);
          else if (f.wt === 2) {
            const t = pb.txt([f], f.field);
            if (t != null && t.length) text.push(`#${f.field}="${t}"`);
            else if (f.sub) walk(f.sub, d2 + 1);
          } else if (f.wt === 5) text.push(`#${f.field}=f32:${f.f}`);
        }
      };
      walk(ds);
      rec.samples.push(text.slice(0, 14).join(' '));
    }
  }
}

const byCount = [...slotMap.entries()].sort((x, y) => y[1].count - x[1].count);
console.log('# Data 槽位 (a,b) 统计 —— 共', byCount.length, '种\n');
for (const [key, r] of byCount) {
  const dets = [...r.dets.entries()]
    .sort((x, y) => y[1] - x[1])
    .map(([f, c]) => `#${f}${DET_SLOT[f] ? `(${DET_SLOT[f]})` : ''}×${c}`)
    .join(' ');
  console.log(`slot ${key.padEnd(7)} count=${String(r.count).padEnd(4)} dets: ${dets || '(无)'}`);
  console.log(`  top: ${[...r.topFields.entries()].map(([f, c]) => `#${f}×${c}`).join(' ')}`);
  console.log(`  样本: ${r.samples[0] || ''}`);
}
