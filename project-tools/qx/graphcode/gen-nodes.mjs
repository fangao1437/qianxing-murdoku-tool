// tools/qx/graphcode/gen-nodes.mjs —— 生成「节点名 → 参数/端口」总表（nodes.json）
//
// ════════════════════════════════════════════════════════════════════════════
// 定位（2026-10 改基）
// ════════════════════════════════════════════════════════════════════════════
//
//   主路线 = **genshin-ts（MIT，TypeScript / npm）**：
//     节点表从它内嵌的 MIT 数据包里**读出来**，写入交给它的 compile/inject，
//     本工程**永不自己写 protobuf 节点图**。
//
//   `--ayaya=` 那条（GPL-3.0 派生）**降级为 fallback**：只在本机没装 genshin-ts 时
//   用来对表/排障，不参与流水线，产物不入库（见 docs/节点图双向工具-spike报告.md）。
//
// ════════════════════════════════════════════════════════════════════════════
// `--gts` 的数据来源（全部 MIT，全部只读）
// ════════════════════════════════════════════════════════════════════════════
//
//   <gts>/dist/src/thirdparty/Genshin-Impact-Miliastra-Wonderland-Code-Node-Editor-Pack/node_data/
//     · node_pin_records.js   → NODE_PIN_RECORDS[498]  服务端节点：name(英文显示名)/id/inputs[]/outputs[]
//                              （inputs 是**类型表达式**，如 "Str"、"R<T>"、"L<R<T>>"；含 reflectMap 泛型具体化表）
//     · client_node_metadata.js → CLIENT_NODE_METADATA[907 → 231 个唯一 nodeType]
//                              客户端节点：**中文 displayName** + 带类型/默认值的 pins
//     · types_list.js         → TYPES_LIST[26]        （与 Ayaya 版同为 26，可交叉验证）
//     · enum_id.js            → ENUM_ID[59] / ENUM_ID_CLIENT[46] / ENUM_VALUE[259]
//
//   <gts>/dist/src/definitions/
//     · zh_aliases.js         → SERVER_EVENT_EN_TO_ZH[65] / SERVER_F_EN_TO_ZH[423]
//                               ← **中文名 ↔ TS 方法名** 的唯一桥（等价于 Ayaya 的 node_type_semantic_map.json）
//     · events.js             → ServerEventMetadata[65]     ← 触发器（Trigger）判定依据
//     · nodes.d.ts            → 每个 f 方法的 JSDoc：中文节点名 + 中文端口名（读文本，静态解析）
//     · events-payload.d.ts   → 每个事件出参的 `中文端口名 → TS 字段名`（读文本，静态解析）
//
// 用法：
//   node tools/qx/graphcode/gen-nodes.mjs --gts=<genshin-ts 安装目录>     # 主路线，产物入库（MIT）
//   node tools/qx/graphcode/gen-nodes.mjs --gts=... --meta-only           # 只打印统计
//   node tools/qx/graphcode/gen-nodes.mjs --ayaya=<仓库根>                # 降级 fallback（GPL，产物不入库）
//
// 退出码：0 = 成功；2 = 外部依赖缺失/路径不对（不会静默产出半张表）

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..', '..');

const argv = process.argv.slice(2);
const argOf = (k) => {
  const a = argv.find((s) => s.startsWith('--' + k + '='));
  return a ? a.slice(k.length + 3) : null;
};
const has = (k) => argv.includes('--' + k);

const gtsArg = argOf('gts') || process.env.QX_GTS_HOME || '';
const ayaya = argOf('ayaya') || process.env.QX_AYAYA_REPO || '';
const outPath = path.resolve(ROOT, argOf('out') || path.join('tools', 'qx', 'graphcode', 'nodes.json'));
const metaOnly = has('meta-only');

function die(msg, code = 2) {
  console.error('❌ ' + msg);
  process.exit(code);
}

const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const imp = (p) => import(pathToFileURL(p).href);

// ════════════════════════════════════════════════════════════════════════════
// 主路线：从 genshin-ts（MIT）生成
// ════════════════════════════════════════════════════════════════════════════

/** `--gts` 可以给 genshin-ts 包目录，也可以给装了它的 workbench 目录 */
function resolveGtsHome(raw) {
  const candidates = [path.resolve(raw)];
  const joined = path.resolve(raw, 'node_modules', 'genshin-ts');
  candidates.push(joined);
  for (const c of candidates) {
    if (fs.existsSync(path.join(c, 'dist', 'src', 'thirdparty'))) {
      return { home: c, pkg: readJson(path.join(c, 'package.json')) };
    }
  }
  die(
    '找不到 genshin-ts 安装目录：' + path.resolve(raw) + '\n' +
      '   期望目录里有 dist/src/thirdparty/...（npm 装好 genshin-ts 之后就有了）。\n' +
      '   获取：npm i genshin-ts@0.2.3   或见 docs/节点图双向工具-spike报告.md 的「MIT 写入路线」。'
  );
}

/** nodes.d.ts 的 JSDoc → 方法名 → { zh（中文节点名）, pins（中文端口名，按出现顺序） } */
function parseNodeDts(dtsPath) {
  const zhByMethod = new Map();
  const pinsByMethod = new Map();
  const src = fs.readFileSync(dtsPath, 'utf8');
  const lines = src.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    // 方法签名，允许泛型子句（setCustomVariable<T extends 'bool' | ...>(...)）：
    //   ^ {4}name<T ...>(args): ret;
    const sig = lines[i].match(/^ {4}([A-Za-z_$][\w$]*)\s*(?:<[^(]*?>)?\s*\(([^)]*)\)\s*:\s*[^;]*;?\s*$/);
    if (!sig) continue;
    const method = sig[1];
    // 向上收集紧邻的 JSDoc 块
    const doc = [];
    for (let j = i - 1; j >= 0; j--) {
      const l = lines[j];
      if (/^\s*\*\//.test(l)) continue;
      if (/^\s*\/\*\*/.test(l)) break;
      if (/^\s*\*/.test(l)) {
        doc.unshift(l.replace(/^\s*\*\s?/, ''));
        continue;
      }
      break;
    }
    if (doc.length === 0) continue;
    let zh = null;
    const pins = [];
    let seenParam = false;
    for (const b of doc) {
      if (/^@param\b/.test(b)) {
        seenParam = true;
        continue;
      }
      if (/^@/.test(b)) continue;
      const m = b.match(/^([\u4e00-\u9fa5][^:：]*)[:：]\s*(.*)$/);
      if (!m) continue;
      if (zh === null && !seenParam) {
        zh = m[1].trim();
      } else {
        pins.push(m[1].trim());
      }
    }
    if (zh) zhByMethod.set(method, zh);
    if (pins.length) pinsByMethod.set(method, pins);
  }
  return { zhByMethod, pinsByMethod };
}

/** events-payload.d.ts → 事件 → [{ zh（中文出参名）, field（TS 字段名） }]（按声明顺序） */
function parseEventPayloads(dtsPath) {
  const src = fs.readFileSync(dtsPath, 'utf8');
  const lines = src.split(/\r?\n/);
  const out = new Map();
  let cur = null;
  let curDepth = 0;
  let pendingZh = null;
  for (const raw of lines) {
    const line = raw.replace(/^\s+/, '');
    const open = raw.match(/^ {4}([A-Za-z_$][\w$]*)\s*:\s*\{\s*$/);
    if (open) {
      cur = open[1];
      curDepth = 1;
      out.set(cur, []);
      pendingZh = null;
      continue;
    }
    if (!cur) continue;
    if (/^ {4}\};\s*$/.test(raw) || /^ {4}\},\s*$/.test(raw)) {
      cur = null;
      continue;
    }
    if (curDepth) {
      // 中文端口名行：`* 事件源实体` 或 `* 事件源实体: 与节点图关联的实体`
      const zh = line.match(/^\*\s*([\u4e00-\u9fa5][^:：]{0,40}?)(?:[:：]\s*.*)?$/);
      if (zh) {
        pendingZh = zh[1].trim();
        continue;
      }
      const fld = line.match(/^([A-Za-z_$][\w$]*)\??\s*:/);
      if (fld && pendingZh) {
        out.get(cur).push({ zh: pendingZh, field: fld[1] });
        pendingZh = null;
      }
    }
  }
  return out;
}

/** 归一化英文名，用于把数据包里的英文显示名对到 TS 方法名 */
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const methodToPhrase = (m) => norm(String(m).replace(/([a-z0-9])([A-Z])/g, '$1 $2'));

/** 类型表达式 → 人类可读类型（保留上游原样，只做展示层的轻整理） */
const prettyType = (t) => String(t || '');

async function buildFromGts(rawGts) {
  const { home, pkg } = resolveGtsHome(rawGts);
  const SRC = path.join(home, 'dist', 'src');
  const PACK = path.join(SRC, 'thirdparty', 'Genshin-Impact-Miliastra-Wonderland-Code-Node-Editor-Pack', 'node_data');
  const DEF = path.join(SRC, 'definitions');
  for (const [label, p] of [
    ['node_data/node_pin_records.js', path.join(PACK, 'node_pin_records.js')],
    ['definitions/zh_aliases.js', path.join(DEF, 'zh_aliases.js')],
    ['definitions/events.js', path.join(DEF, 'events.js')],
  ]) {
    if (!fs.existsSync(p)) die('genshin-ts 安装里缺文件：' + label + '\n   期望：' + p);
  }

  const pack = await imp(path.join(PACK, 'node_pin_records.js'));
  const clientMod = await imp(path.join(PACK, 'client_node_metadata.js'));
  const typesMod = await imp(path.join(PACK, 'types_list.js'));
  const enumMod = await imp(path.join(PACK, 'enum_id.js'));
  const zh = await imp(path.join(DEF, 'zh_aliases.js'));
  const eventsMod = await imp(path.join(DEF, 'events.js'));

  const { zhByMethod, pinsByMethod } = parseNodeDts(path.join(DEF, 'nodes.d.ts'));
  const payloads = parseEventPayloads(path.join(DEF, 'events-payload.d.ts'));

  const fZhToEn = zh.SERVER_F_ZH_TO_EN || {};
  const fEnToZh = zh.SERVER_F_EN_TO_ZH || {};
  const evZhToEn = zh.SERVER_EVENT_ZH_TO_EN || {};
  const evEnToZh = zh.SERVER_EVENT_EN_TO_ZH || {};

  // 英文显示名 → 方法名（f 与 event 两套）
  const fByPhrase = new Map();
  for (const m of Object.keys(fEnToZh)) fByPhrase.set(methodToPhrase(m), m);
  const evByPhrase = new Map();
  for (const m of Object.keys(evEnToZh)) evByPhrase.set(methodToPhrase(m), m);

  const nodes = [];
  const unmatched = [];

  // ── 服务端（数据包节点表） ────────────────────────────────────────────────
  for (const r of pack.NODE_PIN_RECORDS || []) {
    const key = norm(r.name);
    const fMethod = fByPhrase.get(key) || null;
    const evMethod = evByPhrase.get(key) || null;
    const method = evMethod || fMethod;
    let dsl = '';
    if (method) dsl = evEnToZh[method] || fEnToZh[method] || '';
    if (!dsl) dsl = zhByMethod.get(method) || '';
    const pins = method ? pinsByMethod.get(method) || null : null;
    if (!dsl) unmatched.push(r.name);

    const nIn = (r.inputs || []).length;
    const inputs = (r.inputs || []).map((t, i) => ({
      name: pins && pins[i] ? pins[i] : null,
      type: prettyType(t),
    }));
    // 触发器的出参名来自 events-payload.d.ts（那里有「中文端口名 → TS 字段名」），
    // 数据包只给类型；优先级：events-payload 的中文名 > nodes.d.ts 的 @param 中文名。
    const evPayload = evMethod ? payloads.get(evMethod) || [] : [];
    const outputs = (r.outputs || []).map((t, i) => {
      let name = null;
      if (evPayload[i] && evPayload[i].zh) name = evPayload[i].zh;
      else if (pins && pins[nIn + i]) name = pins[nIn + i];
      return { name, type: prettyType(t) };
    });

    nodes.push({
      id: r.id,
      name: r.name,
      dsl,
      ...(method ? { method } : {}),
      range: 'Server',
      class: evMethod ? 'Trigger' : 'Function',
      inputs_types: (r.inputs || []).map(prettyType),
      outputs_types: (r.outputs || []).map(prettyType),
      inputs,
      outputs,
      ...(Array.isArray(r.reflectMap) && r.reflectMap.length
        ? { reflect_map: r.reflectMap.map(([id, t]) => [id, prettyType(t)]) }
        : {}),
    });
  }

  // ── 客户端（客户端元数据，按 nodeType 去重） ──────────────────────────────
  const clientSeen = new Set();
  for (const c of clientMod.CLIENT_NODE_METADATA || []) {
    if (clientSeen.has(c.nodeType)) continue;
    clientSeen.add(c.nodeType);
    const pinsOf = (arr) =>
      (arr || []).map((p) => ({
        name: null, // 上游客户端元数据没有中文端口名，只有 type/index
        type: prettyType(p.type ?? p.connectionType ?? ''),
      }));
    nodes.push({
      id: c.genericId,
      name: c.nodeType,
      dsl: c.displayName || '',
      range: 'Client',
      class: 'ClientNode',
      graph_type: c.graphType,
      ...(c.subType ? { sub_type: c.subType } : {}),
      ...(c.concreteId !== undefined ? { concrete_id: c.concreteId } : {}),
      inputs_types: (c.inputs || []).map((p) => prettyType(p.type ?? '')),
      outputs_types: (c.outputs || []).map((p) => prettyType(p.type ?? '')),
      inputs: pinsOf(c.inputs),
      outputs: pinsOf(c.outputs),
    });
  }

  // ── 事件目录（触发器 + 出参中文名 → TS 字段） ─────────────────────────────
  const events = [];
  for (const [method, meta] of Object.entries(eventsMod.ServerEventMetadata || {})) {
    const payload = payloads.get(method) || [];
    events.push({
      method,
      en: method,
      zh: evEnToZh[method] || '',
      ...(meta && typeof meta === 'object' ? { meta_keys: Object.keys(meta) } : {}),
      payload,
    });
  }
  events.sort((a, b) => (a.method < b.method ? -1 : 1));

  const types = (typesMod.TYPES_LIST || []).map((t) => ({
    name: t.Name,
    id: t.ID,
    ...(t.ClientID !== null && t.ClientID !== undefined ? { client_id: t.ClientID } : {}),
    expression: t.Expression,
    dsl_name: t.DSLName,
    base_type: t.BaseType,
    base_type_id: t.BaseTypeID,
  }));

  const enums = Object.entries(enumMod.ENUM_ID || {}).map(([name, id]) => {
    const items = Object.entries(enumMod.ENUM_VALUE || {})
      .filter(([k]) => k.startsWith(name.replace(/_/g, '') + '_') || k.startsWith(name.split('_')[0] + '_'))
      .map(([k, v]) => ({ name: k, id: v }));
    return { name, id, ...(items.length ? { items } : {}) };
  });

  const counts = {};
  for (const n of nodes) {
    const k = n.range + '/' + n.class;
    counts[k] = (counts[k] || 0) + 1;
  }
  const named = nodes.filter((n) => n.dsl).length;

  const doc = {
    _provenance: {
      note:
        '本表由 **MIT** 项目 genshin-ts（及其内嵌的 MIT 数据包）的只读数据文件拼装而来，不是本工程原创 schema。',
      upstream: pkg.repository?.url || 'https://github.com/josStorer/genshin-ts',
      upstream_license: pkg.license || 'MIT',
      upstream_version: pkg.version,
      pack_upstream:
        'https://github.com/Wu-Yijun/Genshin-Impact-Miliastra-Wonderland-Code-Node-Editor-Pack',
      pack_license: 'MIT',
      sources: [
        'dist/src/thirdparty/Genshin-Impact-Miliastra-Wonderland-Code-Node-Editor-Pack/node_data/node_pin_records.js (NODE_PIN_RECORDS)',
        '.../node_data/client_node_metadata.js (CLIENT_NODE_METADATA)',
        '.../node_data/types_list.js (TYPES_LIST)',
        '.../node_data/enum_id.js (ENUM_ID / ENUM_ID_CLIENT / ENUM_VALUE)',
        'dist/src/definitions/zh_aliases.js (SERVER_EVENT_EN_TO_ZH / SERVER_F_EN_TO_ZH)',
        'dist/src/definitions/events.js (ServerEventMetadata)',
        'dist/src/definitions/nodes.d.ts (JSDoc 中文节点名 / 中文端口名)',
        'dist/src/definitions/events-payload.d.ts (事件出参 中文名 → TS 字段名)',
      ],
      regenerate: 'node tools/qx/graphcode/gen-nodes.mjs --gts=<genshin-ts 安装目录>',
      license_flag:
        '✅ 上游全部为 MIT ⇒ 本文件可以入库、可以随本工程分发。' +
        '（上一版是从 GPL-3.0 的 Ayaya_Miliastra_Editor 派生，那份不再入库。）',
      ports_caveat:
        'inputs/outputs 的 name 来自 genshin-ts 的 JSDoc / 客户端元数据；name 为 null = 上游没给中文端口名，只有 type。' +
        'inputs_types/outputs_types 是**类型表达式**（"Str" / "R<T>" / "L<R<T>>"），顺序即端口顺序。',
      class_taxonomy:
        'Trigger = 服务端事件（events.js 的 ServerEventMetadata）；Function = 其余服务端节点；ClientNode = 客户端节点。',
      unmatched_note:
        'gts 数据包的英文显示名与 TS 方法名有漂移（' +
        unmatched.length +
        ' 个服务端节点没对上中文名，见 counts.server_without_dsl）；这些节点 method 为空。',
    },
    version: pkg.version,
    game_version: 'n/a（以 genshin-ts 版本标定，不再有 Ayaya 的 GameVersion 字段）',
    counts: {
      nodes: nodes.length,
      with_dsl_name: named,
      server: nodes.filter((n) => n.range === 'Server').length,
      client: nodes.filter((n) => n.range === 'Client').length,
      server_without_dsl: unmatched.length,
      server_triggers: nodes.filter((n) => n.range === 'Server' && n.class === 'Trigger').length,
      server_without_port_names: nodes.filter(
        (n) => n.range === 'Server' && (n.inputs || []).some((p) => p.name === null)
      ).length,
      events: events.length,
      by_range_class: counts,
    },
    types,
    enums,
    events,
    nodes,
  };
  return doc;
}

// ════════════════════════════════════════════════════════════════════════════
// 降级 fallback：从 Ayaya（GPL-3.0）生成（仅排障用，产物不入库）
// ════════════════════════════════════════════════════════════════════════════
async function buildFromAyaya(rawAyaya) {
  const AY = path.resolve(rawAyaya);
  const IDX = path.join(AY, 'private_extensions', 'ugc_file_tools', 'node_data', 'index.json');
  const SEM = path.join(AY, 'private_extensions', 'ugc_file_tools', 'graph_ir', 'node_type_semantic_map.json');
  for (const [label, p] of [['node_data/index.json', IDX], ['graph_ir/node_type_semantic_map.json', SEM]]) {
    if (!fs.existsSync(p)) die(`外部文件不存在：${label}\n   期望路径：${p}`);
  }
  const cat = readJson(IDX);
  const sem = readJson(SEM);
  if (!Array.isArray(cat.NodesList)) die('node_data/index.json 结构不符合预期：缺 NodesList 数组');

  const semOf = (id) => sem[String(id)] || {};
  const nodes = cat.NodesList.map((n) => {
    const s = semOf(n.ID);
    const dsl = s.graph_generater_node_name || '';
    return {
      id: n.ID,
      name: n.Name,
      dsl,
      range: n.Range,
      class: n.Class,
      family: n.Family,
      type: n.Type,
      inputs_types: Array.isArray(n.Inputs) ? n.Inputs : [],
      outputs_types: Array.isArray(n.Outputs) ? n.Outputs : [],
      ...(n.ConcreteID !== undefined ? { concrete_id: n.ConcreteID } : {}),
      ...(Array.isArray(n.TypeMappings) ? { type_mappings: n.TypeMappings } : {}),
      dsl_confidence: s.confidence || (dsl ? 'unknown' : 'none'),
      ...(s.notes ? { dsl_notes: s.notes } : {}),
    };
  });

  const types = (cat.TypesList || []).map((t) => ({
    name: t.Name,
    id: t.ID,
    ...(t.ClientID !== undefined ? { client_id: t.ClientID } : {}),
    expression: t.Expression,
    dsl_name: t.DSLName,
    base_type: t.BaseType,
    base_type_id: t.BaseTypeID,
  }));
  const enums = (cat.EnumList || []).map((e) => ({
    name: e.Name,
    id: e.ID,
    items: (e.Items || []).map((i) => ({ name: i.Name, id: i.ID })),
  }));

  const counts = {};
  for (const n of nodes) {
    const k = n.range + '/' + n.class;
    counts[k] = (counts[k] || 0) + 1;
  }
  const named = nodes.filter((n) => n.dsl).length;

  return {
    _provenance: {
      note: '本表由外部开源项目 Ayaya_Miliastra_Editor 的数据文件拼装而来，不是本工程原创 schema。',
      upstream: 'https://github.com/AyayaXiaowang/Ayaya_Miliastra_Editor',
      upstream_license: 'GPL-3.0',
      sources: [
        'private_extensions/ugc_file_tools/node_data/index.json (Version ' + cat.Version + ')',
        'private_extensions/ugc_file_tools/graph_ir/node_type_semantic_map.json',
      ],
      regenerate: 'node tools/qx/graphcode/gen-nodes.mjs --ayaya=<外部仓库根目录>',
      license_flag:
        '⚠️ 上游为 GPL-3.0，**降级 fallback**。这条路径只用于本机对表/排障，产物**不入库**；' +
        '入库的 nodes.json 必须由 --gts=（MIT）生成。',
      ports_caveat: 'inputs_types/outputs_types 是**类型名**，不是端口名；端口名需由 plugins/nodes/**/@node_spec 提供。',
    },
    version: cat.Version,
    game_version: cat.GameVersion,
    counts: {
      nodes: nodes.length,
      with_dsl_name: named,
      server_triggers: nodes.filter((n) => n.range === 'Server' && n.class === 'Trigger').length,
      by_range_class: counts,
    },
    types,
    enums,
    graph_consts: cat.GraphConstList || [],
    nodes,
  };
}

// ════════════════════════════════════════════════════════════════════════════
// main
// ════════════════════════════════════════════════════════════════════════════
if (!gtsArg && !ayaya) {
  die(
    '缺少数据源。二选一：\n' +
      '   --gts=<genshin-ts 安装目录>     ← 主路线（MIT，产物入库）\n' +
      '   --ayaya=<Ayaya 仓库根>          ← 降级 fallback（GPL-3.0，仅排障）\n' +
      '   获取方式见 docs/节点图双向工具-spike报告.md 的「MIT 写入路线」。'
  );
}

let doc;
let sourceLabel;
if (gtsArg) {
  doc = await buildFromGts(gtsArg);
  sourceLabel = 'genshin-ts@' + doc.version + ' (MIT)';
} else {
  doc = await buildFromAyaya(ayaya);
  sourceLabel = 'Ayaya_Miliastra_Editor (GPL-3.0, fallback)';
}

if (metaOnly) {
  console.log(JSON.stringify({ _source: sourceLabel, ...doc, nodes: undefined, types: undefined, enums: undefined, events: undefined }, null, 2));
  process.exit(0);
}

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(doc, null, 1), 'utf8');
console.log('✅ 写出 ' + outPath);
console.log('   数据源：' + sourceLabel);
console.log('   节点 ' + doc.counts.nodes + '（有中文名 ' + doc.counts.with_dsl_name + '）');
console.log('   类型 ' + doc.types.length + '，枚举 ' + doc.enums.length +
  (doc.events ? '，事件 ' + doc.events.length : '') +
  (doc.graph_consts ? '，GraphConst ' + doc.graph_consts.length : ''));
console.log('   域/类分布：');
for (const [k, v] of Object.entries(doc.counts.by_range_class).sort((a, b) => b[1] - a[1])) {
  console.log('     ' + k.padEnd(20) + v);
}
