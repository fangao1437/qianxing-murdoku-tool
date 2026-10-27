// tools/gil/audit_select.mjs —— **只读**审计选关屏控件（select.* / hit.select.* / 参照物）
//
// 为什么要有它（2026-10-15）：
//   ★ 选关屏这条线上，"卡片渲染成白板 / 箭头点不动 / 命中层出白块"三件事
//     一直在**没有逐条读数**的情况下讨论 ✗（交班文档 §五·4 自己写着"未逐条核实" ✗）。
//   ★ 本工具把每条相关记录的**事实**打出来：
//       · 控件类型（中文类型名）        · 画布 / 父控件 / 在父列表里的次序（z 序）
//       · 四个状态块的位置与尺寸        · **控件自身**的 imageId + imageSource
//       · 子控件列表（ID 与名字）       · 是否与别的记录**共享同一份子结构**（根因 B 的判据）
//   ★ 只读：不写任何文件 ✓（它不做任何 encode/pack ✓）
//
// 用法：
//   node tools/gil/audit_select.mjs <存档.gil> [名字过滤子串]
//   node tools/gil/audit_select.mjs "365-选关四张卡-v232.gil"
//   node tools/gil/audit_select.mjs "365-选关四张卡-v232.gil" hit.select

import path from 'node:path';
import { readGil, KNOWN_TYPES, pairOf, pairValue, stateBlocks } from './gilread.mjs';

const file = process.argv[2];
const filter = process.argv[3] || null;
if (!file) {
  console.error('用法: node tools/gil/audit_select.mjs <存档.gil> [名字过滤子串]');
  process.exit(1);
}

const g = readGil(file);
const byId = new Map(g.recs.map((r) => [r.id, r]));

// ── 取"控件自身"的图片引用：路径 /505/503/84#503（imageId）与 #502（imageSource）──
const IMG_ID = '/505/503/84#503';
const IMG_SRC = '/505/503/84#502';
function leaves(fields, p, out) {
  for (const f of fields) {
    if (f.sub) { leaves(f.sub, p + '/' + f.field, out); continue; }
    out.push([p + '#' + f.field, f]);
  }
  return out;
}
function ownRef(rec) {
  let id = null, src = null;
  for (const [p, f] of leaves(rec.field.sub, '', [])) {
    if (p === IMG_ID && f.wt === 0) id = Number(f.num);
    if (p === IMG_SRC && f.wt === 0) src = Number(f.num);
  }
  return { id, src };
}
// 控制自身是否有"文字"字段（文本框才有）
function ownText(rec) {
  const ts = rec.names.filter((s) => !KNOWN_TYPES.has(s));
  return ts.length ? JSON.stringify(ts) : null;
}

// ── 共享子结构的判据（根因 B）──
//   把每条记录的**子字段序列**按"结构指纹"分组：结构完全一致 = 可能是同一个克隆源；
//   真正要看的是**同一条记录被两处引用**——即两条记录指向同一个字段对象。
//   本工具在内存里读的是解析结果，所以能直接比对象身份。
function collectSubObjects(fields, out, seen) {
  for (const f of fields) {
    if (f.sub) {
      if (!seen.has(f.sub)) { seen.add(f.sub); out.push(f.sub); }
      collectSubObjects(f.sub, out, seen);
    }
  }
  return out;
}

const wanted = g.recs.filter((r) => {
  if (!r.name) return false;
  if (filter) return r.name.includes(filter);
  return /^(select\.|hit\.select\.|hit\.back$|hex\.back$|clue$|cell\.1\.1$|root$)/.test(r.name);
});

console.log('文件：' + path.basename(file) + '   记录 ' + g.recs.length + ' 条   maxId=' + g.maxId);
console.log('筛选：' + (filter ? '名字含 "' + filter + '"' : 'select.* / hit.select.* / 参照物') + ' ⇒ ' + wanted.length + ' 条\n');

/**
 * ★ 控件类型怎么读（2026-10-15 实测）：
 *   ★ 类型名**不在** `rec.names` 里 ✗，而且 `encodeMsg(rec.field.sub)` 也找不到 ✗ ——
 *     因为类型名所在的子树可能挂在一条**被 `#503` 冻结**的真消息底下
 *     （`encodeMsg` 对"非 ID 列表的 `#503`"直接用旧 payload ✓ ⇒ 不重新编码子树 ✓）。
 *   ⇒ ★ 唯一可靠的读法：★ **直接扫这条记录在【原始文件】里占的那段字节** ✓
 *     （`f.bs`/`f.be` 是 parseMsg 记下的原文偏移 ✓）。
 */
function typeOfRaw(g, r) {
  const f = r.field;
  if (f.s0 == null || f.s1 == null) return [];
  const raw = g.src.subarray(f.s0, f.s1).toString('utf8');
  return [...KNOWN_TYPES].filter((t) => raw.includes(t));
}

for (const r of wanted.sort((a, b) => a.id - b.id)) {
  const parent = r.parentId != null ? byId.get(r.parentId) : null;
  const type = r.names.find((s) => KNOWN_TYPES.has(s)) || (typeOfRaw(g, r).join('/') || '?');
  const pids = r.childList ? (r.childList.payload.length ? [...r.childList.payload.length ? [] : []] : []) : null;
  // 子列表 ID（自己读一遍 varint）
  let kids = [];
  if (r.childList && r.childList.payload.length) {
    let p = 0;
    while (p < r.childList.payload.length) {
      let v = 0n, s = 0n, b;
      do { b = r.childList.payload[p++]; v |= BigInt(b & 0x7f) << s; s += 7n; } while (b & 0x80);
      kids.push(Number(v));
    }
  }
  const posInParent = (() => {
    if (!parent || !parent.childList) return null;
    let p = 0, arr = [];
    while (p < parent.childList.payload.length) {
      let v = 0n, s = 0n, b;
      do { b = parent.childList.payload[p++]; v |= BigInt(b & 0x7f) << s; s += 7n; } while (b & 0x80);
      arr.push(Number(v));
    }
    const i = arr.indexOf(r.id);
    return i < 0 ? null : (i + 1) + '/' + arr.length;
  })();
  const ref = ownRef(r);
  const bl = r.states;
  const geoms = bl.map((b) => {
    const pos = pairOf(b, 504), sz = pairOf(b, 505);
    const px = pos ? pairValue(pos, 0) : 0, py = pos ? pairValue(pos, 1) : 0;
    const sw = sz ? pairValue(sz, 0) : 0, sh = sz ? pairValue(sz, 1) : 0;
    return `${px.toFixed(0)},${py.toFixed(0)} ${sw.toFixed(0)}x${sh.toFixed(0)}`;
  });
  console.log('#' + r.id + '  ' + r.name);
  console.log('    类型=' + type + '   父=' + (parent ? parent.name || ('#' + parent.id) : (r.parentId != null ? '#' + r.parentId : '（顶层，无 #504）')) + '   z序=' + (posInParent || '?'));
  console.log('    几何(状态0..n)=' + (geoms.join(' | ') || '（无状态块）'));
  console.log('    自身图片 imageId=' + (ref.id === null ? '（无）' : ref.id) + '  imageSource=' + (ref.src === null ? '（无）' : ref.src));
  console.log('    子控件=' + (kids.length ? kids.map((k) => (byId.get(k) ? (byId.get(k).name || '#' + k) : '#' + k)).join(', ') : '（0 个）'));
  if (ownText(r)) console.log('    短字符串=' + ownText(r));
  console.log('');
}

// ── 全量体检：每条记录的子结构指纹重复情况（根因 B 的旁证）──
const fp = new Map();
for (const r of g.recs) {
  const subs = collectSubObjects(r.field.sub, [], new Set());
  const key = subs.map((s) => s.length).join('.');
  fp.set(key, (fp.get(key) || 0) + 1);
}
const dup = [...fp.entries()].filter(([, n]) => n > 1).sort((a, b) => b[1] - a[1]);
console.log('── 子结构形状重复（同形状记录数 > 1）共 ' + dup.length + ' 类 ──');
for (const [k, n] of dup.slice(0, 12)) console.log('  ' + n + ' 条  子消息数序列 = ' + k);
