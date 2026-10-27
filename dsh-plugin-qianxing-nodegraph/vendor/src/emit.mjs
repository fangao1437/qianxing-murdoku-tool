// src/emit.mjs —— behavior-spec(JSON) → 节点图源码 → 交给外部工具落盘
//
// ════════════════════════════════════════════════════════════════════════════
// 硬边界（改这段之前先读）
// ════════════════════════════════════════════════════════════════════════════
//
//   ★ 本工具**只生成节点图源码**，**绝不**自己写 `.gil` / `.gia`，**绝不**碰 protobuf。
//   ★ 落盘一律交给外部开源项目的 injector：
//        主路线  genshin-ts（MIT，TypeScript）    → `gsts` compile → `.gia` → inject `.gil`
//        历史    Ayaya_Miliastra_Editor（GPL-3.0）→ Graph Code `.py` → validate-file
//   ★ 主路线（`--target=gts`，默认）的意义：**语言同构**（我们本来就写 TS/JS 工具链），
//     节点图直接由 MIT 项目的编译器产出，许可干净，不必自研写入器。
//
// ════════════════════════════════════════════════════════════════════════════
// 两个 target
// ════════════════════════════════════════════════════════════════════════════
//
//   --target=gts    （默认，主路线）→ `<graph_name>.ts`（genshin-ts 源码）
//                    随后用 src/gts-build.mjs 跑 compile → inject
//   --target=ayaya  （deprecated，仅历史参考）→ `<graph_name>.py`（Ayaya Graph Code）
//                    不参与流水线、不引入依赖；只在需要跟旧报告对表时用
//
// ════════════════════════════════════════════════════════════════════════════
// spec 格式（两个 target 共用；gts 是主，字段以它为准）
// ════════════════════════════════════════════════════════════════════════════
//
//   {
//     "graph_id": 1073741825,              // 必须等于地图里已存在、已保存的节点图 id
//     "graph_name": "模板_qx最小闭环",       // 文件名 + 图显示名（合法标识符）
//     "graph_type": "server",              // server | client
//     "graph_subtype": "bool_filter",      // 仅 client 必填，对应 g.<subType>(...)
//     "variables": { "counter": 0 },       // 可选：节点图变量
//     "handlers": [
//       {
//         "event": "实体创建时",            // 中文事件名（nodes.json events[].zh）
//         "params": ["事件源实体"],         // 事件出参中文名；自动映射到 evt.<字段>
//         "body": [
//           { "node": "打印字符串", "args": ["hi"] },
//           { "out": "结果", "node": "是否相等", "args": [{ "$ref": "事件源实体" }, { "$int": 1 }] }
//         ]
//       }
//     ]
//   }
//
//   args 约定：
//     · **数组 = 按端口顺序的位置参数**（gts 的原生调用约定，推荐）
//     · 对象 = 按 nodes.json 里 inputs[].name 的顺序重排后当位置参数（老 spec 兼容）；
//              端口名对不上就报错，不猜
//     · {"$ref": "<形参名|上文 out 名>"} = **连线**，不是常量
//     · {"$int": n} = 整数（gts 里 int 是 bigint，会写成 `n` 字面量；裸数字是 float）
//     · {} / 数组 / 布尔 / 字符串 / null 按 TS 字面量写
//
// 用法：
//   node src/emit.mjs --spec=specs/min-loop.json
//   node src/emit.mjs --spec=... --outdir=...
//   node src/emit.mjs --spec=... --target=ayaya        # 历史分支
//   node src/emit.mjs --spec=... --target=ayaya --ayaya=<仓库> --python=<python.exe>
//
// 退出码：0 = 生成成功（ayaya 且给了 --ayaya 时含校验通过）；1 = 校验失败；2 = spec 不合法

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

const argv = process.argv.slice(2);
const argOf = (k) => {
  const a = argv.find((s) => s.startsWith('--' + k + '='));
  return a ? a.slice(k.length + 3) : null;
};

const specArg = argOf('spec');
const target = (argOf('target') || 'gts').toLowerCase();
const ayayaArg = argOf('ayaya') || process.env.QX_AYAYA_REPO || '';
const pyExe = argOf('python') || process.env.QX_PYTHON || 'python';
const outdir = path.resolve(ROOT, argOf('outdir') || path.join('out'));

const USAGE =
  '用法: node src/emit.mjs --spec=<behavior-spec.json> [--outdir=...] ' +
  '[--target=gts|ayaya] [--ayaya=<外部仓库>] [--python=<python.exe>]';

if (!specArg) {
  console.error(USAGE);
  process.exit(2);
}
if (!['gts', 'ayaya'].includes(target)) {
  console.error('❌ --target 只能是 gts（默认，主路线）或 ayaya（deprecated）: ' + target);
  process.exit(2);
}
const specPath = path.isAbsolute(specArg) ? specArg : path.resolve(ROOT, specArg);
if (!fs.existsSync(specPath)) {
  console.error('❌ spec 不存在: ' + specPath);
  process.exit(2);
}

// ── 0. 节点总表（有就用它做前置校验；没有就只做语法层生成） ────────────────
const catalogPath = path.join(ROOT, 'data', 'nodes.json');
let catalog = null;
if (fs.existsSync(catalogPath)) {
  try {
    catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
  } catch (e) {
    console.error('❌ nodes.json 解析失败（先跑 gen-nodes.mjs）: ' + e.message);
    process.exit(2);
  }
}
const byDsl = new Map();
const byName = new Map();
const byMethod = new Map();
// ★ 中文名**不唯一**：实测 nodes.json 里 74 组 dsl 同时存在于服务端与客户端
//   （例：「双分支」= id 2 / Server / doubleBranch 与 id 200056 / Client / **没有 method**）。
//   朴素的 `byDsl.set(dsl, n)` 会让**没有 method 的客户端条目覆盖掉服务端条目**，
//   于是「双分支」查出来 method 为空 ⇒ 白报「不能生成」。⇒ 统一的「有 method 优先」写法。
const preferMethod = (map, key, n) => {
  if (!key) return;
  const cur = map.get(key);
  if (!cur || (!cur.method && n.method)) map.set(key, n);
};
if (catalog) {
  for (const n of catalog.nodes || []) {
    preferMethod(byDsl, n.dsl, n);
    preferMethod(byName, n.name, n);
    preferMethod(byMethod, n.method, n);
  }
}

// ── 0b. 别名表：nodes.json 里 109 个服务端节点没有中文名/方法名（上游措辞漂移）──
//    `node-aliases.json` 是**人工核对过签名**的补充映射（每条带 evidence + confidence）。
//    命中时用「nodes.json 的端口表 + 别名的方法名」合成一条查表项，端口名仍以 nodes.json 为准。
//    ⚠️ 这不是兜底乱猜：别名表里没有的 id 依然会被拒（下面 allCalls 校验会报「不在 nodes.json 里」）。
const aliasPath = path.join(ROOT, 'data', 'node-aliases.json');
const aliasesUsed = [];
if (catalog && fs.existsSync(aliasPath)) {
  try {
    const aliasDoc = JSON.parse(fs.readFileSync(aliasPath, 'utf8'));
    const byIdCat = new Map((catalog.nodes || []).map((n) => [n.id, n]));
    for (const a of aliasDoc.aliases || []) {
      const base = byIdCat.get(a.type_id);
      if (!base || !a.gts_method) continue;
      const entry = { ...base, method: a.gts_method, dsl: a.zh || base.dsl, _alias_type_id: a.type_id, _alias_confidence: a.confidence };
      for (const k of [a.name_en, a.zh, a.gts_method]) if (k) {
        const target = k === a.gts_method ? byMethod : k === a.name_en ? byName : byDsl;
        const cur = target.get(k);
        // 只有「查不到」或「查到的那条没有 method」时才用别名顶上；别覆盖更强的条目
        if (!cur || !cur.method) target.set(k, entry);
      }
      aliasesUsed.push(entry);
    }
  } catch {
    /* 别名表坏了就当没有：不阻断主流程 */
  }
}
const eventsByZh = new Map();
const eventsByMethod = new Map();
for (const e of (catalog && catalog.events) || []) {
  if (e.zh) eventsByZh.set(e.zh, e);
  if (e.method) eventsByMethod.set(e.method, e);
}

// ── 1. 读 spec ────────────────────────────────────────────────────────────
let spec;
try {
  spec = JSON.parse(fs.readFileSync(specPath, 'utf8'));
} catch (e) {
  console.error('❌ spec 不是合法 JSON: ' + e.message);
  process.exit(2);
}

const errs = [];
const need = (cond, msg) => {
  if (!cond) errs.push(msg);
};

need(
  (typeof spec.graph_id === 'number' && Number.isFinite(spec.graph_id)) ||
    (typeof spec.graph_id === 'string' && spec.graph_id),
  'spec.graph_id 必填（节点图 id，数字；或字符串占位）'
);
need(typeof spec.graph_name === 'string' && spec.graph_name, 'spec.graph_name 必填');
need(['server', 'client'].includes(spec.graph_type), 'spec.graph_type 必须是 "server" 或 "client"');
need(Array.isArray(spec.handlers) && spec.handlers.length > 0, 'spec.handlers 必须是非空数组（至少一个触发器）');
if (spec.graph_type === 'client') {
  need(typeof spec.graph_subtype === 'string' && spec.graph_subtype, 'client 图必填 spec.graph_subtype（如 "bool_filter"）');
}
if (target === 'ayaya') {
  need(typeof spec.graph_id === 'string' && spec.graph_id, 'ayaya target 要求 spec.graph_id 是字符串（Graph Code 文件头）');
}
if (target === 'gts') {
  need(typeof spec.graph_id === 'number' && Number.isFinite(spec.graph_id), 'gts target 要求 spec.graph_id 是**数字**（注入按 id 匹配）');
}

const ident = /^[\p{Script=Han}A-Za-z_][\p{Script=Han}A-Za-z0-9_]*$/u;
need(ident.test(spec.graph_name || ''), 'spec.graph_name 必须是合法标识符：' + spec.graph_name);

const allCalls = [];
for (const [hi, h] of (spec.handlers || []).entries()) {
  const where = `handlers[${hi}]`;
  need(typeof h.event === 'string' && h.event, `${where}.event 必填（事件中文名，如 "实体创建时"）`);
  need(ident.test(h.event || ''), `${where}.event 必须能当方法名后缀用：on_${h.event}`);
  need(Array.isArray(h.params), `${where}.params 必须是数组（事件出参中文名，按顺序）`);
  for (const p of h.params || []) need(ident.test(p), `${where}.params 含非法标识符: ${p}`);
  need(Array.isArray(h.body), `${where}.body 必须是数组`);
  for (const [bi, c] of (h.body || []).entries()) {
    if (c.node === 'pass') continue; // 允许显式占位
    need(typeof c.node === 'string' && c.node, `${where}.body[${bi}].node 必填`);
    allCalls.push({ where: `${where}.body[${bi}]`, call: c });
    if (catalog && c.node !== 'pass') {
      const hit = byDsl.get(c.node) || byName.get(c.node) || byMethod.get(c.node);
      if (!hit) {
        errs.push(`${where}.body[${bi}].node = "${c.node}" 不在 nodes.json 里`);
      }
    }
  }
  // 事件必须落在 Trigger（能查的就查）
  if (catalog) {
    const hh = eventsByZh.get(h.event) || eventsByMethod.get(h.event) || byDsl.get(h.event) || byName.get(h.event);
    if (!hh) errs.push(`${where}.event = "${h.event}" 不在 nodes.json 的 events 里（找不到该 Trigger）`);
    else if (hh.class && hh.class !== 'Trigger') errs.push(`${where}.event = "${h.event}" 在 nodes.json 里 class=${hh.class}，不是 Trigger`);
  }
}

if (errs.length) {
  console.error('❌ spec 不合法，未生成文件：');
  for (const e of errs) console.error('   · ' + e);
  process.exit(2);
}

// ════════════════════════════════════════════════════════════════════════════
// target=gts —— 生成 genshin-ts 的 TypeScript 源码（主路线）
// ════════════════════════════════════════════════════════════════════════════
const camel = (s) => String(s).replace(/[_-]+([a-z0-9])/g, (_, c) => c.toUpperCase());

function emitGts() {
  const L = [];
  L.push('// 由 src/emit.mjs 从 behavior-spec 生成（target=gts，主路线 = MIT 的 genshin-ts）');
  L.push('// 落盘路径：本文件 → gsts compile → .gia → gsts inject → .gil');
  L.push('// 本工程**不写** protobuf：写入一律交给 genshin-ts 的 injector。');
  L.push("import { g } from 'genshin-ts/runtime/core'");
  L.push('');

  const cfg = [];
  cfg.push('  id: ' + spec.graph_id);
  if (spec.graph_name) cfg.push('  name: ' + JSON.stringify(spec.graph_name));
  if (spec.variables && typeof spec.variables === 'object' && Object.keys(spec.variables).length) {
    const vars = Object.entries(spec.variables)
      .map(([k, v]) => '    ' + JSON.stringify(k) + ': ' + gtsLit(v))
      .join(',\n');
    cfg.push('  variables: {\n' + vars + '\n  }');
  }

  const factory =
    spec.graph_type === 'server' ? 'g.server({' : 'g.' + camel(spec.graph_subtype) + '({';
  L.push(factory);
  L.push(cfg.join(',\n'));
  L.push('})');

  const warns = [];
  for (const h of spec.handlers) {
    const ev = eventsByZh.get(h.event) || eventsByMethod.get(h.event) || null;
    const evMethod = ev ? ev.method : h.event;
    if (!ev) warns.push(`事件 "${h.event}" 在 nodes.json events 里查不到，按原样写进 .on(...)`);

    // spec.params（中文出参名）→ evt.<ts 字段>
    const bind = [];
    for (const p of h.params) {
      const hit = ev && (ev.payload || []).find((x) => x.zh === p);
      if (hit) bind.push({ zh: p, field: hit.field });
      else
        errs.push(
          `handlers 事件 "${h.event}" 的出参里没有 "${p}"` +
            (ev ? '（可用：' + (ev.payload || []).map((x) => x.zh).filter(Boolean).join(' / ') + '）' : '')
        );
    }
    L.push('  .on(' + JSON.stringify(evMethod) + ', (evt, f) => {');
    for (const b of bind) L.push('    const ' + b.zh + ' = evt.' + b.field);
    const body = h.body.filter((c) => c.node !== 'pass');
    if (body.length === 0 && bind.length === 0) L.push('    /* 空体 */');
    for (const c of body) {
      const n = byDsl.get(c.node) || byName.get(c.node) || byMethod.get(c.node) || null;
      const method = (n && n.method) || c.method;
      if (!n) errs.push(`节点 "${c.node}" 不在 nodes.json 里`);
      else if (!method) errs.push(`节点 "${c.node}" 在 nodes.json 里没有 TS 方法名（method 为空），不能生成 gts 源码`);
      const portNames = ((n && n.inputs) || []).map((p) => p.name);
      const args = gtsArgs(c, portNames, h, allCalls);
      const head = c.out ? `    const ${c.out} = ` : '    ';
      L.push(head + 'f.' + method + '(' + args.join(', ') + ')');
    }
    L.push('  })');
  }
  L.push('');
  return { code: L.join('\n'), warns };
}

/** 端口顺序重排：数组 = 位置参数；对象 = 按 nodes.json 的 inputs[].name 顺序重排 */
function gtsArgs(c, portNames, _h, _all) {
  const raw = c.args;
  if (raw === undefined || raw === null) return [];
  if (Array.isArray(raw)) return raw.map(gtsLit);
  if (typeof raw !== 'object') return [gtsLit(raw)];
  const keys = Object.keys(raw);
  const unknown = keys.filter((k) => portNames.length && !portNames.includes(k));
  if (unknown.length) {
    throw new Error(
      `节点 "${c.node}" 的 args 里端口名对不上 nodes.json：${unknown.join(', ')}\n` +
        '   该节点可用端口名：' + (portNames.filter(Boolean).join(' / ') || '（上游未给端口名，请改用数组形式）')
    );
  }
  if (!portNames.length || portNames.some((p) => p === null)) {
    return keys.map((k) => gtsLit(raw[k])); // 上游没给端口名：退化为对象键顺序
  }
  return portNames.filter((p) => p in raw).map((p) => gtsLit(raw[p]));
}

/** JSON 值 → gts/TS 字面量 */
function gtsLit(v) {
  if (v === null || v === undefined) return 'undefined';
  if (typeof v === 'boolean') return String(v);
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(v); // number = float
  if (typeof v === 'string') return JSON.stringify(v).replace(/^"|"$/g, "'");
  if (Array.isArray(v)) return '[' + v.map(gtsLit).join(', ') + ']';
  if (typeof v === 'object') {
    if (typeof v.$ref === 'string') return v.$ref; // 连线：直接当标识符用
    if (typeof v.$int === 'number') return String(v.$int) + 'n'; // gts：int 是 bigint
    if (typeof v.$float === 'number') return String(v.$float);
    if (typeof v.$str === 'string') return JSON.stringify(v.$str).replace(/^"|"$/g, "'");
    return '{ ' + Object.entries(v).map(([k, x]) => k + ': ' + gtsLit(x)).join(', ') + ' }';
  }
  throw new Error('无法字面量化: ' + typeof v);
}

// ════════════════════════════════════════════════════════════════════════════
// target=ayaya —— 历史分支（deprecated，不参与流水线）
// ════════════════════════════════════════════════════════════════════════════
//
// ⚠️ DEPRECATED：Ayaya_Miliastra_Editor 是 GPL-3.0，且是 Python 栈，与本工程（TS/JS）不同构。
//    这条路径仅保留「历史参考 / 与旧报告对表」用途，**不是**默认 target，也**不引入依赖**。
function emitAyaya() {
  const server = spec.graph_type === 'server';
  const prelude = server ? 'graph_prelude_server' : 'graph_prelude_client';

  const L = [];
  L.push('"""');
  L.push('graph_id: ' + spec.graph_id);
  L.push('graph_name: ' + spec.graph_name);
  L.push('graph_type: ' + spec.graph_type);
  if (spec.mount) L.push('mount: ' + spec.mount);
  L.push('description: ' + (spec.description || '由 src/emit.mjs 从 behavior-spec 生成（target=ayaya, deprecated）'));
  L.push('"""');
  L.push('');
  L.push('import sys');
  L.push('from pathlib import Path');
  L.push('');
  L.push('PROJECT_ROOT = next(p for p in Path(__file__).resolve().parents if (p / "assets" / "资源库").is_dir() or ((p / "engine").is_dir() and (p / "app").is_dir()))');
  L.push('sys.path.insert(0, str(PROJECT_ROOT))');
  L.push("sys.path.insert(1, str(PROJECT_ROOT / 'assets'))");
  L.push('');
  L.push(`from app.runtime.engine.${prelude} import *  # noqa: F401,F403`);
  L.push('');
  L.push('');
  L.push('class ' + spec.graph_name + ':');
  L.push('    def __init__(self, game, owner_entity):');
  L.push('        # 按上游约定：实例化即做静态校验，口径与编辑器一致。');
  L.push('        self.game = game');
  L.push('        self.owner_entity = owner_entity');
  L.push('');
  L.push('        from app.runtime.engine.node_graph_validator import validate_node_graph');
  L.push('');
  L.push('        validate_node_graph(self.__class__)');
  L.push('');

  const lit = (v) => {
    if (v === null || v === undefined) return 'None';
    if (typeof v === 'number') return String(v);
    if (typeof v === 'boolean') return v ? 'True' : 'False';
    if (typeof v === 'string') return JSON.stringify(v);
    if (Array.isArray(v)) return '[' + v.map(lit).join(', ') + ']';
    if (typeof v === 'object') {
      if (typeof v.$ref === 'string') return v.$ref; // 直接当 Python 标识符用（引用已有变量/形参）
      return '{' + Object.entries(v).map(([k, x]) => JSON.stringify(k) + ': ' + lit(x)).join(', ') + '}';
    }
    throw new Error('无法字面量化: ' + typeof v);
  };

  for (const h of spec.handlers) {
    L.push('    def on_' + h.event + '(self' + (h.params.length ? ', ' + h.params.join(', ') : '') + '):');
    L.push('        # 触发器：' + h.event);
    const body = h.body.filter((c) => c.node !== 'pass');
    if (body.length === 0) L.push('        pass');
    for (const c of body) {
      const head = c.out ? `${c.out}: ${JSON.stringify(c.out_type || '整数')} = ` : '';
      const args = ['self.game'];
      const raw = c.args;
      if (Array.isArray(raw)) {
        errs.push(`ayaya target 不支持数组形式 args（节点 "${c.node}"）；请用 {端口名: 值} 对象形式`);
        continue;
      }
      for (const [k, v] of Object.entries(raw || {})) args.push(k + '=' + lit(v));
      L.push('        ' + head + c.node + '(' + args.join(', ') + ')');
    }
    L.push('');
  }

  L.push('    def register_handlers(self):');
  for (const h of spec.handlers) {
    L.push('        self.game.register_event_handler(' + JSON.stringify(h.event) + ', self.on_' + h.event + ', owner=self.owner_entity)');
  }
  L.push('');
  L.push('');
  L.push('if __name__ == "__main__":');
  L.push('    from app.runtime.engine.node_graph_validator import validate_file_cli');
  L.push('');
  L.push('    raise SystemExit(validate_file_cli(__file__))');
  L.push('');
  return { code: L.join('\n'), warns: [] };
}

// ════════════════════════════════════════════════════════════════════════════
// main
// ════════════════════════════════════════════════════════════════════════════
let built;
try {
  built = target === 'gts' ? emitGts() : emitAyaya();
} catch (e) {
  console.error('❌ 生成失败：' + (e instanceof Error ? e.message : String(e)));
  process.exit(2);
}
if (errs.length) {
  console.error('❌ spec 与 nodes.json 对不上，未生成文件：');
  for (const e of errs) console.error('   · ' + e);
  process.exit(2);
}

fs.mkdirSync(outdir, { recursive: true });
const ext = target === 'gts' ? '.ts' : '.py';
const outFile = path.join(outdir, spec.graph_name + ext);
fs.writeFileSync(outFile, built.code, 'utf8');

console.log('✅ 生成 ' + (target === 'gts' ? 'genshin-ts 源码' : 'Ayaya Graph Code') + ': ' + outFile);
console.log(
  '   图 ' + spec.graph_id + '（' + spec.graph_type + '），' + spec.handlers.length +
    ' 个触发器，' + allCalls.length + ' 次节点调用 → target=' + target
);
if (catalog) {
  console.log(
    '   节点总表：' + (catalog.nodes || []).length + ' 个（来源 ' +
      (catalog._provenance?.upstream_license || '?') + '，' + catalogPath + '）'
  );
} else {
  console.log('   ⚠️ 没有 nodes.json ⇒ 跳过了节点名前置校验');
}
for (const w of built.warns) console.log('   ⚠️ ' + w);

if (target === 'gts') {
  console.log('');
  console.log('ℹ️ 下一步（落盘不是本工具的事）：');
  console.log('   node src/gts-build.mjs --src="' + outFile + '" --workbench=<装了 genshin-ts 的目录>');
  console.log('     → 它会在 workbench 里跑 gsts compile 出 .gia，可选再 inject 到 `_work/` 的 .gil 副本');
  process.exit(0);
}

// ── ayaya 分支的外部校验（GPL 隔离：只起子进程；deprecated） ──────────────
if (!ayayaArg) {
  console.log('');
  console.log('ℹ️ target=ayaya 且未给 --ayaya，跳过外部校验。要校验请加：');
  console.log('   --target=ayaya --ayaya=<Ayaya_Miliastra_Editor 仓库根目录> --python=<python.exe>');
  process.exit(0);
}

const AY = path.resolve(ayayaArg);
if (!fs.existsSync(path.join(AY, 'app', 'cli', 'graph_tools.py'))) {
  console.error('❌ --ayaya 路径不对（缺 app/cli/graph_tools.py）：' + AY);
  process.exit(2);
}

const stageDir = path.join(AY, 'assets', '资源库', '共享', '节点图', spec.graph_type || 'server', '实体节点图', '_qx_emitted');
fs.mkdirSync(stageDir, { recursive: true });
const staged = path.join(stageDir, spec.graph_name + '.py');
fs.copyFileSync(outFile, staged);
console.log('   已复制到上游 workspace 暂存位（校验要求）：' + staged);

const args = ['-X', 'utf8', '-m', 'app.cli.graph_tools', 'validate-file', staged];
console.log('');
console.log('$ (cwd=' + AY + ') ' + pyExe + ' ' + args.join(' '));
let code = 0;
let stdout = '';
try {
  stdout = execFileSync(pyExe, args, { cwd: AY, encoding: 'utf8', timeout: 600000, stdio: ['ignore', 'pipe', 'pipe'] });
} catch (e) {
  code = e.status || 1;
  stdout = (e.stdout || '') + (e.stderr || '') || e.message;
}
process.stdout.write(stdout);
console.log('');
console.log('--- validate-file 退出码: ' + code + ' ---');
if (code === 0) {
  console.log('✅ 外部校验通过。下一步（落盘 .gil/.gia）由上游工具执行，本工程不代劳。');
} else {
  console.log('❌ 外部校验失败。**不要**为此改本工程里的任何东西 —— 改 spec。');
}
process.exit(code === 0 ? 0 : 1);
