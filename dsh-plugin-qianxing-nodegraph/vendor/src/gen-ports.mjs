// src/gen-ports.mjs —— 从外部仓库 `@node_spec` 抽「端口名」（nodes.json 缺的那一半）
//
// ════════════════════════════════════════════════════════════════════════════
// 为什么还要这个脚本
// ════════════════════════════════════════════════════════════════════════════
//   `node_data/index.json`（gen-nodes.mjs 用的）只给端口**类型**：
//       "Inputs": ["Str"]              ← 类型
//   而 Graph Code 里调用节点要写的是端口**名**：
//       打印字符串(self.game, 字符串="hi")   ← 名字
//   端口名只在 `plugins/nodes/**/*.py` 的 `@node_spec(inputs=[("字符串","字符串")])` 里。
//
//   ⇒ 本脚本**只做静态 AST 层面的事**：正则/状态机读 `@node_spec` 块的源码文本，
//     **不 import 任何上游模块**、不执行上游代码 —— 这样 GPL 隔离成立（没有代码进本工程，
//     也没有把上游变成运行期依赖），拿到的只是**端口名/类型这种事实性清单**。
//
// ⚠️ 上游自己也是「只解析不导入」（engine.nodes.pipeline 的 V2 AST 管线），做法一致。
//
// 用法：
//   node src/gen-ports.mjs --ayaya=<外部仓库> --merge     # 并进 nodes.json
//   node src/gen-ports.mjs --ayaya=... --json             # 只打印统计
//
// 退出码：0 成功；2 外部仓库不可用 / 被 deprecation 闸门拦下
//
// ════════════════════════════════════════════════════════════════════════════
// ⚠️ DEPRECATED（2026-10 改基 task-7 之后）
// ════════════════════════════════════════════════════════════════════════════
//   主路线换成 genshin-ts（MIT）之后，**端口名不再需要二次抽取**：
//   它就在 `dist/src/definitions/nodes.d.ts` 的 JSDoc 里（`gen-nodes.mjs --gts=` 直接读）。
//   本脚本（Ayaya `@node_spec` 静态解析）留着只为：本机没装 genshin-ts 时临时对表。
//
//   ⛔ 因此 `--merge` 现在**默认拒绝**：入股的 `nodes.json` 是由 MIT 源生成的，
//      拿 GPL 侧的数据去 merge 会同时污染来源和许可。真要用必须显式 `--i-know-legacy`。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

const argv = process.argv.slice(2);
const argOf = (k) => {
  const a = argv.find((s) => s.startsWith('--' + k + '='));
  return a ? a.slice(k.length + 3) : null;
};
const has = (k) => argv.includes('--' + k);

const ayaya = argOf('ayaya') || process.env.QX_AYAYA_REPO || '';
if (!ayaya) {
  console.error('缺少 --ayaya=<Ayaya_Miliastra_Editor 仓库根目录>');
  process.exit(2);
}
// deprecation 闸门：不许 GPL 侧数据悄悄 merge 进 MIT 派的 nodes.json（见文件头 ⚠️）
if (has('merge') && !has('i-know-legacy')) {
  console.error(
    '⛔ gen-ports.mjs 已 DEPRECATED：主路线的端口名由 gen-nodes.mjs --gts= 从 genshin-ts 的 JSDoc 直接取，\n' +
      '   入库的 nodes.json 是 **MIT** 派的；用 Ayaya(GPL-3.0) 的 @node_spec 去 --merge 会污染来源与许可。\n' +
      '   确实只是本机对表，请显式加 --i-know-legacy。'
  );
  process.exit(2);
}
const AY = path.resolve(ayaya);
const NODES_DIR = path.join(AY, 'plugins', 'nodes');
if (!fs.existsSync(NODES_DIR)) {
  console.error('❌ 找不到 ' + NODES_DIR);
  process.exit(2);
}

// ── 1. 遍历 .py ────────────────────────────────────────────────────────────
function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === '__pycache__') continue;
      walk(p, out);
    } else if (e.name.endsWith('.py')) {
      out.push(p);
    }
  }
  return out;
}

// ── 2. 取 @node_spec(...) 的整段文本（括号配对，跳过字符串内的括号） ──────
function specBlocks(src) {
  const out = [];
  const re = /@node_spec\s*\(/g;
  let m;
  while ((m = re.exec(src))) {
    let i = m.index + m[0].length; // 指向 '(' 之后
    let depth = 1;
    let inStr = null;
    const start = i;
    for (; i < src.length; i++) {
      const c = src[i];
      if (inStr) {
        if (c === '\\') {
          i++;
          continue;
        }
        if (c === inStr) inStr = null;
        continue;
      }
      if (c === '"' || c === "'") {
        inStr = c;
        continue;
      }
      if (c === '(') depth++;
      else if (c === ')') {
        depth--;
        if (depth === 0) break;
      }
    }
    out.push(src.slice(start, i));
  }
  return out;
}

// ── 3. 从块里取字段 ────────────────────────────────────────────────────────
const strField = (blk, key) => {
  const m = blk.match(new RegExp('(?:^|[,(\\s])' + key + '\\s*=\\s*"((?:[^"\\\\]|\\\\.)*)"', 'u'));
  return m ? m[1] : null;
};
// 取 `key=[ ("a","b"), ("c","d") ]` 里的元组列表；支持空列表
const portList = (blk, key) => {
  const m = blk.match(new RegExp('[,\\s]' + key + '\\s*=\\s*\\[', 'u'));
  if (!m) return null;
  let i = m.index + m[0].length;
  let depth = 1;
  let inStr = null;
  const start = i;
  for (; i < blk.length; i++) {
    const c = blk[i];
    if (inStr) {
      if (c === '\\') {
        i++;
        continue;
      }
      if (c === inStr) inStr = null;
      continue;
    }
    if (c === '"' || c === "'") {
      inStr = c;
      continue;
    }
    if (c === '[') depth++;
    else if (c === ']') {
      depth--;
      if (depth === 0) break;
    }
  }
  const inner = blk.slice(start, i);
  const tup = /\(\s*"((?:[^"\\]|\\.)*)"\s*,\s*"((?:[^"\\]|\\.)*)"\s*\)/g;
  const ports = [];
  let t;
  while ((t = tup.exec(inner))) ports.push({ name: t[1], type: t[2] });
  return ports;
};

// ── 4. 汇总 ────────────────────────────────────────────────────────────────
const files = walk(NODES_DIR);
const specs = [];
for (const f of files) {
  const rel = path.relative(NODES_DIR, f).split(path.sep);
  const scope = rel[0]; // server | client | shared
  if (scope !== 'server' && scope !== 'client') continue;
  const src = fs.readFileSync(f, 'utf8');
  for (const blk of specBlocks(src)) {
    const name = strField(blk, 'name');
    if (!name) continue;
    const inputs = portList(blk, 'inputs');
    const outputs = portList(blk, 'outputs');
    const category = strField(blk, 'category');
    const semantic_id = strField(blk, 'semantic_id');
    // 函数定义行（拿形参名做交叉校验：事件节点的输出端口名应等于形参名）
    const ret = src.indexOf('def ' + name + '(');
    let params = null;
    if (ret >= 0) {
      const open = src.indexOf('(', ret);
      const close = src.indexOf(')', open);
      if (open >= 0 && close > open) {
        params = src
          .slice(open + 1, close)
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
          .filter((s) => s !== 'game');
      }
    }
    specs.push({
      scope,
      name,
      category,
      ...(semantic_id ? { semantic_id } : {}),
      file: path.relative(AY, f).split(path.sep).join('/'),
      inputs: inputs || [],
      outputs: outputs || [],
      has_inputs_decl: inputs !== null,
      has_outputs_decl: outputs !== null,
      fn_params: params,
    });
  }
}

console.log('扫描 ' + files.length + ' 个 .py，得到 @node_spec ' + specs.length + ' 条');
const byScope = {};
for (const s of specs) byScope[s.scope] = (byScope[s.scope] || 0) + 1;
console.log('  按域：' + JSON.stringify(byScope));
const withIn = specs.filter((s) => s.has_inputs_decl && s.inputs.length).length;
const withOut = specs.filter((s) => s.has_outputs_decl && s.outputs.length).length;
console.log('  有输入端口：' + withIn + '，有输出端口：' + withOut);

// 事件节点：Graph Code 里 `on_<事件名>(self, <输出端口名>...)` 的形参**就是**输出端口名。
// ⚠️ 别拿 `plugins/nodes/**/事件节点/*.py` 里那个 `def 事件名(game)` 去比 ——
//    那是**运行期 mock 实现**（body 里 `return 事件源, "mock_guid"`），形参与端口无关。
//    第一版我拿它比，得到"57 个事件节点全部不一致"这种**看起来像 bug、其实是判据错**的结论。
//    正确判据只有一条：输出端口名必须是**合法 Python 标识符**（能直接当形参）。
const ev = specs.filter((s) => s.category === '事件节点');
const badIdent = [];
for (const s of ev) {
  for (const p of s.outputs) {
    if (p.type === '流程') continue;
    if (!/^[\p{Script=Han}A-Za-z_][\p{Script=Han}A-Za-z0-9_]*$/u.test(p.name)) {
      badIdent.push(s.name + '.' + p.name);
    }
  }
}
console.log('  事件节点 ' + ev.length + ' 个；输出端口名不是合法标识符的：' + badIdent.length + (badIdent.length ? ' ' + JSON.stringify(badIdent.slice(0, 5)) : ''));

if (has('json')) {
  console.log(JSON.stringify(specs.slice(0, 3), null, 2));
  process.exit(0);
}

// ── 5. 合并进 nodes.json（按 中文名 ↔ 英文 Name） ─────────────────────────
const nodesPath = path.join(ROOT, 'data', 'nodes.json');
if (!fs.existsSync(nodesPath)) {
  console.error('❌ 先跑 gen-nodes.mjs 生成 nodes.json');
  process.exit(2);
}
const doc = JSON.parse(fs.readFileSync(nodesPath, 'utf8'));

// 上游 @node_spec 的 name 是**中文 DSL 名**；nodes.json 里 dsl 就是它。
const byDsl = new Map();
for (const s of specs) {
  if (!byDsl.has(s.name)) byDsl.set(s.name, []);
  byDsl.get(s.name).push(s);
}
let merged = 0;
const unmatched = [];
for (const n of doc.nodes) {
  const cands = (n.dsl && byDsl.get(n.dsl)) || null;
  if (!cands) {
    if (n.dsl) unmatched.push(n.dsl);
    continue;
  }
  const pickScope = n.range === 'Client' ? 'client' : 'server';
  const s = cands.find((c) => c.scope === pickScope) || cands[0];
  n.inputs = s.inputs;
  n.outputs = s.outputs;
  n.port_source = s.file;
  merged++;
}
// 上游有、目录里没有的（复合节点/信号节点等），也补进来，标注出来
const dslSet = new Set(doc.nodes.map((n) => n.dsl).filter(Boolean));
const extra = [];
for (const s of specs) {
  if (dslSet.has(s.name)) continue;
  extra.push({
    scope: s.scope,
    dsl: s.name,
    category: s.category,
    inputs: s.inputs,
    outputs: s.outputs,
    port_source: s.file,
    source: 'plugins/@node_spec (不在 node_data/index.json 里)',
  });
}

doc.port_coverage = {
  merged_with_ports: merged,
  nodes_without_ports: doc.nodes.filter((n) => !n.inputs && !n.outputs).length,
  dsl_names_not_found_in_plugins: unmatched.length,
  plugins_only_entries: extra.length,
  note: 'inputs/outputs 现在是**端口名+类型**（来自 @node_spec 静态解析），比只有类型可用。',
};
doc.plugins_only_nodes = extra;

fs.writeFileSync(nodesPath, JSON.stringify(doc, null, 1), 'utf8');
console.log('');
console.log('✅ 已合并进 ' + nodesPath);
console.log('   补齐端口名的节点：' + merged);
console.log('   仍缺端口：' + doc.port_coverage.nodes_without_ports);
console.log('   目录外的 @node_spec 条目：' + extra.length);
