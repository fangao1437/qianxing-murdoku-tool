// tools/gil/gen_obj_art.mjs —— 家具「三层拼装」：给格子模板加 `obj2` / `obj3` 两层，
//                            并按 palette 写 `things/obj.<kind>`（第 1 层）的 `imageId` / `imageColor`
//
// ════════════════════════════════════════════════════════════════════════════
// 为什么需要（2026-10-22，v299 家具改多层）
// ════════════════════════════════════════════════════════════════════════════
//   原作（Murdoku）的家具是「**base 剪影 + overlay 剪影 + 两个颜色**」，官方单张素材拼不出
//   俯视扶手椅/长桌 ⇒ 一格家具不能只有一张图。于是格子模板 `cell.1.1/content` 在 `obj` 之后
//   再补两层 **`obj2` / `obj3`**（克隆 obj：135×135 / imageId=100001 / imageColor=FFFFFFFF /
//   imageType 与 obj 一致 / visible=true），由 lua（v299 的 `OBJ_LAYER_SUBS`）按层画。
//
//   ★★★ 2026-10-22 **lead 方案调整（本工具的最终口径）** ★★★
//     · `things` **只保留现有 6 个 `obj.<kind>`**（第 1 层的图/色，供**编辑器**覆盖）；
//       **不再**新增 `obj2.<kind>` / `obj3.<kind>` 控件 —— 第 2/3 层的图/色/几何是
//       脚本里的常量（`cfg.obj_art` 的 layers），**一处定义**：第 1 层给编辑器改，
//       第 2/3 层是脚本几何常量，避免两处定义、也避免再加 12 条新记录。
//     · `--palette` 因此只写现有 6 个 `things/obj.<kind>` 的 `imageId` + `imageColor`
//       （`/505/503/84/#503` 与 `/505/503/84/#502`，与 `gen_palette.mjs` 的 `imgIdsOf` 同源）。
//     · 记录数预期：**466 → 470（+4）**。
//
// ── 本工具做的两件事（**幂等**：已经加过的层不重复加；palette 值相同不写）──────────
//   ① 两份 `content`（cell.1.1 本体 + 模板层级根下那份，E6）各把 `obj` 克隆两份 ⇒ `obj2` / `obj3`，
//      插进**子控件列表** `obj` 之后：face → hint → obj → **obj2 → obj3** → x → wall.* → door.* → …
//      除 `name` / 自身 GUID / 父子引用外**字段与 `obj` 完全一致**。→ **+4 条记录**
//   ② 按 `--palette=<json>` 写 `things/obj.<kind>` 的 `imageId` + `imageColor`：
//        `{ "table": {"id":100001,"color":"0xFF4A3524"}, "chair": {"id":106053,"color":"0xFF4A3A2A"}, … }`
//        缺的 kind / null = 不动；颜色一律写 32 位整数（0xAARRGGBB）。
//
//   ★ `--palette` 也接受**内联 JSON**（值以 `{` 开头），例：
//       node tools/gil/gen_obj_art.mjs --in=494-… --out=495-… \
//            --palette='{"table":{"id":100001,"color":"0xFF4A3524"}}'
//
// ── 关键设计（每条都有踩坑依据）─────────────────────────────────────────────
//   ★ 新记录**追加到 `g.recHolder` 末尾**，不插在原型旁边。
//     理由：`diff_fields` / `writeGil` 的字段 diff 是**按位置**比的（E10）——插在中间会让
//     后面所有兄弟节点下标整体位移，基线→输出会报出成千处"假差异"，**审计就失效了**。
//     记录次序不是层级：父子关系只由 `#504` 父指针 + 父记录的子列表决定（E5）。
//     仓内先例：`gen_modal_art3.mjs`（"新记录一律 holder.push()，零下标运算"）。
//     而**子控件次序**（谁盖谁）才是必须插对地方的 ⇒ 我们改的是 `content` 的子列表 ID 数组 ✓
//   ★ 新 GUID 从 **1073746000** 起：
//     先**扫全文件**所有 id 区间 varint（含非记录引用的画布 id）取已用集合与 maxGuid，
//     再从这个高位号段顺序分配，保证**文件内唯一**；同时避开 E14 说的被编辑器占用的
//     1074000000+ 段。真机若仍报撞号 ⇒ `--guid-base=<新起点>` 一条命令换段，别改结构。
//   ★ 克隆必须**整条记录 remap 自身 GUID**（E1）：obj 记录里自身 id 出现 **8 处**
//     （`/#501`、`/#502/#11/#501`、6 处 `/#505/#503/#504/#4`）——只改顶层会让编辑器报
//     「控件 GUID 重复」。本工具克隆后把**所有**等于原型 id 的 varint 改成新 id，并断言
//     `/#502/#11/#501` == 顶层 id（让 probe_guid_collision 的 ② 也保持干净）。
//   ★ 「字段与 obj 完全一致」不靠嘴保证：克隆后做一次**规范化字段树签名比对**
//     （把"原型 id↔新 id"、"原型名↔新名"折叠成同一个标记再逐节点比），一致才继续。
//   ★ **分两段写**（两次 `writeGil`，中间文件在系统临时目录，成功即删）：
//       ① 只加结构（+4 条记录 + 2 个子列表）⇒ 断言"结构差异恰好 = 1 处记录数组条数 + 2 处子列表"；
//       ② 只写调色板 ⇒ 断言"差异恰好 = N 处叶子"（N 由实际新旧值逐字段算出来，全同则 0）。
//     一段里混做的话，`expectDiffs` 就说不清"到底改了 N 个叶子还是 N+结构"——分两段才能
//     让第二段的 `expectDiffs` **字面上就是** 调色板叶子数 ✓
//     （占位 palette 若与现值完全相同 ⇒ N=0，第二段不写、直接沿用第一段已校验的文件）
//   ★ 所有写 `.gil` 只走 `writeGil()`（自带 落盘→重读磁盘→往返闸门→字段 diff 断言）✗不自己写✗
//   ★ 写完后**原样跑仓库里的只读闸门**并打印：probe_guid_collision / roundtrip / diff_fields /
//     list_names，再回读两份 content 的子控件顺序 —— 任何一条不过就报错退出，文件留着但**别导入**。
//
// ── 用法 ───────────────────────────────────────────────────────────────────
//   node tools/gil/gen_obj_art.mjs --in=494-教程teach-v298.gil \
//        --out=495-一二关美术-obj3层.gil --palette=<palette.json> [--dry]
//
//   --palette=  调色板 JSON 文件路径（相对仓库根，或绝对路径）；也可直接给内联 JSON
//   --dry       只解析/构建/预测，不写任何 .gil，也不跑外部闸门
//   --guid-base= 新 GUID 起点（默认 1073746000；只影响新记录，不改已有号）
//
//   退出码：0 成功（含"幂等：无需改动"）；1 用法/参数错；2 基线结构不符预期；3 断言/写入失败；4 外部闸门失败
// ════════════════════════════════════════════════════════════════════════════

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  readGil, encodeMsg, cloneField, findChildListTop, setChildList, asIdList,
  stateBlocks, pairOf, pairValue, setPair, textsOf, writeVarint, ID_LO, ID_HI,
} from './gilread.mjs';
import { writeGil, loadTree, diffTrees } from './gilwrite.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const P = (p) => (path.isAbsolute(p) ? p : path.join(ROOT, p));

// ── 参数 ───────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const argOf = (k, d) => {
  const hit = argv.find((s) => s.startsWith('--' + k + '='));
  return hit ? hit.slice(k.length + 3).replace(/^"|"$/g, '') : d;
};
const hasFlag = (k) => argv.includes('--' + k);

const IN = argOf('in');
const OUT = argOf('out');
const PALETTE_ARG = argOf('palette');
const DRY = hasFlag('dry');
const GUID_BASE = Number(argOf('guid-base', '1073746000'));

const ID_LO_NUM = Number(ID_LO), ID_HI_NUM = Number(ID_HI);
const KINDS = ['table', 'plant', 'carpet', 'chair', 'shelf', 'statue'];
const NEW_LAYERS = ['obj2', 'obj3'];                 // 只加进**格子模板**（content），不进 things
const CELL = 135;                                    // 设计单位 = 画布 108（格子边长）
const BASE_IMG_ID = 100001;                          // 基础矩形占位图 id
const WHITE = 0xFFFFFFFF;                            // imageColor 白（= 不染色）

const fatal = (msg, code = 3) => { console.error('\n❌ ' + msg); process.exit(code); };
const hex32 = (v) => '0x' + (Number(v) >>> 0).toString(16).toUpperCase().padStart(8, '0');
const basenameOf = (p) => path.basename(p);

// ════════════════════════════════════════════════════════════════════════════
// 0. 调色板 JSON（只写第 1 层 things/obj.<kind>）
//   { "table": {"id":100001,"color":"0xFF4A3524"}, "chair": {"id":106053,"color":"0xFF4A3A2A"}, … }
//   缺的 kind 或值为 null ⇒ 该 kind 的图/色**不动**
// ════════════════════════════════════════════════════════════════════════════
function parseColor32(v, where) {
  if (typeof v === 'number') {
    if (!Number.isInteger(v) || v < 0 || v > 0xFFFFFFFF) throw new Error(where + '：颜色必须是 0..4294967295 的整数（0xAARRGGBB），实得 ' + v);
    return v >>> 0;
  }
  if (typeof v === 'string') {
    const s = v.trim();
    const m = /^0x([0-9a-fA-F]{8})$/.exec(s) || /^#([0-9a-fA-F]{8})$/.exec(s);
    if (!m) throw new Error(where + '：颜色要写成 "0xAARRGGBB"（8 位十六进制），实得 ' + JSON.stringify(v));
    return parseInt(m[1], 16) >>> 0;
  }
  throw new Error(where + '：颜色缺省或类型不对（要 "0xAARRGGBB" 或 32 位整数）');
}

function loadPalette(spec) {
  if (!spec) fatal('缺 --palette=<palette.json>（或内联 JSON）', 1);
  let raw;
  if (spec.trim().startsWith('{')) raw = spec;
  else {
    const file = P(spec);
    if (!fs.existsSync(file)) fatal('找不到调色板文件：' + file, 1);
    raw = fs.readFileSync(file, 'utf8');
  }
  raw = raw.replace(/^\uFEFF/, '');
  let obj;
  try { obj = JSON.parse(raw); } catch (e) { fatal('调色板 JSON 解析失败：' + e.message, 1); }
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) fatal('调色板 JSON 顶层必须是对象（kind → {id,color}）', 1);
  const map = new Map();
  for (const k of Object.keys(obj)) {
    if (!KINDS.includes(k)) fatal('调色板里不认识的 kind「' + k + '」；只允许：' + KINDS.join(', ') + '（kind 不是控件名，别写 obj.table）', 1);
    const v = obj[k];
    if (v == null) { map.set(k, null); continue; }          // null = 这个 kind 不动
    if (Array.isArray(v)) {
      fatal('palette["' + k + '"] 是数组（旧方案：写 things 的 obj2/obj3 控件）—— 该方案已取消。\n'
        + '   现在只写第 1 层：请改成对象 {"id":…, "color":"0xAARRGGBB"}；第 2/3 层由脚本 cfg.obj_art 给。', 1);
    }
    if (typeof v !== 'object') fatal('palette["' + k + '"] 必须是 {"id":…,"color":…} 或 null', 1);
    const id = Number(v.id);
    if (!Number.isInteger(id) || id < 0 || id > 0xFFFFFFFF) fatal('palette["' + k + '"].id 必须是 0..4294967295 的整数', 1);
    map.set(k, { id: id >>> 0, color: parseColor32(v.color, 'palette["' + k + '"]') });
  }
  return map;
}

// ════════════════════════════════════════════════════════════════════════════
// 1. 字段级 helper（全部按【路径/类型】取值，不按"递归第一个 #N"——同号字段陷阱）
// ════════════════════════════════════════════════════════════════════════════
function topVarint(fields, no) {
  const f = (fields || []).find((x) => x.field === no);
  return f && f.wt === 0 ? f : null;
}

/** `/505/503/84` 那个图片消息（按字段号逐层下钻；起点必须是记录自身，见 gen_palette 的 off-by-one 注释） */
function imageNodes(recField) {
  let cur = [recField];
  for (const fno of [505, 503, 84]) {
    const nxt = [];
    for (const f of cur) if (f && f.sub) for (const c of f.sub) if (c.field === fno && c.sub) nxt.push(c);
    cur = nxt;
  }
  return cur;
}

/** 读图片三元组：source=`#502` / id=`#503` / type=`#504`（都挂在 `/505/503/84` 这个节点上） */
function imageTriple(recField) {
  const nodes = imageNodes(recField);
  if (nodes.length !== 1) throw new Error('图片节点 `/505/503/84` 命中 ' + nodes.length + ' 个（预期 1）');
  const n = nodes[0];
  const leaf = (no) => n.sub.find((f) => f.field === no && f.wt === 0) || null;
  const idLeaf = leaf(503), colorLeaf = leaf(502), typeLeaf = leaf(504);
  if (!idLeaf || !colorLeaf) throw new Error('图片节点缺 #502(imageColor) 或 #503(imageId)');
  return {
    node: n,
    source: colorLeaf ? Number(colorLeaf.num) : null,
    id: Number(idLeaf.num), idLeaf,
    color: Number(colorLeaf.num), colorLeaf,
    type: typeLeaf ? Number(typeLeaf.num) : null,
  };
}

/** 4 个状态块的位置/尺寸摘要（几何只在**新**记录里改） */
function stateSummary(recField) {
  return stateBlocks(recField.sub, []).map((b) => {
    const pos = pairOf(b, 504), size = pairOf(b, 505);
    return {
      block: b, pos, size,
      x: pairValue(pos, 0), y: pairValue(pos, 1),
      w: pairValue(size, 0), h: pairValue(size, 1),
    };
  });
}

/** 可见性：`#505` 块内 `/503/14/17/503 = 1` ⇒ 存档里存的是"隐藏"；叶子缺失 ⇒ 可见（与 check_visible.mjs 同一判据） */
function isHidden(recField) {
  let hidden = false;
  for (const f of (recField.sub || [])) {
    if (f.field !== 505 || !f.sub) continue;
    (function walk(fs2, p) {
      for (const x of fs2) {
        const pp = p + '/' + x.field;
        if (x.wt === 0 && pp === '/503/14/17/503') hidden = true;
        else if (x.sub) walk(x.sub, pp);
      }
    })(f.sub, '');
  }
  return hidden;
}

function countVarintEqual(fields, val) {
  let n = 0;
  (function walk(list) {
    for (const f of list) {
      if (f.wt === 0 && Number(f.num) === val) n++;
      if (f.sub) walk(f.sub);
    }
  })(fields);
  return n;
}

/** 把克隆体里所有"等于原型 GUID"的 varint 改成自己的 GUID（E1：obj 记录里自身 id 有 8 处） */
function remapSelfIds(fields, oldId, newId) {
  let n = 0;
  (function walk(list) {
    for (const f of list) {
      if (f.wt === 0 && Number(f.num) === oldId) { f.num = BigInt(newId); n++; }
      else if (f.wt === 2 && f.sub === null && !f.isText && f.payload && f.payload.length >= 1 && f.payload.length <= 8) {
        const ids = asIdList(f.payload, false);
        if (ids && ids.length === 1 && ids[0] === oldId) { f.payload = writeVarint(newId); f.len = f.payload.length; n++; }
      }
      if (f.sub) walk(f.sub);
    }
  })(fields);
  return n;
}

/** 改控件名：记录里**恰好 1 个**短文本 == oldName 时才改（多于 1 个说明结构变了，停下） */
function renameRecord(fields, oldName, newName) {
  const hits = textsOf(fields, []).filter((t) => t.payload && t.payload.toString('utf8') === oldName);
  if (hits.length !== 1) return { ok: false, hits: hits.length };
  hits[0].payload = Buffer.from(newName, 'utf8');
  hits[0].len = hits[0].payload.length;
  return { ok: true, hits: 1 };
}

/**
 * 字段树签名：把整棵树的 (字段号, wire type, 值/子结构) 摊平成字符串数组。
 * `idSet` / `nameSet` 把"原型 id / 新 id"、"原型名 / 新名"折叠成同一个标记 ⇒ 可逐节点比对
 * "除了 name/guid 之外是否完全一致"。
 */
function sigOf(fields, { idSet = new Set(), nameSet = new Set() } = {}) {
  const enc = (f) => {
    if (f.wt === 0) return '0:' + f.field + ':' + (idSet.has(Number(f.num)) ? 'SELF' : String(f.num));
    if (f.wt === 5) return '5:' + f.field + ':' + (Object.is(f.f, -0) ? '-0' : String(f.f));
    if (f.wt === 1) return '1:' + f.field + ':' + (f.raw ? f.raw.toString('hex') : '');
    if (f.isText) {
      const s = f.payload.toString('utf8');
      return 'T:' + f.field + ':' + (nameSet.has(s) ? 'NAME' : s);
    }
    if (f.sub) return 'M:' + f.field + '(' + f.sub.map(enc).join(',') + ')';
    return 'B:' + f.field + ':' + (f.payload ? f.payload.toString('hex') : '');
  };
  return fields.map(enc);
}

/** 断言"克隆体 == obj（除 name / 自身 GUID 外逐字段一致）"——不一致就把第一处差异打印出来 */
function assertFaithful(protoFields, cloneFields, oldName, oldId, newId, newName, label) {
  const a = sigOf(protoFields, { idSet: new Set([oldId]), nameSet: new Set([oldName]) }).join('|');
  const b = sigOf(cloneFields, { idSet: new Set([newId]), nameSet: new Set([newName]) }).join('|');
  if (a === b) return true;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  fatal('[' + label + '] 克隆体与原型 ' + oldName + '#' + oldId + ' 的字段不一致（' + i + ' 字符起）：\n'
    + '   原型：…' + a.slice(Math.max(0, i - 70), i + 130) + '\n'
    + '   克隆：…' + b.slice(Math.max(0, i - 70), i + 130));
}

// ════════════════════════════════════════════════════════════════════════════
// 2. GUID 分配：扫全文件已用 id 区间 varint（不只是记录 id）→ 从高位号段顺取
// ════════════════════════════════════════════════════════════════════════════
function scanGuidUsage(tree) {
  const used = new Set();
  let maxGuid = 0;
  (function walk(fields) {
    for (const f of fields) {
      if (f.wt === 0) {
        const v = Number(f.num);
        if (v >= ID_LO_NUM && v < ID_HI_NUM) { used.add(v); if (v > maxGuid) maxGuid = v; }
      }
      if (f.sub) walk(f.sub);
    }
  })(tree);
  return { used, maxGuid };
}

// ════════════════════════════════════════════════════════════════════════════
// 3. 结构段：两份 content 各加 obj2 / obj3（克隆 obj，插在 obj 之后）
// ════════════════════════════════════════════════════════════════════════════
function buildStructural(g) {
  const re = { added: [], skipped: [], childListChanges: [], guids: [], guidBase: null };

  // ── 找两份 cell.1.1 → content → obj ──────────────────────────────────
  const cellRoots = g.recs.filter((r) => r.name === 'cell.1.1');
  if (cellRoots.length !== 2) {
    fatal('cell.1.1 记录 ' + cellRoots.length + ' 个（预期 2：本体 + 模板层级根下那份，见 E6）—— 基线不是预期形态，停止', 2);
  }
  const targets = [];
  for (const root of cellRoots) {
    const content = g.recs.find((r) => Number(r.parentId) === Number(root.id) && r.name === 'content');
    if (!content) fatal('cell.1.1 #' + root.id + ' 下找不到 content', 2);
    const obj = g.recs.find((r) => Number(r.parentId) === Number(content.id) && r.name === 'obj');
    if (!obj) fatal('content #' + content.id + ' 下找不到 obj（基线缺家具层？）', 2);
    targets.push({ root, content, obj });
  }

  // ── things 现状（本工具**不再**往 things 加东西；留作断言）────────────
  const things = g.recs.find((r) => r.name === 'things');
  if (!things) fatal('找不到 things 容器', 2);
  const thingsCl = findChildListTop(things.field.sub);
  if (!thingsCl) fatal('things #' + things.id + ' 顶层没有子控件列表', 2);
  const thingsNamesBefore = (asIdList(thingsCl.payload, true) || []).map((id) => {
    const r = g.recs.find((x) => Number(x.id) === Number(id));
    return r ? r.name : '#' + id;
  });
  const missingProtos = KINDS.filter((k) => !g.recs.some((r) => Number(r.parentId) === Number(things.id) && r.name === 'obj.' + k));
  if (missingProtos.length) fatal('things 下缺原型控件：' + missingProtos.map((k) => 'obj.' + k).join(', '), 2);

  // ── GUID 段 ─────────────────────────────────────────────────────────
  const { used, maxGuid } = scanGuidUsage(g.tree);
  if (!Number.isInteger(GUID_BASE) || GUID_BASE < 1073741824 || GUID_BASE >= ID_HI_NUM) {
    fatal('--guid-base=' + GUID_BASE + ' 不合法：必须在 [1073741824, ' + ID_HI_NUM + ') 内', 1);
  }
  if (GUID_BASE >= 1074000000) {
    console.warn('⚠️ --guid-base=' + GUID_BASE + ' 落在 1074000000+ 段 —— E14 记录该段曾被编辑器自己占用，真机可能报撞号');
  }
  let nextId = Math.max(GUID_BASE, maxGuid + 1);
  const takeId = () => {
    while (used.has(nextId)) nextId++;
    if (nextId >= ID_HI_NUM) fatal('GUID 号段耗尽（nextId=' + nextId + '）');
    const v = nextId++;
    used.add(v);
    re.guids.push(v);
    return v;
  };
  re.guidBase = Math.max(GUID_BASE, maxGuid + 1);
  console.log('  · GUID 扫描：文件内 id 区间 varint ' + used.size + ' 个，maxGuid=' + maxGuid
    + ' ⇒ 新号从 ' + re.guidBase + ' 起分配（+' + (ID_HI_NUM - re.guidBase) + ' 可用）');

  // ── 两份 content：obj → obj2 / obj3（插在子控件列表 obj 之后）───────
  for (const t of targets) {
    const cl = findChildListTop(t.content.field.sub);
    if (!cl) fatal('content #' + t.content.id + ' 顶层没有子控件列表', 2);
    const cur = (asIdList(cl.payload, true) || []).map(Number);
    if (cur.indexOf(Number(t.obj.id)) < 0) fatal('content #' + t.content.id + ' 的子列表里没有 obj #' + t.obj.id, 2);

    const layerIds = [];
    for (const layer of NEW_LAYERS) {
      const exists = g.recs.find((r) => Number(r.parentId) === Number(t.content.id) && r.name === layer);
      if (exists) {
        layerIds.push(exists.id);
        re.skipped.push('content#' + t.content.id + '/' + layer + '#' + exists.id);
        continue;
      }
      const clone = cloneField(t.obj.field);
      const nid = takeId();

      // ① id：整条记录里 8 处自身 GUID 全换（E1）
      const selfCnt = countVarintEqual(t.obj.field.sub, t.obj.id);
      const remapped = remapSelfIds(clone.sub, t.obj.id, nid);
      if (remapped !== selfCnt) fatal('克隆 content/' + layer + '：自身 GUID 替换 ' + remapped + '/' + selfCnt + ' 处');

      // ② name：obj → obj2 / obj3
      const rn = renameRecord(clone.sub, 'obj', layer);
      if (!rn.ok) fatal('克隆 content/' + layer + '：改名命中 ' + rn.hits + ' 处（预期 1）');

      // ③ 父指针：指向同一个 content
      const p504 = topVarint(clone.sub, 504);
      if (!p504) fatal('克隆 content/' + layer + '：顶层没有 #504 父指针');
      p504.num = BigInt(t.content.id);

      // ④ 断言"除 name/guid 外字段与 obj 完全一致"
      assertFaithful(t.obj.field.sub, clone.sub, 'obj', t.obj.id, nid, layer, 'content/' + layer);

      // ⑤ 任务书点名的字段逐项核对（135×135 / 100001 / FFFFFFFF / imageType / visible=true）
      const img = imageTriple(clone);
      const protoImg = imageTriple(t.obj.field);
      if (img.id !== BASE_IMG_ID) fatal(layer + ' 的 imageId=' + img.id + '（预期 ' + BASE_IMG_ID + '）');
      if (img.color !== WHITE) fatal(layer + ' 的 imageColor=' + hex32(img.color) + '（预期 0xFFFFFFFF）');
      if (img.type !== protoImg.type) fatal(layer + ' 的 imageType=' + img.type + ' ≠ obj 的 ' + protoImg.type);
      const st = stateSummary(clone);
      if (st.length !== 4) fatal(layer + ' 的状态块 ' + st.length + ' 个（预期 4）');
      for (const s of st) if (s.w !== CELL || s.h !== CELL) fatal(layer + ' 尺寸 ' + s.w + 'x' + s.h + '（预期 135x135）');
      if (isHidden(clone)) fatal(layer + ' 的初始可见性=隐藏（预期可见=true）');

      g.recHolder.push(clone);                     // ★ 只追加到记录数组末尾（E10：diff 可审计）
      layerIds.push(nid);
      re.added.push({ kind: 'cell-layer', name: layer, id: nid, parent: t.content.id, contentId: t.content.id });
    }

    // 子控件列表：obj → [obj2, obj3] → 其余（幂等：先摘掉已有的 obj2/obj3 再按序插入）
    const kept = cur.filter((id) => !layerIds.includes(id));
    const at = kept.indexOf(Number(t.obj.id));
    if (at < 0) fatal('content #' + t.content.id + '：摘掉 obj2/obj3 后找不到 obj', 2);
    const next = [...kept.slice(0, at + 1), ...layerIds, ...kept.slice(at + 1)];
    if (next.join(',') !== cur.join(',')) {
      setChildList(cl, next);
      re.childListChanges.push({ where: 'content#' + t.content.id, before: cur, after: next });
    }
  }

  re.targets = targets;
  re.things = things;
  re.thingsNamesBefore = thingsNamesBefore;
  re.expectedRecs = g.recs.length + re.added.length;
  re.expectedStructuralDiffs = (re.added.length ? 1 : 0) + re.childListChanges.length;
  return re;
}

// ════════════════════════════════════════════════════════════════════════════
// 4. 第一段写盘 + 结构断言（用 writeGil 重读磁盘的那份 g2 断言）
// ════════════════════════════════════════════════════════════════════════════
function assertStructure(g2, re) {
  const bad = [];
  const nameOf = (id) => (g2.recs.find((r) => r.id === Number(id)) || {}).name || '#' + id;

  // ① 两份 content 的子控件顺序：face,hint,obj,obj2,obj3,x,…
  for (const t of re.targets) {
    const c2 = g2.recs.find((r) => r.id === Number(t.content.id));
    if (!c2) { bad.push('重读后找不到 content#' + t.content.id); continue; }
    const cl = findChildListTop(c2.field.sub);
    if (!cl) { bad.push('content#' + t.content.id + ' 重读后没有子列表'); continue; }
    const ids = (asIdList(cl.payload, true) || []).map(Number);
    const names = ids.map(nameOf);
    const want = ['face', 'hint', 'obj', 'obj2', 'obj3'];
    if (names.slice(0, want.length).join(',') !== want.join(',')) {
      bad.push('content#' + t.content.id + ' 子控件前 ' + want.length + ' 位 = ' + names.slice(0, want.length).join(',')
        + '（预期 ' + want.join(',') + '）');
    }
    for (const layer of NEW_LAYERS) {
      const r = g2.recs.find((x) => Number(x.parentId) === Number(t.content.id) && x.name === layer);
      if (!r) { bad.push('content#' + t.content.id + ' 下缺 ' + layer); continue; }
      if (!ids.includes(Number(r.id))) bad.push(layer + ' 没登记进 content 子列表');
      const img = imageTriple(r.field);
      if (img.id !== BASE_IMG_ID) bad.push(layer + ' imageId=' + img.id + '（预期 ' + BASE_IMG_ID + '）');
      if (img.color !== WHITE) bad.push(layer + ' imageColor=' + hex32(img.color) + '（预期 0xFFFFFFFF）');
      const st = stateSummary(r.field);
      if (st.length !== 4) bad.push(layer + ' 状态块 ' + st.length + ' 个（预期 4）');
      for (const s of st) if (s.w !== CELL || s.h !== CELL) bad.push(layer + ' 尺寸 ' + s.w + 'x' + s.h + '（预期 135x135）');
      if (isHidden(r.field)) bad.push(layer + ' 初始可见性=隐藏（预期可见）');
    }
  }

  // ② things 必须**原样**：仍然只有 6 个 obj.<kind>，不许出现 obj2./obj3.（lead 2026-10-22 取消）
  const t2 = g2.recs.find((r) => r.name === 'things');
  if (!t2) bad.push('重读后找不到 things');
  else {
    const cl = findChildListTop(t2.field.sub);
    const names = cl ? (asIdList(cl.payload, true) || []).map((id) => nameOf(id)) : [];
    if (names.join(',') !== re.thingsNamesBefore.join(',')) {
      bad.push('things 子控件变了：' + names.join(',') + '（预期原样 ' + re.thingsNamesBefore.join(',') + '）');
    }
    if (names.some((n) => /^obj[23]\./.test(n))) bad.push('things 下出现了 obj2./obj3. 控件（本方案明确不加）');
  }

  // ③ 记录数 / GUID 唯一 / 自身 GUID 两处一致（E1）
  if (g2.recs.length !== re.expectedRecs) bad.push('记录数 ' + g2.recs.length + '（预期 ' + re.expectedRecs + '）');
  const tops = g2.recs.map((r) => r.id);
  if (new Set(tops).size !== tops.length) bad.push('顶层 #501 有重复：' + (tops.length - new Set(tops).size) + ' 条');
  for (const a of re.added) {
    const r = g2.recs.find((x) => x.id === Number(a.id));
    if (!r) { bad.push('重读后缺新记录 ' + a.name + '#' + a.id); continue; }
    if (Number(r.parentId) !== Number(a.parent)) bad.push(a.name + ' 的父 ' + r.parentId + '（预期 ' + a.parent + '）');
    const p502 = (r.field.sub || []).find((f) => f.field === 502 && f.sub && f.sub.some((x) => x.field === 11));
    const inner = p502 ? (p502.sub.find((x) => x.field === 11).sub || []).find((x) => x.field === 501 && x.wt === 0) : null;
    if (!inner || Number(inner.num) !== Number(a.id)) bad.push(a.name + ' 的 #502/#11/#501 ≠ 自身 GUID（E1 会报撞号）');
    if (Number(a.id) < re.guidBase) bad.push(a.name + ' 的 GUID ' + a.id + ' 不在新号段（<' + re.guidBase + '）');
  }

  if (bad.length) return '✗ 结构断言失败：\n  ' + bad.join('\n  ');
  console.log('  ✅ 结构断言：两份 content 层序 = face,hint,obj,obj2,obj3,x,…；things 保持 6 个 obj.<kind> 原样；'
    + '新记录 GUID 唯一且 #501 与 #502/#11/#501 一致');
  return true;
}

// ════════════════════════════════════════════════════════════════════════════
// 5. 调色板段：只写 things/obj.<kind>（第 1 层）的 imageId / imageColor
// ════════════════════════════════════════════════════════════════════════════
function makeResolver(g) {
  const things = g.recs.find((r) => r.name === 'things');
  if (!things) fatal('找不到 things 容器', 2);
  const map = new Map();
  for (const r of g.recs) {
    if (r.name && Number(r.parentId) === Number(things.id)) map.set(r.name, { id: r.id, field: r.field });
  }
  return (name) => map.get(name) || null;
}

/**
 * 按 palette 写叶子（**幂等**：值相同不写）。
 * @returns {Array<{recId,name,which,from,to,isExisting}>} 真正发生变化的字段（= 第二段 expectDiffs）
 */
function planPalette(resolve, paletteMap, baselineIds) {
  const changes = [];
  const put = (recId, name, which, leaf, from, to) => {
    if (from === to) return;
    leaf.num = BigInt(to >>> 0);
    changes.push({ recId, name, which, from, to, isExisting: baselineIds.has(recId) });
  };
  for (const kind of KINDS) {
    const target = paletteMap.get(kind);
    if (!target) continue;                                   // 缺的 kind 不动
    const name = 'obj.' + kind;
    const rec = resolve(name);
    if (!rec) fatal('找不到调色板控件 ' + name + '（things 下）—— 基线不完整？', 2);
    const img = imageTriple(rec.field);
    put(rec.id, name, 'imageId', img.idLeaf, img.id, target.id);
    put(rec.id, name, 'imageColor', img.colorLeaf, img.color, target.color);
  }
  return changes;
}

function assertPalette(g2, paletteMap, re) {
  const bad = [];
  const things = g2.recs.find((r) => r.name === 'things');
  if (!things) return '重读后找不到 things';
  let checked = 0;
  for (const kind of KINDS) {
    const target = paletteMap.get(kind);
    if (!target) continue;
    const name = 'obj.' + kind;
    const r = g2.recs.find((x) => Number(x.parentId) === Number(things.id) && x.name === name);
    if (!r) { bad.push('重读后缺调色板控件 ' + name); continue; }
    const img = imageTriple(r.field);
    checked += 2;
    if (img.id !== target.id) bad.push(name + ' imageId=' + img.id + '（期望 ' + target.id + '）');
    if (img.color !== target.color) bad.push(name + ' imageColor=' + hex32(img.color) + '（期望 ' + hex32(target.color) + '）');
  }
  // 结构不许被第二段动过
  if (g2.recs.length !== re.expectedRecs) bad.push('第二段改了记录数：' + g2.recs.length + '（预期 ' + re.expectedRecs + '）');
  for (const t of re.targets) {
    const c2 = g2.recs.find((r) => r.id === Number(t.content.id));
    const cl = c2 ? findChildListTop(c2.field.sub) : null;
    const names = cl ? (asIdList(cl.payload, true) || []).map((id) => ((g2.recs.find((r) => r.id === Number(id)) || {}).name || '')) : [];
    if (names.slice(0, 5).join(',') !== 'face,hint,obj,obj2,obj3') bad.push('content#' + t.content.id + ' 层序被第二段改了：' + names.slice(0, 5).join(','));
  }
  if (bad.length) return '✗ 调色板断言失败：\n  ' + bad.join('\n  ');
  console.log('  ✅ 调色板断言：' + checked + ' 个 imageId/imageColor 叶子与 palette 一致（重读磁盘核对）');
  return true;
}

// ════════════════════════════════════════════════════════════════════════════
// 6. 外部只读闸门（原样跑仓库工具，打印结果）
// ════════════════════════════════════════════════════════════════════════════
function runNode(tool, args) {
  const r = spawnSync(process.execPath, [path.join(HERE, tool), ...args], {
    cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
  });
  return { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '', error: r.error };
}

function runExternalGates(outAbs, inAbs, re, changes) {
  const results = [];
  const say = (s) => console.log(s);

  // ③ probe_guid_collision：① 真撞号 0；② 两处一致
  say('\n── ③ probe_guid_collision.mjs（GUID 撞号分类审计）──');
  const probe = runNode('probe_guid_collision.mjs', [outAbs]);
  say(probe.stdout.trim());
  const probePass = probe.status === 0
    && /① 真撞号（自身 GUID 重复）：\*\*0 处\*\*/.test(probe.stdout)
    && /✅ ② 自身 GUID 两处一致/.test(probe.stdout);
  results.push({ name: 'probe_guid_collision', pass: probePass, status: probe.status });
  say('  ⇒ ' + (probePass ? '✅ 通过：① 真撞号 0，② 自身 GUID 两处一致' : '❌ 未通过（见上面输出）'));

  // ④ roundtrip：逐字节一致
  say('\n── ④ roundtrip.mjs（解析→重编码 逐字节往返）──');
  const rt = runNode('roundtrip.mjs', [outAbs]);
  say(rt.stdout.trim());
  const rtPass = rt.status === 0 && /★★★ 往返成功/.test(rt.stdout);
  results.push({ name: 'roundtrip', pass: rtPass, status: rt.status });
  say('  ⇒ ' + (rtPass ? '✅ 通过：重新编码与原始体逐字节一致' : '❌ 未通过'));

  // ⑤ diff_fields：只允许 "声明的调色板叶子 + 结构新增"
  say('\n── ⑤ diff_fields.mjs（基线 vs 输出，按位置比）──');
  const df = runNode('diff_fields.mjs', [inAbs, outAbs]);
  say(df.stdout.trim());
  const m = /差异：(\d+) 处/.exec(df.stdout);
  const got = m ? Number(m[1]) : -1;
  const structural = re.expectedStructuralDiffs;
  const existingLeaf = changes.filter((c) => c.isExisting).length;
  const want = structural + existingLeaf;
  const recA = /记录数：A (\d+) → B (\d+)/.exec(df.stdout);
  // diff_fields 只在"记录数变了 或 差异>200"时才打印记录数那行 ⇒ 幂等复跑（+0 条）时不能要求它存在
  const recOk = recA
    ? (Number(recA[2]) === re.expectedRecs && Number(recA[1]) + re.added.length === Number(recA[2]))
    : (re.added.length === 0);
  const dfPass = got === want && recOk && (want === 0 ? df.status === 0 : df.status === 3);
  results.push({ name: 'diff_fields', pass: dfPass, status: df.status, got, want });
  say('  ⇒ ' + (dfPass ? '✅ 通过：差异 ' + got + ' 处 = 结构新增 ' + structural + ' + 已有控件调色板叶子 ' + existingLeaf
    : '❌ 未通过：差异 ' + got + ' 处，预期 ' + want + '（结构 ' + structural + ' + 已有控件调色板 ' + existingLeaf + '）'));
  say('     ★ ' + re.added.length + ' 条新记录在 diff_fields 眼里是"记录数变了"的**新增**（1 处子字段个数不同），');
  say('       不计入逐字段差异（E10）；调色板只写在**已有控件** things/obj.<kind> 上 ⇒ 那 '
    + existingLeaf + ' 处才是真正的字段值变化 ✓');

  // ⑥ list_names：6 个 obj.<kind>（things）+ 2 个 obj / obj2 / obj3（两份 content）
  say('\n── ⑥ list_names.mjs <输出> obj（名字对账）──');
  const ln = runNode('list_names.mjs', [outAbs, 'obj']);
  say(ln.stdout.trim());
  const g3 = readGil(outAbs);
  const wantNames = g3.recs.filter((r) => (r.name || '').includes('obj')).map((r) => r.name);
  const things3 = g3.recs.find((x) => x.name === 'things');
  const thingsKids = g3.recs.filter((r) => things3 && Number(r.parentId) === Number(things3.id) && /^obj[23]?\./.test(r.name || ''));
  const kind6 = thingsKids.filter((r) => /^obj\./.test(r.name)).length;
  const extraThingLayers = thingsKids.filter((r) => /^obj[23]\./.test(r.name)).length;
  const contentLayers = g3.recs.filter((r) => /^obj[23]?$/.test(r.name || '')).length;
  const lineCount = (ln.stdout.match(/^\s+\d+\s+\S+/gm) || []).length;
  const lnPass = ln.status === 0 && lineCount === wantNames.length && kind6 === 6
    && extraThingLayers === 0 && contentLayers === 6;
  results.push({ name: 'list_names', pass: lnPass, status: ln.status });
  say('  ⇒ ' + (lnPass
    ? '✅ 通过：' + lineCount + ' 个名字 = 6 个 `obj.<kind>`（things）+ 2×`obj`/`obj2`/`obj3`（两份 content 的层）'
    : '❌ 未通过：list_names 行数 ' + lineCount + '（预期 ' + wantNames.length + '），things obj.*=' + kind6
      + '，things obj2/3.*=' + extraThingLayers + '（预期 0），content 层=' + contentLayers + '（预期 6）'));

  // ⑦ 回读两份 content 的子控件顺序
  say('\n── ⑦ 回读两份 content 的子控件顺序（证明 obj2/obj3 插在 obj 之后）──');
  let orderPass = true;
  for (const t of re.targets) {
    const c2 = g3.recs.find((r) => r.id === Number(t.content.id));
    const cl = c2 ? findChildListTop(c2.field.sub) : null;
    const names = cl ? (asIdList(cl.payload, true) || []).map((id) => ((g3.recs.find((r) => r.id === Number(id)) || {}).name || '#' + id)) : [];
    const head = names.slice(0, 6);
    const ok = head.join(',') === 'face,hint,obj,obj2,obj3,x';
    if (!ok) orderPass = false;
    say('  content#' + t.content.id + '（cell.1.1#' + t.root.id + '）→ ' + names.join(' , '));
    say('    ' + (ok ? '✅' : '❌') + ' 前 6 位 = ' + head.join(',') + '（预期 face,hint,obj,obj2,obj3,x）');
  }
  results.push({ name: 'childlist-order', pass: orderPass, status: 0 });

  return results;
}

// ════════════════════════════════════════════════════════════════════════════
// main
// ════════════════════════════════════════════════════════════════════════════
function main() {
  if (!IN || !OUT) {
    console.error('用法: node tools/gil/gen_obj_art.mjs --in=<存档.gil> --out=<输出.gil> --palette=<palette.json> [--dry]');
    console.error('     可选: --guid-base=1073746000');
    process.exit(1);
  }

  const paletteMap = loadPalette(PALETTE_ARG);
  const inAbs = P(IN), outAbs = P(OUT);
  if (!fs.existsSync(inAbs)) fatal('找不到输入存档：' + inAbs, 1);

  // ── 调色板摘要 ───────────────────────────────────────────────────────
  console.log('══ gen_obj_art —— 家具三层模板（obj / obj2 / obj3）══');
  console.log('  输入 ' + basenameOf(inAbs) + '\n  输出 ' + basenameOf(outAbs) + '（' + (DRY ? '--dry 只预测不写' : '写') + '）');
  console.log('  调色板只写第 1 层 `things/obj.<kind>`（第 2/3 层图/色/几何由脚本 cfg.obj_art 给，不进 things）');
  const provided = [];
  for (const kind of KINDS) {
    const e = paletteMap.get(kind);
    if (e) provided.push(kind);
    console.log('   ' + kind.padEnd(7) + (e ? 'id=' + e.id + '  color=' + hex32(e.color) : '（未提供 ⇒ 不动）'));
  }

  // ── 读基线 ───────────────────────────────────────────────────────────
  const g = readGil(inAbs);
  const baselineIds = new Set(g.recs.map((r) => Number(r.id)));
  console.log('\n  基线 ' + basenameOf(inAbs) + '：' + g.src.length + ' 字节，记录 ' + g.recs.length + ' 条，maxId=' + g.maxId);

  // ── 结构段（①）─────────────────────────────────────────────────────
  console.log('\n── ① 结构：两份 content 各加 obj2 / obj3（克隆 obj，插在 obj 之后）──');
  const re = buildStructural(g);
  console.log('  新增记录 ' + re.added.length + ' 条：');
  for (const a of re.added) console.log('    ' + ('#' + a.id).padEnd(13) + a.name.padEnd(6) + ' 父=content#' + a.parent);
  if (re.skipped.length) console.log('  （已存在、本次跳过 ' + re.skipped.length + ' 条：' + re.skipped.join(', ') + '）');
  console.log('  记录数：' + g.recs.length + ' → ' + re.expectedRecs + '（+' + re.added.length + '）');
  console.log('  子列表改动 ' + re.childListChanges.length + ' 处；第一段预计字段差异 ' + re.expectedStructuralDiffs + ' 处'
    + '（1 处记录数组条数 + ' + re.childListChanges.length + ' 处子列表 payload；新记录字段算"新增"不算差异）');

  let tmpFile = null;
  let midSrc = inAbs;
  try {
    if (re.added.length > 0 && !DRY) {
      tmpFile = path.join(os.tmpdir(), 'gen_obj_art_' + process.pid + '_' + Date.now() + '.gil');
      writeGil(g, tmpFile, {
        label: 'gen_obj_art ① 结构：两份 content 加 obj2/obj3',
        expectRecs: re.expectedRecs,
        expectDiffs: re.expectedStructuralDiffs,
        assert: (g2) => assertStructure(g2, re),
      });
      midSrc = tmpFile;
    }

    // ── 调色板段（②）─────────────────────────────────────────────────
    console.log('\n── ② 调色板：按 palette 写第 1 层 things/obj.<kind> 的 imageId / imageColor ──');
    const gB = readGil(midSrc);
    const resolve = makeResolver(gB);
    const changes = planPalette(resolve, paletteMap, baselineIds);
    if (changes.length === 0) {
      console.log('  （palette 里提供的每一层都与现值相同 ⇒ 无需写字段）');
    } else {
      console.log('  实际发生变化 ' + changes.length + ' 处：');
      for (const c of changes) {
        const from = c.which === 'imageColor' ? hex32(c.from) : c.from;
        const to = c.which === 'imageColor' ? hex32(c.to) : c.to;
        console.log('    ' + c.name.padEnd(13) + c.which.padEnd(11) + String(from).padStart(12) + ' → ' + String(to).padStart(12));
      }
    }
    const expectedLeafDiffs = changes.length;

    if (DRY) {
      const buf = g.pack(encodeMsg(g.tree));
      const structural = re.expectedStructuralDiffs;
      const existingLeaf = changes.filter((c) => c.isExisting).length;
      console.log('\n[--dry] 不写任何文件。预测：');
      console.log('  输出记录 ' + g.recs.length + ' → ' + re.expectedRecs + '（+' + re.added.length + '）');
      console.log('  输出字节 ' + g.src.length + ' → ' + buf.length + '（+' + (buf.length - g.src.length) + '）');
      console.log('  第一段 expectDiffs（结构）      = ' + structural);
      console.log('  第二段 expectDiffs（调色板叶子）= ' + expectedLeafDiffs
        + '（提供 ' + provided.length + ' 个 kind × 2 字段中真正变化的）');
      console.log('  diff_fields 基线→输出          = ' + (structural + existingLeaf)
        + '（结构 ' + structural + ' + 已有控件调色板 ' + existingLeaf + '）');
      return 0;
    }

    // ── 第二段落盘 ───────────────────────────────────────────────────
    let finalBytes = 0, finalRecs = 0;
    if (changes.length > 0) {
      const rep = writeGil(gB, outAbs, {
        label: 'gen_obj_art ② 按 palette 写第 1 层 imageId/imageColor',
        expectRecs: re.expectedRecs,
        expectDiffs: expectedLeafDiffs,
        assert: (g2) => assertPalette(g2, paletteMap, re),
      });
      finalBytes = rep.bytes;
      finalRecs = rep.recs;
    } else {
      if (path.resolve(midSrc) !== path.resolve(outAbs)) fs.copyFileSync(midSrc, outAbs);
      finalBytes = fs.statSync(outAbs).size;
      finalRecs = re.expectedRecs;
      console.log('  （无调色板改动 ⇒ 输出直接沿用第一段 writeGil 已校验的文件）');
    }

    // ── ③~⑦ 外部闸门 ─────────────────────────────────────────────────
    const results = runExternalGates(outAbs, inAbs, re, changes);

    // ── 摘要 ─────────────────────────────────────────────────────────
    const allPass = results.every((r) => r.pass);
    console.log('\n════════════════ 交付摘要 ════════════════');
    console.log('  输出：' + OUT + '（' + finalBytes + ' 字节，记录 ' + finalRecs + ' 条）');
    console.log('  记录数：' + g.recs.length + ' → ' + finalRecs + '（+' + (finalRecs - g.recs.length) + '）'
      + (finalRecs === re.expectedRecs ? ' ✅' : ' ❌'));
    console.log('  新增：' + re.added.length + ' 条（' + re.added.map((a) => a.name + '#' + a.id).join(', ') + '）');
    console.log('  GUID 号段：' + re.guidBase + '–' + (re.guidBase + re.added.length - 1)
      + '（文件内唯一，已扫全档已用集合）');
    console.log('  调色板：提供 ' + provided.length + ' 个 kind ⇒ 实际写 ' + expectedLeafDiffs + ' 个叶子'
      + (expectedLeafDiffs === 0 ? '（占位值与现值相同）' : ''));
    console.log('  闸门：' + results.map((r) => r.name + ' ' + (r.pass ? '✅' : '❌')).join('  '));
    if (!allPass) {
      console.error('\n❌ 外部闸门未全过 —— 文件已写出但**不要导入**；先按上面输出排查。');
      return 4;
    }
    console.log('  ★ 全部通过。导入用：' + OUT);
    if (re.skipped.length) console.log('  ℹ️ 本次为幂等复跑：' + re.skipped.length + ' 个已存在的层被跳过');
    return 0;
  } finally {
    if (tmpFile && fs.existsSync(tmpFile)) { try { fs.unlinkSync(tmpFile); } catch { /* 留垃圾也不影响结果 */ } }
  }
}

process.exit(main());
