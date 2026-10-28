// 基于 580 补齐：① 克隆 v356 里被删掉的 184 条文本记录 ② 给丢了文本组的记录补回文本组
// 用法: node tools/gil/_restore_missing_texts.mjs <清单.md> <基座580.gil> <旧档v356.gil> <输出.gil>
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {
  readGil, recordsOf, cloneField, findChildListTop, asIdList, setChildList, bigIds,
  stateBlocks, pairOf, pairValue, textsOf,
} from './gilread.mjs';
import { writeGil } from './gilwrite.mjs';

const [mdPath, basePath, srcPath, outPath] = process.argv.slice(2);
if (!mdPath || !basePath || !srcPath || !outPath) {
  console.error('用法: node _restore_missing_texts.mjs <清单.md> <基座.gil> <旧档.gil> <输出.gil>');
  process.exit(2);
}
const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');

// ---------- 清单 ----------
const rows = [];
const rx = new RegExp('^\\|\\s*`([^`]+)`\\s*\\|\\s*(.*?)\\s*\\|\\s*(\\d+)\\s*\\|\\s*`0x([0-9A-Fa-f]{8})`\\s*\\|$');
for (const line of fs.readFileSync(mdPath, 'utf8').split(/\r?\n/)) {
  const m = line.match(rx);
  if (!m) continue;
  rows.push({ name: m[1], text: m[2].replaceAll('\\|', '|').replaceAll('<br>', '\n'), size: Number(m[3]), color: parseInt(m[4], 16) >>> 0 });
}

// ---------- 存档 ----------
const g = readGil(basePath);
const gS = readGil(srcPath);
const byName = new Map(); for (const r of g.recs) if (r.name && !byName.has(r.name)) byName.set(r.name, r);
const byNameS = new Map(); for (const r of gS.recs) if (r.name && !byNameS.has(r.name)) byNameS.set(r.name, r);
const byId = new Map(g.recs.map((r) => [r.id, r]));
const byIdS = new Map(gS.recs.map((r) => [r.id, r]));
// Markdown 表格会裁掉行尾空格；文本、字号、字色一律以源存档字段为准。
function sourceInfo(rec) {
  const grp = rec && groupOf(rec.field.sub);
  if (!grp) return null;
  const tn = grp.sub.find((f) => f.field === 510 && f.sub);
  const tl = tn && tn.sub.find((f) => f.field === 501 && f.wt === 2);
  const num = (fld) => { const l = grp.sub.find((x) => x.field === fld && x.wt === 0); return l ? Number(l.num) : 0; };
  return { text: tl && tl.payload ? tl.payload.toString('utf8') : '', size:num(512), color:num(504) };
}
console.log('基座 ' + g.recs.length + ' 条（maxId=' + g.maxId + '）　旧档 ' + gS.recs.length + ' 条　清单 ' + rows.length);

// ---------- 文本组工具 ----------
function nodesAt(fields, pathArr) {
  let lv = fields;
  for (let i = 0; i < pathArr.length; i++) {
    const hits = lv.filter((f) => f.field === pathArr[i] && f.sub);
    if (i === pathArr.length - 1) return hits;
    lv = hits.flatMap((f) => f.sub);
  }
  return [];
}
const groupOf = (fields) => { const ns = nodesAt(fields, [505, 503, 75]); return ns.length === 1 ? ns[0] : null; };
function setText(group, text) {
  const buf = Buffer.from(text, 'utf8');
  let p = group.sub.find((f) => f.field === 510);
  if (!p) { p = { field: 510, wt: 2, sub: [], payload: Buffer.alloc(0), len: 0, isText: false }; group.sub.push(p); }
  if (p.sub == null) p.sub = [];
  p.payload = Buffer.alloc(0); p.len = 0; p.isText = false;
  let leaf = p.sub.find((f) => f.field === 501 && f.wt === 2);
  if (!leaf) { leaf = { field: 501, wt: 2, payload: buf, len: buf.length, isText: true, sub: null }; p.sub.unshift(leaf); }
  else { leaf.payload = buf; leaf.len = buf.length; leaf.isText = true; }
}
function setNum(group, field, value) {
  let f = group.sub.find((x) => x.field === field && x.wt === 0);
  if (!f) { f = { field, wt: 0, num: 0n }; group.sub.push(f); }
  f.num = BigInt(value >>> 0);
}
for (const row of rows) {
  const src = sourceInfo(byNameS.get(row.name));
  if (!src) throw new Error('源存档无文本字段 ' + row.name);
  row.text = src.text; row.size = src.size; row.color = src.color;
}
function remapIds(fields, oldId, newId, parentOld, parentNew) {
  let n = 0;
  (function w(fs2, depth) {
    for (const f of fs2) {
      if (f.wt === 0 && Number(f.num) === oldId) { f.num = BigInt(newId); n++; }
      if (depth === 0 && f.wt === 0 && f.field === 504 && parentOld != null && Number(f.num) === parentOld) f.num = BigInt(parentNew);
      if (f.sub) w(f.sub, depth + 1);
    }
  })(fields, 0);
  return n;
}
function holderOf(id) {
  const stack = [g.tree];
  while (stack.length) {
    const arr = stack.pop();
    if (!Array.isArray(arr)) continue;
    for (let i = 0; i < arr.length; i++) {
      const f = arr[i];
      if (f.sub) {
        if (Number((bigIds(f.sub, [])[0] || {}).num) === Number(id)) return { arr, index: i };
        stack.push(f.sub);
      }
    }
  }
  return null;
}

// ---------- 计划 ----------
// v358 共享棋盘后 SVG 文本会重新编号。先按几何位置复用这些现有记录，禁止重复克隆。
function geometryOf(rec) {
  const blocks = []; stateBlocks(rec.field.sub, blocks);
  const b = blocks[0]; if (!b) return '';
  const p = pairOf(b, 504), s = pairOf(b, 505);
  return [p && pairValue(p, 0), p && pairValue(p, 1), s && pairValue(s, 0), s && pairValue(s, 1)].join(',');
}
const pageOf = (name) => (String(name).match(/^(td\.[^.]+\.page\.\d+)\./) || [])[1] || '';
const wantedNames = new Set(rows.map((r) => r.name));
let reused = 0;
for (const row of rows) {
  if (byName.has(row.name)) continue;
  const src = byNameS.get(row.name); if (!src) continue;
  const want = sourceInfo(src), geo = geometryOf(src);
  const candidates = g.recs.filter((r) => r.name && !wantedNames.has(r.name)
    && pageOf(r.name) === pageOf(row.name) && geometryOf(r) === geo);
  const matched = candidates.find((r) => {
    const cur = sourceInfo(r);
    return cur && cur.text === want.text && cur.size === want.size && cur.color === want.color;
  });
  if (!matched) continue;
  const oldName = matched.name;
  for (const leaf of textsOf(matched.field.sub, [])) {
    if (leaf.payload && leaf.payload.toString('utf8') === oldName) {
      leaf.payload = Buffer.from(row.name, 'utf8'); leaf.len = leaf.payload.length;
    }
  }
  matched.name = row.name; byName.delete(oldName); byName.set(row.name, matched); reused++;
}
console.log('  重新编号记录复用 ' + reused + ' 条');
let nextId = BigInt(g.maxId) + 1n;
const used = new Set(g.recs.map((r) => r.id));
const alloc = () => { while (used.has(Number(nextId))) nextId++; const id = Number(nextId); used.add(id); nextId++; return id; };

const missingRows = rows.filter((r) => !byName.has(r.name));
const noGroupRows = rows.filter((r) => { const rec = byName.get(r.name); return rec && !groupOf(rec.field.sub); });
console.log('  待克隆 ' + missingRows.length + ' 条　待补文本组 ' + noGroupRows.length + ' 条');

const newIds = new Map();       // name -> newId
const restoredFields = new Map(); // name -> cloned field
const parentAdd = new Map();    // parentName -> [ {name,newId} ]
const skipped = [];
for (const row of missingRows) {
  const rs = byNameS.get(row.name);
  if (!rs) { skipped.push(row.name + '（旧档无）'); continue; }
  const pS = rs.parentId != null ? byIdS.get(rs.parentId) : null;
  const pName = pS ? pS.name : null;
  const pB = pName ? byName.get(pName) : null;
  if (!pB) { skipped.push(row.name + '（父不在基座）'); continue; }
  const cf = cloneField(rs.field);
  const newId = alloc();
  remapIds(cf.sub, rs.id, newId, pS.id, pB.id);
  const grp = groupOf(cf.sub);
  if (!grp) { skipped.push(row.name + '（旧记录无文本组）'); continue; }
  setText(grp, row.text);
  setNum(grp, 512, row.size);
  setNum(grp, 504, row.color);
  // 插树：插到最近的幸存兄弟后面（否则 append 到 root holder）
  const srcKids = (() => { const clf = findChildListTop(pS.field.sub); return clf ? (asIdList(clf.payload, true) || []) : []; })();
  const srcIdx = srcKids.indexOf(rs.id);
  let neighbor = null;
  for (let k = srcIdx - 1; k >= 0 && !neighbor; k--) { const c = byIdS.get(srcKids[k]); if (c && byName.has(c.name)) neighbor = byName.get(c.name); }
  if (!neighbor) for (let k = srcIdx + 1; k < srcKids.length && !neighbor; k++) { const c = byIdS.get(srcKids[k]); if (c && byName.has(c.name)) neighbor = byName.get(c.name); }
  const h = neighbor ? holderOf(neighbor.id) : null;
  if (h) h.arr.splice(h.index + 1, 0, cf); else g.recHolder.push(cf);
  newIds.set(row.name, newId);
  restoredFields.set(row.name, cf.sub);
  if (!parentAdd.has(pName)) parentAdd.set(pName, []);
  parentAdd.get(pName).push({ name: row.name, newId, srcId: rs.id });
}
if (skipped.length) console.log('  ⚠️ 跳过 ' + skipped.length + ' 条: ' + skipped.slice(0, 6).join(' / '));

// ---------- 父的子列表：按 v356 顺序插回去 ----------
for (const [pName, adds] of parentAdd) {
  const pB = byName.get(pName); const pS = byNameS.get(pName);
  const clf = findChildListTop(pB.field.sub);
  if (!clf) { console.log('  ⚠️ ' + pName + ' 无子列表，跳过登记'); continue; }
  const cur = (asIdList(clf.payload, true) || []).slice();
  const srcOrder = (() => { const c = findChildListTop(pS.field.sub); return c ? (asIdList(c.payload, true) || []) : []; })();
  const baseByName = new Map();
  for (const id of cur) { const r = byId.get(id); if (r && r.name) baseByName.set(r.name, id); }
  let lastIdx = -1;
  for (const sid of srcOrder) {
    const sr = byIdS.get(sid); if (!sr) continue;
    if (baseByName.has(sr.name)) { lastIdx = cur.indexOf(baseByName.get(sr.name)); continue; }
    const hit = adds.find((a) => a.name === sr.name);
    if (!hit) continue;
    const pos = lastIdx < 0 ? 0 : lastIdx + 1;
    cur.splice(pos, 0, hit.newId);
    lastIdx = pos;
  }
  setChildList(clf, cur);
}

// ---------- 补文本组（记录在，但 /505/503/75 丢了）----------
// ★ 2026-10-28 修正 ✗：文本组是 **记录顶层 `#505` 块里的 `#503 → #75`** ✓
//   ⇒ 必须克隆【整个 `#505` 块】再插到记录顶层 ✗ 不能把 `#75` 直接插顶层 ✗（那样读回找不到 ✓）
let groupFixed = 0;
for (const row of noGroupRows) {
  const rb = byName.get(row.name); const rs = byNameS.get(row.name);
  if (!rs) { console.log('  ⚠️ ' + row.name + ' 旧档无，跳过'); continue; }
  // 找旧记录里"含 #503→#75 的那个顶层 #505 块"
  let srcBlock = null, srcGroup = null;
  for (const f of rs.field.sub) {
    if (f.field !== 505 || !f.sub) continue;
    const ns = nodesAt(f.sub, [503, 75]);
    if (ns.length === 1) { srcBlock = f; srcGroup = ns[0]; break; }
  }
  if (!srcBlock) { console.log('  ⚠️ ' + row.name + ' 旧档也无文本组块'); continue; }
  const block = cloneField(srcBlock);
  const grp = nodesAt(block.sub, [503, 75])[0];
  setText(grp, row.text); setNum(grp, 512, row.size); setNum(grp, 504, row.color);
  // 插到记录顶层末尾（名字文本块在 index 3，位于它之前 ⇒ 记录名不受影响 ✓）
  rb.field.sub.push(block);
  groupFixed++;
}
console.log('  文本组补回 ' + groupFixed + ' 条');

// 全量重写 942 项，不只处理缺记录：恢复前次被裁掉的空格和任何被改动的字段。
for (const row of rows) {
  const rec = byName.get(row.name);
  const fields = rec ? rec.field.sub : restoredFields.get(row.name);
  const grp = fields ? groupOf(fields) : null;
  if (!grp) throw new Error('填入前仍无文本组 ' + row.name);
  setText(grp, row.text); setNum(grp, 512, row.size); setNum(grp, 504, row.color);
}
// 共享棋盘中多出的旧编号文本不再属于 942 项清单，清空以免坐标/数字重复显示。
let clearedExtra = 0;
for (const rec of g.recs) {
  if (!rec.name || wantedNames.has(rec.name) || !/\.svg\.\d+$/.test(rec.name)) continue;
  const grp = groupOf(rec.field.sub); if (!grp) continue;
  const tn = grp.sub.find((f) => f.field === 510 && f.sub);
  const tl = tn && tn.sub.find((f) => f.field === 501 && f.wt === 2);
  if (tl && tl.payload && tl.payload.length) { setText(grp, ''); clearedExtra++; }
}
console.log('  清单外重复文本清空 ' + clearedExtra + ' 条');

// ---------- 写出 ----------
const expectRecs = g.recs.length + newIds.size;
const shaBase = sha(basePath);
writeGil(g, outPath, {
  label: 'restore-missing-texts',
  expectRecs,
  mustDiffer: true,
  quiet: false,
  assert: (g2) => {
    const recs2 = recordsOf(g2.tree);
    const map2 = new Map(); for (const r of recs2) if (r.name && !map2.has(r.name)) map2.set(r.name, r);
    let ok = 0, bad = [];
    for (const row of rows) {
      const r = map2.get(row.name);
      const grp = r ? groupOf(r.field.sub) : null;
      if (!grp) { bad.push(row.name + '（无文本组）'); continue; }
      const tn = grp.sub.find((f) => f.field === 510 && f.sub);
      const tl = tn && tn.sub.find((f) => f.field === 501 && f.wt === 2);
      const t = tl && tl.payload ? tl.payload.toString('utf8') : null;
      const num = (fld) => { const l = grp.sub.find((x) => x.field === fld && x.wt === 0); return l ? Number(l.num) : -1; };
      if (t === row.text && num(512) === row.size && num(504) === row.color) ok++; else bad.push(row.name);
    }
    console.log('    清单读回 ' + ok + '/' + rows.length + (bad.length ? '　❌ ' + bad.slice(0, 8).join(' / ') : ''));
    // id 唯一 + 子列表自洽
    const ids = recs2.map((r) => r.id);
    const uniq = new Set(ids).size === ids.length;
    let dangling = 0, parentMismatch = 0;
    for (const r of recs2) {
      const clf = findChildListTop(r.field.sub); if (!clf) continue;
      for (const cid of (asIdList(clf.payload, true) || [])) {
        const c = recs2.find((x) => x.id === cid);
        if (!c) dangling++; else if (c.parentId !== r.id) parentMismatch++;
      }
    }
    console.log('    id 唯一=' + uniq + '　悬空子列表项=' + dangling + '　父指针不符=' + parentMismatch + '　记录=' + recs2.length);
    return ok === rows.length && uniq && dangling === 0 && parentMismatch === 0 ? true : '补齐校验不过';
  },
});
console.log('  基座 sha 未变: ' + (sha(basePath) === shaBase ? '✅' : '❌'));
fs.writeFileSync('_restore-report.json', JSON.stringify({
  base: path.basename(basePath), out: path.basename(outPath),
  total: rows.length, reused, cloned: newIds.size, groupFixed, clearedExtra,
  skipped, parentAdd: Object.fromEntries([...parentAdd].map(([k, v]) => [k, v.length])),
}, null, 2), 'utf8');
console.log('  报告: _restore-report.json');
