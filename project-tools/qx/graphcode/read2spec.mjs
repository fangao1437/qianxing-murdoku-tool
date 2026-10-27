// tools/qx/graphcode/read2spec.mjs —— 解码出来的图 → `emit.mjs` 能吃的 behavior-spec
//
// ════════════════════════════════════════════════════════════════════════════
// 它在这个链路里的位置
// ════════════════════════════════════════════════════════════════════════════
//
//   .gia ──giaread.mjs──▶ 图(节点/连线/常量/端口名) ──read2spec.mjs──▶ spec.json
//                                                          │
//                                                          ├─ emit.mjs --target=gts ─▶ .ts
//                                                          └─ gts-build.mjs         ─▶ .gia（回编译验证）
//
//   ★ 本工具的**核心职责不是「尽量翻译」，而是「说清楚哪里不能翻译」**。
//     读得出 ≠ 译得出：读回来一个 31 节点的图，只要有 1 个节点在 nodes.json 里没有
//     TS 方法名、或者用了复合节点、或者常量是枚举却没映射，生成的 TS 就是**残的**，
//     而残的 TS 有时还能 compile 过 —— 那就是最坏的结果（静默错误）。
//     ⇒ 所以默认 **strict**：有任何 blocker 就 exit 2，不产出 spec。
//
// ════════════════════════════════════════════════════════════════════════════
// blocker 分类（对外就是「翻译算法的实测边界」）
// ════════════════════════════════════════════════════════════════════════════
//
//   NO_TRIGGER_ROOT      图里没有任何触发器 ⇒ 生成不出 handlers[]
//   NOT_IN_CATALOG       节点类型 id 既不在 nodes.json、也不在本文件内定义
//   COMPOSITE_NODE       节点是**本文件内定义**的复合节点（type 元组 scope=22001）
//   NO_DSL_NAME          节点在 nodes.json 里有英文名但没中文名
//   NO_METHOD            节点在 nodes.json 里有名字但没 TS 方法名（→ 可用 node-aliases.json 补）
//   GRAPH_TYPE_UNKNOWN   推断不出 server / client（含 Client 节点与 Server 节点混用）
//   CROSS_HANDLER_REF    数据引用跨越了两个触发器处理器（emit 的 spec 表达不了）
//   MISSING_ARG          某节点的输入参数没有连线也没有常量，且在 arity 范围内
//   ENUM_CONSTANT        常量是枚举项，gts 需要枚举成员而不是数字
//   LIST_CONSTANT        常量是非空列表，gts 列表字面量的写法未验证
//   DICT_CONSTANT        常量是字典，字段布局未解
//   UNKNOWN_CONSTANT     常量解不出来
//   CYCLE                节点依赖成环（包括「回路」被当成前向边的情况）
//   TRIGGER_PAYLOAD      触发器的出参名对不上 nodes.json events[].payload
//
// ════════════════════════════════════════════════════════════════════════════
// 用法
// ════════════════════════════════════════════════════════════════════════════
//
//   node tools/qx/graphcode/read2spec.mjs --gia=<x.gia> [--graph=<graphId|名字子串>]
//        [--outdir=tools/qx/graphcode/out] [--json] [--allow-zero-defaults]
//
//   退出码：0 = 产出 spec（无 blocker）；2 = 有 blocker（报告照打，spec 不写）

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { readGia } from './giaread.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

export const BLOCKERS = {
  NO_TRIGGER_ROOT: '图里没有触发器，生成不出 handlers[]',
  NOT_IN_CATALOG: '节点类型 id 不在 nodes.json、也不在本文件内定义',
  COMPOSITE_NODE: '节点是本文件内定义的复合节点',
  NO_DSL_NAME: '节点有英文名但没有中文 DSL 名',
  NO_METHOD: '节点没有 gts TS 方法名（可用 node-aliases.json 补）',
  GRAPH_TYPE_UNKNOWN: '推断不出 server/client',
  CROSS_HANDLER_REF: '数据引用跨越了两个触发器处理器',
  UPSTREAM_FAILED: '它依赖的上游节点本身就译不出来',
  MULTI_OUT_PIN: '取了多出参节点的第 N 个出参，但没有 out_fields 映射（属性名未知）',
  CONTROL_FLOW_NODE: '分支/循环节点：gts 的 API 是回调式的，顺序调用模型表达不了',
  MISSING_ARG: '输入参数既没连线也没常量',
  ENUM_CONSTANT: '常量是枚举项，gts 需要枚举成员',
  LIST_CONSTANT: '常量是非空列表，gts 列表字面量写法未验证',
  DICT_CONSTANT: '常量是字典，布局未解',
  UNKNOWN_CONSTANT: '常量解不出来',
  CYCLE: '节点依赖成环',
  TRIGGER_PAYLOAD: '触发器出参名对不上 nodes.json events[].payload',
};

// ── 零值兜底（只在 --allow-zero-defaults 时用；类型 → 字面量） ────────────
function zeroFor(typeExpr) {
  if (!typeExpr) return null;
  if (typeExpr === 'Int') return { $int: 0 };
  if (typeExpr === 'Flt') return 0;
  if (typeExpr === 'Bol') return false;
  if (typeExpr === 'Str') return '';
  if (typeExpr === 'Vec') return [0, 0, 0];
  return null;
}

const ident = /^[\p{Script=Han}A-Za-z_][\p{Script=Han}A-Za-z0-9_]*$/u;

/** 分支/循环类节点：顺序调用模型表达不了（只警告，不拦） */
const CONTROL_FLOW_RE = /双分支|多分支|遍历|循环|随机执行一个节点/;

/**
 * 把一个解出来的图翻成 emit spec。
 * @param {object} graph      giaread.readGraph 的产物
 * @param {object} catalog    nodes.json
 * @param {object} [opts]
 * @param {Map} [opts.aliases] type_id → {gts_method}
 * @param {boolean} [opts.allowZeroDefaults]
 */
export function graphToSpec(graph, catalog, opts = {}) {
  const aliases = opts.aliases || new Map();
  const outFields = opts.outFields || new Map();
  const ctx = { ...opts, aliases, outFields };
  const byDsl = new Map();
  const byId = new Map();
  const eventsByZh = new Map();
  const eventsByMethod = new Map();
  for (const n of (catalog && catalog.nodes) || []) {
    byId.set(n.id, n);
    if (n.dsl) byDsl.set(n.dsl, n);
  }
  for (const e of (catalog && catalog.events) || []) {
    if (e.zh) eventsByZh.set(e.zh, e);
    if (e.method) eventsByMethod.set(e.method, e);
  }

  const blockers = [];
  const notes = [];
  const warnings = [];
  const block = (category, where, detail) => blockers.push({ category, where, detail: detail || BLOCKERS[category] });

  // ── 1. 每个实例的「可译性」 ─────────────────────────────────────────────
  const info = new Map(); // nodeIndex → { node, cat, dsl, method, source }
  for (const n of graph.instances) {
    const src = n.resolve.source;
    if (src.startsWith('local_def')) {
      block('COMPOSITE_NODE', `#${n.index}`, `"${n.resolve.name}"（本文件内定义，scope=${n.tuple && n.tuple.scope}）`);
      info.set(n.index, { node: n, ok: false });
      continue;
    }
    if (src === 'unknown') {
      block('NOT_IN_CATALOG', `#${n.index}`, `type_id=${n.typeId}`);
      info.set(n.index, { node: n, ok: false });
      continue;
    }
    const cat = byId.get(n.typeId) || null;
    const alias = aliases.get(n.typeId) || null;
    const method = (cat && cat.method) || (alias && alias.gts_method) || null;
    const dsl = (cat && cat.dsl) || (alias && alias.zh) || null;
    if (!cat) block('NOT_IN_CATALOG', `#${n.index}`, `type_id=${n.typeId}`);
    else if (!dsl) block('NO_DSL_NAME', `#${n.index}`, `type_id=${n.typeId} name="${cat.name}"`);
    if (!method) block('NO_METHOD', `#${n.index}`, `type_id=${n.typeId} name="${(cat && cat.name) || n.resolve.name}"`);
    info.set(n.index, { node: n, cat, method, dsl, ok: !!(cat && method && dsl), usedAlias: !!alias && !(cat && cat.method) });
  }

  // ── 2. 触发器根 ─────────────────────────────────────────────────────────
  const triggers = graph.instances.filter((n) => {
    const i = info.get(n.index);
    return i && i.ok && i.cat && i.cat.class === 'Trigger';
  });
  if (!triggers.length) block('NO_TRIGGER_ROOT', '(graph)', `图 "${graph.name}" 里 class=Trigger 的节点 0 个`);

  // ── 3. 图类型 ───────────────────────────────────────────────────────────
  const ranges = new Set(graph.instances.map((n) => {
    const i = info.get(n.index);
    return (i && i.cat && i.cat.range) || null;
  }).filter(Boolean));
  let graphType = null;
  if (ranges.size === 1 && ranges.has('Server')) graphType = 'server';
  else if (ranges.size === 1 && ranges.has('Client')) graphType = 'client';
  else block('GRAPH_TYPE_UNKNOWN', '(graph)', '实例 range 集合 = ' + JSON.stringify([...ranges]));

  // ── 4. 每个触发器 → 一个 handler ────────────────────────────────────────
  const handlers = [];
  const owner = new Map(); // nodeIndex → handler 序号（-1 = 无主）
  const dataDeps = new Map(); // nodeIndex → Set(nodeIndex) 它依赖的数据来源
  const flowSucc = new Map();
  for (const n of graph.instances) {
    dataDeps.set(n.index, new Set());
    flowSucc.set(n.index, []);
  }
  for (const e of graph.edges) {
    if (e.category === 'data') dataDeps.get(e.to.node).add(e.from.node);
    else flowSucc.get(e.from.node).push(e.to.node);
  }

  for (const [hi, trg] of triggers.entries()) {
    const ti = info.get(trg.index);
    const ev = eventsByZh.get(ti.dsl) || eventsByMethod.get(ti.method) || null;
    if (!ev) {
      block('TRIGGER_PAYLOAD', `#${trg.index}`, `事件 "${ti.dsl}" 不在 nodes.json events 里`);
      continue;
    }
    // 事件出参：按触发器 data_out 引脚顺序，用 nodes.json 该 Trigger 的 outputs 名字
    const outNames = (ti.cat.outputs || []).map((p) => p.name);
    const payloadZh = (ev.payload || []).map((p) => p.zh);
    const params = [];
    const dupNames = [];
    for (const nm of outNames) {
      if (nm && payloadZh.includes(nm)) {
        // ⚠️ nodes.json 里同一事件可能有两个同名的出参（例：角色移动速度达到条件时 的
        //    「条件」同时是 E<1> 和 Flt）。emit 会把每个 param 写成一条 `const`，
        //    重名直接是 TS 语法错误 ⇒ 只保留第一次出现，后面的记进 dupNames。
        if (params.includes(nm)) dupNames.push(nm);
        else params.push(nm);
      } else if (nm) {
        block('TRIGGER_PAYLOAD', `#${trg.index}`, `出参 "${nm}" 不在事件 "${ti.dsl}" 的 payload 里（可用：${payloadZh.join(' / ')}）`);
        params.push(null);
      }
    }
    if (dupNames.length) {
      warnings.push(
        `事件 "${ti.dsl}" 有重名出参 [${[...new Set(dupNames)].join(', ')}]，只保留了第一次出现的那个；` +
          '如果图里引用的正是被丢掉的那个，会报 TRIGGER_PAYLOAD'
      );
    }

    // 收集本 handler 的节点集合：exec 前向可达 ∪ 这些节点的数据前向祖先
    const set = new Set([trg.index]);
    const stack = [trg.index];
    while (stack.length) {
      const cur = stack.pop();
      for (const nx of flowSucc.get(cur) || []) {
        if (!set.has(nx)) {
          set.add(nx);
          stack.push(nx);
        }
      }
    }
    // 数据祖先闭包
    let grew = true;
    while (grew) {
      grew = false;
      for (const idx of [...set]) {
        for (const dep of dataDeps.get(idx) || []) {
          if (!set.has(dep)) {
            set.add(dep);
            grew = true;
          }
        }
      }
    }
    for (const idx of set) {
      if (owner.has(idx) && owner.get(idx) !== hi) {
        block('CROSS_HANDLER_REF', `#${idx}`, `节点同时属于 handlers[${owner.get(idx)}] 与 handlers[${hi}]`);
      } else owner.set(idx, hi);
    }
    handlers.push({ seq: hi, trigger: trg, ti, ev, params, nodes: set });
  }

  // ── 5. 每个 handler 内部拓扑序 + 变量名 + args ──────────────────────────
  const specs = [];
  for (const h of handlers) {
    const order = topoSort(h.nodes, graph, dataDeps, flowSucc, h.trigger.index, block);
    if (!order) continue;
    const varName = new Map(); // nodeIndex → `const` 名
    const body = [];
    for (const idx of order) {
      const n = graph.instances.find((x) => x.index === idx);
      const i = info.get(idx);
      if (!n || !i || !i.ok) continue; // 已经记过 blocker
      // ★ 触发器本身**不是**一次节点调用：它就是 handler 的入口（`.on(event, …)`）。
      //   把它写进 body 会变成 `f.角色移动速度达到条件时()` —— 编不过，也没意义。
      if (i.cat && i.cat.class === 'Trigger') continue;
      const argList = buildArgs(n, i, varName, h, graph, info, block, ctx);
      if (argList === null) continue;
      // 是否有人要用它的输出
      const consumers = graph.edges.filter((e) => e.category === 'data' && e.from.node === idx).length;
      const needOut = consumers > 0;
      const out = needOut ? 'v_' + idx : undefined;
      if (out) varName.set(idx, out);
      // ⚠️ gts 的分支/循环节点是**回调式** API（`doubleBranch(cond, onTrue, onFalse)`），
      //    而 emit 的 spec 是对平铺调用的顺序列表 —— 给不出回调 ⇒ 生成物在 gts **IR 生成阶段**
      //    会直接抛 `TypeError: fn is not a function`（实测，不是猜）。
      //    ⇒ 默认**拒绝生成**；想看这条边界长什么样，加 --treat-branch-as-linear（降级为警告）。
      if (CONTROL_FLOW_RE.test(i.dsl || '')) {
        if (!opts.treatBranchAsLinear) {
          block('CONTROL_FLOW_NODE', `#${idx}`, `"${i.dsl}" 是分支/循环节点：gts 的 API 要回调，顺序调用模型表达不了`);
          continue;
        }
        warnings.push(`#${idx} "${i.dsl}" 是分支/循环节点：已按 --treat-branch-as-linear 降级为顺序调用，**语义不等价且 IR 生成可能失败**`);
      }
      body.push({
        ...(out ? { out } : {}),
        node: i.dsl,
        _nodeIndex: idx,
        _method: i.method,
        args: argList,
      });
    }
    specs.push({ event: h.ti.dsl, params: h.params.filter(Boolean), body });
  }

  const specName = sanitizeName(graph.name || ('图' + graph.header.graphId));
  const spec = {
    graph_id: graph.header.graphId,
    graph_name: specName,
    graph_type: graphType,
    handlers: specs.map((s) => ({ event: s.event, params: s.params, body: s.body })),
  };
  // 去掉内部字段（emit 不认，但留着便于人看；这里删掉保证 spec 干净）
  for (const h of spec.handlers) for (const c of h.body) {
    delete c._nodeIndex;
    delete c._method;
  }

  const report = {
    _kind: 'qx.graphcode.translate-report',
    graph: { name: graph.name, graphId: graph.header.graphId, unit: graph.unit },
    graph_type: graphType,
    nodes: graph.nodeCount,
    edges: graph.edgeCount,
    translatable: blockers.length === 0,
    handlers: handlers.length,
    blockers,
    notes,
    warnings,
    semantic_equivalence: blockers.length === 0 && warnings.length === 0
      ? '✅ 无已知语义退化'
      : '⚠️ 只保证「能生成 + 能编译」。emit 的 spec 是顺序调用模型，分支/循环/枚举/重名出参都会让**语义**退化，见 warnings。',
    used_aliases: [...info.entries()]
      .filter(([, v]) => v.usedAlias)
      .map(([k, v]) => ({ nodeIndex: k, typeId: v.node.typeId, dsl: v.dsl, method: v.method })),
  };
  return { spec, report };
}

function sanitizeName(s) {
  let t = String(s).replace(/[^\p{Script=Han}A-Za-z0-9_]/gu, '_');
  if (!/^[\p{Script=Han}A-Za-z_]/u.test(t)) t = 'G' + t;
  return t;
}

/** 拓扑序：优先走 flow 后继，其次按实例序号；成环就报 CYCLE 并返回 null */
function topoSort(nodeSet, graph, dataDeps, flowSucc, rootIndex, block) {
  const deps = new Map();
  for (const idx of nodeSet) {
    const d = new Set();
    for (const dep of dataDeps.get(idx) || []) if (nodeSet.has(dep)) d.add(dep);
    // 执行流也是前向依赖：A -flow→ B 表示 A 先
    for (const idx2 of nodeSet) {
      if ((flowSucc.get(idx2) || []).includes(idx)) d.add(idx2);
    }
    deps.set(idx, d);
  }
  const out = [];
  const done = new Set();
  const pending = new Set(nodeSet);
  while (pending.size) {
    const ready = [...pending].filter((i) => [...deps.get(i)].every((d) => done.has(d)));
    if (!ready.length) {
      block('CYCLE', '(handler)', '剩下 ' + [...pending].join(',') + ' 互相依赖');
      return null;
    }
    // 偏好：触发器最先；其余按 flow 后继声明顺序，最后按序号
    ready.sort((a, b) => {
      if (a === rootIndex) return -1;
      if (b === rootIndex) return 1;
      const fa = (flowSucc.get(a) || []).length;
      const fb = (flowSucc.get(b) || []).length;
      if (fa !== fb) return fb - fa;
      return a - b;
    });
    const pick = ready[0];
    out.push(pick);
    done.add(pick);
    pending.delete(pick);
  }
  return out;
}

/** 组装一次节点调用的位置参数 */
function buildArgs(n, i, varName, h, graph, info, block, opts) {
  const cat = i.cat;
  const ports = cat.inputs || [];
  const bound = new Map();
  for (const b of n.bindings) {
    if (b.pin.kind !== 'data_in') continue;
    if (b.link) bound.set(b.pin.index, { ref: b.link });
    else if (b.constant) bound.set(b.pin.index, { const: b.constant });
  }
  const maxIdx = bound.size ? Math.max(...bound.keys()) : -1;
  // arity：用 nodes.json 声明的入参个数；binding 超出声明也算
  const arity = Math.max(ports.length, maxIdx + 1);
  const args = [];
  for (let k = 0; k < arity; k++) {
    const slot = bound.get(k);
    const portName = (ports[k] && ports[k].name) || '#' + k;
    if (!slot) {
      const z = zeroFor((ports[k] && ports[k].type) || null);
      if (z !== null && opts.allowZeroDefaults) {
        args.push(z);
        continue;
      }
      // 尾部没有声明的多余引脚（ports 短于 arity）→ 直接截断，不补
      if (k >= ports.length) break;
      block('MISSING_ARG', `#${n.index}.data_in[${k}]`, `端口 "${portName}"（${(ports[k] && ports[k].type) || '?'}）没有连线也没有常量`);
      return null;
    }
    if (slot.ref) {
      const src = slot.ref.node;
      const srcInfo = info.get(src);
      const refPinIndex = slot.ref.pin.index;
      // 触发器出参 → 形参名
      if (srcInfo && srcInfo.cat && srcInfo.cat.class === 'Trigger' && src === h.trigger.index) {
        const nm = (srcInfo.cat.outputs || [])[refPinIndex] || {};
        if (nm.name && h.params.includes(nm.name)) {
          args.push({ $ref: nm.name });
          continue;
        }
        block('TRIGGER_PAYLOAD', `#${n.index}.data_in[${k}]`, `引用了触发器 #${src} 的第 ${refPinIndex} 个出参，名字对不上（可用：${h.params.join(' / ') || '无'}）`);
        return null;
      }
      const v = varName.get(src);
      if (!v) {
        // 分清两件事：源节点自己就译不出来（上游失败） vs 真的跨了 handler
        const up = info.get(src);
        const upstreamOk = !!(up && up.ok);
        block(
          upstreamOk ? 'CROSS_HANDLER_REF' : 'UPSTREAM_FAILED',
          `#${n.index}.data_in[${k}]`,
          upstreamOk
            ? `引用了 #${src}，但 #${src} 没有在本 handler 里产出变量（多出参未声明 / 跨处理器）`
            : `引用了 #${src}，而 #${src} 本身译不出来`
        );
        return null;
      }
      // ★ 多出参：`const v = f.xxx()` 拿到的是**整个返回值**，取第几个分量要靠属性名。
      //   属性名不在 nodes.json 里（端口名常常是 null）⇒ 必须有 out_fields 表，否则拒绝。
      const outCount = ((info.get(src) || {}).cat && info.get(src).cat.outputs || []).length;
      if (outCount > 1) {
        const fields = opts.outFields.get(info.get(src).node.typeId) || null;
        if (!fields || !fields[refPinIndex]) {
          block('MULTI_OUT_PIN', `#${n.index}.data_in[${k}]`, `引用了 #${src} 的第 ${refPinIndex} 个出参，但该节点有 ${outCount} 个出参且没有 out_fields 映射`);
          return null;
        }
        args.push({ $ref: v + '.' + fields[refPinIndex] });
        continue;
      }
      args.push({ $ref: v });
      continue;
    }
    const c = slot.const;
    const lit = constToLiteral(c, `#${n.index}.data_in[${k}]`, block);
    if (lit === FAIL) return null;
    args.push(lit);
  }
  return args;
}

const FAIL = Symbol('fail');

/** 常量 → emit 认的字面量；解不出来就报 blocker 并返回 FAIL */
function constToLiteral(c, where, block) {
  if (!c) {
    block('UNKNOWN_CONSTANT', where, '常量信封为空');
    return FAIL;
  }
  if (c.status === 'UNKNOWN') {
    block('UNKNOWN_CONSTANT', where, '解不出来：' + (c.shape || []).join(' '));
    return FAIL;
  }
  if (c.note && /字典/.test(c.note)) {
    block('DICT_CONSTANT', where, c.note);
    return FAIL;
  }
  switch (c.valueKind) {
    case 'int':
      return { $int: c.value };
    case 'float':
      return c.value;
    case 'str':
      return c.value;
    case 'bool':
      return !!c.value;
    case 'vec3':
      return c.value;
    case 'enum':
      block('ENUM_CONSTANT', where, '枚举值 ' + JSON.stringify(c.value) + '（' + (c.typeName || '') + '）没有映射到 gts 枚举成员');
      return FAIL;
    case 'list':
      if (!c.value || c.value.length === 0) {
        block('LIST_CONSTANT', where, '空列表常量：gts 需要带类型的空列表写法，未验证');
        return FAIL;
      }
      block('LIST_CONSTANT', where, '列表常量 ' + JSON.stringify(c.value).slice(0, 80) + '：gts 列表字面量写法未验证');
      return FAIL;
    case 'id':
      block('UNKNOWN_CONSTANT', where, 'Id 类常量 ' + JSON.stringify(c.value) + '（需要把它换成编辑器里已存在的实体/元件引用，不能凭空造）');
      return FAIL;
    default:
      block('UNKNOWN_CONSTANT', where, 'valueKind=' + c.valueKind);
      return FAIL;
  }
}

// ════════════════════════════════════════════════════════════════════════════
// CLI
// ════════════════════════════════════════════════════════════════════════════
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const argv = process.argv.slice(2);
  const argOf = (k) => {
    const a = argv.find((s) => s.startsWith('--' + k + '='));
    return a ? a.slice(k.length + 3) : null;
  };
  const ROOT = path.resolve(HERE, '..', '..', '..');
  const giaArg = argOf('gia');
  const graphArg = argOf('graph');
  const outdir = path.resolve(ROOT, argOf('outdir') || path.join('tools', 'qx', 'graphcode', 'out'));
  const jsonOut = argv.includes('--json');
  const allowZeroDefaults = argv.includes('--allow-zero-defaults');
  const treatBranchAsLinear = argv.includes('--treat-branch-as-linear');
  if (!giaArg) {
    console.error('用法: node tools/qx/graphcode/read2spec.mjs --gia=<x.gia|.gil> [--graph=<id|名字子串>] [--outdir=...] [--json] [--allow-zero-defaults]');
    process.exit(2);
  }
  const gia = path.isAbsolute(giaArg) ? giaArg : path.resolve(ROOT, giaArg);
  if (!fs.existsSync(gia)) {
    console.error('❌ 输入不存在: ' + gia);
    process.exit(2);
  }
  const catalog = JSON.parse(fs.readFileSync(path.join(HERE, 'nodes.json'), 'utf8'));
  const aliasDoc = JSON.parse(fs.readFileSync(path.join(HERE, 'node-aliases.json'), 'utf8'));
  const aliases = new Map((aliasDoc.aliases || []).map((a) => [a.type_id, a]));
  const outFields = new Map(
    Object.entries(aliasDoc.out_fields || {}).map(([k, v]) => [Number(k), v.fields])
  );

  const r = readGia(gia, { catalog });
  const targets = graphArg
    ? r.graphs.filter((g) => String(g.header.graphId) === graphArg || (g.name || '').includes(graphArg))
    : r.graphs;
  if (!targets.length) {
    console.error('❌ 没有匹配 --graph=' + graphArg + ' 的图；本文件有 ' + r.graphs.length + ' 张');
    process.exit(2);
  }
  fs.mkdirSync(outdir, { recursive: true });
  let anyBlocked = false;
  for (const g of targets) {
    const { spec, report } = graphToSpec(g, catalog, { aliases, outFields, allowZeroDefaults, treatBranchAsLinear });
    const tag = (g.name || 'graph') + '.' + g.header.graphId;
    const reportPath = path.join(outdir, tag + '.translate.json');
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 1), 'utf8');
    if (jsonOut) console.log(JSON.stringify(report, null, 1));
    else {
      console.log('· ' + (g.name || '(无名)') + '  id=' + g.header.graphId + '  节点 ' + g.nodeCount + '  连线 ' + g.edgeCount);
      console.log('  graph_type=' + report.graph_type + '  handlers=' + report.handlers + '  ' + (report.translatable ? '✅ 可译' : '❌ 不可译'));
      if (report.used_aliases.length) {
        for (const a of report.used_aliases) console.log('  [alias] #' + a.nodeIndex + ' type=' + a.typeId + ' → ' + a.method + '（' + a.dsl + '）');
      }
      const byCat = {};
      for (const b of report.blockers) (byCat[b.category] = byCat[b.category] || []).push(b);
      for (const [cat, list] of Object.entries(byCat)) {
        console.log('  ✗ ' + cat + ' ×' + list.length + ' — ' + BLOCKERS[cat]);
        for (const b of list.slice(0, 6)) console.log('      ' + b.where + '  ' + b.detail);
      }
      for (const w of report.warnings) console.log('  ⚠️ ' + w);
      console.log('  报告：' + reportPath);
    }
    if (report.translatable) {
      const specPath = path.join(outdir, spec.graph_name + '.spec.json');
      fs.writeFileSync(specPath, JSON.stringify(spec, null, 1), 'utf8');
      console.log('  ✅ spec：' + specPath);
    } else anyBlocked = true;
  }
  process.exit(anyBlocked ? 2 : 0);
}
