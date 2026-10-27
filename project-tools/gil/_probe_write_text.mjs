// tools/gil/_probe_write_text.mjs —— ★ 受控实验：**能不能把文本写进 `.gil`**
//
//   ★ 只写新文件 ✓ 绝不碰原档 ✓
//   ★ 两步 ✓：
//     ① 改一条【已有文本】的记录（hud.title 之类）⇒ 写入 ⇒ 重读验证
//     ② 找一条【有文本属性组但文本为空】的控件 ⇒ 补上文本 ⇒ 写入 ⇒ 重读验证（★ 这才是"从 gil 填文本" ✓）
//
// 用法：node tools/gil/_probe_write_text.mjs <存档.gil> <输出.gil>
import path from 'node:path';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { readGil, recordsOf } from './gilread.mjs';
import { writeGil } from './gilwrite.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const inFile = process.argv[2];
const outFile = process.argv[3];
if (!inFile || !outFile) { console.error('用法: node tools/gil/_probe_write_text.mjs <存档.gil> <输出.gil>'); process.exit(2); }
const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');

function nodesAt(fields, pathArr) {
  let cur = fields;
  const hits = [];
  (function rec(fs, i) {
    for (const f of fs) {
      if (!f.sub) continue;
      if (i === pathArr.length) { hits.push(f); continue; }
      if (f.field === pathArr[i]) rec(f.sub, i + 1);
    }
  })(fields, 0);
  // 上面语义：从 fields 开始逐层按字段号下钻，返回【最后一段】的命中
  return hits;
}
function textGroupOf(recField) {
  // 严格路径 /#505/#503/#75（只有一个）
  let cur = [recField];
  for (const no of [505, 503, 75]) {
    const nxt = [];
    for (const f of cur) for (const x of (f.sub || [])) if (x.field === no && x.sub) nxt.push(x);
    cur = nxt;
    if (!cur.length) return null;
  }
  return cur.length === 1 ? cur[0] : null;
}
function textContentOf(grp) {
  const p510 = (grp.sub || []).find((f) => f.field === 510 && f.sub);
  if (!p510) return null;
  const leaf = (p510.sub || []).find((f) => f.field === 501 && f.wt === 2);
  if (!leaf) return null;
  return leaf.payload.toString('utf8');
}
function setText(grp, text) {
  const buf = Buffer.from(text, 'utf8');
  // ★ 2026-10-28 ★ **必须复用已有的 `#510`** ✓（空文本时它以 `wt2/len0/无子消息` 的形式存在 ✓）
  //   ✗ 错误做法：再造一个 `#510` ⇒ 同组里出现两个 ✓（proto 上是重复字段，引擎取哪个不确定 ✗）
  let p510 = (grp.sub || []).find((f) => f.field === 510);
  if (!p510) {
    p510 = { field: 510, wt: 2, sub: [], payload: Buffer.alloc(0), len: 0, isText: false };
    grp.sub.push(p510);
  }
  if (p510.sub == null) p510.sub = [];
  p510.payload = Buffer.alloc(0);
  p510.len = 0;
  p510.isText = false;
  let leaf = p510.sub.find((f) => f.field === 501 && f.wt === 2);
  if (!leaf) {
    leaf = { field: 501, wt: 2, payload: buf, len: buf.length, isText: true, sub: null };
    p510.sub.unshift(leaf);
  } else {
    leaf.payload = buf;
    leaf.len = buf.length;
    leaf.isText = true;
  }
  return leaf;
}

const g = readGil(path.isAbsolute(inFile) ? inFile : path.join(ROOT, inFile));
const out = path.isAbsolute(outFile) ? outFile : path.join(ROOT, outFile);
if (path.resolve(out) === path.resolve(path.isAbsolute(inFile) ? inFile : path.join(ROOT, inFile))) {
  console.error('输出不能等于输入'); process.exit(2);
}

// 统计：有文本属性组的记录 / 有文本的
let hasGroup = 0, hasText = 0, groupNoText = [];
for (const r of g.recs) {
  const grp = textGroupOf(r.field);
  if (!grp) continue;
  hasGroup++;
  const t = textContentOf(grp);
  if (t !== null) hasText++;
  else groupNoText.push(r);
}
console.log('存档 ' + path.basename(inFile) + '　记录 ' + g.recs.length);
console.log('  有文本属性组(/505/503/75) 的记录：' + hasGroup);
console.log('  其中已有文本：' + hasText + '　文本为空：' + groupNoText.length);

const changes = [];
// ① 改一条已有文本
const target1 = g.recs.find((r) => { const grp = textGroupOf(r.field); return grp && textContentOf(grp) !== null; });
const marker1 = '★写入实验-改已有-' + Date.now().toString(36).toUpperCase();
if (target1) {
  setText(textGroupOf(target1.field), marker1);
  changes.push({ kind: '改已有', name: target1.name, id: target1.id, want: marker1 });
}
// ② 给一条空文本控件补文本（优先名字像按钮/标签的）
const pref = groupNoText.filter((r) => /label|btn|text|title|home\.|modal\.|result\./i.test(r.name || ''));
const target2 = pref[0] || groupNoText[0];
const marker2 = '★写入实验-补空文本-' + Date.now().toString(36).toUpperCase();
if (target2) {
  setText(textGroupOf(target2.field), marker2);
  changes.push({ kind: '补空文本', name: target2.name, id: target2.id, want: marker2 });
}

const shaBefore = sha(path.isAbsolute(inFile) ? inFile : path.join(ROOT, inFile));
writeGil(g, out, {
  label: 'write-text-experiment',
  expectRecs: g.recs.length,
  mustDiffer: true,
  quiet: false,
  assert: (g2) => {
    // ★ g2 = loadTree(out)（无 recs）⇒ 用 recordsOf 现算 ✓
    const recs2 = recordsOf(g2.tree);
    let okAll = true;
    for (const c of changes) {
      const r2 = recs2.find((r) => r.id === c.id);
      const got = r2 ? textContentOf(textGroupOf(r2.field)) : null;
      const ok = got === c.want;
      if (!ok) okAll = false;
      console.log('  ' + (ok ? '✅' : '❌') + ' ' + c.kind + '：' + c.name + ' #' + c.id
        + '　读回=' + JSON.stringify(got));
    }
    const recOk = recs2.length === g.recs.length;
    if (!recOk) okAll = false;
    console.log('  ' + (recOk ? '✅' : '❌') + ' 记录数 ' + g.recs.length + ' → ' + recs2.length);
    return okAll ? true : '文本写入读回不符';
  },
});

console.log('');
console.log('  原档 sha 未变：' + (sha(path.isAbsolute(inFile) ? inFile : path.join(ROOT, inFile)) === shaBefore ? '✅' : '❌'));
console.log('  输出：' + out);
