// tools/gil/gen_things_obj.mjs —— 给「障碍物」建 `things` 素材区，并给格子模板加 `obj` 图层
//
//   做什么（**只新增记录**，不改任何已有记录的值）：
//     ① `things` 容器（`root` 的子控件，摆在画布外 200000,200000）
//        —— 用户要求："障碍物单独建一个 things 区域用来放它们的美术素材"
//     ② `things/obj.<kind>`：每个家具一件**图片控件**，名字就是脚本的引用键
//        `obj.table` / `obj.plant` / `obj.carpet` / `obj.chair` / `obj.shelf` / `obj.statue`
//        ★ 现在里面是**色块占位**（imageId=100001 ＋ 各自的 imageColor）
//          ⇒ 在编辑器里把每个控件的图换成真家具素材即可，**名字别改**，脚本不用动 ✓
//     ③ 格子模板 `cell` → `content` → **`obj`**（135×135，克隆自 `face`，插在 `hint` 之后）
//        ⇒ 适配层 `key=="object"` 把 `things/obj.<kind>` 的图与色**照抄**到那一格 ✓
//
//   用法：
//     node tools/gil/gen_things_obj.mjs --in=395.gil --out=396-things.gil [--dry]
//
//   ★ 为什么 `obj` 插在 `hint` **之后**：图层顺序里索引大的画在上面 ✓
//     face(0) < hint(1) < obj(2) < x / wall.* / note / door.* ✓
//     ⇒ 提示底色在**家具图标之下**（图标不被蓝色盖住 ✓），墙/门仍压在格子边缘上 ✓
//   ★ 验收：`writeGil()` 自带「重读磁盘 + 往返一致 + 记录数断言 + 结构断言」✓
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  readGil, encodeMsg, cloneField, findChildListTop, setChildList, asIdList,
  bigIds, textsOf, stateBlocks, pairOf, setPair,
} from './gilread.mjs';
import { writeGil } from './gilwrite.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const P = (p) => (path.isAbsolute(p) ? p : path.join(ROOT, p));
const argv = process.argv.slice(2);
const argOf = (k, d) => {
  const hit = argv.find((s) => s.startsWith('--' + k + '='));
  return hit ? hit.slice(k.length + 3).replace(/^"|"$/g, '') : d;
};
const IN = argOf('in'), OUT = argOf('out');
const DRY = argv.includes('--dry');
if (!IN || !OUT) {
  console.error('用法: node tools/gil/gen_things_obj.mjs --in=<存档.gil> --out=<输出.gil> [--dry]');
  process.exit(1);
}

const THINGS_POS = { x: 200000, y: 200000 };   // 画布外（与 tpl-container 同一套路）
const THINGS_SIZE = { w: 900, h: 180 };
const CELL = 135;                               // 设计单位 = 画布 108（格子边长）
const KINDS = [
  { name: 'obj.table',  color: 0xFFB07946 },   // 桌子（不可站人）
  { name: 'obj.plant',  color: 0xFF4CAF50 },   // 植物（不可站人）
  { name: 'obj.carpet', color: 0xFFD9C8A6 },   // 地毯（可站人）
  { name: 'obj.chair',  color: 0xFFE0A040 },   // 椅子（可站人）
  { name: 'obj.shelf',  color: 0xFF7A5230 },   // 书架（不可站人）
  { name: 'obj.statue', color: 0xFFB8B8C0 },   // 雕塑（不可站人）
];

const g = readGil(P(IN));
console.log('存档 ' + path.basename(IN) + '　记录 ' + g.recs.length + '　maxId=' + g.maxId);

const byName = (n) => g.recs.find((r) => r.name === n);
const content = byName('content');
const face = g.recs.find((r) => r.name === 'face' && Number(r.parentId) === Number(content && content.id));
const hint = g.recs.find((r) => r.name === 'hint' && Number(r.parentId) === Number(content && content.id));
const tplContainer = byName('tpl-container');
const root = byName('root');
for (const [nm, v] of Object.entries({ content, face, hint, tplContainer, root })) {
  if (!v) { console.error('✗ 找不到必要记录：' + nm); process.exit(2); }
}
if (byName('things')) { console.error('✗ 已存在 `things`（本工具不覆盖）'); process.exit(2); }
if (KINDS.some((k) => byName(k.name))) { console.error('✗ 已存在某个 `obj.*`（本工具不覆盖）'); process.exit(2); }

// ── 找"这条记录自己所在的那个字段数组"：只认**同时有顶层 #501 与 #505** 的字段 ✓
function holderOfRecord(id) {
  const want = BigInt(id);
  const stack = [{ arr: g.tree, parent: null }];
  while (stack.length) {
    const { arr } = stack.pop();
    if (!Array.isArray(arr)) continue;
    for (let i = 0; i < arr.length; i++) {
      const f = arr[i];
      if (!f.sub) continue;
      const own501 = f.sub.find((x) => x.field === 501 && x.wt === 0);
      const has505 = f.sub.some((x) => x.field === 505 && x.sub);
      if (own501 && has505 && own501.num === want) return { arr, index: i };
      stack.push({ arr: f.sub });
    }
  }
  return null;
}
function renameIn(fields, oldName, newName) {
  const t = textsOf(fields, []).find((x) => x.payload && x.payload.toString('utf8') === oldName);
  if (!t) return false;
  t.payload = Buffer.from(newName, 'utf8');
  t.len = t.payload.length;
  return true;
}
function imageBlocks(fields, out) {
  for (const f of fields || []) {
    if (f.field === 84 && f.sub) out.push(f);
    if (f.sub) imageBlocks(f.sub, out);
  }
  return out;
}

let nextId = BigInt(g.maxId) + 1n;
const takeId = () => nextId++;

function buildClone({ proto, name, parentId, size, color }) {
  const cf = cloneField(proto.field);
  const id = takeId();
  const own501 = cf.sub.find((x) => x.field === 501 && x.wt === 0);
  if (!own501) throw new Error(name + '：克隆体没有顶层 #501');
  own501.num = id;
  if (!renameIn(cf.sub, proto.name, name)) throw new Error(name + '：改名失败（原型 ' + proto.name + '）');
  const p504 = cf.sub.find((x) => x.field === 504 && x.wt === 0);
  if (p504) {
    p504.num = BigInt(parentId);
  } else {
    // ★ 顶层没有 `#504`（`tpl-container` 就是这样：它是根级记录、当时没有父指针）
    //   ⇒ **新建一个**，插在 `#505`（数据）之前，保持字段顺序与其它记录一致 ✓
    const f = { field: 504, wt: 0, num: BigInt(parentId) };
    const at = cf.sub.findIndex((x) => x.field === 505);
    if (at >= 0) cf.sub.splice(at, 0, f); else cf.sub.push(f);
    console.log('  · ' + name + '：顶层原来没有 #504 ⇒ 已新建父指针 → ' + parentId);
  }

  const bl = [];
  stateBlocks(cf.sub, bl);
  if (bl.length !== 4) console.warn('  ⚠ ' + name + '：状态块 ' + bl.length + ' 个（预期 4）');
  for (const b of bl) {
    const sz = pairOf(b, 505);
    if (sz && size) setPair(sz, size.w, size.h);
    if (size && size.pos) {
      const pos = pairOf(b, 504);
      if (pos) setPair(pos, size.pos.x, size.pos.y);
    }
  }
  const ib = imageBlocks(cf.sub, []);
  const protoIsImage = imageBlocks(proto.field.sub, []).length > 0;
  if (protoIsImage && ib.length !== 1) console.warn('  ⚠ ' + name + '：图片块 ' + ib.length + ' 个（预期 1）');
  for (const blk of ib) {
    const setNum = (no, v) => {
      let f = blk.sub.find((x) => x.field === no && x.wt === 0);
      if (!f) { f = { field: no, wt: 0, num: 0n }; blk.sub.push(f); }
      f.num = BigInt(v >>> 0);
    };
    if (color !== undefined) setNum(502, color);   // imageColor（ARGB）
    setNum(503, 100001);                            // imageId（基础矩形占位）
    setNum(504, 1);                                 // imageType = Stretch（填满控件）
  }
  return { id, field: cf };
}

const added = [];

// ① things 容器
const things = buildClone({
  proto: tplContainer, name: 'things', parentId: root.id,
  size: { w: THINGS_SIZE.w, h: THINGS_SIZE.h, pos: THINGS_POS },
});
{
  const h = holderOfRecord(tplContainer.id);
  h.arr.splice(h.index + 1, 0, things.field);
}
added.push({ name: 'things', id: things.id });

// ② things/obj.<kind>
const thingKids = [];
for (const k of KINDS) {
  const c = buildClone({ proto: face, name: k.name, parentId: things.id, size: { w: CELL, h: CELL }, color: k.color });
  const h = holderOfRecord(face.id);
  h.arr.splice(h.index + 1, 0, c.field);
  thingKids.push(c);
  added.push({ name: k.name, id: c.id, color: k.color });
}
// 登记 things 的子列表（原型无子 ⇒ 新建一个空 #503）
{
  let cl = findChildListTop(things.field.sub);
  if (!cl) {
    cl = { field: 503, wt: 2, sub: [], payload: Buffer.alloc(0), len: 0, s1: 0 };
    things.field.sub.push(cl);
  }
  setChildList(cl, thingKids.map((c) => Number(c.id)));
}
// 登记 root → things
{
  const cl = findChildListTop(root.field.sub);
  if (!cl) { console.error('✗ root 没有子列表'); process.exit(3); }
  const cur = (asIdList(cl.payload, true) || []).map(Number);
  setChildList(cl, cur.concat([Number(things.id)]));
}

// ③ content/obj（插在 hint 之后）
const obj = buildClone({ proto: face, name: 'obj', parentId: content.id, size: { w: CELL, h: CELL }, color: 0xFFFFFFFF });
{
  const h = holderOfRecord(hint.id);
  h.arr.splice(h.index + 1, 0, obj.field);
}
let objIndex = -1;
{
  const cl = findChildListTop(content.field.sub);
  if (!cl) { console.error('✗ content 没有子列表'); process.exit(3); }
  const cur = (asIdList(cl.payload, true) || []).map(Number);
  const at = cur.indexOf(Number(hint.id)) + 1;
  cur.splice(at, 0, Number(obj.id));
  objIndex = at;
  setChildList(cl, cur);
}

console.log('\n新增记录：');
for (const a of added) {
  console.log('  ' + a.name.padEnd(12) + '#' + a.id + (a.color ? '　color=0x' + a.color.toString(16).toUpperCase() : ''));
}
console.log('  ' + 'obj'.padEnd(12) + '#' + obj.id + '　（content 子列表第 ' + objIndex + ' 位：face,hint,obj,…）');

const expectRecs = g.recs.length + added.length + 1;
if (DRY) {
  const buf = g.pack(encodeMsg(g.tree));
  console.log('\n[--dry] 不写文件：预计记录 ' + expectRecs + '、' + buf.length + ' 字节');
  process.exit(0);
}

writeGil(g, P(OUT), {
  label: 'gen_things_obj',
  expectRecs,
  assert: (g2) => {
    const bad = [];
    const t = g2.recs.find((r) => r.name === 'things');
    if (!t) bad.push('缺 things');
    else {
      if (Number(t.parentId) !== Number(root.id)) bad.push('things 的父不是 root');
      const cl = findChildListTop(t.field.sub);
      const ids = cl ? (asIdList(cl.payload, true) || []).map(Number) : [];
      if (ids.length !== KINDS.length) bad.push('things 子控件 ' + ids.length + ' 个（预期 ' + KINDS.length + '）');
      for (const k of KINDS) {
        const r = g2.recs.find((x) => x.name === k.name);
        if (!r) { bad.push('缺 ' + k.name); continue; }
        if (Number(r.parentId) !== Number(t.id)) bad.push(k.name + ' 的父不是 things');
        if (!ids.includes(Number(r.id))) bad.push(k.name + ' 没登记进 things 子列表');
      }
    }
    const c2 = g2.recs.find((r) => r.id === Number(content.id));
    const o = g2.recs.find((r) => r.name === 'obj' && Number(r.parentId) === Number(content.id));
    if (!o) bad.push('缺 content/obj');
    const clc = c2 ? findChildListTop(c2.field.sub) : null;
    const cids = clc ? (asIdList(clc.payload, true) || []).map(Number) : [];
    const oi = o ? cids.indexOf(Number(o.id)) : -1;
    if (oi !== objIndex) bad.push('content 里 obj 的位置 = ' + oi + '（预期 ' + objIndex + '）');
    if (bad.length) throw new Error('✗ 结构断言失败：\n  ' + bad.join('\n  '));
    console.log('  ✅ 结构断言通过：root→things（' + KINDS.length + ' 个素材）＋ content 第 ' + oi + ' 位 = obj ✓');
  },
});
console.log('\n已写出：' + OUT + '（' + fs.statSync(P(OUT)).size + ' 字节，记录 ' + expectRecs + '）');
