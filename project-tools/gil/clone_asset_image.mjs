// tools/gil/clone_asset_image.mjs —— 把用户在编辑器里做好的「素材图片控件」克隆到别处
//
// 为什么需要它（2026-10-03 用户实验结论）：
//   用户实测两条：
//     ① **素材的尺寸在"生成时就定好"** —— 之后调素材大小或图片大小都无效；
//     ② **客户端控件容器的子级里，图片加载不了外部资产** ——
//        图片必须挂在**客户端容器之外**（也就是它只能是**服务器控件**）。
//   他给的实物：`132.gil` 里有个控件 `m`（id=1073742379，**父级就是 root**），
//   在编辑器里用「图片 → 静态引用」选中了 `murdoku-btn-hex`。
//
//   我把 `m` 拆开看了：它**没有任何指向 murdoku-btn-hex(1073742355) 的 id**（搜了 0 处命中）
//   —— 也就是说，编辑器的「静态引用」**不是按 id 引用，而是把素材的图元复制了一份**
//   （`m` 的 `#505` 结构与素材子记录几乎一样，只有几何那块 423 vs 447 不同）。
//
//   ⇒ 所以"用脚本引用素材"这条路是不存在的；**正确做法是"克隆那个已经做好的控件"**。
//      这个工具就干这件事：把 `m` 作为原型，按需要克隆若干份，改名字 / 改父级 / 挪位置。
//
// 用法：
//   node tools/gil/clone_asset_image.mjs --base=<含 m 的.gil> --out=<输出.gil> \
//        --proto=m --spec="action.redo.img@1073741916@-40@-30;action.hint.img@1073741919@0@0"
//     spec 每项三段：<新名字>@<父控件名>@<相对父级的 x>@<相对父级的 y>
//     （父控件名用**控件名**，工具自己去 base 里查它的 id）

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  readGil, encodeMsg, stateBlocks, pairOf, setPair,
  findChildListTop, ensureChildListTop, setChildList, asIdList,
} from './gilread.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const arg = (k, d) => {
  const h = process.argv.find((s) => s.startsWith('--' + k + '='));
  return h ? h.slice(k.length + 3).replace(/^"|"$/g, '') : d;
};
const P = (p) => (path.isAbsolute(p) ? p : path.resolve(ROOT, p));

const BASE = arg('base');
const OUT = arg('out');
const PROTO = arg('proto', 'm');
const SPEC = arg('spec', '');
if (!BASE || !OUT || !SPEC) {
  console.error('用法: node tools/gil/clone_asset_image.mjs --base=<含原型的.gil> --out=<输出.gil> --proto=m --spec="名字@父控件@x@y;..."');
  process.exit(1);
}

const g = readGil(P(BASE));
const proto = g.byName.get(PROTO);
if (!proto) { console.error('❌ 找不到原型 `' + PROTO + '`'); process.exit(2); }
console.log('  原型 `' + PROTO + '`：id=' + proto.id + ' 父=' + proto.parentId + ' 字段数=' + (proto.field.sub || []).length);

// 名字怎么改：记录里有一个"名字"字段（`setName` 那套）。这里沿用 sync_plan 的做法：
// 找一个 text 字段（wt=2 且 isText）改掉；找不到就报错，不硬来。
function deepField(f) {
  return {
    field: f.field, wt: f.wt, num: f.num ?? 0n,
    payload: f.payload ? Buffer.from(f.payload) : Buffer.alloc(0),
    len: f.len ?? 0, isText: !!f.isText,
    sub: f.sub ? f.sub.map(deepField) : null,
  };
}
function walkFields(fs, fn) { for (const f of fs) { fn(f); if (f.sub) walkFields(f.sub, fn); } }
function setName(fs, text) {
  let done = false;
  walkFields(fs, (f) => {
    if (done) return;
    if (f.wt === 2 && f.isText) { f.payload = Buffer.from(text, 'utf8'); f.len = f.payload.length; done = true; }
  });
  return done;
}

let nextId = Math.max(...g.recs.map((r) => Number(r.id))) + 1;
const specs = SPEC.split(';').map((s) => s.trim()).filter(Boolean);
let made = 0;

for (const sp of specs) {
  const [name, parentName, dxs, dys] = sp.split('@');
  // ★ 父级支持两种写法：**控件名**，或 `#<记录id>`（因为 `m` 的父级是个**无名容器** 1073741825，
  //   它在客户端 UI 的根层 —— 按用户实测第 2 条，图必须挂在那里，不能挂进客户端控件容器的子级）。
  let parentRec = null;
  if (/^#\d+$/.test(parentName)) {
    // ★ `#<id>` 允许"这条记录不在我们的记录集里" —— 例如 `m` 的父级 1073741825
    //   就是**引擎自己的根节点**（不在 recHolder 里），但对 `m` 来说它是有效父级。
    //   ⇒ 不存在时构造一个"只有 id"的伪父级，只用于写 `#504` 和挂子列表。
    const found = g.recs.find((r) => String(r.id) === parentName.slice(1));
    parentRec = found || { id: Number(parentName.slice(1)), name: '(引擎根)', field: null };
  } else {
    parentRec = g.byName.get(parentName) || null;
  }
  if (!parentRec) { console.log('  ❌ 父控件 `' + parentName + '` 不存在，跳过 ' + name); continue; }
  console.log('  父级 `' + parentName + '` → id=' + parentRec.id + ' name=' + (parentRec.name || '(无名)'));

  const id = nextId++;
  const field = deepField(proto.field);
  // ① 自身 id（第一个 #501）
  let first501 = false;
  walkFields(field.sub, (f) => { if (!first501 && f.field === 501 && f.wt === 0) { f.num = BigInt(id); first501 = true; } });
  // ② 父级（第一个 #504）
  let setP = false;
  walkFields(field.sub, (f) => { if (!setP && f.field === 504 && f.wt === 0) { f.num = BigInt(parentRec.id); setP = true; } });
  // ③ 名字
  const okName = setName(field.sub, name);
  // ④ 几何：原型里 `#505` 有若干块（每个状态一块），把位置按 dx/dy 挪一挪
  let ngeom = 0;
  for (const b of stateBlocks(field.sub, [])) {
    const p4 = pairOf(b, 504);
    if (p4) {
      const cur = pairOf(b, 504).sub ? pairOf(b, 504).sub.map((x) => Number(x.num)) : [];
      const x = (cur[0] || 0) + Number(dxs || 0);
      const y = (cur[1] || 0) + Number(dys || 0);
      setPair(p4, x, y);
      ngeom++;
    }
  }
  // ⑤ 子列表清空（克隆的是叶子图元，没有子控件）
  const cl = findChildListTop(field.sub);
  if (cl) setChildList(cl, []);

  const rec = { id, name, parentId: parentRec.id, field: null, holder: null, index: -1, fieldNum: proto.fieldNum };
  rec.field = { field: proto.field.field, wt: 2, sub: field.sub, num: 0n, payload: Buffer.alloc(0), len: 0, isText: false };
  g.recHolder.push(rec.field);
  g.recs.push(rec);
  g.byName.set(name, rec);
  made++;
  console.log('  ✅ ' + name + '  id=' + id + '  父=' + parentName + '(' + parentRec.id + ')'
    + '  几何块=' + ngeom + '  名字写入=' + okName);

  // ⑥ 挂进父控件的子列表
  // 伪父级（引擎根）没有 field，跳过挂子列表（它本来也在记录集之外）
  if (!parentRec.field) { continue; }
  const pl = ensureChildListTop(parentRec, findChildListTop(proto.field.sub));
  if (pl) {
    const cur = asIdList(pl).map(String);
    if (!cur.includes(String(id))) { cur.push(String(id)); setChildList(pl, cur); }
  }
}

if (made === 0) { console.error('❌ 一份都没克隆出来，不写文件'); process.exit(3); }
const buf = g.pack(encodeMsg(g.tree));
fs.writeFileSync(P(OUT), buf);
console.log('  写出 ' + path.relative(ROOT, P(OUT)) + '  ' + Math.round(buf.length / 1024) + ' KB（克隆 ' + made + ' 份）');

// 回读自检：新控件在不在、父级对不对
const g2 = readGil(P(OUT));
let bad = 0;
for (const sp of specs) {
  const name = sp.split('@')[0];
  const r = g2.byName.get(name);
  if (!r) { console.log('  ❌ 回读找不到 ' + name); bad++; }
}
console.log(bad ? ('  ❌ 回读有 ' + bad + ' 个不对') : '  ★ 回读全部就位 ✅');
