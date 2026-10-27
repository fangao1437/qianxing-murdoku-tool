// tools/gil/gen_btn_art.mjs —— 给**所有按钮**加一个图片子控件，让它们看得见（美术接线）
//
// 为什么必须做（2026-09-28 真机截图证实）：
//   **预设按钮没有子控件 = 完全透明**。截图里工具条 / 动作条 / X 按钮**一个都看不见**，
//   玩家以为"按钮不存在"，其实是"存在、可点、但不画任何东西"。
//   官方说法「预设按钮的外观来自状态节点引用的子控件」——而状态节点引用**脚本改不了**；
//   但**没被引用的子控件照常渲染**（用户往 tray.D 加图片子控件、没动状态节点，实测能显示 ✅）。
//   ⇒ 所以给每个按钮挂一个图片子控件，就是它的"底图"。
//
// 做法：克隆**已经配好图**的控件当子控件。
//   · 按钮 → 克隆格子模板里的 `face`（自带底图 106053）
//   · 尺寸 = 按钮自身尺寸（从它的状态块读），位置 (0,0) —— 正好铺满当底图
//
// 用法：
//   node tools/gil/gen_btn_art.mjs --in=完整界面5.gil --out=完整界面6.gil
//   node tools/gil/gen_btn_art.mjs --in=... --out=... --probe

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  readGil, encodeMsg, cloneField, setPair, pairOf, stateBlocks, textsOf,
  findChildListTop, ensureChildListTop, setChildList, asIdList, writeVarint,
} from './gilread.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const argv = process.argv.slice(2);
const argOf = (k) => { const a = argv.find((s) => s.startsWith('--' + k + '=')); return a ? a.slice(k.length + 3) : null; };
const DRY = argv.includes('--probe');
const BASE = argOf('in') || path.join(ROOT, '完整界面5.gil');
const OUT = argOf('out') || path.join(ROOT, '完整界面6.gil');
// ★ 2026-10-07 新增 `--parts=`：要挂哪些子控件，逗号分隔，**默认 `bg,label`**。
//   · `label` = 按钮**文案**子控件 —— `engine_adapter_qianxing.lua:3987` 走 `self:sub(id,"label")`；
//     没有它 ⇒ 属性 `text` 永远送不到 ⇒ 日志「属性补发 3 次仍未送达：`xxx.text`」且按钮上一个字没有。
//   · `bg`    = 底图子控件（克隆 content/face 并把图片 ID 改成非白素材）。
//   ⇒ `--parts=label` 只补 label、完全不碰图片（"只补文案"那轮交付用的就是它）。
const PARTS = new Set((argOf('parts') || 'bg,label').split(',').map((s) => s.trim()).filter(Boolean));
// ★ 新增 `--skip-existing=<基准.gil>`：**基准里已有的同名控件一律不碰** ——
//   用于"只给本次净新增的按钮补 label，原有记录保持原样"。
const SKIP_GIL = argOf('skip-existing') || null;
const CHILD_NAME = argOf('child') || 'face';   // 旧参数，仅用于打印/兼容

const g = readGil(BASE);
console.log('基准：' + path.basename(BASE) + '（' + g.src.length + ' 字节）控件记录 ' + g.recs.length + ' 条');

// ── 原型：**非白且可见**的底图 + 文字 ────────────────────────────────────
// ⚠️ 两版都踩了坑，记下来免得再来一次：
//   · 第一版用格子模板的 `face`（图 106053）→ 那是**白色**占位图（用户："不要用白色"）。
//   · 第二版换成 `wall.left`（图 100001，有颜色）→ **还是看不见**！
//     真机日志给出答案：`bg(visible=false ...)` —— `wall.left` 在模板里是
//     **visible=false**（墙在运行时靠 `_apply_edges` 开关显示），
//     克隆会**把"隐藏"一起继承**，所以底图写进去了却永远不显示。
//   · 第三版改用 `wall.up`（图 100108）—— **还是 `visible=false`**！
//     真机日志把两次放在一起才看清：
//         tool.place  bg(visible=false ... id=100108)   ← 我克隆出来的
//         wall.up     visible=true  ... id=100108       ← 格子里那个
//     格子里的 `wall.up` 之所以是 true，是**脚本运行时用 `_apply_edges` 打开**的；
//     它在 `.gil` 里**存的就是 false**。⇒ **凡"运行时才变可见"的控件都不能当原型。**
//
//   ★ 最终方案（稳）：**克隆已知可见的 `face`**（头像卡那张白底就是它，`visible=true`），
//     然后**直接改写它的图片 ID** → 换来一张非白的图。
//     图片 ID 的字段路径已探明：`#505/#503/#84/#503`（见 tools/gil 的探针输出）。
//     ⇒ 这样"可见性"和"图"各自独立可控，不再受原型状态牵连。
const IMG_PATH = [505, 503, 84, 503];      // imageId 的字段路径（相对控件记录）
const BG_IMAGE_ID = Number(argOf('bgid') || 100001);
const IMG_SRC_PATH = [505, 503, 84, 502];          // imageSource 的字段路径
const REF_SRC = Number(argOf('refsrc') || 4281536672);   // wall.left(绿) 的 source 值   // 明显有颜色的素材（棋盘上的绿墙就是它）
//   ⚠️ 第一版用 100108 —— 真机截图显示它是**浅色**的，按钮看上去还是白条。

const content = g.recs.find((r) => r.name === 'content' && g.recs.some((k) => k.parentId === r.id && k.name === 'face'));
// 原型：**已知可见**的 face（`visible=true`，真机日志确认）
const protoBg = PARTS.has('bg')
  ? (argOf('proto') ? (g.byName.get(argOf('proto')) || null)
                    : (content ? g.recs.find((r) => r.parentId === content.id && r.name === 'face') : null))
  : null;
// 文字原型：`proto.text` 优先，**缺了用同类文本控件兜底** —— 208 这一版存档里没有 `proto.text`
const LP = argOf('label-proto');
const protoTxt = PARTS.has('label')
  ? (LP ? (g.byName.get(LP) || null)
        : (['proto.text', 'home.title', 'hud.title', 'label', 'home.subtitle']
            .map((n) => g.byName.get(n)).find(Boolean) || null))
  : null;
if (PARTS.has('bg') && !protoBg) { console.error('找不到底图原型（默认找 content 下的 face）'); process.exit(1); }
if (PARTS.has('label') && !protoTxt) { console.error('找不到文字原型（用 --label-proto= 指定，或存档里要有 proto.text / home.title）'); process.exit(1); }
if (protoBg) console.log('底图原型：' + (protoBg.name || '?') + ' #' + protoBg.id + '（**已知可见**，随后改写它的图片 ID）');
// ★ `--skip-existing=<基准.gil>`：基准里**已有的同名控件一律不碰**
const skipNames = new Set();
if (SKIP_GIL) {
  const sg = readGil(SKIP_GIL);
  for (const r of sg.recs) if (r.name) skipNames.add(r.name);
  console.log('--skip-existing：' + path.basename(SKIP_GIL) + ' 已有 ' + skipNames.size + ' 个名字 ⇒ 一律不碰');
}

/** 顺着字段路径找到那个字段（相对控件记录）。
 *
 *  ⚠️ 必须**逐层保留全部候选**，不能只取第一个匹配 ——
 *     一条控件记录里有**多个 `#505` 块**（状态/锚点块），
 *     而 imageId 在后面的某一块里。第一版 `find()` 只认第一个 `#505`，
 *     走到 `#84` 就断了，报"找不到 imageId 字段"。
 */
function fieldsAtPath(fields, path) {
  let level = [fields];
  for (let i = 0; i < path.length; i++) {
    const hits = [];
    for (const list of level) {
      for (const f of list) if (f.field === path[i]) hits.push(f);
    }
    if (!hits.length) return [];
    if (i === path.length - 1) return hits;
    level = hits.map((f) => f.sub).filter(Boolean);
    if (!level.length) return [];
  }
  return [];
}
if (protoBg) console.log('改名用的图片 ID → ' + BG_IMAGE_ID + '（路径 ' + IMG_PATH.map((x) => '#' + x).join('/') + '）');
if (protoTxt) console.log('文字原型：' + protoTxt.name + ' #' + protoTxt.id);


// ── 子列表：一律用 gilread 的**顶层**版 ───────────────────────────────────
// ★★★ 2026-10-07 修：原来这里用**递归** `childListPath(tray.field.sub,'')`（allowEmpty=false）
//   去"学习"字段号与插入位置。`tray` 的顶层子列表**是空的** ⇒ 递归会跳过它、钻进 `#505`
//   块里，拿到一个**嵌套字段号**当 CL_FIELD_NO，并把 CL_INDEX 算成 -1
//   ⇒ 新建的列表字段被插到**位置 0**，字段号还可能是 `#501`（控件 ID 那个字段！）。
//   ⇒ 直接用 `ensureChildListTop`：新建的 `#503` 固定插在 `#502` 之后（位置 2，与 board 同构）。
function ensureChildList(rec) { return ensureChildListTop(rec, null); }

// ── 目标：**只给「预设按钮」**加底图 ──────────────────────────────────────
// ⚠️ 第一版按"4 个状态块 + 尺寸合理"筛，结果把**格子模板的子控件**（face/x/wall.*/door.*/note）
//    和**文本框**（clue.*/ruler.*/hud.*/legend）全当成按钮了 —— 124 个里只有一半是按钮。
//    状态块数量与尺寸**区分不出控件种类**。
//    正确做法：用 `layout-plan.json` 里的 `kind`（那是 ui_controller 自己写的类型），
//    `kind == "button"` 才是按钮；`cell.*` 是运行时生成的，排除。
const planFile = path.join(ROOT, 'tools', 'sim', 'out', 'layout-plan.json');
const plan = JSON.parse(fs.readFileSync(planFile, 'utf8'));
const BUTTONS = new Set(plan.nodes.filter((n) => n.kind === 'button' && !/^cell\./.test(n.id)).map((n) => n.id));
console.log('\n规划里标记为 button 的控件：' + BUTTONS.size + ' 个（已排除运行时生成的 cell.*）');
// 按钮名字取自**规划里的 text 字段**（ui_controller 自己写的标签，例如「放置」「撤销」）
const LABEL = new Map(plan.nodes.map((n) => [n.id, n.text]));

const targets = g.recs.filter((r) => {
  if (!r.name || r.states.length !== 4) return false;
  if (!BUTTONS.has(r.name)) return false;                          // ← 只认规划里的按钮
  if (skipNames.has(r.name)) return false;                         // ★ 基准里已有 → 一条都不碰
  // ★ 幂等：按**实际要建的名字**判断。原来错用 `CHILD_NAME`（默认 'face'），而实际建的是
  //   `bg`/`label` ⇒ 那个判断永远不成立 ⇒ 重跑一次就重复挂一份。
  if (g.recs.some((k) => k.parentId === r.id
      && ((PARTS.has('bg') && k.name === 'bg') || (PARTS.has('label') && k.name === 'label')))) return false;
  const b = r.states[0];
  const p = pairOf(b, 505);
  if (!p || !p.sub) return false;
  const w = (p.sub.find((x) => x.field === 501) || {}).f;
  const h = (p.sub.find((x) => x.field === 502) || {}).f;
  if (typeof w !== 'number' || typeof h !== 'number' || w <= 0 || h <= 0) return false;
  r._w = w; r._h = h;
  return true;
});

console.log('\n要处理的按钮：' + targets.length + ' 个（挂 ' + [...PARTS].join('+') + '）');
for (const t of targets) console.log('  ' + t.name.padEnd(22) + String(t._w).padStart(6) + '×' + String(t._h).padEnd(5));

if (DRY) { console.log('\n--probe：不写文件'); process.exit(0); }
if (!targets.length) { console.log('\n无需改动'); process.exit(0); }

let nextId = g.maxId + 1;
const built = [];
let patched = 0;   // 成功改写图片 ID 的次数

/** 克隆一个原型成"某控件的子控件"：换 ID / 换父 / 换名 / 改几何 / 清子列表 / 登记 */
function makeChild(rec, srcProto, childName, w, h, posY, label) {
  const clone = cloneField(srcProto.field);
  const oldId = srcProto.id, newId = nextId++;

  let nId = 0;
  (function fix(fs2) {
    for (const f of fs2) {
      if (f.wt === 0 && Number(f.num) === oldId) { f.num = BigInt(newId); nId++; }
      else if (f.wt === 2 && f.sub === null && !f.isText && f.payload && f.payload.length >= 1 && f.payload.length <= 8) {
        const ids = asIdList(f.payload, false);
        if (ids && ids.length === 1 && ids[0] === oldId) { f.payload = writeVarint(newId); f.len = f.payload.length; nId++; }
      }
      if (f.sub) fix(f.sub);
    }
  })(clone.sub);

  let pOk = false;
  (function fixParent(fs2) {
    for (const f of fs2) {
      if (!pOk && f.wt === 0 && f.field === 504 && Number(f.num) === srcProto.parentId) { f.num = BigInt(rec.id); pOk = true; }
      if (f.sub) fixParent(f.sub);
    }
  })(clone.sub);

  // ★ 改写图片 ID（让"克隆自 face 的白图"变成非白素材）。
  //   只对底图那一次调用做 —— 用 childName === 'bg' 区分。
  if (childName === 'bg') {
    // ★★ 关键：**source 和 id 必须成对改写**！
    //
    // 真机踩坑记录（2026-09-28）：我只改了 `#84/#503`（imageId），
    //   结果**属性读出来是 100001、渲染的纹理却还是原来那张白图** ——
    //   因为渲染用的纹理来自 `#84/#502`（imageSource），它是**另一个字段**。
    //   三个已知素材的对照（从存档里读出来的真实值）：
    //       face(白)       #502=4294967295   #503=106053
    //       wall.left(绿)  #502=4281536672   #503=100001
    //       x(红)          #502=4290453793   #503=100101
    //   ⇒ 参考素材（默认 wall.left，绿色）的这两个值**一起复制过来**。
    const srcCands = fieldsAtPath(clone.sub, IMG_SRC_PATH).filter((f) => f.wt === 0);
    const srcF = srcCands[0];
    if (srcF === undefined) {
      console.error('  ❌ 底图克隆里找不到 imageSource 字段（路径 ' + IMG_SRC_PATH.join('/') + '）');
      process.exit(7);
    }
    srcF.num = BigInt(REF_SRC);

    const cands = fieldsAtPath(clone.sub, IMG_PATH).filter((f) => f.wt === 0);
    const imgF = cands.find((f) => Number(f.num) >= 100000 && Number(f.num) <= 110000) || cands[0];
    if (imgF === undefined) {
      console.error('  ❌ 底图克隆里找不到 imageId 字段（路径 ' + IMG_PATH.join('/') + '）');
      process.exit(6);
    }
    imgF.num = BigInt(BG_IMAGE_ID);
    patched++;
  }
  const nf = textsOf(clone.sub, []).find((t) => t.payload.toString('utf8') === srcProto.name);
  let nOk = false;
  if (nf) { nf.payload = Buffer.from(childName, 'utf8'); nf.len = nf.payload.length; nOk = true; }

  let geo = 0;
  for (const block of stateBlocks(clone.sub, [])) {
    if (setPair(pairOf(block, 504), 0, posY)) geo++;
    setPair(pairOf(block, 505), w, h);
  }

  // 文字内容：写进 `text` 字段（如果这个原型有的话）
  if (label !== null && label !== undefined && label !== '') {
    (function putText(fs2) {
      for (const f of fs2) {
        if (f.wt === 2 && f.isText && f.payload && f.payload.toString('utf8') !== childName
            && f.payload.toString('utf8').length <= 40 && f.len > 0) {
          // 原型里的示例文案，换成按钮标签
          f.payload = Buffer.from(tostring(label), 'utf8');
          f.len = f.payload.length;
          return;
        }
        if (f.sub) putText(f.sub);
      }
    })(clone.sub);
  }

  // ★ 2026-10-07 修：原来用**递归** findChildList(clone.sub, true) —— allowEmpty=true 时
  //   连"任何空的 wt2 字段"都算命中（含嵌套块里的）⇒ 清空的是**无关字段**，原型真正的
  //   子列表反而留着 ⇒ 副本认领原型子控件。必须只认记录顶层。
  const myChild = findChildListTop(clone.sub);
  if (myChild) setChildList(myChild, []);

  const list = ensureChildList(rec);
  const cur = asIdList(list.payload, true) || [];
  if (!cur.includes(newId)) cur.push(newId);
  setChildList(list, cur);

  if (!pOk || !nOk || geo !== 4) { console.error('  ❌ ' + rec.name + '/' + childName + ' 补丁不完整'); process.exit(3); }
  return { clone, id: newId, holder: rec.holder, index: rec.index };
}

for (const rec of targets) {
  const label = LABEL.get(rec.name) || rec.name;
  // ① 底图（非白）
  if (PARTS.has('bg')) built.push({ who: rec.name, what: 'bg', ...makeChild(rec, protoBg, 'bg', rec._w, rec._h, 0, null) });
  // ② 名字：贴在按钮中部偏下一点，宽度略窄于按钮
  if (PARTS.has('label')) built.push({ who: rec.name, what: 'label', ...makeChild(rec, protoTxt, 'label', rec._w - 8, Math.min(20, rec._h - 8), 0, label) });
}

// 插入（按 holder 分组、从后往前，索引不失效）
const byHolder = new Map();
for (const it of built) {
  if (!byHolder.has(it.holder)) byHolder.set(it.holder, []);
  byHolder.get(it.holder).push(it);
}
for (const [holder, items] of byHolder) {
  items.sort((a, b) => b.index - a.index);
  for (const it of items) holder.splice(it.index + 1, 0, it.clone);
}

const body = encodeMsg(g.tree);
const outBuf = g.pack(body);
fs.writeFileSync(OUT, outBuf);

const g2 = readGil(OUT);
console.log('\n输出：' + path.basename(OUT));
console.log('  文件 ' + outBuf.length + '（+' + (outBuf.length - g.src.length) + '）  '
  + '头 ' + [0, 4, 8, 12, 16].map((o) => outBuf.readUInt32BE(o)).join(', '));
const tr = outBuf.subarray(outBuf.length - g.trailer.length);
console.log('  尾 ' + tr.toString('hex') + (tr.equals(g.trailer) ? '  ✅' : '  ❌')
  + '   控件记录 ' + g2.recs.length + '（+' + (g2.recs.length - g.recs.length) + '）');

let bad = 0;
for (const it of built) {
  const r = g2.recs.find((x) => x.name === it.who);
  const ok = r && g2.recs.some((x) => x.parentId === r.id && x.name === it.what);
  if (!ok) { bad++; console.log('  ❌ ' + it.who + '/' + it.what); }
}
console.log('  改写图片 ID 的底图：' + patched + ' 个');
console.log('\n' + (bad === 0
  ? '★ ' + targets.length + ' 个按钮都挂上了 [' + [...PARTS].join('+') + ']，共新建子控件 ' + built.length + ' 个'
  : '❌ 有 ' + bad + ' 个不完整'));
process.exit(bad === 0 ? 0 : 4);
