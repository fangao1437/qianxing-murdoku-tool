// src/giaread.mjs —— **`.gia`（节点图导出）**的节点图层原生解码器（纯 Node，不需要 Python）
//
// ⚠️ 范围边界（别误会）：本文件只解 **`.gia` 布局**。
//    `.gia`（编辑器「导出节点图」产物）= root `#1`/`#2` 两个单元桶，桶里每个 GraphUnit 带 `#1 Id`.
//    `.gil`（整张地图存档）**不是这个布局**：root 是 1..53 个并列「段」，每个段一个子消息，
//    节点图藏在更深处（实测 `<你的存档>.gil`：`readUnits` 得到 0 个单元）。
//    ⇒ 对 `.gil` 本工具会返回 `layout: 'other'` 且 `graphs: []`，**明确说读不出来**，不假装。
//    要读 `.gil` 的节点图仍然只能走外部解码器（`read.mjs --ayaya=<仓库>` + python）。
//
// ════════════════════════════════════════════════════════════════════════════
// 为什么要这个文件
// ════════════════════════════════════════════════════════════════════════════
//
//   旧版 `read.mjs` 的节点图层**只能**走外部解码器（`--ayaya=<仓库>` + `python.exe`）：
//
//       buf → parse_gil_payload_to_graph_ir.py → index.json → ir.json → 我们的 graph.json
//
//   这有三个硬伤：
//     ① 机器上没 Python 就永远读不出图（本机 `python` 是 WindowsApps 的 Store stub，
//        跑 `python --version` 什么都不打印 ⇒ 实际不可用）；
//     ② 产物落在**外部仓库**的 `out/` 里，不是我们自己的 fixture，无法入库做回归；
//     ③ 端口语义名（哪个 pin 是「变量名」）外部解码器也给不出来 ⇒ 我们只能写 UNKNOWN。
//
//   而 `.gia` 的 wire 结构我们**已经解出来了**（本轮用 5 份官方/社区样本实测反推，
//   见 docs/official-gia-coverage.md）。⇒ 把 `.gia` 的节点图层改成**原生读**，
//   外部解码器降级为可选交叉校验（对 `.gil` 仍是唯一路）。
//
// ════════════════════════════════════════════════════════════════════════════
// 信封（`tools/gil/gilread.mjs` 同一套，[实测] 真机导入验证过）
// ════════════════════════════════════════════════════════════════════════════
//
//   offset 0,4,8,12,16 : 5 × big-endian u32；u32[16] = bodyLen
//   body   : 20 .. 20+bodyLen   —— 单个 protobuf 消息
//   trailer: 20+bodyLen .. EOF  —— 必须原样保留的尾部字节
//
//   protobuf 解析**不重写**：直接 `import { parseMsg } from './gilread.mjs'`。
//   （仓库头部自己写着「同类坑第三次发生」：12 个工具各自抄了一份 parse。这里不抄。）
//
// ════════════════════════════════════════════════════════════════════════════
// 节点图结构（全部 [实测]，证据 = 5 份样本 + 每条的实例/引脚数对得上）
// ════════════════════════════════════════════════════════════════════════════
//
//   root #1 = graph 桶的 GraphUnit × n
//   root #2 = acc   桶的 GraphUnit × n（同一个 guid 空间，会撞号 ⇒ 用「(bucket,index)」定位）
//
//   GraphUnit = {
//     #1 Id { #2 class, #3 type, #4 guid }
//     #2 相关 id × m  { #4 = id }
//     #3 name（文本）
//     #5 which —— 单元种类：9=节点图 12/14=节点单元定义 21=界面控件组 15=容器节点
//                  69=客户端脚本 1=模型 18/19=模版 7=#15 载荷（语义 UNKNOWN）
//     #13 节点图内容   （which=9）
//     #14 节点单元内容 （which=12 / 14）
//     #19 控件内容     （which=15/21）
//     #35 客户端脚本   （which=69）
//   }
//
//   节点图 which=9：#13 → #1 → #1 = inner
//     inner #1 头 { #1=10000 #2=20000|20002 #3=21001|21002 #5=<图 id> }
//     inner #2 图名（文本；有时为空 ⇒ 回退 unit #3）
//     inner #3 实例 × n          ← 节点实例
//     inner #6 组/注释 × m
//
//   实例 inner#3 = {
//     #1 序号
//     #2 类型元组 { #1=10001 #2=20000|20002 #3=22000|22001 #5=<节点类型 id> }
//     #3 同一份类型元组的副本
//     #4 引脚绑定 × k
//     #5 画布 x（float32 LE）  #6 画布 y（float32 LE）
//     #7 注释 { #1 = 文本 }
//   }
//
//   节点单元定义 which=12/14：#14 → #1 → #1 = body
//     body #4 类型引用 { #1 = 类型元组（同上）, #5 }
//     body #100 执行输入引脚 / #101 执行输出引脚 / #102 输入参数引脚 / #103 输出参数引脚
//       每个引脚 { #1 引脚名(文本) #2 ? #3 引脚序号 #4 类型/默认值 #8 引脚 id }
//     ⇒ **这就是端口语义名的来源**：旧版最头疼的 UNKNOWN 在这里被解掉了。
//
//   引脚绑定 body#4 = {
//     #1 { #1=引脚种类 #2=引脚序号(缺省 0) }     ← 本端
//     #2 同上（重复写一遍，实测两处始终一致）
//     #3 常量信封（只有常量输入才有）
//     #4 常量种类（varint；只有常量输入才有）
//     #5 { #1=对端实例序号 #2{ #1=种类 #2=序号 } #3{…同 #2} }   ← 只有连线才有
//   }
//
//   引脚种类（[实测] 与定义侧字段号严格差 99，且方向能被 5 份样本的数据流复现）：
//     1 = 执行流入 (exec_in)   2 = 执行流出 (exec_out)
//     3 = 输入参数 (data_in)   4 = 输出参数 (data_out)
//
//   ★ 一个绑定记录住在实例 A 上，说的是「A 的本端引脚 ↔ B 的对端引脚」。
//     光看记录**推不出方向**：A 的 pin 是 out 就 A→B，是 in 就 B→A。
//     旧版正是栽在这里（把源端 kind 当连线类型，7 条全报成一种），别重犯。
//
// ════════════════════════════════════════════════════════════════════════════
// 用法
// ════════════════════════════════════════════════════════════════════════════
//
//   import { readGia } from './giaread.mjs'
//   const r = readGia('assets/xxx.gia')            // 纯同步，不联网
//   const r2 = readGia('assets/xxx.gia', { catalog })   // 顺带用 nodes.json 翻中文名
//
//   退出码无关（这是库）。CLI 见 read.mjs。

import fs from 'node:fs';
import path from 'node:path';

import { parseMsg } from './gilread.mjs';

// ════════════════════════════════════════════════════════════════════════════
// 0. 常量与语义表（只写**实测**的；没测出来的明确写 UNKNOWN，不猜）
// ════════════════════════════════════════════════════════════════════════════

/** 引脚种类：数字 ↔ 名字。field = 种类 + 99（定义侧 #100..#103） */
export const PIN_KIND = Object.freeze({
  1: 'exec_in',
  2: 'exec_out',
  3: 'data_in',
  4: 'data_out',
});

export const PIN_KIND_ZH = Object.freeze({
  exec_in: '执行流入',
  exec_out: '执行流出',
  data_in: '输入参数',
  data_out: '输出参数',
});

/** which（GraphUnit 的 #5）。只标实测见到过的种类；语义能确定的写死，其余标 UNKNOWN。 */
export const UNIT_KIND = Object.freeze({
  1: '模型',
  7: 'UNKNOWN（#15 载荷，语义未解）',
  9: '节点图',
  12: '节点单元定义',
  14: '节点单元定义',
  15: '容器节点',
  18: '模版',
  19: '模版',
  21: '界面控件组',
  61: 'UNKNOWN（界面相关）',
  69: '客户端脚本',
});

// ════════════════════════════════════════════════════════════════════════════
// 1. protobuf 字段访问小工具（parseMsg 的产物是 {field, wt, num|payload|f|sub} 数组）
// ════════════════════════════════════════════════════════════════════════════

const F = (arr, n) => (arr || []).filter((f) => f.field === n);
const F1 = (arr, n) => (arr || []).find((f) => f.field === n);

/** varint 字段 */
const numOf = (arr, n) => {
  const f = F1(arr, n);
  return f && f.wt === 0 ? Number(f.num) : null;
};
/** float32 字段 */
const f32Of = (arr, n) => {
  const f = F1(arr, n);
  return f && f.wt === 5 ? f.f : null;
};
/** 文本字段（parseMsg 的 isText 判定；不是文本就返回 null） */
const textOf = (arr, n) => {
  const f = F1(arr, n);
  if (!f || f.wt !== 2 || !f.isText) return null;
  return f.payload.toString('utf8');
};
/** 子消息字段（parseMsg 的 sub；解不出来就 null） */
const subOf = (arr, n) => {
  const f = F1(arr, n);
  return f && Array.isArray(f.sub) ? f.sub : null;
};
const subsOf = (arr, n) => F(arr, n).filter((f) => Array.isArray(f.sub)).map((f) => f.sub);

/** 标量兜底：能把一个字段读成 number / string 就读，读不了 undefined（**不猜**） */
function scalarOf(f) {
  if (!f) return undefined;
  if (f.wt === 0) return Number(f.num);
  if (f.wt === 5) return f.f;
  if (f.wt === 2 && f.isText) return f.payload.toString('utf8');
  return undefined;
}

/** 把任意一段字段树拍平成 `field=value` / `field{…}` 的可读文本（调试与 fixture 用） */
export function flattenFields(fields, depth = 0) {
  const out = [];
  for (const f of fields || []) {
    const v = scalarOf(f);
    if (v !== undefined) out.push(`${f.field}=${v}`);
    else if (Array.isArray(f.sub) && depth < 6) {
      const inner = flattenFields(f.sub, depth + 1);
      // ★ 空子消息也要打出来：`104{}`（字段在、值为空）表示「取零值」，
      //   它和「字段整个不存在」在语义上是**同一件事**，但看不见就会误判成没这个字段。
      //   我第一版就是被这个坑了一下 —— 输出里没有 104，实际是 104 空消息。
      if (inner.length) out.push(`${f.field}{${inner.join(' ')}}`);
      else out.push(`${f.field}{}`);
    } else if (f.wt === 2) out.push(`${f.field}{?len${f.len}}`);
  }
  return out;
}

// ════════════════════════════════════════════════════════════════════════════
// 2. 信封与根消息
// ════════════════════════════════════════════════════════════════════════════

/**
 * 读 `.gia`/`.gil` 的信封 + 根消息。失败抛错（调用方决定怎么报）。
 * @returns {{file:string, bytes:number, headerU32:number[], bodyLen:number, trailerLen:number, root:object[]}}
 */
export function readEnvelope(filePath) {
  const buf = fs.readFileSync(filePath);
  if (buf.length < 24) throw new Error('文件太小，不是 .gia/.gil：' + buf.length + ' bytes');
  const headerU32 = [0, 4, 8, 12, 16].map((o) => buf.readUInt32BE(o));
  const bodyLen = headerU32[4];
  if (bodyLen <= 0 || 20 + bodyLen > buf.length) {
    throw new Error(`信封不自洽：bytes=${buf.length} bodyLen=${bodyLen}`);
  }
  const root = parseMsg(buf, 20, 20 + bodyLen, 0);
  if (!root) throw new Error('根消息 protobuf 解析失败（parseMsg 返回 null）');
  return {
    file: filePath,
    bytes: buf.length,
    headerU32,
    bodyLen,
    trailerLen: buf.length - 20 - bodyLen,
    root,
  };
}

// ════════════════════════════════════════════════════════════════════════════
// 3. GraphUnit 列表（两个桶，同一个 guid 空间会撞号 ⇒ 用 (bucket,index) 定位）
// ════════════════════════════════════════════════════════════════════════════

const BUCKETS = [
  ['graph', 1],
  ['acc', 2],
];

/** @returns {Array<{bucket:string,index:number,bucketField:number,guid:number|null,idClass:number|null,idType:number|null,name:string|null,which:number|null,relatedIds:number[],fields:object[]}>} */
export function readUnits(root) {
  const units = [];
  for (const [bucket, bucketField] of BUCKETS) {
    const msgs = F(root, bucketField).filter((f) => Array.isArray(f.sub));
    msgs.forEach((u, index) => {
      const s = u.sub;
      const id = subOf(s, 1) || [];
      units.push({
        bucket,
        index,
        bucketField,
        guid: numOf(id, 4),
        idClass: numOf(id, 2),
        idType: numOf(id, 3),
        name: textOf(s, 3),
        which: numOf(s, 5),
        relatedIds: subsOf(s, 2).map((r) => numOf(r, 4)).filter((v) => v != null),
        fields: s,
      });
    });
  }
  return units;
}

// ════════════════════════════════════════════════════════════════════════════
// 4. 类型元组：{ #1=10001 #2=20000|20002 #3=22000|22001 #5=<类型 id> }
// ════════════════════════════════════════════════════════════════════════════
//
//   #3=22000 ⇒ 类型 id 落在全局节点目录（nodes.json / 编辑器内置）
//   #3=22001 ⇒ 类型 id **本文件内定义**（which=12/14 的节点单元）—— 这就是「复合节点」
//
//   ⚠️ #2 的 20000 / 20002 到底是不是「服务端/客户端」**没验证出来**：实测
//      `向服务器节点图发送信号`（nodes.json 里 range=Client）是 20002，
//      但 `发送客户端脚本信号`（Client，且 nodes.json 里根本没有）却是 20000。
//      ⇒ 只原样记录两个数字，**不**给它起语义名。
export function readTypeTuple(fields) {
  if (!fields) return null;
  return {
    tag1: numOf(fields, 1),
    tag2: numOf(fields, 2), // 20000 / 20002 —— 语义 UNKNOWN
    scope: numOf(fields, 3), // 22000 = 全局目录 / 22001 = 本文件内定义
    tag4: numOf(fields, 4),
    typeId: numOf(fields, 5),
  };
}

// ════════════════════════════════════════════════════════════════════════════
// 5. 节点单元定义（which=12/14）—— 端口语义名的唯一来源
// ════════════════════════════════════════════════════════════════════════════

const PIN_FIELD = { 100: 'exec_in', 101: 'exec_out', 102: 'data_in', 103: 'data_out' };

/** 从 #14 里挖出 body；两种嵌套形态（`#14→#1→#1` 与 `#14→#1`）都见过 */
function nodeDefBody(u) {
  const g14 = subOf(u.fields, 14);
  if (!g14) return null;
  const a = subOf(g14, 1);
  if (!a) return null;
  const hasPins = (x) => F(x, 100).length + F(x, 101).length + F(x, 102).length + F(x, 103).length > 0;
  if (hasPins(a)) return a;
  const b = subOf(a, 1);
  return b && hasPins(b) ? b : a;
}

/**
 * 把所有节点单元定义抽出来。
 * @returns {Map<number, object>} guid → def
 */
export function readNodeDefs(units) {
  const defs = new Map();
  for (const u of units) {
    if (![12, 14].includes(u.which)) continue;
    const body = nodeDefBody(u);
    if (!body) continue;
    const typeRef = subOf(body, 4) || [];
    const tuple = readTypeTuple(subOf(typeRef, 1));
    const pins = { exec_in: [], exec_out: [], data_in: [], data_out: [] };
    for (const [fieldNo, kind] of Object.entries(PIN_FIELD)) {
      for (const p of subsOf(body, Number(fieldNo))) {
        pins[kind].push({
          name: textOf(p, 1),
          index: numOf(p, 3),
          pinId: numOf(p, 8),
          typeRaw: flattenFields(subOf(p, 4) || []).join(' '),
        });
      }
    }
    const guid = u.guid != null ? u.guid : tuple && tuple.typeId;
    if (guid == null) continue;
    defs.set(guid, {
      guid,
      name: u.name || textOf(body, 3) || null,
      which: u.which,
      tuple,
      pins,
      pinCount: {
        exec_in: pins.exec_in.length,
        exec_out: pins.exec_out.length,
        data_in: pins.data_in.length,
        data_out: pins.data_out.length,
      },
      /** 该定义被哪些图引用 —— 回填用，先留空 */
      referencedBy: [],
    });
  }
  return defs;
}

// ════════════════════════════════════════════════════════════════════════════
// 6. 节点图（which=9）
// ════════════════════════════════════════════════════════════════════════════

/** 图体内层：`#13 → #1 → #1`，两种嵌套都兜住 */
function graphInner(u) {
  const g13 = subOf(u.fields, 13);
  if (!g13) return null;
  const a = subOf(g13, 1);
  if (!a) return null;
  if (F(a, 3).length || F(a, 1).length || F(a, 2).length) {
    // a 本身就是 inner（有实例/头/名）
    if (F(a, 3).length) return a;
  }
  const b = subOf(a, 1);
  if (b && (F(b, 1).length || F(b, 3).length)) return b;
  return F(a, 3).length ? a : b || a;
}

// ── 常量信封解码 ──────────────────────────────────────────────────────────
//
// 实测形状（5 份样本共 2000+ 个常量，全部符合下面两条中的一条）：
//
//   A. 直接形态：`#3 = { #1=<cat> #2=1 #4=<类型描述> #<值字段>=<值> }`
//   B. 泛型包裹：`#3 = { #1=10000 #2=1 #110{ #1=<tag> #2{ #1=<cat> #4=<类型描述> #<值字段>=… } } }`
//
//   `#110.#2` 就是一个 A 形态的消息（只是没有自己的 `#2`）⇒ 剥掉壳再走同一条路径。
//
//   类型描述 `#4 = { #1=1 #100{ #1=<类型 id> … } }`，类型 id 与 nodes.json `types[].id`
//   是**同一套**（3=Int 4=Bool 5=Float 6=String 12=Vector 14=Enum 21=Prefab …）。
//   ⇒ 所以**按类型 id 决定怎么读值**，而不是按 cat 决定：实测 cat=6 既用来装 Boolean
//     也用来装 EnumItem（4101 / 1200），按 cat 分会读错。
//
//   值字段号 → 语义（实测）：
//     #101 = Id（Entity / GUID / Prefab / Config 之类的数字 id）
//     #102 = 整数（varint）      #104 = 浮点（**float32**，实测 0.1 读出来是 0.10000000149…）
//     #105 = 字符串（length-delimited）        #106 = 布尔/枚举小整数（varint）
//     #107 = 向量 `#107{ #1{ #1=x #2=y #3=z } }`
//     #109 = 列表 `#109{ #1{<元素信封>} × n }`（元素信封与 A 形态同构，递归解）

/** 从 length-delimited 字段里取字符串。两种读法都兜住（见下面注释）。 */
function textPayload(f) {
  if (!f || f.wt !== 2 || !f.payload) return null;
  // ① 正常情况：`#105 = { #1: <文本> }` 被当成消息解出来了
  if (Array.isArray(f.sub)) {
    const inner = f.sub.find((x) => x.field === 1 && x.wt === 2 && x.isText);
    if (inner) return inner.payload.toString('utf8');
    return null;
  }
  // ② parseMsg 的"这是不是文本"启发式只看控制字符：当字符串足够长时，
  //    `#105` 的 payload 是「字段键 0x0a + varint 长度 + 正文」，长度字节可能是可打印字符
  //    （例：`[玩家]检测掉线-广播信号` 正好 33 字节 ⇒ 0x21 = '!'），整段就被判成文本了。
  //    ⇒ 这里手工把 `0x0a + varint(len) + len 字节` 拆开。**不是**名字真的以 '!' 开头。
  const p = f.payload;
  if (p.length >= 2 && p[0] === 0x0a) {
    let len = 0;
    let shift = 0;
    let i = 1;
    for (;;) {
      if (i >= p.length) break;
      const b = p[i++];
      len |= (b & 0x7f) << shift;
      if ((b & 0x80) === 0) break;
      shift += 7;
      if (shift > 28) break;
    }
    if (len === 0) return '';
    if (i + len <= p.length) return p.subarray(i, i + len).toString('utf8');
  }
  return p.toString('utf8');
}

/** 一个标量值字段（wt=0 varint / wt=5 float32 / wt=2 文本）→ JS 值 */
function scalarValue(f) {
  if (!f) return undefined;
  if (f.wt === 0) return Number(f.num);
  if (f.wt === 5) return f.f;
  if (f.wt === 2) return textPayload(f);
  return undefined;
}

/** 类型描述 `#4` → 类型 id + 参数 */
function readTypeDesc(node) {
  const td = subOf(node, 4) || [];
  const idMsg = subOf(td, 100);
  return {
    typeId: idMsg ? numOf(idMsg, 1) : numOf(td, 100),
    typeParams: idMsg ? flattenFields(idMsg.sub || idMsg).filter((s) => !s.startsWith('1=')) : [],
    raw: flattenFields(td),
  };
}

const LIST_TYPE_IDS = new Set([7, 8, 9, 10, 11, 13, 15, 22, 23, 24, 26]);
const ID_TYPE_IDS = new Set([1, 2, 17, 20, 21]);

/**
 * 解一个**常量信封**（A 形态那种消息）。
 * @returns {{cat:number|null, typeId:number|null, status:string, value:any, typeName:string|null, shape:string[]}}
 */
export function decodeConstantEnvelope(raw, opts = {}) {
  if (!raw) return null;
  const shape = flattenFields(raw);
  const cat = numOf(raw, 1);

  // B 形态：剥掉 #110 的壳
  let node = raw;
  let wrapped = false;
  if (cat === 10000) {
    const w = subOf(raw, 110) || [];
    const inner = subOf(w, 2);
    if (inner) {
      node = inner;
      wrapped = true;
    }
  }
  const effCat = wrapped ? numOf(node, 1) : cat;
  const td = readTypeDesc(node);
  const out = {
    cat: effCat,
    catOuter: cat,
    wrapped,
    typeId: td.typeId,
    typeName: (opts.typesById && td.typeId != null && opts.typesById.get(td.typeId)) || null,
    typeRaw: td.raw,
    status: 'UNKNOWN',
    valueKind: null,
    value: null,
    shape,
    note: null,
  };

  // 类型 id 优先；缺类型 id 时退回 cat 猜 —— 但**必须**在 note 里写清楚是猜的
  const t = td.typeId;
  // ⚠️ 「字段在但是空消息」= 取零值（实测：`#104{}` 就是 0.0）。所以这里用 ?? 兜零。
  const pick = (f) => {
    const s = subOf(node, f);
    return s && s.length ? scalarValue(s[0]) : undefined;
  };

  if (t != null && LIST_TYPE_IDS.has(t)) {
    const listMsg = subOf(node, 109) || [];
    const items = F(listMsg, 1).map((e) => decodeConstantEnvelope(e.sub, opts));
    out.status = 'OK';
    out.valueKind = 'list';
    out.value = items.map((x) => (x ? x.value : null));
    out.items = items;
    return out;
  }
  if (t != null && ID_TYPE_IDS.has(t)) {
    const v = pick(101);
    out.status = 'OK';
    out.valueKind = 'id';
    out.value = v ?? null;
    if (v == null) out.note = '空引用（#101 缺或空）';
    return out;
  }
  if (t === 3) {
    out.status = 'OK';
    out.valueKind = 'int';
    out.value = pick(102) ?? 0;
    return out;
  }
  if (t === 5) {
    out.status = 'OK';
    out.valueKind = 'float';
    out.value = pick(104) ?? 0;
    return out;
  }
  if (t === 6) {
    out.status = 'OK';
    out.valueKind = 'str';
    out.value = pick(105) ?? '';
    return out;
  }
  if (t === 4) {
    out.status = 'OK';
    out.valueKind = 'bool';
    out.value = (pick(106) ?? 0) !== 0;
    return out;
  }
  if (t === 14) {
    out.status = 'OK';
    out.valueKind = 'enum';
    out.value = pick(106) ?? null;
    return out;
  }
  if (t === 12) {
    const v = subOf(node, 107) || [];
    const triple = subOf(v, 1) || [];
    const comp = (n) => {
      const f = F1(triple, n);
      if (!f) return 0;
      return scalarValue(f) ?? 0;
    };
    out.status = 'OK';
    out.valueKind = 'vec3';
    out.value = [comp(1), comp(2), comp(3)];
    return out;
  }
  if (t === 27) {
    out.note = '字典常量：字段布局未解 ⇒ 不译';
    return out;
  }

  // ── 没有类型 id：只能按 cat 猜，猜了就要在 note 里说 ────────────────────
  const byCat = { 1: 101, 2: 102, 4: 104, 5: 105, 6: 106, 7: 107 };
  if (effCat != null && byCat[effCat] && F(node, byCat[effCat]).length) {
    out.status = 'OK_BY_CAT';
    out.note = '缺类型 id，按常量种类 #1=' + effCat + ' 推断（证据弱，已标注）';
    const f = byCat[effCat];
    if (f === 107) {
      const triple = subOf(subOf(node, 107) || [], 1) || [];
      const comp = (n) => {
        const x = F1(triple, n);
        return x ? scalarValue(x) : 0;
      };
      out.valueKind = 'vec3';
      out.value = [comp(1) ?? 0, comp(2) ?? 0, comp(3) ?? 0];
    } else {
      out.valueKind = { 101: 'id', 102: 'int', 104: 'float', 105: 'str', 106: 'bool' }[f];
      out.value = scalarValue(F1(node, f));
    }
    return out;
  }
  return out;
}

/**
 * 兼容旧签名：从绑定记录的 `#3` 解常量。
 * @param {object} raw       常量信封字段数组
 * @param {string} [pinHint] 端口类型提示（只记下来，不参与判断；判断走类型 id）
 * @param {object} [ctx]     `{typesById}` = nodes.json 的 types 表
 */
export function decodeConstant(raw, pinHint, ctx = {}) {
  const d = decodeConstantEnvelope(raw, { typesById: (ctx && ctx.typesById) || null });
  if (!d) return null;
  return {
    ...d,
    pinTypeHint: pinHint || null,
    constKind: d.cat,
  };
}

/**
 * 读一张图（with instances / edges / comments）。
 * @param {object} u    GraphUnit（which=9）
 * @param {Map} defs    节点单元定义表（解「本文件内定义」的类型名 + 端口名）
 * @param {Map} catalog nodes.json → id → 节点条目（可选）
 */
export function readGraph(u, defs = new Map(), catalog = new Map(), ctx = {}) {
  const typesById = ctx.typesById || new Map();
  const inner = graphInner(u);
  if (!inner) return null;
  const header = subOf(inner, 1) || [];
  const instancesRaw = subsOf(inner, 3);

  const instances = instancesRaw.map((s) => {
    const tuple = readTypeTuple(subOf(s, 2)) || readTypeTuple(subOf(s, 3));
    const tid = tuple ? tuple.typeId : null;
    const localDef = tid != null ? defs.get(tid) : null;
    const cat = tid != null ? catalog.get(tid) : null;

    let resolve;
    if (localDef && tuple && tuple.scope === 22001) {
      resolve = {
        source: 'local_def',
        name: localDef.name,
        dsl: null,
        method: null,
        range: null,
        class: null,
        isComposite: true,
        pins: localDef.pins,
      };
    } else if (localDef) {
      // 定义在本地但元组说是全局目录 ⇒ 两边都记，标出来
      resolve = {
        source: 'local_def(scope≠22001)',
        name: localDef.name,
        dsl: cat ? cat.dsl : null,
        method: cat ? cat.method : null,
        range: cat ? cat.range : null,
        class: cat ? cat.class : null,
        isComposite: true,
        pins: localDef.pins,
      };
    } else if (cat) {
      resolve = {
        source: 'catalog',
        name: cat.name || cat.dsl || null,
        dsl: cat.dsl || null,
        method: cat.method || null,
        range: cat.range || null,
        class: cat.class || null,
        isComposite: false,
        pins: null,
      };
    } else {
      resolve = {
        source: 'unknown',
        name: null,
        dsl: null,
        method: null,
        range: null,
        class: null,
        isComposite: false,
        pins: null,
      };
    }

    const bindings = subsOf(s, 4).map((b) => {
      const self = subOf(b, 1) || [];
      const selfDup = subOf(b, 2) || [];
      const selfKind = numOf(self, 1);
      const selfIndex = numOf(self, 2) ?? 0;
      const link = subOf(b, 5);
      const remote = link ? subOf(link, 2) || [] : null;
      const constRaw = subOf(b, 3);
      const kindName = PIN_KIND[selfKind] || null;
      // 端口类型提示：优先用本地定义的引脚声明，其次 nodes.json
      let pinTypeHint = null;
      if (kindName && resolve.pins) {
        const arr = resolve.pins[kindName] || [];
        const hit = arr.find((p) => p.index === selfIndex) || arr[selfIndex];
        if (hit && hit.typeRaw) pinTypeHint = hit.typeRaw;
      }
      if (!pinTypeHint && cat && kindName) {
        const arr = kindName === 'data_in' ? cat.inputs : kindName === 'data_out' ? cat.outputs : [];
        const hit = (arr || [])[selfIndex];
        if (hit && hit.type) pinTypeHint = hit.type;
      }
      return {
        pin: { kind: kindName, kindInt: selfKind, index: selfIndex },
        pinDup: { kindInt: numOf(selfDup, 1), index: numOf(selfDup, 2) },
        constKind: numOf(b, 4),
        constant: constRaw ? decodeConstant(constRaw, pinTypeHint, { typesById }) : null,
        constantRaw: constRaw ? { shape: flattenFields(constRaw) } : null,
        link: link
          ? {
              node: numOf(link, 1),
              pin: { kind: PIN_KIND[numOf(remote, 1)] || null, kindInt: numOf(remote, 1), index: numOf(remote, 2) ?? 0 },
            }
          : null,
      };
    });

    return {
      index: numOf(s, 1),
      typeId: tid,
      tuple,
      resolve,
      pos: { x: f32Of(s, 5), y: f32Of(s, 6) },
      comment: textOf(subOf(s, 7) || [], 1),
      bindings,
    };
  });

  // ── 连线：方向靠「本端引脚是 out 还是 in」定，不靠记录顺序 ────────────────
  const byIndex = new Map(instances.map((n) => [n.index, n]));
  const edges = [];
  for (const n of instances) {
    for (const b of n.bindings) {
      if (!b.link || b.pin.kindInt == null || !b.pin.kind) continue;
      const other = byIndex.get(b.link.node);
      if (!other) continue;
      const category = b.pin.kind === 'exec_in' || b.pin.kind === 'exec_out' ? 'flow' : 'data';
      const selfEnd = { node: n.index, pin: b.pin.kind, index: b.pin.index };
      const otherEnd = { node: other.index, pin: b.link.pin.kind, index: b.link.pin.index };
      const selfIsOut = b.pin.kind === 'exec_out' || b.pin.kind === 'data_out';
      edges.push({
        from: selfIsOut ? selfEnd : otherEnd,
        to: selfIsOut ? otherEnd : selfEnd,
        category,
      });
    }
  }

  const comments = subsOf(inner, 6).map((g) => ({
    name: textOf(g, 1) || textOf(g, 2) || null,
    shape: flattenFields(g),
  }));

  return {
    unit: { bucket: u.bucket, index: u.index, guid: u.guid, which: u.which },
    name: textOf(inner, 2) || u.name || null,
    header: {
      tag1: numOf(header, 1),
      tag2: numOf(header, 2), // 20000 / 20002 —— 语义 UNKNOWN
      tag3: numOf(header, 3), // 21001 / 21002 —— 语义 UNKNOWN
      graphId: numOf(header, 5),
    },
    nodeCount: instances.length,
    edgeCount: edges.length,
    instances,
    edges,
    comments,
  };
}

// ════════════════════════════════════════════════════════════════════════════
// 7. 顶层入口
// ════════════════════════════════════════════════════════════════════════════

/**
 * @param {string} filePath  `.gia` 或 `.gil`
 * @param {{catalog?:object}} [opts]  catalog = nodes.json 的对象（可选）
 */
export function readGia(filePath, opts = {}) {
  const env = readEnvelope(filePath);
  const units = readUnits(env.root);
  const defs = readNodeDefs(units);

  const catalog = new Map();
  for (const n of (opts.catalog && opts.catalog.nodes) || []) catalog.set(n.id, n);
  const typesById = new Map();
  for (const t of (opts.catalog && opts.catalog.types) || []) typesById.set(t.id, t.name + '(' + t.dsl_name + ')');

  const graphs = [];
  for (const u of units) {
    if (u.which !== 9) continue;
    const g = readGraph(u, defs, catalog, { typesById });
    if (g) graphs.push(g);
  }

  // 定义被引用情况回填（复合节点 ↔ 实现图 的对照靠这个）
  const byGraphId = new Map();
  for (const g of graphs) if (g.header.graphId != null) byGraphId.set(g.header.graphId, g);
  for (const g of graphs) {
    for (const n of g.instances) {
      if (n.resolve.source.startsWith('local_def')) {
        const d = defs.get(n.typeId);
        if (d && !d.referencedBy.some((r) => r.bucket === g.unit.bucket && r.index === g.unit.index)) {
          d.referencedBy.push({ bucket: g.unit.bucket, index: g.unit.index, graphName: g.name });
        }
      }
    }
  }
  for (const [guid, d] of defs) {
    const impl = byGraphId.get(guid);
    if (impl) d.implGraph = { bucket: impl.unit.bucket, index: impl.unit.index, name: impl.name, nodes: impl.nodeCount };
  }
  // 复合节点的**实现图**自己常常没有名字（unit#3 和 inner#2 都是空），
  // 但定义单元的 guid == 图头的 graphId ⇒ 用定义名回填，报告里才看得懂在说哪张图。
  for (const g of graphs) {
    if (g.name) continue;
    const d = defs.get(g.header.graphId);
    if (d && d.name) {
      g.name = d.name;
      g.nameFrom = 'composite-def';
    }
  }

  const whichCounts = {};
  for (const u of units) whichCounts[String(u.which)] = (whichCounts[String(u.which)] || 0) + 1;

  return {
    _kind: 'qx.graphcode.gia',
    // ⚠️ 布局判定：`gia-export` 才有单元桶；`.gil`（整张地图）会得到 `other`
    layout: units.length ? 'gia-export' : 'other',
    layoutNote: units.length
      ? null
      : 'root #1/#2 里没有带 Id 的单元 ⇒ 不是 .gia 导出布局（`.gil` 整张地图就是这个形状）。本工具只解 .gia。',
    file: { path: env.file, name: path.basename(env.file), bytes: env.bytes },
    envelope: {
      headerU32: env.headerU32,
      bodyLen: env.bodyLen,
      trailerLen: env.trailerLen,
    },
    rootFields: (() => {
      const h = {};
      for (const f of env.root) h[f.field] = (h[f.field] || 0) + 1;
      return h;
    })(),
    units: {
      total: units.length,
      whichCounts,
      list: units.map((u) => ({
        bucket: u.bucket,
        index: u.index,
        guid: u.guid,
        which: u.which,
        kind: UNIT_KIND[u.which] || 'UNKNOWN',
        name: u.name,
        relatedIds: u.relatedIds,
      })),
    },
    nodeDefs: [...defs.values()],
    graphs,
    resources: collectResources(graphs),
  };
}

// ════════════════════════════════════════════════════════════════════════════
// 7b. 图里的「资源引用」：节点图变量 / 自定义信号 / 复合节点
// ════════════════════════════════════════════════════════════════════════════
//
//   这几类东西在 `.gia` 里**没有**独立的表可以读（本轮没找到；不确定就不编）。
//   能**从数据流自证**的读法是：看它们被哪个节点引用、引用的那个字符串常量是什么。
//     · 节点图变量 → 「获取节点图变量 / 设置节点图变量」的第 0 个输入参数（Str）
//     · 自定义信号 → 「监听信号 / 发送信号（含本文件内定义的同名单元）」的 Str 常量
//   这两条都是**间接**证据：节点名对得上 + 常量类型是 String + 位置是那个口
//   ⇒ 标 [实测-间接]，不标死。
const VAR_GET = new Set(['获取节点图变量', 'getNodeGraphVariable']);
const VAR_SET = new Set(['设置节点图变量', 'setNodeGraphVariable']);
const SIGNAL_NODES = /^(监听信号|发送信号|发送客户端脚本信号|向服务器节点图发送信号)$/;

export function collectResources(graphs) {
  const variables = new Map();
  const signals = new Map();
  const composites = new Map();
  const bump = (map, key, where) => {
    if (!key) return;
    if (!map.has(key)) map.set(key, { name: key, uses: [] });
    map.get(key).uses.push(where);
  };
  for (const g of graphs) {
    const where = g.name || g.unit.bucket + ':' + g.unit.index;
    for (const n of g.instances) {
      const labels = [n.resolve.name, n.resolve.dsl, n.resolve.method].filter(Boolean);
      if (n.resolve.isComposite) bump(composites, n.resolve.name, where);
      const isVar = labels.some((l) => VAR_GET.has(l) || VAR_SET.has(l));
      const isSignal = labels.some((l) => SIGNAL_NODES.test(l));
      if (!isVar && !isSignal) continue;
      for (const b of n.bindings) {
        const c = b.constant;
        if (!c || c.valueKind !== 'str' || !c.value) continue;
        if (isVar) bump(variables, c.value, where);
        else bump(signals, c.value, where);
      }
    }
  }
  return {
    variables: [...variables.values()],
    signals: [...signals.values()],
    composites: [...composites.values()],
  };
}

// ════════════════════════════════════════════════════════════════════════════
// 8. 摘要（给人看的读数：图数/节点数/连线/复合节点）
// ════════════════════════════════════════════════════════════════════════════

export function summarize(r, defs = null) {
  const defMap = new Map((defs || r.nodeDefs).map((d) => [d.guid, d]));
  const rows = r.graphs.map((g) => {
    const compositeRefs = g.instances.filter((n) => n.resolve.source.startsWith('local_def'));
    const unknown = g.instances.filter((n) => n.resolve.source === 'unknown');
    const flow = g.edges.filter((e) => e.category === 'flow').length;
    const data = g.edges.filter((e) => e.category === 'data').length;
    return {
      name: g.name,
      graphId: g.header.graphId,
      bucket: g.unit.bucket,
      unitIndex: g.unit.index,
      nodes: g.nodeCount,
      edges: g.edgeCount,
      flowEdges: flow,
      dataEdges: data,
      comments: g.comments.length,
      compositeRefs: compositeRefs.length,
      unknownNodes: unknown.length,
      compositeNames: [...new Set(compositeRefs.map((n) => n.resolve.name))],
    };
  });
  return {
    file: r.file.name,
    bytes: r.file.bytes,
    unitKinds: r.units.whichCounts,
    graphs: r.graphs.length,
    nodeDefs: r.nodeDefs.length,
    defNames: r.nodeDefs.map((d) => d.name),
    defMapSize: defMap.size,
    rows,
    totals: rows.reduce(
      (a, x) => ({
        nodes: a.nodes + x.nodes,
        edges: a.edges + x.edges,
        compositeRefs: a.compositeRefs + x.compositeRefs,
        unknownNodes: a.unknownNodes + x.unknownNodes,
      }),
      { nodes: 0, edges: 0, compositeRefs: 0, unknownNodes: 0 }
    ),
  };
}
