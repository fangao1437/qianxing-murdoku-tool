// 修复教程文本不渲染：高度至少为字号2倍，窄框宽度至少为字号1.5倍；中心不动。
import path from 'node:path';
import { readGil, recordsOf, stateBlocks, pairOf, pairValue, setPair } from './gilread.mjs';
import { writeGil } from './gilwrite.mjs';

const [inPath, outPath] = process.argv.slice(2);
if (!inPath || !outPath) throw new Error('用法: node _fix_tutorial_text_metrics.mjs <输入.gil> <输出.gil>');
const g = readGil(inPath);
function nodesAt(fields, pathArr) {
  let level = fields;
  for (let i = 0; i < pathArr.length; i++) {
    const hits = level.filter((f) => f.field === pathArr[i] && f.sub);
    if (i === pathArr.length - 1) return hits;
    level = hits.flatMap((f) => f.sub);
  }
  return [];
}
function info(rec) {
  const ns = nodesAt(rec.field.sub, [505, 503, 75]);
  if (ns.length !== 1) return null;
  const grp = ns[0];
  const tn = grp.sub.find((f) => f.field === 510 && f.sub);
  const tl = tn && tn.sub.find((f) => f.field === 501 && f.wt === 2);
  const text = tl && tl.payload ? tl.payload.toString('utf8') : '';
  const fs = grp.sub.find((f) => f.field === 512 && f.wt === 0);
  return { text, font:fs ? Number(fs.num) : 0 };
}
const touched = [];
for (const rec of g.recs) {
  if (!rec.name || !rec.name.startsWith('td.')) continue;
  const cur = info(rec);
  if (!cur || !cur.text || cur.font <= 0) continue;
  const minW = Math.ceil(cur.font * 1.5), minH = Math.ceil(cur.font * 2);
  const blocks = []; stateBlocks(rec.field.sub, blocks);
  let changed = false, before = null, after = null;
  for (const b of blocks) {
    const sz = pairOf(b, 505); if (!sz) continue;
    const w = pairValue(sz, 0), h = pairValue(sz, 1);
    if (before == null) before = { w, h };
    const nw = Math.max(w, minW), nh = Math.max(h, minH);
    if (nw !== w || nh !== h) { setPair(sz, nw, nh); changed = true; }
    after = { w:nw, h:nh };
  }
  if (changed) touched.push({ id:rec.id, name:rec.name, font:cur.font, minW, minH, before, after });
}
console.log('文本框修正', touched.length, '项；高度不足', touched.filter((x) => x.before.h < x.minH).length,
  '项；宽度不足', touched.filter((x) => x.before.w < x.minW).length, '项');
for (const x of touched.filter((x) => /heading|rule\.1\.title|body\.0\.0|stepnum\.1|\.tag$/.test(x.name)).slice(0, 15)) {
  console.log(' ', x.name, `${x.before.w.toFixed(2)}x${x.before.h.toFixed(2)}`, '→', `${x.after.w}x${x.after.h}`, 'font', x.font);
}
writeGil(g, outPath, {
  label:'tutorial-text-metrics', expectRecs:g.recs.length, mustDiffer:touched.length > 0, quiet:false,
  assert:(g2) => {
    const map = new Map(recordsOf(g2.tree).map((r) => [r.id, r]));
    for (const t of touched) {
      const r = map.get(t.id); if (!r) return '缺记录 ' + t.name;
      const blocks = []; stateBlocks(r.field.sub, blocks);
      for (const b of blocks) {
        const sz = pairOf(b, 505);
        if (sz && (pairValue(sz, 0) < t.minW || pairValue(sz, 1) < t.minH)) return '尺寸不足 ' + t.name;
      }
      const cur = info(r); if (!cur || !cur.text) return '文本丢失 ' + t.name;
    }
    return true;
  },
});
console.log('输出', path.basename(outPath));
