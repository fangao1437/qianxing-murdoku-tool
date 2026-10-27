// tools/gil/gen_home.mjs —— 在存档里**直接建出主页与选关界面的控件**
//
// 为什么走这条路（而不是让脚本创建）：
//   见 `docs/工作约定-优先直改控件.md` —— 加控件/改几何这类事直改 `.gil` 一步到位，
//   走脚本要经过"创建→找控件→设属性→每帧维持"，环节多、易错。
//   脚本只负责**运行时才成立**的东西：文字内容、显隐、进度。
//
// 建出来的东西（设计坐标 1920×1080）：
//   home   容器（整屏）
//     home.title        标题
//     home.select       选关        ← 用户要求：原左下角的「选关」挪到中列**最上**
//     home.continue     从存档点开始
//     home.shop         商城（占位）
//     home.bag          背包（占位）
//     （左下角原来放「选关」的位置**留空** —— 用户明确要求）
//   select 容器（整屏）
//     select.title / select.back
//     select.card.1 … select.card.8   关卡卡片网格 4×2（murdoku 原作那种卡片选关）
//
// 用法：
//   node tools/gil/gen_home.mjs --in=完整界面30.gil --out=完整界面31.gil
//
// ⚠️ 克隆是**递归**的：按钮自带 `bg` / `label` 子控件，必须连子控件一起复制并换 ID，
//    否则副本的子列表还指着原型的子控件（两个按钮共用一张底图/一个文本框）。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  readGil, encodeMsg, cloneField, setPair, pairOf, stateBlocks,
  findChildList, findChildListTop, ensureChildListTop, setChildList, asIdList, writeVarint,
} from './gilread.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const argv = process.argv.slice(2);
const argOf = (k) => { const a = argv.find((s) => s.startsWith('--' + k + '=')); return a ? a.slice(k.length + 3) : null; };
const IN = argOf('in') || path.join(ROOT, '完整界面30.gil');
const OUT = argOf('out') || path.join(ROOT, '完整界面31.gil');

const g = readGil(IN);
const byId = new Map(g.recs.map((r) => [r.id, r]));
let nextId = g.maxId + 1;

// ── 几何 ──────────────────────────────────────────────────────────────────
// `rect` 是设计坐标**左上原点**；记录里存两对浮点（位置 / 尺寸）。
// 注意：这里写的是**编辑器里的控件几何**，脚本的 `respect_editor_rect` 会尊重它。
function setGeom(fields, x, y, w, h) {
  const pairs = [];
  (function walk(fs2) {
    for (const f of fs2) {
      if (f.wt === 5) {                       // 两浮点对
        pairs.push(f);
        continue;
      }
      if (f.sub) walk(f.sub);
    }
  })(fields);
  // 记录里通常有多组两浮点对：按约定 第 1 对 = 中心偏移，第 2 对 = 宽高
  // （gen_btn_art.mjs 用的是同一个约定：`setPair(pairOf(block,505), w, h)`）
  const blocks = stateBlocks(fields, []);
  for (const b of blocks) {
    const p = pairOf(b, 505);
    if (p) setPair(p, w, h);
  }
  return pairs.length;
}

function setPos(fields, x, y) {
  const blocks = stateBlocks(fields, []);
  for (const b of blocks) {
    const p = pairOf(b, 504);
    if (p) setPair(p, x, y);
  }
}

function findBlocks(fields) { return stateBlocks(fields, []); }

// ── 递归克隆 ──────────────────────────────────────────────────────────────
// 返回新记录（已挂进 tree），并把它加进 `parentRec` 的子列表。
function cloneSubtree(srcRec, parentRec, newName) {
  const clone = cloneField(srcRec.field);
  const oldId = srcRec.id;
  const newId = nextId++;

  // ① 记录自己的 ID（引用它的地方全换掉）
  (function fixId(fs2) {
    for (const f of fs2) {
      if (f.wt === 0 && Number(f.num) === oldId) f.num = BigInt(newId);
      if (f.payload && f.len > 0) {
        const ids = asIdList(f.payload, true);
        if (ids && ids.length === 1 && ids[0] === oldId) { f.payload = writeVarint(newId); f.len = f.payload.length; }
      }
      if (f.sub) fixId(f.sub);
    }
  })(clone.sub);

  // ② 名字
  if (newName) {
    (function putName(fs2) {
      for (const f of fs2) {
        if (f.wt === 2 && f.isText && f.payload && f.payload.toString('utf8') === srcRec.name) {
          f.payload = Buffer.from(newName, 'utf8'); f.len = f.payload.length; return true;
        }
        if (f.sub && putName(f.sub)) return true;
      }
      return false;
    })(clone.sub);
  }

  // ②b ★★ **父级字段要改**（踩过的坑）：
  //   只改 JS 侧的 `parentId` 是没用的 —— 记录里的 `#504` 才是真正的父级引用，
  //   不改的话副本仍挂在原型下面。我第一次跑出来"按钮子控件为空"就是这个原因：
  //   克隆出的 bg/label 认的还是 `action.undo`，不是新按钮。
  if (parentRec) {
    (function fixParent(fs2) {
      for (const f of fs2) {
        if (f.wt === 0 && f.field === 504) { f.num = BigInt(parentRec.id); return true; }
      }
      return false;
    })(clone.sub);
  }

  // ③ 递归克隆子控件（关键：否则副本和原型共用子控件）
  const kids = g.recs.filter((r) => r.parentId === srcRec.id);
  //   ★ 2026-10-07 修：递归版 ⇒ 只认顶层（否则清空的是嵌套里的无关字段）
  const cl = findChildListTop(clone.sub);
  if (cl) setChildList(cl, []);

  const newRec = {
    id: newId, name: newName || srcRec.name, parentId: parentRec ? parentRec.id : srcRec.parentId,
    field: clone, holder: null, index: -1,
  };
  byId.set(newId, newRec);

  const list = ensureChildList(newRec);
  const ids = [];
  for (const k of kids) {
    const kc = cloneSubtree(k, newRec, null);
    ids.push(kc.id);
  }
  setChildList(list, ids);

  // ★ 把自己挂进父级的子列表 —— **必须用记录里的 `#504` 指到的那个父级**，
  //   光在 JS 对象上设 `parentId` 是没用的（`readGil` 认的是 `#504`）。
  //   漏了这一步的症状：建出来的控件记录存在，但**挂在原型下面**，
  //   于是容器看起来"子控件是 bg/label"（那是原型的子控件）。
  if (parentRec) addToChildList(parentRec, newId);

  return newRec;
}

function ensureChildList(rec) {
  // ★★★ 2026-09-30：**必须用"顶层版"**。
  //   老实现调的是递归的 `findChildList` ⇒ 对一个**原本没有子控件**的容器，
  //   它会递归到嵌套字段里、把子控件 ID 写到无关的字段上 ⇒ 文件导不进去。
  //   详见 `gilread.mjs` 里 `findChildListTop` 的注释。
  const proto = g.recs.map((r) => findChildListTop(r.field.sub)).find(Boolean);
  return ensureChildListTop(rec, proto);
}

// ── 建树 ──────────────────────────────────────────────────────────────────
const rootRec = g.byName.get('root');
if (!rootRec) { console.error('❌ 找不到 root'); process.exit(3); }
const protoBtn = g.byName.get('action.undo') || g.byName.get('action.hint');
// ★★★ 2026-09-30：**容器必须克隆"真正的容器"**。
//
//   用户反馈「编辑器里看不到 home 和 select」。查下来是**类型标记**不对：
//     · 容器节点 = `#505` 块里以 `#78` 开头
//     · 预设按钮 = 以 `#80` 开头
//   我原来从 `action.undo`（按钮）克隆 ⇒ 建出来的"容器"其实是**预设按钮**
//   ⇒ 编辑器那个树叫「**客户端控件容器**」，只列容器 ⇒ **看不到它们**。
//   （而且按钮在编辑器里也不允许挂子控件 ⇒ 首页那些子控件也一起看不见。）
//   ⇒ 改成克隆 `intro`（一个**货真价实的容器节点**），类型字段自然就对。
// 文本原型：`modal.title` 是编辑器里一个货真价实的文本控件
const protoText = g.byName.get('modal.title') || g.byName.get('hud.title') || g.byName.get('intro.title') || null;
const protoBox = g.byName.get('intro') || g.byName.get('modal') || g.byName.get('board');
if (!protoBox) { console.error('❌ 找不到容器原型（intro/modal/board 都没有）'); process.exit(3); }
if (!protoBtn) { console.error('❌ 找不到按钮原型 action.undo'); process.exit(3); }

const built = [];
function addContainer(name, x, y, w, h) {
  // ★★★ 2026-09-30：**父级必须传给 `cloneSubtree`**。
  //
  //   同一个坑我踩了两次：
  //     · 传 `null` ⇒ 记录里的 `#504`（**真正的父级引用**）不会被改写，
  //       副本仍指向原型的父级（`toolbar`）⇒ **编辑器按 `#504` 建树，看不到这个控件**
  //       —— 用户反馈"完整界面33 里没有 home 和 select"就是这个原因；
  //       而我只手工把它加进了 `root` 的**子列表** ⇒ 两套数据不一致。
  //     · 传 `rootRec` ⇒ `#504` 改写 + 自动挂进 root 的子列表，一步到位。
  //   ⇒ 教训：**「子列表」和「#504」是两套数据，必须同时正确**，缺一个编辑器就看不到。
  const rec = cloneSubtree(protoBox, rootRec, name);
  setGeom(rec.field.sub, x, y, w, h);
  setPos(rec.field.sub, x + w / 2, y + h / 2);
  // 容器不需要原型带来的 bg/label（那是按钮的子控件）⇒ 清空
  const cl = ensureChildList(rec);
  setChildList(cl, []);
  built.push({ name, what: 'container' });
  return rec;
}
function addToChildList(rec, id) {
  const l = ensureChildList(rec);
  const cur = asIdList(l.payload, true) || [];
  if (!cur.includes(id)) cur.push(id);
  setChildList(l, cur);
}

// ★★★ 2026-09-30：**`--reuse` 模式 —— 容器由编辑器自己建，我们只砌砖**。
//
//   背景：我从 `intro` 克隆出来的 `home`/`select`，**编辑器导入后整棵子树被丢弃**
//   （用户导出回来的 35.gil 只有 197 条记录，`home`/`select` 连同子控件全没了）。
//   我在 `.gil` 里能验的都验过了：类型 `#505/#78` 对、父级 `#504` 对、子列表对、
//   ID 无冲突、和 `board` 全字段零差异 —— 编辑器还是不认。
//   ⇒ 不再猜了：**让编辑器自己建容器**（用户已在 35.1.gil 里建好 `home`/`select`），
//     我们只往里挂子控件。地基是编辑器打的，它必然认。
const REUSE = argv.some((s) => s === '--reuse' || s === '--reuse=true');

function useContainer(name, x, y, w, h) {
  if (REUSE) {
    const ex = g.byName.get(name);
    if (ex) {
      console.log('    ♻️  复用编辑器已建的容器 `' + name + '`（id=' + ex.id + '）');
      built.push({ name, what: 'container(reused)' });
      return ex;
    }
    console.error('❌ --reuse 模式下找不到 `' + name + '`，无法继续');
    process.exit(5);
  }
  return addContainer(name, x, y, w, h);
}

// 主页
const HOME_X = 730, HOME_W = 460, HOME_H = 88;
const home = useContainer('home', 0, 0, 1920, 1080);
const homeTitle = cloneSubtree(protoText || protoBtn, home, 'home.title');
homeTitle.parentId = home.id;
setGeom(homeTitle.field.sub, 460, 140, 1000, 110);
setPos(homeTitle.field.sub, 960, 195);
addToChildList(home, homeTitle.id);
built.push({ name: 'home.title', what: 'title' });

const HOME_ROWS = [
  ['home.select',   '选关',           360],
  ['home.continue', '从存档点开始',   480],
  ['home.shop',     '商城',           600],
  ['home.bag',      '背包',           720],
];
for (const [id, , y] of HOME_ROWS) {
  const b = cloneSubtree(protoBtn, home, id);
  b.parentId = home.id;
  setGeom(b.field.sub, HOME_X, y, HOME_W, HOME_H);
  setPos(b.field.sub, HOME_X + HOME_W / 2, y + HOME_H / 2);
  // （挂父级已由 cloneSubtree 负责）
  built.push({ name: id, what: 'button' });
}

// 选关界面
const sel = useContainer('select', 0, 0, 1920, 1080);
const selTitle = cloneSubtree(protoText || protoBtn, sel, 'select.title');
selTitle.parentId = sel.id;
setGeom(selTitle.field.sub, 460, 80, 1000, 90);
setPos(selTitle.field.sub, 960, 125);
addToChildList(sel, selTitle.id);
const selBack = cloneSubtree(protoBtn, sel, 'select.back');
selBack.parentId = sel.id;
setGeom(selBack.field.sub, 120, 950, 260, 80);
setPos(selBack.field.sub, 250, 990);
addToChildList(sel, selBack.id);

const CARD_W = 380, CARD_H = 200, CGAP = 40, CX0 = 160, CY0 = 240;
for (let i = 1; i <= 8; i++) {
  const col = (i - 1) % 4, row = Math.floor((i - 1) / 4);
  const x = CX0 + col * (CARD_W + CGAP), y = CY0 + row * (CARD_H + CGAP);
  const c = cloneSubtree(protoBtn, sel, 'select.card.' + i);
  c.parentId = sel.id;
  setGeom(c.field.sub, x, y, CARD_W, CARD_H);
  setPos(c.field.sub, x + CARD_W / 2, y + CARD_H / 2);
  // （挂父级已由 cloneSubtree 负责）
  built.push({ name: 'select.card.' + i, what: 'card' });
}

// 把新记录插进 tree（tree 是 parseMsg 的字段数组，记录就在其中）
// ★ 只把**从 root 可达**的新记录放进 tree。
//
//   为什么：容器原型（`intro`）自带子控件，克隆时它们也被复制了一份；
//   我们随后清空了容器的子列表 ⇒ 那些副本成了**孤儿记录** ——
//   挂在容器下但不在子列表里，运行时会**飘在主页上**（视觉垃圾）。
//   ⇒ 做一次可达性遍历，只保留真正用得上的。
const allNew = [...byId.values()].filter((r) => r.id >= g.maxId + 1);
const reachable = new Set([rootRec.id]);
const byIdAll = new Map([...g.recs.map((r) => [r.id, r]), ...allNew.map((r) => [r.id, r])]);
(function mark(id) {
  const r = byIdAll.get(id);
  if (!r) return;
  //   ★ 2026-10-07 修：只认顶层（这里只是**读**子 ID 做可达性遍历，但递归版会拿嵌套字段的
  //     payload 当 ID 列表 ⇒ 读出垃圾 ID）
  const cl = findChildListTop(r.field.sub);
  const kids = cl ? (asIdList(cl.payload, true) || []) : [];
  for (const k of kids) { if (!reachable.has(k)) { reachable.add(k); mark(k); } }
})(rootRec.id);
let dropped = 0;
// ★★★ 2026-09-30：**加到 `recHolder`，不是 `g.tree`**！
//   所有真实控件都住在某个子消息里（本工程是 `/#9`），`tree` 只是最外层字段列表。
//   我原来 push 到 tree ⇒ 编辑器读不到（导入后记录全没）+ 顶层多出怪记录（整个文件导不进去）。
//   详见 `gilread.mjs` 里 `recHolder` 的注释。
const holder = g.recHolder;
for (const r of allNew) {
  if (reachable.has(r.id)) holder.push(r.field);
  else dropped++;
}
console.log('  新记录写入容器：' + (holder === g.tree ? '顶层 tree（⚠️ 本文件记录就在顶层）' : '嵌套子消息（与现有 ' + g.recs.length + ' 条同处）'));
console.log('  丢掉孤儿记录 ' + dropped + ' 条（容器原型带过来的子控件副本）');

const body = encodeMsg(g.tree);
const outBuf = g.pack(body);
fs.writeFileSync(OUT, outBuf);

const g2 = readGil(OUT);
const tr = outBuf.subarray(outBuf.length - g.trailer.length);
console.log('输出：' + path.basename(OUT));
console.log('  文件 ' + outBuf.length + '（+' + (outBuf.length - g.src.length) + '）');
console.log('  尾 ' + tr.toString('hex') + (tr.equals(g.trailer) ? '  ✅' : '  ❌')
  + '   控件记录 ' + g2.recs.length + '（+' + (g2.recs.length - g.recs.length) + '）');
let bad = 0;
for (const it of built) {
  const r = g2.byName.get(it.name);
  if (!r) { bad++; console.log('  ❌ 缺 ' + it.name); }
}
for (const nm of ['home.select', 'home.continue', 'home.shop', 'home.bag']) {
  const r = g2.byName.get(nm);
  const kids = r ? g2.recs.filter((x) => x.parentId === r.id).map((x) => x.name) : [];
  console.log('    ' + nm.padEnd(16) + ' 子控件：' + (kids.join(', ') || '（无）'));
}
console.log('\n' + (bad === 0 ? '★ 主页/选关控件已建好（共 ' + built.length + ' 个）' : '❌ 有 ' + bad + ' 个缺失'));
process.exit(bad === 0 ? 0 : 4);
