// tools/sim/scale_groups_in_gil.mjs -- scale controls in a .gil keeping each centre (or a group's centre) fixed
//
// 2026-10-16 user instructions (revised):
//   1) the four level-select cards sit too far left: scale them holding the GROUP centre fixed,
//      so the gaps shrink with them (no fixed-gap behaviour like the board grid)
//   2) also scale the grid viewport and its background to 90% of their current xy
//   3) everything except the board must be done in the .gil, not in the script
//
// two modes:
//   --each="a,b"    -> each control scales about ITS OWN centre
//   --group="c,d,e" -> the set scales about the bounding box centre of the set
//
// usage:
//   node tools/sim/scale_groups_in_gil.mjs --in=<in.gil> --out=<out.gil> [--k=0.9] \
//        [--each="clues.grid,clues.bg"] [--group="select.card.1,..."]
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readGil } from '../gil/gilread.mjs';
import { writeGil } from '../gil/gilwrite.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const argv = process.argv.slice(2);
const argOf = (k) => { const a = argv.find((s) => s.startsWith('--' + k + '=')); return a ? a.slice(k.length + 3).replace(/^"|"$/g, '') : null; };
const IN = argOf('in'), OUT = argOf('out');
const K = Number(argOf('k') || 0.9);
const EACH = (argOf('each') || '').split(',').map((s) => s.trim()).filter(Boolean);
const GROUP = (argOf('group') || '').split(',').map((s) => s.trim()).filter(Boolean);
if (!IN || !OUT || (EACH.length === 0 && GROUP.length === 0)) {
  console.error('usage: --in= --out= [--k=0.9] [--each="a,b"] [--group="c,d,e"]');
  process.exit(1);
}

const g = readGil(path.isAbsolute(IN) ? IN : path.join(ROOT, IN));
const pairOf = (r, n) => {
  const b = r.states[0];
  const p = b.sub.find((x) => x.field === n);
  return p && p.sub ? p.sub.filter((x) => x.wt === 5) : null;
};
// size must be a pair; the position may carry a SINGLE float in this archive (clues.bg does),
// which is the offset form -- keep scaling it, just with one component.
function rectOf(r) {
  const p = pairOf(r, 504), s = pairOf(r, 505);
  if (!p || !s || s.length < 2) return null;
  const two = p.length >= 2;
  return {
    x: two ? p[0].f : null,
    y: two ? p[1].f : null,
    p1: !two && p.length === 1 ? p[0].f : null,
    w: s[0].f, h: s[1].f,
  };
}
function writeRect(rec, x, y, w, h, p1) {
  let n = 0;
  for (const blk of rec.states) {
    const p4 = blk.sub.find((z) => z.field === 504);
    const p5 = blk.sub.find((z) => z.field === 505);
    const apply = (p, vals) => {
      if (!p || !p.sub) return;
      const fs_ = p.sub.filter((z) => z.wt === 5);
      vals.forEach((v, i) => { if (fs_[i] !== undefined && v !== null) { fs_[i].f = v; n++; } });
    };
    const single = p4 && p4.sub.filter((z) => z.wt === 5).length === 1;
    apply(p4, single ? [p1] : [x, y]);
    apply(p5, [w, h]);
  }
  return n;
}

const plan = [];

// (1) each about its own centre
for (const nm of EACH) {
  const r = g.byName.get(nm);
  if (!r) { console.log('  skip (absent): ' + nm); continue; }
  const b = rectOf(r);
  if (!b) { console.log('  skip (geometry incomplete): ' + nm); continue; }
  plan.push({
    name: nm, rec: r, before: b,
    after: {
      x: b.x === null ? null : b.x * K,
      y: b.y === null ? null : b.y * K,
      p1: b.p1 === null ? null : b.p1 * K,
      w: b.w * K, h: b.h * K,
    },
  });
}

// (2) the whole set about its bounding box centre
if (GROUP.length) {
  const items = [];
  for (const nm of GROUP) {
    const r = g.byName.get(nm);
    if (!r) { console.log('  skip (absent): ' + nm); continue; }
    const b = rectOf(r);
    if (!b || b.x === null) { console.log('  skip (geometry incomplete): ' + nm); continue; }
    items.push({ name: nm, rec: r, b });
  }
  if (items.length) {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const it of items) {
      minX = Math.min(minX, it.b.x - it.b.w / 2); maxX = Math.max(maxX, it.b.x + it.b.w / 2);
      minY = Math.min(minY, it.b.y - it.b.h / 2); maxY = Math.max(maxY, it.b.y + it.b.h / 2);
    }
    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
    console.log('  group bbox x ' + minX.toFixed(1) + '..' + maxX.toFixed(1)
      + '  y ' + minY.toFixed(1) + '..' + maxY.toFixed(1) + '  centre (' + cx.toFixed(1) + ',' + cy.toFixed(1) + ')');
    for (const it of items) {
      plan.push({
        name: it.name, rec: it.rec, before: it.b,
        after: {
          x: cx + (it.b.x - cx) * K,
          y: cy + (it.b.y - cy) * K,
          p1: null,
          w: it.b.w * K, h: it.b.h * K,
        },
      });
    }
  }
}

let tot = 0;
for (const p of plan) {
  tot += writeRect(p.rec, p.after.x, p.after.y, p.after.w, p.after.h, p.after.p1 ? p.after.p1 : p.after.x * 0);
  const b = p.before, a = p.after;
  const bx = b.x === null ? (b.p1 === null ? '?' : String(b.p1.toFixed(1))) : (b.x.toFixed(1) + ',' + b.y.toFixed(1));
  const ax = a.x === null ? (a.p1 === null ? '?' : String(a.p1.toFixed(1))) : (a.x.toFixed(1) + ',' + a.y.toFixed(1));
  console.log('  ' + p.name.padEnd(22) + ' pos ' + bx.padEnd(16) + '-> ' + ax.padEnd(16)
    + '  size ' + b.w.toFixed(1) + 'x' + b.h.toFixed(1) + ' -> ' + a.w.toFixed(1) + 'x' + a.h.toFixed(1));
}
console.log('  k=' + K + '  floats written: ' + tot);

const rep = writeGil(g, path.isAbsolute(OUT) ? OUT : path.join(ROOT, OUT), {
  label: 'scale about centre k=' + K,
  assert: (g2) => {
    const bad = [];
    for (const p of plan) {
      const r2 = g2.recs.find((x) => x.id === p.rec.id);
      if (!r2) { bad.push(p.name + ' unreadable'); continue; }
      const a = rectOf(r2);
      if (Math.abs(a.w - p.after.w) > 0.01) bad.push(p.name + ' width ' + a.w + ' expected ' + p.after.w);
      if (a.x !== null && Math.abs(a.x - p.after.x) > 0.01) bad.push(p.name + ' x ' + a.x + ' expected ' + p.after.x);
      if (a.p1 !== null && p.after.p1 !== null && Math.abs(a.p1 - p.after.p1) > 0.01) bad.push(p.name + ' offset ' + a.p1 + ' expected ' + p.after.p1);
    }
    if (g2.recs.length !== g.recs.length) bad.push('record count changed');
    return bad.length ? bad.join('; ') : true;
  },
});
console.log('  wrote ' + path.basename(OUT) + ' (' + rep.bytes + ' bytes, ' + rep.recs + ' records, diff ' + rep.diffs + ')');
