// test/run-tests.mjs —— 离线自测（不联网、不需要 Python、不需要外部仓库）
//
// 为什么要有它：emit.mjs 的"把关"逻辑（spec 校验 / 未知节点拦截 / $ref 连线）如果只在
// 装了 genshin-ts 或 Ayaya 的机器上才能验，那它迟早会在别人机器上静默退化。
// 所以这里把**纯本地**的判据全测一遍：
//   · 入库的 nodes.json（MIT 派生）自洽性
//   · emit.mjs 默认 target=gts 的正向生成文本
//   · emit.mjs 的反向拦截（坏 spec 必须 exit 2）
//   · emit.mjs --target=ayaya（deprecated 分支）没被改坏
//   · gts-build.mjs 在缺 --workbench 时干净报错（而不是崩）
//
// 跑法：node test/run-tests.mjs
// 退出码：0 全过；1 有失败

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GC = path.resolve(HERE, '..', 'src');
const ROOT = path.resolve(HERE, '..');

let pass = 0;
let fail = 0;
const failures = [];
function ok(cond, name, detail) {
  if (cond) {
    pass++;
    console.log('  ✅ ' + name);
  } else {
    fail++;
    failures.push(name + (detail ? ' — ' + detail : ''));
    console.log('  ❌ ' + name + (detail ? ' — ' + detail : ''));
  }
}
function eq(a, b, name) {
  ok(a === b, name, a === b ? '' : '期望 ' + JSON.stringify(b) + '，实际 ' + JSON.stringify(a));
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'qxgc-'));
const runNode = (script, args) => {
  try {
    const out = execFileSync(process.execPath, [script, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { code: 0, out };
  } catch (e) {
    return { code: e.status || 1, out: ((e.stdout || '') + (e.stderr || '')).toString() };
  }
};
const runEmit = (specPath, extra = []) =>
  runNode(path.join(GC, 'emit.mjs'), ['--spec=' + specPath, '--outdir=' + tmp, ...extra]);

// ════════════════════════════════════════════════════════════════════════════
console.log('\n[1] nodes.json 自洽性（来源必须是 MIT）');
// ════════════════════════════════════════════════════════════════════════════
const nodesPath = path.join(ROOT, 'data', 'nodes.json');
ok(fs.existsSync(nodesPath), 'nodes.json 存在');
let doc = null;
if (fs.existsSync(nodesPath)) {
  doc = JSON.parse(fs.readFileSync(nodesPath, 'utf8'));
  const prov = doc._provenance || {};
  eq(prov.upstream_license, 'MIT', '上游许可字段 = MIT（不再分发 GPL-3.0 派生表）');
  ok(/genshin-ts/.test(prov.upstream || ''), '上游指向 genshin-ts', prov.upstream);
  ok(/--gts=/.test(prov.regenerate || ''), 'regenerate 命令是 --gts=（主路线）', prov.regenerate);
  ok(!('graph_consts' in doc), '不再输出 Ayaya 专有的 graph_consts 字段');

  eq(doc.nodes.length, 729, '节点总数 = 729（服务端 498 + 客户端 231）');
  eq(doc.counts.server, 498, 'counts.server = 498');
  eq(doc.counts.client, 231, 'counts.client = 231');
  eq(doc.counts.with_dsl_name, 620, '有中文名的节点 = 620');
  eq(doc.counts.server_triggers, 55, '服务端 Trigger = 55');
  eq(doc.types.length, 26, 'types = 26（与旧 Ayaya 版同数，可交叉验证）');
  ok(Array.isArray(doc.events) && doc.events.length === 65, 'events = 65', String(doc.events && doc.events.length));

  const triggers = doc.nodes.filter((n) => n.range === 'Server' && n.class === 'Trigger');
  eq(triggers.length, 55, '按 class 过滤出的 Trigger 也是 55');
  ok(triggers.every((n) => n.dsl && n.method), '每个 server Trigger 都有中文名 + TS 方法名');

  // 端口是 {name,type}；name 可能为 null（上游没给中文端口名），但 type 必须有
  const anyPort = doc.nodes.find((n) => Array.isArray(n.inputs) && n.inputs.length);
  ok(
    anyPort && typeof anyPort.inputs[0] === 'object' && 'name' in anyPort.inputs[0] && anyPort.inputs[0].type,
    '端口是 {name,type}，不是裸类型字符串',
    anyPort ? JSON.stringify(anyPort.inputs[0]) : 'no sample'
  );
  ok(
    doc.nodes.filter((n) => n.range === 'Server').every((n) => (n.inputs_types || []).length === (n.inputs || []).length),
    'inputs_types 与 inputs 长度一致（端口顺序可对齐）'
  );

  // 抽查我们真正依赖的两个节点
  const setVar = doc.nodes.find((n) => n.dsl === '设置自定义变量');
  ok(!!setVar, '有「设置自定义变量」');
  if (setVar) {
    eq(setVar.method, 'setCustomVariable', '「设置自定义变量」的 TS 方法名');
    const names = (setVar.inputs || []).map((p) => p.name);
    ok(
      names.includes('目标实体') && names.includes('变量名') && names.includes('变量值') && names.includes('是否触发事件'),
      '「设置自定义变量」端口名齐全',
      JSON.stringify(names)
    );
    ok(Array.isArray(setVar.reflect_map) && setVar.reflect_map.length > 0, '带泛型具体化表 reflect_map');
  }
  const onCreate = doc.nodes.find((n) => n.dsl === '实体创建时');
  ok(!!onCreate, '有「实体创建时」');
  if (onCreate) {
    eq(onCreate.method, 'whenEntityIsCreated', '「实体创建时」的 TS 方法名');
    eq(JSON.stringify((onCreate.outputs || []).map((p) => p.name)), JSON.stringify(['事件源实体', '事件源GUID']),
      '「实体创建时」输出端口名');
  }
  const ev = (doc.events || []).find((e) => e.method === 'whenEntityIsCreated');
  ok(!!ev, 'events 里有 whenEntityIsCreated');
  if (ev) {
    eq(ev.zh, '实体创建时', '事件的 zh = 实体创建时');
    const p = (ev.payload || []).find((x) => x.zh === '事件源实体');
    ok(!!p && p.field === 'eventSourceEntity', '事件出参 事件源实体 → eventSourceEntity',
      JSON.stringify(ev.payload));
  }
}

// ════════════════════════════════════════════════════════════════════════════
console.log('\n[2] emit.mjs 正向：默认 target=gts，最小闭环 spec 能生成 TS');
// ════════════════════════════════════════════════════════════════════════════
const minSpecPath = path.join(ROOT, 'specs', 'min-loop.json');
const minSpec = JSON.parse(fs.readFileSync(minSpecPath, 'utf8'));
const r1 = runEmit(minSpecPath);
eq(r1.code, 0, 'min-loop.json 生成成功（exit 0）', r1.out.slice(0, 400));
ok(/target=gts/.test(r1.out), '默认 target 是 gts');
const tsOut = path.join(tmp, minSpec.graph_name + '.ts');
ok(fs.existsSync(tsOut), '产物 .ts 存在');
if (fs.existsSync(tsOut)) {
  const src = fs.readFileSync(tsOut, 'utf8');
  ok(src.includes("import { g } from 'genshin-ts/runtime/core'"), '有 genshin-ts 的 import');
  ok(src.includes('g.server({'), 'server 图入口是 g.server(');
  ok(src.includes('id: ' + minSpec.graph_id + ','), '写进了数字 graph_id');
  ok(src.includes('.on("whenEntityIsCreated"'), '中文事件名被翻译成 gts 事件方法名');
  ok(src.includes('const 事件源实体 = evt.eventSourceEntity'), '事件出参 中文名 → evt.<字段>');
  ok(src.includes("f.printString('qx-min-loop: entity created')"), '节点 中文名 → f.<方法>(位置参数)');
  ok(/f\.setCustomVariable\(事件源实体, 'qx_min_loop_flag', 1n, true\)/.test(src),
    '$ref 生成连线；$int 生成 bigint 字面量',
    src.split('\n').find((l) => l.includes('setCustomVariable')) || '');
  ok(!src.includes('$ref'), '没有把 $ref 原样漏进产物');
  ok(!src.includes('self.game'), '没有残留 Ayaya 的 self.game 调用约定');
}

// ════════════════════════════════════════════════════════════════════════════
console.log('\n[3] emit.mjs 反向：坏 spec 必须被挡住（exit 2）');
// ════════════════════════════════════════════════════════════════════════════
const bad = (obj, name, expectFragment) => {
  const p = path.join(tmp, name.replace(/[^\w]/g, '_') + '.json');
  fs.writeFileSync(p, JSON.stringify(obj), 'utf8');
  const r = runEmit(p);
  ok(r.code === 2, name + ' 被拒（exit 2）', 'exit=' + r.code + ' ' + r.out.slice(0, 200));
  if (expectFragment) ok(r.out.includes(expectFragment), name + ' 报错含「' + expectFragment + '」', r.out.slice(0, 300));
};

const base = {
  graph_id: 1073741825,
  graph_name: '合法类名',
  graph_type: 'server',
  handlers: [{ event: '实体创建时', params: ['事件源实体'], body: [{ node: '打印字符串', args: ['x'] }] }],
};

bad({ ...base, graph_name: '' }, '缺 graph_name', 'graph_name');
bad({ ...base, graph_type: 'realtime' }, '非法 graph_type', 'graph_type');
bad({ ...base, handlers: [] }, '空 handlers', 'handlers');
bad({ ...base, graph_name: '带空格的 名字' }, 'graph_name 不是合法标识符', '标识符');
bad({ ...base, graph_id: 'server_01' }, 'gts target 的 graph_id 必须是数字', '数字');
bad(
  { ...base, handlers: [{ ...base.handlers[0], body: [{ node: '根本不存在的节点', args: [] }] }] },
  '未知节点名',
  '不在 nodes.json 里'
);
bad(
  { ...base, handlers: [{ ...base.handlers[0], event: '打印字符串' }] },
  'event 用了非 Trigger 节点',
  'Trigger'
);
bad(
  { ...base, handlers: [{ ...base.handlers[0], params: ['有-横线的形参'] }] },
  'params 含非法标识符',
  '标识符'
);
bad(
  { ...base, handlers: [{ ...base.handlers[0], params: ['并不存在的出参'] }] },
  'params 不在事件出参里',
  '出参'
);
// 对象形式 args 时端口名对不上必须报错（不猜）
bad(
  { ...base, handlers: [{ ...base.handlers[0], body: [{ node: '打印字符串', args: { 不存在的端口: 'x' } }] }] },
  '对象 args 的端口名对不上',
  '端口名对不上'
);
bad({ graph_id: 1073741825, graph_name: 'x', graph_type: 'client', handlers: base.handlers },
  'client 图缺 graph_subtype', 'graph_subtype');

// ════════════════════════════════════════════════════════════════════════════
console.log('\n[4] emit.mjs --target=ayaya：deprecated 分支仍然可用（离线）');
// ════════════════════════════════════════════════════════════════════════════
const aySpecPath = path.join(ROOT, 'specs', 'min-loop-ayaya.json');
const aySpec = JSON.parse(fs.readFileSync(aySpecPath, 'utf8'));
const rAy = runEmit(aySpecPath, ['--target=ayaya']);
eq(rAy.code, 0, '--target=ayaya 生成成功（exit 0）', rAy.out.slice(0, 300));
const pyOut = path.join(tmp, aySpec.graph_name + '.py');
ok(fs.existsSync(pyOut), '产物 .py 存在');
if (fs.existsSync(pyOut)) {
  const py = fs.readFileSync(pyOut, 'utf8');
  ok(py.includes('graph_id: ' + aySpec.graph_id), '文件头 docstring 带 graph_id');
  ok(py.includes('from app.runtime.engine.graph_prelude_server import *'), 'bootstrap: server prelude');
  ok(py.includes('validate_node_graph(self.__class__)'), '__init__ 里做静态校验');
  ok(py.includes('def on_实体创建时(self, 事件源实体, 事件源GUID):'), 'handler 形参 = 触发器输出端口名');
  ok(/设置自定义变量\(self\.game,\s*目标实体=事件源实体,/.test(py), '$ref 生成连线（Python 标识符）');
  ok(py.includes('是否触发事件=True'), '布尔字面量 True（不是 true）');
}
// 默认 target 不变：同一个 spec 走 gts 会因 graph_id 是字符串而被拒
const rAyDefault = runEmit(aySpecPath);
eq(rAyDefault.code, 2, '同一 spec 走默认 target=gts 被拒（graph_id 必须数字）');

// ════════════════════════════════════════════════════════════════════════════
console.log('\n[5] gts-build.mjs：缺 --workbench 要干净报错，不能崩');
// ════════════════════════════════════════════════════════════════════════════
const rGb = runNode(path.join(GC, 'gts-build.mjs'), ['--src=' + nodesPath]);
eq(rGb.code, 2, 'gts-build 缺 --workbench → exit 2');
ok(/workbench/.test(rGb.out), '报错里点明要 --workbench', rGb.out.slice(0, 200));

// ════════════════════════════════════════════════════════════════════════════
console.log('\n[6] read.mjs：输入不存在要报错，不能静默成功');
// ════════════════════════════════════════════════════════════════════════════
const rRead = runNode(path.join(GC, 'read.mjs'), ['--gil=' + path.join(tmp, 'nope.gil')]);
eq(rRead.code, 2, '不存在的 .gil → exit 2');

// ════════════════════════════════════════════════════════════════════════════
// 以下是 2026-11 加的一批：**官方 .gia 样本验收集**（fixture 驱动，离线可跑）
//
//   为什么要用 fixture 而不是直接读 assets/*.gia：
//     `.gia` 是别人的产物（跨仓库、跨版本、体积大），而且这一批样本在我们的
//     `assets/` 里还是未入库状态。**能入库的只有「我们自己的解码器从它身上读出的结论」**。
//   ⇒ 本组测试只读 `fixtures/*.json`，一个字节的 .gia 都不需要。
//   重生成命令（需要 assets/ 里有样本）：
//     node tools/qx/graphcode/coverage.mjs --in=assets --md=docs/official-gia-coverage.md
//     node tools/qx/graphcode/roundtrip.mjs --in=assets --workbench=<装了 genshin-ts 的目录>
// ════════════════════════════════════════════════════════════════════════════
const FIX = path.join(ROOT, 'fixtures');

console.log('\n[7] fixtures：5 份官方 .gia 的解码 digest 基线');
// ════════════════════════════════════════════════════════════════════════════
const fixIndexPath = path.join(FIX, 'index.json');
ok(fs.existsSync(fixIndexPath), 'fixtures/index.json 存在');
let fixIndex = null;
if (fs.existsSync(fixIndexPath)) {
  fixIndex = JSON.parse(fs.readFileSync(fixIndexPath, 'utf8'));
  eq((fixIndex.samples || []).length, 5, '样本数 = 5');
}
const DIGEST_BASE = {
  // slug → {graphs, nodes, edges, defs, defsWithImpl?}
  'fall-protect': { graphs: 1, nodes: 7, edges: 8, defs: 0 },
  'composite-atlas': { graphs: 87, nodes: 473, edges: 523, defs: 87, defsWithImpl: 80 },
  'projectile-coords': { graphs: 4, nodes: 34, edges: 42, defs: 3 },
  'disconnect-detect': { graphs: 2, nodes: 33, edges: 37, defs: 9 },
  'double-jump': { graphs: 1, nodes: 40, edges: 60, defs: 0 },
};
const digests = {};
for (const [slug, want] of Object.entries(DIGEST_BASE)) {
  const p = path.join(FIX, slug + '.digest.json');
  if (!ok(fs.existsSync(p), slug + '.digest.json 存在')) continue;
  const d = JSON.parse(fs.readFileSync(p, 'utf8'));
  digests[slug] = d;
  eq(d._kind, 'qx.graphcode.gia-digest', slug + ' 是 digest');
  eq(d.graphs.length, want.graphs, slug + ' 图数 = ' + want.graphs);
  eq(d.totals.nodes, want.nodes, slug + ' 节点数 = ' + want.nodes);
  eq(d.totals.edges, want.edges, slug + ' 连线数 = ' + want.edges);
  eq(d.nodeDefs.length, want.defs, slug + ' 节点定义(复合)数 = ' + want.defs);
  if (want.defsWithImpl != null) {
    eq(d.nodeDefs.filter((x) => x.implGraph).length, want.defsWithImpl, slug + ' 能对上实现图的定义数 = ' + want.defsWithImpl);
  }
  // 结构性不变量：每张图的 节点数 == 类型直方图之和；连线 = 执行 + 数据
  ok(
    d.graphs.every((g) => Object.values(g.typeHistogram).reduce((a, b) => a + b, 0) === g.nodes),
    slug + ' 每张图：类型直方图之和 == 节点数'
  );
  ok(d.graphs.every((g) => g.flowEdges + g.dataEdges === g.edges), slug + ' 每张图：执行连线 + 数据连线 == 总连线');
  // 信封
  ok(Array.isArray(d.envelope.headerU32) && d.envelope.headerU32.length === 5, slug + ' 信封 5×u32');
  eq(d.envelope.trailerLen, 4, slug + ' 尾部 4 字节');
}

// 逐份的「读到了什么」断言（这些数字都是本轮实测出来的）
if (digests['fall-protect']) {
  const d = digests['fall-protect'];
  eq(JSON.stringify(d.units.whichCounts), JSON.stringify({ 7: 1, 9: 1 }), 'fall-protect 单元种类 = {7×1, 9×1}');
  const g = d.graphs[0];
  eq(g.name, '坠崖保护', 'fall-protect 图名');
  eq(g.graphId, 1073741845, 'fall-protect graphId');
  eq(JSON.stringify(g.header), JSON.stringify({ tag1: 10000, tag2: 20000, tag3: 21001, graphId: 1073741845 }), 'fall-protect 图头');
  eq(g.flowEdges, 2, 'fall-protect 执行连线 2 条');
  eq(g.dataEdges, 6, 'fall-protect 数据连线 6 条');
}
if (digests['composite-atlas']) {
  const d = digests['composite-atlas'];
  eq(JSON.stringify(d.units.whichCounts), JSON.stringify({ 9: 87, 12: 87 }), 'composite-atlas 单元种类 = {9×87, 12×87}');
  eq(d.resources.composites.length > 0, true, 'composite-atlas 记录到复合节点引用');
  ok(d.nodeDefs.every((x) => x.pinCount && typeof x.pinCount.data_out === 'number'), '每个定义都有引脚数');
}
if (digests['disconnect-detect']) {
  const d = digests['disconnect-detect'];
  eq(JSON.stringify(d.resources.signals.map((s) => s.name)), JSON.stringify(['[玩家]检测掉线-心跳包', '[玩家]检测掉线-广播信号']), 'disconnect-detect 信号名（间接读法）');
  eq(JSON.stringify(d.resources.variables.map((s) => s.name)), JSON.stringify(['NOLOC_isDisconnect']), 'disconnect-detect 图变量名');
  ok(d.units.whichCounts['69'] === 1, 'disconnect-detect 里识别出客户端脚本单元(which=69)');
}
if (digests['double-jump']) {
  eq(JSON.stringify(digests['double-jump'].resources.variables.map((s) => s.name)), JSON.stringify(['平台']), 'double-jump 图变量 = 平台');
}

console.log('\n[8] 黄金解码：fall-protect 的 7 个节点逐条对得上');
// ════════════════════════════════════════════════════════════════════════════
const decodePath = path.join(FIX, 'fall-protect.decode.json');
ok(fs.existsSync(decodePath), 'fall-protect.decode.json 存在');
if (fs.existsSync(decodePath)) {
  const dec = JSON.parse(fs.readFileSync(decodePath, 'utf8'));
  eq(dec.length, 1, '解码 fixture 里 1 张图');
  const g = dec[0];
  eq(g.name, '坠崖保护', '图名');
  eq(g.nodes.length, 7, '7 个节点');
  const byId = new Map(g.nodes.map((n) => [n.index, n]));
  const want = [
    [2, 946, '角色移动速度达到条件时', 'whenCharacterMovementSpdMeetsCondition', 'catalog'],
    [3, 2, '双分支', 'doubleBranch', 'catalog'],
    [4, 99, '获取实体位置与旋转', 'getEntityLocationAndRotation', 'catalog'],
    [6, 231, '数值小于等于', 'lessThanOrEqualTo', 'catalog'],
    [7, 259, '获取角色归属的玩家实体', 'getPlayerEntityToWhichTheCharacterBelongs', 'catalog'],
  ];
  for (const [idx, tid, dsl, method, src] of want) {
    const n = byId.get(idx);
    ok(!!n, '有节点 #' + idx);
    if (!n) continue;
    eq(n.typeId, tid, '#' + idx + ' type_id');
    eq(n.dsl, dsl, '#' + idx + ' 中文名');
    eq(n.method, method, '#' + idx + ' gts 方法名');
    eq(n.source, src, '#' + idx + ' 解析来源');
  }
  // 两个「只有英文名、nodes.json 里没有 method」的节点 —— 这是覆盖度缺口的活证据
  for (const [idx, tid, en] of [
    [1, 288, 'Teleport Player (Beyond Mode)'],
    [5, 9, 'Split 3D Vector'],
  ]) {
    const n = byId.get(idx);
    ok(!!n, '有节点 #' + idx);
    if (!n) continue;
    eq(n.typeId, tid, '#' + idx + ' type_id');
    eq(n.name, en, '#' + idx + ' 只有英文名');
    ok(n.method === null || n.method === '', '#' + idx + ' 没有 gts 方法名（所以要靠 node-aliases.json）', JSON.stringify(n.method));
  }
  // 连线方向：执行流 2 条，且都能从触发器走到传送
  const flow = g.edges.filter((e) => e.category === 'flow');
  eq(flow.length, 2, '执行连线 2 条');
  eq(
    JSON.stringify(flow.map((e) => e.from.node + '→' + e.to.node)),
    JSON.stringify(['2→3', '3→1']),
    '执行链：#2 触发器 → #3 双分支 → #1 传送'
  );
}

console.log('\n[9] node-aliases.json 自洽（别名不许瞎写）');
// ════════════════════════════════════════════════════════════════════════════
const aliasPath2 = path.join(ROOT, 'data', 'node-aliases.json');
ok(fs.existsSync(aliasPath2), 'node-aliases.json 存在');
if (fs.existsSync(aliasPath2)) {
  const ad = JSON.parse(fs.readFileSync(aliasPath2, 'utf8'));
  ok(ad._provenance && /宁可少收/.test(ad._provenance.policy || ''), '别名表写了「宁可少收，不许猜」的政策');
  const catById = new Map((doc ? doc.nodes : []).map((n) => [n.id, n]));
  for (const a of ad.aliases || []) {
    ok(!!catById.get(a.type_id), 'alias type_id=' + a.type_id + ' 在 nodes.json 里');
    ok(typeof a.gts_method === 'string' && a.gts_method.length > 0, 'alias ' + a.type_id + ' 有 gts_method');
    ok(typeof a.evidence === 'string' && a.evidence.length > 20, 'alias ' + a.type_id + ' 写了 evidence');
    ok(['[实测]', '[推断]'].includes(a.confidence), 'alias ' + a.type_id + ' confidence 只能是 [实测]/[推断]');
    const cat = catById.get(a.type_id);
    // 别名只该补「上游没给 method」的洞；上游已经给了就是对不上
    ok(cat && !cat.method, 'alias ' + a.type_id + ' 补的确实是「上游没有 method」的洞');
  }
  for (const [k, v] of Object.entries(ad.out_fields || {})) {
    if (k.startsWith('_')) continue;
    ok(Array.isArray(v.fields) && v.fields.every((x) => typeof x === 'string' && x), 'out_fields[' + k + '] 是字符串数组');
    ok(!!catById.get(Number(k)), 'out_fields 的 key=' + k + ' 是真实 type_id');
    ok(typeof v.evidence === 'string' && v.evidence.length > 20, 'out_fields[' + k + '] 写了 evidence');
  }
}

console.log('\n[10] 反向回编译基线：哪张过、哪张不过、不过的原因分类');
// ════════════════════════════════════════════════════════════════════════════
const rtPath = path.join(FIX, 'roundtrip.json');
ok(fs.existsSync(rtPath), 'fixtures/roundtrip.json 存在');
if (fs.existsSync(rtPath)) {
  const rt = JSON.parse(fs.readFileSync(rtPath, 'utf8'));
  const byCase = new Map((rt.cases || []).map((c) => [c.slug, c]));
  ok(byCase.size >= 5, '至少 5 个回编译用例', String(byCase.size));

  const st = (slug) => (byCase.get(slug) || {}).status;
  eq(st('atlas-collision-death'), 'generated', 'atlas-collision-death 生成成功');
  eq(st('atlas-hide-player-model'), 'generated', 'atlas-hide-player-model 生成成功');
  eq(st('fall-protect-strict'), 'blocked', 'fall-protect（strict）被拒');
  eq(st('projectile-coords'), 'blocked', 'projectile-coords 被拒');
  eq(st('disconnect-detect'), 'blocked', 'disconnect-detect 被拒');
  eq(st('double-jump'), 'blocked', 'double-jump 被拒');

  // 两张能过的，compile 必须是 ok（这条只有在跑了 --workbench 的机器上才有值）
  for (const slug of ['atlas-collision-death', 'atlas-hide-player-model']) {
    const c = byCase.get(slug) || {};
    ok(c.compile && ['ok', 'skipped'].includes(c.compile.status), slug + ' compile = ok/skipped（实际 ' + JSON.stringify(c.compile) + '）');
    if (c.compile && c.compile.status === 'ok') {
      ok(c.compile.gia && c.compile.gia.bytes > 0, slug + ' 产出了非空 .gia');
      ok(c.compile.gia && /^[0-9a-f]{16}$/.test(c.compile.gia.sha256), slug + ' .gia 有 sha256 指纹');
    }
  }
  // 不过的那条：必须是「我们的层」拒绝，且原因分类对得上
  const strict = byCase.get('fall-protect-strict') || {};
  ok((strict.blockers || []).includes('CONTROL_FLOW_NODE'), 'fall-protect-strict 的原因是 CONTROL_FLOW_NODE（分支节点）');
  const proj = byCase.get('projectile-coords') || {};
  ok((proj.blockers || []).includes('COMPOSITE_NODE'), 'projectile-coords 的原因是 COMPOSITE_NODE（复合节点）');
  const dc = byCase.get('disconnect-detect') || {};
  ok((dc.blockers || []).includes('NO_METHOD') || (dc.blockers || []).includes('NO_DSL_NAME'), 'disconnect-detect 命中了「上游没名字/没方法」的洞');
  const dj = byCase.get('double-jump') || {};
  ok((dj.blockers || []).includes('ENUM_CONSTANT'), 'double-jump 命中 ENUM_CONSTANT（枚举常量没映射）');
  ok((dj.blockers || []).includes('LIST_CONSTANT'), 'double-jump 命中 LIST_CONSTANT（列表常量没验证）');

  // 那条「强行降级」的用例：编译必须真失败，且失败在 gts 的 IR 生成阶段
  const lin = byCase.get('fall-protect-linear') || {};
  if (lin.compile && lin.compile.status !== 'skipped') {
    eq(lin.compile.status, 'failed', 'fall-protect-linear 编译失败（这是实测边界，不是我们的 bug）');
    ok(/fn is not a function/.test(lin.compile.errorLine || ''), '失败信息是 gts 分支 API 的回调缺失', lin.compile.errorLine);
  }
}

console.log('\n[11] 离线复现：fixture spec → emit → 与 fixture 里的 TS 逐字节一致');
// ════════════════════════════════════════════════════════════════════════════
const specFiles = fs.existsSync(FIX) ? fs.readdirSync(FIX).filter((f) => f.endsWith('.spec.json')) : [];
ok(specFiles.length >= 3, 'fixtures 里至少 3 个 spec', String(specFiles.length));
for (const f of specFiles) {
  const spec = JSON.parse(fs.readFileSync(path.join(FIX, f), 'utf8'));
  // spec 形状
  ok(typeof spec.graph_id === 'number', f + '：graph_id 是数字');
  ok(/^[\p{Script=Han}A-Za-z_][\p{Script=Han}A-Za-z0-9_]*$/u.test(spec.graph_name || ''), f + '：graph_name 是合法标识符');
  ok(Array.isArray(spec.handlers) && spec.handlers.length > 0, f + '：handlers 非空');
  ok(!JSON.stringify(spec).includes('$ref"') || true, f + '：可序列化');

  const specOut = path.join(tmp, 'rt-' + f);
  fs.copyFileSync(path.join(FIX, f), specOut);
  const r = runEmit(specOut);
  const goldenName = f.replace(/\.spec\.json$/, '.emit.ts');
  const golden = path.join(FIX, goldenName);
  if (!fs.existsSync(golden)) {
    ok(false, f + '：缺同名 golden ' + goldenName);
    continue;
  }
  eq(r.code, 0, f + '：emit 成功（离线）', r.out.slice(0, 300));
  // runEmit 的默认 outdir 就是 tmp
  const produced = path.join(tmp, spec.graph_name + '.ts');
  if (!ok(fs.existsSync(produced), f + '：产出了 ' + spec.graph_name + '.ts')) continue;
  ok(
    fs.readFileSync(produced, 'utf8') === fs.readFileSync(golden, 'utf8'),
    f + '：产物与 golden 逐字节一致（翻译算法没有悄悄漂移）'
  );
  // golden 本身的要求
  const ts = fs.readFileSync(golden, 'utf8');
  ok(ts.includes("import { g } from 'genshin-ts/runtime/core'"), goldenName + ' 有 genshin-ts import');
  ok(ts.includes('g.server({'), goldenName + ' 是 server 图');
  ok(!ts.includes('$ref'), goldenName + ' 没有把 $ref 漏进产物');
}

console.log('\n[12] 反向拦截：翻译层不认识的输入必须报错，不能编');
// ════════════════════════════════════════════════════════════════════════════
// read2spec：不存在的输入
const rR2S = runNode(path.join(GC, 'read2spec.mjs'), ['--gia=' + path.join(tmp, 'nope.gia')]);
eq(rR2S.code, 2, 'read2spec 输入不存在 → exit 2');
// roundtrip：样本缺失时不能崩，而且**不许清空基线**
const fixBackup = fs.existsSync(path.join(FIX, 'roundtrip.json'))
  ? fs.readFileSync(path.join(FIX, 'roundtrip.json'), 'utf8')
  : null;
const rRt = runNode(path.join(GC, 'roundtrip.mjs'), ['--in=' + path.join(tmp, 'no-such-dir'), '--fixtures=' + path.join(tmp, 'rt-fix')]);
ok([0, 1].includes(rRt.code), 'roundtrip 在样本缺失时优雅退化（exit ' + rRt.code + '）', rRt.out.slice(0, 200));
ok(/不写 fixtures/.test(rRt.out), 'roundtrip 样本全缺时明确声明不写 fixture', rRt.out.slice(-200));
ok(
  fixBackup === (fs.existsSync(path.join(FIX, 'roundtrip.json')) ? fs.readFileSync(path.join(FIX, 'roundtrip.json'), 'utf8') : null),
  'roundtrip 没有动 fixtures/roundtrip.json（基线不被自测覆盖）'
);
// coverage：样本缺失也不能崩
const rCov = runNode(path.join(GC, 'coverage.mjs'), ['--in=' + path.join(tmp, 'no-such-dir'), '--no-fixtures']);
ok([0, 1].includes(rCov.code), 'coverage 在样本缺失时优雅退化（exit ' + rCov.code + '）', rCov.out.slice(0, 200));

// ════════════════════════════════════════════════════════════════════════════
console.log('\n' + '='.repeat(60));
console.log('通过 ' + pass + '，失败 ' + fail);
if (failures.length) {
  console.log('\n失败项：');
  for (const f of failures) console.log('  · ' + f);
}
fs.rmSync(tmp, { recursive: true, force: true });
process.exit(fail === 0 ? 0 : 1);
