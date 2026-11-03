// tools/gia_tree.mjs — 重建 .gia 的控件树，并解码已知槽位（transform / field14 / name / 文本）
// 用法: node gia_tree.mjs <file.gia> [--maxdepth N] [--hidden] [--json out.json]
//
// 槽位表来源：插件 worker.js 内嵌 `br`（控件族）与 `wa`（界面/模板族）两张表 + Details oneof 号。
//   [ "a/b", data字段名, details字段名 ]
//   transform  1/12   → Details#13 MultiPlatform{platforms[#501 platformType, #502 RectTransform]}
//   name       2/15   → Data#12 WrapperString{value=#501}
//   field14    4/23|4/86 → Details#14 Field14{ empty15=#15, field17=#17 ClientInitialState{initiallyHidden=#503}, initiallyInactive=#502 }
//   rootChildRef 62/82 → Details#73 RootChildRef{guid=#501}
import fs from 'node:fs';
import * as pb from './pb.mjs';

const argv = process.argv.slice(2);
const IN = argv[0];
const MAXD = (() => {
  const i = argv.indexOf('--maxdepth');
  return i >= 0 ? Number(argv[i + 1]) : 99;
})();
const SHOW_HIDDEN = argv.includes('--hidden');
const JSON_OUT = (() => {
  const i = argv.indexOf('--json');
  return i >= 0 ? argv[i + 1] : null;
})();
if (!IN) {
  console.error('用法: node gia_tree.mjs <file.gia> [--maxdepth N] [--hidden] [--json out.json]');
  process.exit(2);
}

const buf = fs.readFileSync(IN);
const bodyLen = buf.readUInt32BE(16);
const root = pb.decodeDeep(buf.subarray(20, 20 + bodyLen));

const PLATFORM = { 0: 'KEYBOARD', 1: 'TOUCHSCREEN', 2: 'CONTROLLER_CONSOLE', 3: 'CONTROLLER_MOBILE' };
const SLOT = {
  '1/12': 'transform',
  '1/11': 'transform?',
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

function pair(f) {
  const s = f && f.sub;
  if (!s) return null;
  const x = pb.f32(s, 501);
  const y = pb.f32(s, 502);
  if (x == null && y == null) return null;
  return { x: x ?? 0, y: y ?? 0 };
}
function vec3(f) {
  const s = f && f.sub;
  if (!s) return null;
  return { x: pb.f32(s, 1) ?? 0, y: pb.f32(s, 2) ?? 0, z: pb.f32(s, 3) ?? 0 };
}

function decodeTransform(det) {
  // Details#13 Transform{ oneof value { empty11=#11, multiPlatform=#12 }; type=#501 }
  const t = det.sub || [];
  const mp = pb.msg(t, 12);
  if (!mp) return null;
  const out = { preset: pb.num(mp.sub || [], 502), syncAllDevices: pb.num(mp.sub || [], 504) === 1, platforms: {} };
  for (const p of pb.msgs(mp.sub || [], 501)) {
    const ps = p.sub || [];
    const pt = PLATFORM[pb.num(ps, 501)] || `pt${pb.num(ps, 501)}`;
    const rt = pb.msg(ps, 502);
    const rs = rt ? rt.sub || [] : [];
    out.platforms[pt] = {
      scale: vec3(pb.msg(rs, 501)) || { x: 1, y: 1, z: 1 },
      anchorMin: pair(pb.msg(rs, 502)),
      anchorMax: pair(pb.msg(rs, 503)),
      offset: pair(pb.msg(rs, 504)),
      size: pair(pb.msg(rs, 505)),
      pivot: pair(pb.msg(rs, 506)),
      rot: vec3(pb.msg(rs, 508)),
    };
  }
  return out;
}

function decodeField14(det) {
  // Details#14 Field14{ empty15=#15, field17=#17 ClientInitialState{initiallyHidden=#503}, initiallyInactive=#502 }
  const s = det.sub || [];
  const st = pb.msg(s, 17);
  return {
    initiallyInactive: pb.num(s, 502) === 1,
    initiallyHidden: st ? pb.num(st.sub || [], 503) === 1 : false,
    raw501: pb.num(s, 501),
  };
}

function collectStrings(fields, acc = [], d = 0) {
  for (const f of fields || []) {
    if (d > 6) return acc;
    if (f.wt === 2) {
      const t = pb.txt([f], f.field);
      if (t != null && t.length) acc.push(t);
      else if (f.sub) collectStrings(f.sub, acc, d + 1);
    } else if (f.sub) collectStrings(f.sub, acc, d + 1);
  }
  return acc;
}

// ── 解析所有记录 ─────────────────────────────────────────────────────────────
const recs = [];
for (const [bucket, field] of [['graph', 1], ['accessories', 2]]) {
  for (const u of pb.msgs(root, field)) {
    const s = u.sub || [];
    const idM = pb.msg(s, 1) || [];
    const rec = {
      bucket,
      guid: pb.num(idM, 4),
      class: pb.num(idM, 2),
      type: pb.num(idM, 3),
      unitName: pb.txt(s, 3),
      which: pb.num(s, 5),
      related: pb.msgs(s, 2).map((r) => pb.num(r.sub || [], 4)),
      slotKeys: [],
      name: null,
      transform: null,
      state: null,
      strings: [],
      script: null,
    };
    const ui = pb.msg(s, 19);
    const content = ui ? pb.msg(ui, 1) : null;
    if (content) {
      rec.parentGuid = (() => {
        const p = pb.msgs(content, 504).find((f) => f.wt === 0);
        return p ? Number(p.num) : null;
      })();
      for (const d of pb.msgs(content, 505)) {
        const ds = d.sub || [];
        const key = `${pb.num(ds, 501)}/${pb.num(ds, 502)}`;
        const kind = SLOT[key] || `?${key}`;
        rec.slotKeys.push(kind);
        const det = pb.msg(ds, 503);
        if (!det) continue;
        if (kind === 'transform') rec.transform = decodeTransform(det);
        else if (kind === 'field14') rec.state = decodeField14(det);
        else if (kind === 'name') {
          const w = ds.find((f) => f.field === 12);
          const inner = w ? pb.msg(w.sub || [], 501) : null;
          rec.name = inner ? pb.txt(inner, 501) : null;
        }
        rec.strings.push(...collectStrings(det.sub || []).filter((t) => t.length > 1 && t.length < 300));
      }
    }
    const sm = pb.msg(s, 35);
    if (sm) {
      const m = pb.msg(sm, 1);
      if (m) rec.script = { id: pb.num(m, 1), name: pb.txt(m, 2), path: pb.txt(m, 3), srcLen: (pb.txt(m, 5) || '').length };
    }
    recs.push(rec);
  }
}
const byGuid = new Map(recs.map((r) => [r.guid, r]));

// ── 树 ──────────────────────────────────────────────────────────────────────
for (const r of recs) {
  r.parents = recs.filter((p) => p !== r && p.related.includes(r.guid)).map((p) => p.guid);
}
const roots = recs.filter((r) => !r.parents.length);

function label(r) {
  const parts = [r.name || r.unitName || '(无名)'];
  parts.push(`[${r.guid}]`);
  if (r.which != null) parts.push(`w${r.which}`);
  const kb = r.transform?.platforms?.KEYBOARD;
  if (kb?.size) parts.push(`${Math.round(kb.size.x)}×${Math.round(kb.size.y)} @(${Math.round(kb.offset?.x ?? 0)},${Math.round(kb.offset?.y ?? 0)})`);
  if (r.state && (r.state.initiallyHidden || r.state.initiallyInactive)) parts.push(r.state.initiallyHidden ? 'HIDDEN' : 'INACTIVE');
  if (r.slotKeys.length) parts.push(`{${r.slotKeys.filter((k) => k !== 'name' && k !== 'transform' && k !== 'field14').join(',') || 'container'}}`);
  return parts.join(' ');
}

let visibleCount = 0;
const seen = new Set();
function walk(r, d) {
  if (seen.has(r.guid)) return;
  seen.add(r.guid);
  if (!SHOW_HIDDEN && r.state && (r.state.initiallyHidden || r.state.initiallyInactive)) {
    // 仍打印，但标记；不剪枝（结构证据比显示状态重要）
  }
  visibleCount++;
  console.log(`${'  '.repeat(d)}${d ? '└ ' : ''}${label(r)}${r.parents.length > 1 ? `  ⚠多父(${r.parents.join(',')})` : ''}`);
  if (d >= MAXD) return;
  for (const g of r.related) {
    const c = byGuid.get(g);
    if (c) walk(c, d + 1);
    else console.log(`${'  '.repeat(d + 1)}└ (缺失引用 ${g})`);
  }
}

console.log(`# ${IN}`);
console.log(`# 记录 ${recs.length} 条；根 ${roots.length} 个；which 分布 ${JSON.stringify(recs.reduce((m, r) => ((m[r.which] = (m[r.which] || 0) + 1), m), {}))}`);
console.log('');
for (const r of roots) walk(r, 0);
const orphan = recs.filter((r) => !seen.has(r.guid));
console.log(`\n# 树上记录 ${visibleCount}／${recs.length}${orphan.length ? `，未挂树 ${orphan.length}` : ''}`);
for (const o of orphan) console.log(`  · ${label(o)}`);

if (JSON_OUT) {
  fs.writeFileSync(JSON_OUT, JSON.stringify({ recs: recs.map(({ strings, ...rest }) => ({ ...rest, strings })) }, null, 1));
  console.log(`\n已写 ${JSON_OUT}`);
}
