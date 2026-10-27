// tools/gil/copy_image_block.mjs —— 把一个【图片控件】的**图像块**整体抄到别的图片控件上
//
// 为什么需要它（2026-10-16 用户点破 ✓）：
//   ★ 用户原话 ✓：「**settle.btn 在编辑器里根本没有子控件，你加上文本控件和图片控件，
//     图片引用 107179，顺便把主页另外四颗按钮也这么处理，位置尺寸不变**」✓
//   ★ 查证 ✓：`add_button.mjs` 克隆出来的 `bg` **连图像块都没有** ✗
//     ⇒ ★ 编辑器里它就是"一个没有图的图片控件" ✓ ⇒ ★ 看不到、也没法在检视器里配 ✓
//     而正常按钮（`home.select/bg`、`modal.settle/bg`）**都有**那一块 ✓（含 `#510:1` 拉伸开关 ✓）
//   ⇒ ★ 抄一块过来 ⇒ ★ 既有图、又能在编辑器里编辑 ✓
//
//   ⚠️ 图元 ID **不在状态块里** ✗（真机那个 `107179` 是**运行时**写的 ✓）
//     ⇒ ★ 本工具抄的是"图片控件该有的那一套参数" ✓（含铺开方式 ✓）
//     ★ 用户点名"图片引用 107179"那条，由 `main.lua` 的 `set_image_deep` 在运行时落实 ✓
//       （★ modal 那四颗走的就是它 ✓ 已验证 ✓）
//
// ★ 自引用修补 ✓：块里那张 `#504{2:1,3:8,4:<原型id>}` 回指的是**原型自己** ✓
//   ⇒ ★ 抄过来必须把 `#4` 改成**目标控件的 id** ✓（否则目标会去回指别人的记录 ✗）
//
// ⚠️ 判据按【形状】写，不按字段号 ✗（本仓的老规矩 ✓）：
//   "图像块" = 状态块顶层里，第一个**含 `#85` 且 `#85` 里含 `#510`** 的消息 ✓
//
// 用法：
//   node tools/gil/copy_image_block.mjs --in=<in.gil> --out=<out.gil> \
//        --from=<父名/子名> --to=<父名/子名,...> [--dry]
//   ⚠️ 子控件要写成【父名/子名】 ✓ —— ★ 本档有很多同名 `bg` ✓（`byName` 是平的 ✓）
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readGil, findChildListTop, asIdList } from './gilread.mjs';
import { writeGil } from './gilwrite.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const argv = process.argv.slice(2);
const argOf = (k) => { const a = argv.find((s) => s.startsWith('--' + k + '=')); return a ? a.slice(k.length + 3).replace(/^"|"$/g, '') : null; };
const DRY = argv.includes('--dry');

const IN = argOf('in'), OUT = argOf('out'), FROM = argOf('from');
const TOS = (argOf('to') || '').split(',').map((s) => s.trim()).filter(Boolean);
if (!IN || !OUT || !FROM || TOS.length === 0) {
  console.error('用法: node tools/gil/copy_image_block.mjs --in= --out= --from=<父/子> --to=<父/子,父/子,...> [--dry]');
  process.exit(1);
}

const g = readGil(path.isAbsolute(IN) ? IN : path.join(ROOT, IN));
const byId = new Map(g.recs.map((r) => [r.id, r]));

function kidsOf(rec) {
  const cl = findChildListTop(rec.field.sub);
  return cl ? (asIdList(cl.payload, true) || []).map((i) => byId.get(Number(i))).filter(Boolean) : [];
}

// ★ 取记录：`父/子` ⇒ 从父的子列表里按名找 ✓；纯名字 ⇒ 只有唯一同名才给 ✓
function resolve(spec) {
  const i = spec.indexOf('/');
  if (i < 0) {
    const hits = g.recs.filter((r) => r.name === spec);
    if (hits.length === 1) return hits[0];
    if (hits.length === 0) return null;
    console.error('名字 ' + spec + ' 有 ' + hits.length + ' 条记录，请写成【父名/子名】');
    process.exit(6);
  }
  const parent = g.byName.get(spec.slice(0, i));
  if (!parent) { console.error('找不到父控件 ' + spec.slice(0, i)); process.exit(6); }
  return kidsOf(parent).find((c) => c.name === spec.slice(i + 1)) || null;
}

// ── 图像块判据（按形状 ✓）──────────────────────────────────────────────────
function isImageBlockField(f) {
  if (!f.sub) return false;
  const i85 = f.sub.find((x) => x.field === 85 && x.sub);
  if (!i85) return false;
  return i85.sub.some((z) => z.field === 510);
}
function findImageBlock(rec) {
  for (const blk of rec.states) {
    const f = blk.sub.find(isImageBlockField);
    if (f) return f;
  }
  return null;
}

function cloneField(f) {
  const c = { field: f.field, wt: f.wt, sub: null, num: f.num, len: f.len, isText: f.isText,
              payload: f.payload ? Buffer.from(f.payload) : Buffer.alloc(0), f: f.f,
              raw: f.raw ? Buffer.from(f.raw) : undefined };
  if (f.sub) c.sub = f.sub.map(cloneField);
  return c;
}
// ★ 把"回指原型"的那个 varint（`#504` 里的 `#4=<原型id>`）改成目标 id ✓
function repoint(f, fromId, toId) {
  let n = 0;
  (function w(fs) {
    for (const x of fs) {
      if (x.wt === 0 && x.field === 4 && Number(x.num) === fromId) { x.num = BigInt(toId); n++; }
      if (x.sub) w(x.sub);
    }
  })([f]);
  return n;
}

const src = resolve(FROM);
if (!src) { console.error('找不到原型 ' + FROM); process.exit(2); }
const sBlock = findImageBlock(src);
if (!sBlock) { console.error('原型 ' + FROM + ' 里找不到图像块'); process.exit(3); }
console.log('原型 ' + FROM + ' #' + src.id + '  图像块字段 #' + sBlock.field
  + '  内层: ' + sBlock.sub.map((x) => '#' + x.field).join('/'));

for (const to of TOS) {
  const dst = resolve(to);
  if (!dst) { console.error('找不到目标 ' + to); process.exit(4); }
  const had = findImageBlock(dst) !== null;
  const nBlocks = Math.min(src.states.length, dst.states.length);
  let wrote = 0, reTotal = 0;
  for (let i = 0; i < nBlocks; i++) {
    const sF = src.states[i].sub.find(isImageBlockField);
    if (!sF) continue;
    const copy = cloneField(sF);
    reTotal += repoint(copy, src.id, dst.id);
    const holder = dst.states[i];
    const idx = holder.sub.findIndex(isImageBlockField);
    if (idx >= 0) holder.sub[idx] = copy; else holder.sub.push(copy);
    wrote++;
  }
  console.log('  ' + to + ' #' + dst.id + '  ' + (had ? '原有图像块 → 已替换' : '原先**没有**图像块 → 已补上')
    + '  状态块 ' + wrote + ' 个  回指修补 ' + reTotal + ' 处');
}

if (DRY) { console.log('--dry：不写文件'); process.exit(0); }

const rep = writeGil(g, path.isAbsolute(OUT) ? OUT : path.join(ROOT, OUT), {
  label: '抄图像块：' + FROM + ' → ' + TOS.length + ' 个',
  assert: (g2) => {
    const bad = [];
    if (g2.recs.length !== g.recs.length) bad.push('记录数变了：' + g.recs.length + ' → ' + g2.recs.length);
    for (const to of TOS) {
      const r = resolve(to) && g2.byName.get(resolve(to).name);
      const r2 = (() => {
        const i = to.indexOf('/');
        const p2 = g2.byName.get(to.slice(0, i));
        if (!p2) return null;
        const cl = findChildListTop(p2.field.sub);
        const ids2 = cl ? (asIdList(cl.payload, true) || []).map(Number) : [];
        return ids2.map((id) => g2.recs.find((x) => x.id === id)).find((x) => x && x.name === to.slice(i + 1)) || null;
      })();
      if (!r2) { bad.push(to + ' 回读不到'); continue; }
      for (let i = 0; i < r2.states.length; i++) {
        if (!r2.states[i].sub.some(isImageBlockField)) bad.push(to + ' 第 ' + i + ' 块仍没有图像块');
      }
      let wrong = 0;
      (function w(fs) { for (const x of fs) { if (x.wt === 0 && x.field === 4 && Number(x.num) === src.id) wrong++; if (x.sub) w(x.sub); } })(r2.states.map((b) => b));
      if (wrong > 0) bad.push(to + ' 里还有 ' + wrong + ' 处回指原型 #' + src.id);
    }
    // ★ 未点名控件的几何/文本必须与输入一致 ✓
    const geom = (r) => r.states.map((blk) => {
      const pair = (n) => { const p = blk.sub.find((x) => x.field === n); if (!p || !p.sub) return 'null';
        return p.sub.filter((x) => x.wt === 5).map((x) => x.f).join(','); };
      return pair(504) + '|' + pair(505);
    }).join('  ');
    for (const nm of ['settle.btn', 'home.select', 'home.title', 'select.back', 'modal.settle']) {
      const a = g.byName.get(nm), b = g2.byName.get(nm);
      if (a && b && geom(a) !== geom(b)) bad.push(nm + ' 几何被改动了 ✗');
    }
    return bad.length ? bad.join('；') : true;
  },
});
console.log('输出 ' + path.basename(OUT) + '（' + rep.bytes + ' 字节，记录 ' + rep.recs + ' 条，字段差异 ' + rep.diffs + ' 处）');
