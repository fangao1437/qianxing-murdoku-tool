// tools/gil/sync_plan.mjs —— **按布局计划把缺失的控件补进 .gil**
//
// 为什么要有它：
//   美术改造的 ②③⑤⑥ 都要"往 .gil 里加新控件"（线索卡的标红子控件、滚动列表、
//   右侧按钮、家具图标…）。每次手写一个一次性脚本既慢又容易漏掉那串必须遵守的坑。
//   这个工具把"加控件"这件事**标准化**：
//     · 从 `tools/sim/out/layout-plan.json`（`lua tools/dump_layout.lua` 生成）读要有什么
//     · 和现有 .gil 对比，**只补缺的**，已有的一律不动（尊重你在编辑器里调的位置）
//
// ★ 必须遵守的坑（本会话踩了一整天才摸清，这里逐条落实）：
//   1. 新记录写进 **`g.recHolder`**（本工程是子消息 `/#9`），**不是 `g.tree`**
//      —— 写错地方编辑器根本读不到，导入后记录全没；写顶层还会让文件导不进去。
//   2. 容器必须克隆**真正的容器原型**（`#505/#78`），克隆按钮（`#80`）会被编辑器忽略。
//   3. 父级要**同时**改记录里的 `#504` **和**父控件的子列表 —— 只改一边编辑器看不到。
//   4. 子列表只在**顶层**找/建（`findChildListTop`/`ensureChildListTop`），
//      且新建时插在 `#502` 之后（与 `board` 同构）。
//   5. 坐标用 `setPair` 的**稀疏编码**（0 分量不写），与引擎一致。
//
// 用法：
//   node tools/gil/sync_plan.mjs --gil=38.gil --out=完整界面40.gil [--dry]
//     --dry   只看会补哪些，不写文件

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  readGil, encodeMsg, stateBlocks, pairOf, setPair,
  findChildListTop, ensureChildListTop, setChildList, asIdList,
} from './gilread.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const argv = process.argv.slice(2);
const argOf = (k) => { const a = argv.find((s) => s.startsWith('--' + k + '=')); return a ? a.slice(k.length + 3) : null; };
const DRY = argv.includes('--dry');
const GIL = argOf('gil') || path.join(ROOT, '38.gil');
const OUT = argOf('out') || path.join(ROOT, '完整界面40-计划同步.gil');
const PLAN = argOf('plan') || path.join(ROOT, 'tools/sim/out/layout-plan.json');

const g = readGil(GIL);
const plan = JSON.parse(fs.readFileSync(PLAN, 'utf8'));
const byId = new Map(g.recs.map((r) => [r.id, r]));
const byName = g.byName;

// ── 选原型：容器用容器、其它用按钮/文本 ────────────────────────────────────
const protoBox = g.byName.get('intro') || g.byName.get('modal') || g.byName.get('board');
// ★★★★★ 2026-10-12 **原型查找补上"它已被删"的退路** ✗✓
//
//   症状：`❌ 找不到原型（需要 intro/modal/board 与 action.undo/action.hint）`
//   根因：`action.undo` / `action.hint` 这**旧文字键**在 2026-10-05 就被删了 ✓
//     （接替者 = `hex.undo` / `hex.hint` ✓ 见 `00-索引.md` 第五节的"已删控件"表 ✓）
//     ⇒ ★ 这份工具**从那以后就没法用** ✗ —— 属"克隆族工具的陈旧原型"那类工具债 ✓
//   ⇒ 修法：保留旧名（老存档还能命中）✓，但**补一串当前确实存在的按钮当退路** ✓
//     挑的都是"运行时可见、且自带 bg/label 的预设按钮" ✓
const protoBtn = g.byName.get('action.undo') || g.byName.get('action.hint')
              || g.byName.get('modal.cancel') || g.byName.get('modal.next')
              || g.byName.get('home.select')   || g.byName.get('action.back')
              || g.byName.get('hex.submit');
// 图片控件的原型：**必须是"source 对"、而且"visible=true"的图片控件**。
//
// ⚠️⚠️ 2026-10-01 **我在这里踩了《工作约定》里写明的那条坑**：
//   「别拿"运行时状态为假"的控件当克隆原型 —— 例如墙/门在存档里是 `visible=false`，
//     克隆出来的副本也是隐藏的」
//   我第一版用 `wall.right`（**它是 visible=false**）当原型 ⇒ 18 个六边形图元
//   全部 `visible=false` ⇒ 真机上「截图上什么都没有」。
//   日志里能直接看到对比：
//     action.submit.hex1(visible=false type=Basic id=100001)   ← id 全对，但隐藏
//     wall.left  visible=true                                   ← 它是可见的
//   ⇒ 改用 `wall.left`（同样 `imageId=100001`，但 **visible=true**）。
const protoImg = g.byName.get('wall.left') || g.byName.get('wall.up')
              || g.byName.get('door.left') || g.byName.get('wall.right');
const protoText = g.byName.get('modal.title') || g.byName.get('hud.title') || g.byName.get('intro.title');
if (!protoBox || !protoBtn) { console.error('❌ 找不到原型（需要 intro/modal/board 与 action.undo/action.hint）'); process.exit(3); }

// ── 克隆（字段深拷贝 + 重写 ID / 父级 / 名字）──────────────────────────────
let nextId = g.maxId + 1;
function deepField(f) {
  const c = { field: f.field, wt: f.wt, sub: null, num: f.num, len: f.len, isText: f.isText,
              payload: f.payload ? Buffer.from(f.payload) : Buffer.alloc(0) };
  if (f.sub) c.sub = f.sub.map(deepField);
  return c;
}
function walkFields(fs, fn) { for (const f of fs) { fn(f); if (f.sub) walkFields(f.sub, fn); } }

function setName(fs, text) {
  const buf = Buffer.from(text, 'utf8');
  let done = false;
  // ⚠️ 名字埋在 `#505 / #12 / #501`（`#505` 在一条记录里出现**很多次**：
  //    名字、位置、尺寸、状态各一个；只有带 `#12` 的那个才是名字）。
  //    我第一版递归进 `#12` 时把"正在找名字"的记号重置成了 false ⇒ **永远找不到** ⇒
  //    新记录全部沿用了原型的名字（回读时才报"回读不到 clue.1.who"）。
  //    ⇒ 记号要**一路带下去**，只有碰到 `#501` 且是文本字段时才落笔。
  (function visit(list, inName) {
    for (const f of list) {
      if (done) return;
      if (f.sub) { visit(f.sub, inName || f.field === 505); continue; }
      if (inName && f.field === 501 && f.wt === 2) {
        f.payload = buf; f.len = buf.length; f.isText = true; done = true; return;
      }
    }
  })(fs, false);
  return done;
}

/**
 * 写图片 id。
 *
 * ★★★ 2026-10-01：**图片 id 在 `/#505/#503/#84/#503`** —— 这是我在 4 个控件上
 *   对比确认的（`wall.right`=100001、`wall.down`=100108、`x`=100101、`face`=106053）。
 *   做法：把两个只有图不同的控件**逐字段对比**，唯一不同的就是它。
 *
 * ⚠️ 为什么必须在**存档里**写好、不能留给运行时 `SetImage`：
 *   适配器里有过一条实测记录（L1503）——
 *   「运行时 `SetImage(bg.imageSource, 100108)` 反而把它**覆盖成了紫色**，
 *     说明运行时读到的 `imageSource` 和我写进存档的**不是同一个值**，配错了图集」
 *   ⇒ 运行时按"读到的 source + 新 id"去换图**不可靠**；在存档里直接写好才稳。
 */
function setImageId(fieldSub, imageId) {
  let done = false;
  (function walk(fs, path) {
    for (const x of fs) {
      if (done) return;
      if (x.wt === 0 && x.field === 503 && path === '/#505/#503/#84') { x.num = BigInt(imageId); done = true; return; }
      if (x.wt === 2 && x.sub) walk(x.sub, path + '/#' + x.field);
    }
  })(fieldSub, '');
  return done;
}

/** 克隆一个原型记录（**只克隆它自己，不带子控件** —— 我们要的是"空壳"） */
function makeRecord(proto, name, parentRec, x, y, w, h, imageId) {
  const id = nextId++;
  const field = deepField(proto.field);
  // ① 本记录自己的 ID
  let first501 = false;
  walkFields(field.sub, (f) => { if (!first501 && f.wt === 0 && f.field === 501) { f.num = BigInt(id); first501 = true; } });
  // ② 其它指向原型 ID 的地方也改（`#502/#11/#501`、`#505/#503/#504/#4`）
  walkFields(field.sub, (f) => {
    if (f.wt === 0 && f.field === 501 && f !== null && Number(f.num) === proto.id) f.num = BigInt(id);
    if (f.wt === 0 && f.field === 4 && Number(f.num) === proto.id) f.num = BigInt(id);
  });
  // ③ 父级 `#504`
  let setP = false;
  walkFields(field.sub, (f) => { if (!setP && f.wt === 0 && f.field === 504) { f.num = BigInt(parentRec.id); setP = true; } });
  // ④ 名字
  setName(field.sub, name);
  // ⑤ 清空子列表（原型自带的子控件我们不要 —— 否则会飘在界面上）
  const cl = findChildListTop(field.sub);
  if (cl) setChildList(cl, []);
  // ⑥ 几何
  let n = 0;
  for (const b of stateBlocks(field.sub, [])) {
    const p5 = pairOf(b, 505); if (p5) { setPair(p5, w, h); n++; }
    const p4 = pairOf(b, 504); if (p4) { setPair(p4, x, y); n++; }
  }
  // ⑥b 图片 id（只有图片控件才给）
  if (imageId != null) setImageId(field.sub, imageId);

  const rec = { id, name, parentId: parentRec.id, field: null, holder: null, index: -1 };
  // ⚠️⚠️ **字段号必须用原型记录的**，不能写 0！
  //   我第一版写成 `{ field: 0, wt: 2, sub: field.sub }` —— 字段号 0 在 protobuf 里**非法**，
  //   编码出来 tag=2，整个文件解析成 **0 条记录**（回读验证当场报"34 个全丢了"）。
  //   记录在 `.gil` 里是**带字段号的重复字段**（本工程是 `#9`），必须照抄原型那个号。
  rec.field = { field: proto.field.field, wt: 2, sub: field.sub, num: 0n,
                payload: Buffer.alloc(0), len: 0, isText: false };
  byId.set(id, rec);
  byName.set(name, rec);

  // ⑦ 挂进父级子列表
  const pl = ensureChildListTop(parentRec, findChildListTop(protoBox.field.sub));
  const ids = asIdList(pl.payload, true) || [];
  ids.push(id);
  setChildList(pl, ids);

  // ⑧ 写进正确的容器
  g.recHolder.push(rec.field);
  return { rec, pairs: n };
}

// ── 对比计划，补缺失的 ─────────────────────────────────────────────────────
// 只补"叶子界面控件"：容器/按钮/文本。层级按计划里的 parent 递归解析。
const planNodes = plan.nodes || [];
const planById = new Map(planNodes.map((n) => [n.id, n]));
const created = [], skipped = [];

// 计划里的坐标是**画布空间**（1600×900），而 .gil 里存的是**设计空间**（1920×1080）
const SX = 1920 / 1600, SY = 1080 / 900;
const toDesign = (n) => ({
  x: Math.round((n.cx - n.w / 2) * SX), y: Math.round((n.cy - n.h / 2) * SY),
  w: Math.round(n.w * SX), h: Math.round(n.h * SY),
});

function parentRecOf(pid) {
  if (!pid) return g.byName.get('root');
  return g.byName.get(pid) || g.byName.get('root');
}
function parentPlanId(pid) {
  const p = planById.get(pid);
  return p ? p.parent : 'root';
}

// ★★★★★ 2026-10-02 **必须按"父级先建"的顺序处理** —— 这是本节最关键的一处修正。
//
//   原来直接 `for (const n of planNodes)`，按**计划里的排列顺序**走。
//   而 `parentRecOf()` 是 `g.byName.get(pid) || g.byName.get('root')` ——
//   **父级只有在"已经被建出来"时才找得到**。计划里 `select.card.1` 排在 `select` 前面时，
//   父级查不到 ⇒ **静默退回 `root`** ⇒ 实测后果：`select` 那 36 个子控件全挂到 root 下，
//   **root 子级数 9 → 42**（之前"点不动复活"就是 root 子级 37 那次）⇒ 有抢光标射线的风险。
//
//   ⇒ 修法：按"祖先链长度"升序排（深度浅的先建）。这样任何节点的父级在处理它之前就已经存在。
const depthOf = (id) => {
  let d = 0, cur = id, guard = 0;
  while (cur && guard++ < 64) {
    const p = planById.get(cur);
    if (!p || !p.parent) break;
    cur = p.parent; d++;
  }
  return d;
};
const orderedPlan = [...planNodes].sort((a, b) => depthOf(a.id) - depthOf(b.id));
console.log('  处理顺序：按层级深度升序（最深 ' + Math.max(...planNodes.map((n) => depthOf(n.id)), 0) + ' 层）');

for (const n of orderedPlan) {
  if (byName.has(n.id)) { continue; }                    // 已有 ⇒ 不动（尊重编辑器）
  // 只处理我们关心的几类；`cell.*` / `tray.*` 等由脚本运行时生成，不进 .gil
  if (/^(cell\.|ruler|tray\.|portrait\.|hud\.|toast|fx\.)/.test(n.id)) { skipped.push(n.id); continue; }
  // ★★★ 2026-10-01：**从「外部资产」转存进来的素材，必须由脚本按模板索引实例化，
  //   绝对不能进 `.gil`** —— 一旦进了，适配器 `find(id)` 会先找到这个"编辑器里的空控件"，
  //   于是永远不走 `InstantiateClientUIControl`，画面上就是**一块空白**。
  //
  //   这类节点的共同特征：在 `entry_client_script.lua` 的 `cfg.prefab_of` 里登记了模板索引。
  //   对应 id：右侧按钮的 `.hexbg`、线索条的 `clue.N.bg`、背景板 `home.panel`/`select.panel`。
  if (/\.hexbg$/.test(n.id) || /^clue\.\d+\.bg$/.test(n.id)
      || n.id === 'home.panel' || n.id === 'select.panel') {
    skipped.push(n.id + '(按模板索引实例化)'); continue;
  }
  if (n.kind !== 'container' && n.kind !== 'button' && n.kind !== 'text' && n.kind !== 'cursor') {
    skipped.push(n.id); continue;
  }
  // 父级也得存在（先建父再建子 —— 计划里父一般排在前面）
  const pid = parentPlanId(n.id);
  const parentRec = g.byName.get(pid) || g.byName.get('root');
  if (!g.byName.get(pid) && pid !== 'root') { skipped.push(n.id + '(父 ' + pid + ' 不在)'); continue; }

  // 原型选择：
  //   · 图片控件（带 `image_id`）⇒ 用 `wall.right`（**它的 source 是对的**，
  //     我们只改 id）。用按钮原型的话会带上按钮自己的图/source。
  //   · 容器 ⇒ protoBox
  //   · 文本 ⇒ protoText
  //   · 其它 ⇒ protoBtn
  const proto = n.image_id != null && protoImg ? protoImg
              : n.kind === 'container' ? protoBox
              : (n.kind === 'text' && protoText ? protoText : protoBtn);
  const d = toDesign(n);
  const r = makeRecord(proto, n.id, parentRec, d.x, d.y, d.w, d.h, n.image_id);
  created.push({ id: n.id, kind: n.kind, parent: parentRec.name, rect: d, pairs: r.pairs,
                 img: n.image_id != null ? n.image_id : null });
}

console.log('  存档 ' + path.basename(GIL) + '  记录 ' + g.recs.length + ' → 新增 ' + created.length);
for (const c of created.slice(0, 40)) {
  console.log('    + ' + c.id.padEnd(26) + c.kind.padEnd(10) + '父=' + String(c.parent).padEnd(12)
    + JSON.stringify(c.rect) + (c.pairs >= 4 ? '' : '  ⚠️ 坐标组数 ' + c.pairs));
}
if (created.length > 40) console.log('    …还有 ' + (created.length - 40) + ' 个');
if (skipped.length) console.log('    跳过（脚本运行时生成 / 不需要进 .gil）：' + skipped.slice(0, 12).join(' ') + (skipped.length > 12 ? ' …' : ''));

if (DRY) { console.log('  --dry：不写文件'); process.exit(0); }

fs.writeFileSync(OUT, g.pack(encodeMsg(g.tree)));
console.log('\n输出：' + path.basename(OUT) + '  ' + fs.statSync(OUT).size + ' 字节');

// ── 回读验证（**必须**：只看"写成功"不算数）────────────────────────────────
const g2 = readGil(OUT);
const holderCount = new Map();
{
  const paths = new Map();
  (function walk(fields, p) { for (const f of fields) if (f.sub) { paths.set(f.sub, p + '/#' + f.field); walk(f.sub, p + '/#' + f.field); } })(g2.tree, '');
  for (const r of g2.recs) { const p = paths.get(r.holder) || '(顶层)'; holderCount.set(p, (holderCount.get(p) || 0) + 1); }
}
console.log('  回读：记录 ' + g2.recs.length + '；记录分布 ' + [...holderCount].map(([p, n]) => p + '=' + n).join(' '));
const topLevel = holderCount.get('(顶层)') || 0;
console.log('  ' + (topLevel === 0 ? '✅ 所有记录都在子消息里（编辑器读得到）' : '❌ 有 ' + topLevel + ' 条跑到了顶层，编辑器读不到'));
let missing = 0;
for (const c of created) if (!g2.byName.has(c.id)) { missing++; console.log('    ❌ 回读不到 ' + c.id); }
console.log('  ' + (missing === 0 ? '✅ 新增的 ' + created.length + ' 个控件回读全在' : '❌ 有 ' + missing + ' 个丢了'));
process.exit(missing === 0 && topLevel === 0 ? 0 : 4);
