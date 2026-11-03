// tools/gia_tree2.mjs — 用 ContentWrapper#504(parent) / #503(children) 重建 .gia 控件树
// 用法: node gia_tree2.mjs <file.gia> [--json out.json] [--text] [--maxdepth N]
//
// 已确认的字段（本文件实测 + 插件 worker.js 内嵌模式）：
//   GraphUnit: #1 Id{class=2,type=3,id=4} / #2 relatedIds / #3 name / #5 which
//              (15=控件记录, 21/61=界面, 9/12/14=节点图单元) / #19 ui / #35 script
//   UiControlGroup.content: #501 guid / #502 Info{(a,b)标签} / #503 children(打包 varint)
//                           / #504 parent(varint) / #505 Data{(a,b)标签, #503 Details}
//   Data 槽位 (a,b)：2/15=name、1/12=transform(带 multiPlatform)、1/11=空 transform、
//                    4/23|4/86=field14(state)。其余新版本槽位按原样记录，不猜语义。
import fs from 'node:fs';
import * as pb from './pb.mjs';

const argv = process.argv.slice(2);
const IN = argv[0];
const JSON_OUT = (() => {
  const i = argv.indexOf('--json');
  return i >= 0 ? argv[i + 1] : null;
})();
const MAXD = (() => {
  const i = argv.indexOf('--maxdepth');
  return i >= 0 ? Number(argv[i + 1]) : 99;
})();
const SHOW_TEXT = argv.includes('--text');
if (!IN) {
  console.error('用法: node gia_tree2.mjs <file.gia> [--json out.json] [--text]');
  process.exit(2);
}

const buf = fs.readFileSync(IN);
const bodyLen = buf.readUInt32BE(16);
const root = pb.decodeDeep(buf.subarray(20, 20 + bodyLen));

const SLOT = {
  '1/12': 'transform',
  '1/11': 'transform(空)',
  '2/15': 'name',
  '4/23': 'state',
  '4/86': 'state',
  '62/82': 'rootChildRef',
  '63/83': 'genericSlot',
  '64/84': 'textConfig',
  '65/85': 'cursorConfig',
  '66/89': 'templateRef',
  '67/90': 'footerSlot',
  '68/91': 'containerNodeSlot',
  '69/92': 'gridView',
  '70/93': 'buttonPreset',
  '71/94': 'textConfig',
  '72/95': 'keyHint',
  '73/96': 'imageSlot',
  '74/97': 'image',
  '75/98': 'effectSlot',
  '76/99': 'fullscreenEffect',
};
const PLATFORM = { 0: 'KEYBOARD', 1: 'TOUCHSCREEN', 2: 'CONTROLLER_CONSOLE', 3: 'CONTROLLER_MOBILE' };

const pair = (f) => {
  const s = f && f.sub;
  if (!s) return null;
  const x = pb.f32(s, 501);
  const y = pb.f32(s, 502);
  return x == null && y == null ? null : { x: x ?? 0, y: y ?? 0 };
};
const vec3 = (f) => {
  const s = f && f.sub;
  return s ? { x: pb.f32(s, 1) ?? 0, y: pb.f32(s, 2) ?? 0, z: pb.f32(s, 3) ?? 0 } : null;
};

function decodeTransform(det) {
  const t = (det.sub || []).find((f) => f.field === 13);
  const mp = t ? pb.msg(t.sub || [], 12) : null;
  if (!mp) return { empty: true };
  const ms = mp.sub || [];
  const out = { preset: pb.num(ms, 502), platforms: {} };
  for (const p of pb.msgs(ms, 501)) {
    const ps = p.sub || [];
    const k = PLATFORM[pb.num(ps, 501)] || `pt${pb.num(ps, 501)}`;
    const rs = pb.msg(ps, 502)?.sub || [];
    out.platforms[k] = {
      anchorMin: pair(pb.msg(rs, 502)),
      anchorMax: pair(pb.msg(rs, 503)),
      offset: pair(pb.msg(rs, 504)),
      size: pair(pb.msg(rs, 505)),
      pivot: pair(pb.msg(rs, 506)),
      scale: vec3(pb.msg(rs, 501)),
    };
  }
  return out;
}

function packedIds(f) {
  if (!f.payload) return null;
  const ids = [];
  let p = 0;
  try {
    while (p < f.payload.length) {
      const v = pb.readVarint(f.payload, p);
      p = v.pos;
      ids.push(Number(v.value));
    }
  } catch {
    return null;
  }
  return ids;
}

const recs = [];
for (const [bucket, field] of [['graph', 1], ['acc', 2]]) {
  for (const u of pb.msgs(root, field)) {
    const s = u.sub || [];
    const idM = pb.msg(s, 1) || [];
    const r = {
      bucket,
      guid: pb.num(idM, 4),
      cls: pb.num(idM, 2),
      type: pb.num(idM, 3),
      unitName: pb.txt(s, 3),
      which: pb.num(s, 5),
      related: pb.msgs(s, 2).map((x) => pb.num(x.sub || [], 4)),
      name: null,
      parent: null,
      children: [],
      slots: [],
      transform: null,
      state: null,
      strings: [],
      script: null,
    };
    const sm = pb.msg(s, 35);
    if (sm) {
      const m = pb.msg(sm, 1);
      if (m) r.script = { id: pb.num(m, 1), name: pb.txt(m, 2), path: pb.txt(m, 3), srcLen: (pb.txt(m, 5) || '').length };
    }
    const content = pb.msg(pb.msg(s, 19) || [], 1);
    if (content) {
      const cs = Array.isArray(content) ? content : content.sub || [];
      const p = pb.msgs(cs, 504).find((f) => f.wt === 0);
      r.parent = p ? Number(p.num) : null;
      for (const c of pb.msgs(cs, 503)) {
        const ids = packedIds(c);
        if (ids && ids.length && ids.every((v) => v > 1000)) r.children.push(...ids);
      }
      for (const d of pb.msgs(cs, 505)) {
        const ds = d.sub || [];
        const key = `${pb.num(ds, 501)}/${pb.num(ds, 502)}`;
        const kind = SLOT[key];
        r.slots.push(kind || key);
        const det = pb.msg(ds, 503);
        if (kind === 'transform' || kind === 'transform(空)') r.transform = det ? decodeTransform(det) : null;
        if (kind === 'state' && det) {
          const f14 = (det.sub || []).find((f) => f.field === 14);
          const fs2 = f14 ? f14.sub || [] : [];
          const st = pb.msg(fs2, 17);
          r.state = {
            initiallyInactive: pb.num(fs2, 502) === 1,
            initiallyHidden: st ? pb.num(st.sub || [], 503) === 1 : false,
            marker: pb.num(fs2, 501),
          };
        }
        if (kind === 'name') {
          const w = ds.find((f) => f.field === 12);
          const inner = w ? pb.msg(w.sub || [], 501) : null;
          r.name = inner ? pb.txt(inner, 501) : null;
        }
        const walk = (fields, d2) => {
          for (const f of fields || []) {
            if (d2 > 5) return;
            if (f.wt === 2) {
              const t = pb.txt([f], f.field);
              if (t != null) {
                if (t.length > 1) r.strings.push(t);
              } else if (f.sub) walk(f.sub, d2 + 1);
            } else if (f.sub) walk(f.sub, d2 + 1);
          }
        };
        if (det) walk(det.sub || [], 0);
      }
    }
    recs.push(r);
  }
}

// guid 空间在 graph / acc 两个桶之间会撞号（如 1073741825），解析父/子时优先取 acc（控件记录）桶
const byGuid = new Map();
for (const r of recs) if (r.bucket === 'acc' && r.guid) byGuid.set(r.guid, r);
for (const r of recs) if (!byGuid.has(r.guid)) byGuid.set(r.guid, r);
for (const r of recs) r.strings = [...new Set(r.strings)].filter((t) => t !== r.name).slice(0, 8);

const roots = recs.filter((r) => r.parent == null || !byGuid.has(r.parent));
const label = (r) => {
  const parts = [r.name || r.unitName || '(无名)'];
  parts.push(`#${r.guid}`);
  const kb = r.transform?.platforms?.KEYBOARD;
  if (kb?.size) parts.push(`${Math.round(kb.size.x)}x${Math.round(kb.size.y)}`);
  if (r.state && (r.state.initiallyHidden || r.state.initiallyInactive)) parts.push(r.state.initiallyHidden ? 'HIDDEN' : 'INACTIVE');
  const extra = r.slots.filter((k) => !['name', 'transform', 'transform(空)', 'state'].includes(k));
  if (extra.length) parts.push(`{${extra.join(',')}}`);
  if (SHOW_TEXT && r.strings.length) parts.push(`《${r.strings.slice(0, 3).join(' | ')}》`);
  return parts.join(' ');
};

let n = 0;
const walked = new Set();
const kids = new Map();
for (const r of recs) for (const c of r.children) if (byGuid.has(c)) kids.set(c, (kids.get(c) || 0) + 1);
function walk(r, d) {
  if (walked.has(r)) return;
  walked.add(r);
  n++;
  const multi = kids.get(r.guid) > 1 ? ` (被 ${kids.get(r.guid)} 个父列出)` : '';
  console.log(`${'  '.repeat(d)}${d ? '- ' : ''}${label(r)}${multi}`);
  if (d >= MAXD) return;
  for (const c of r.children) {
    const cc = byGuid.get(c);
    if (cc) walk(cc, d + 1);
    else console.log(`${'  '.repeat(d + 1)}- (缺失 #${c})`);
  }
}
console.log(`# ${IN.split(/[\\/]/).pop()}`);
console.log(`# 记录 ${recs.length} | 根 ${roots.length} | which ${JSON.stringify(recs.reduce((m, r) => ((m[r.which] = (m[r.which] || 0) + 1), m), {}))}`);
console.log('');
for (const r of roots) walk(r, 0);
const left = recs.filter((x) => !walked.has(x));
if (left.length) {
  console.log(`\n# 未与父相连 ${left.length} 条：`);
  for (const r of left) console.log(`  - ${label(r)} parent=${r.parent}`);
}

if (JSON_OUT) {
  fs.writeFileSync(JSON_OUT, JSON.stringify({ recs }, null, 1));
  console.log('\n已写', JSON_OUT);
}
