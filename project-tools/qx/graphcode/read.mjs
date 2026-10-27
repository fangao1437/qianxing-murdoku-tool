// tools/qx/graphcode/read.mjs —— `.gil`/`.gia` → `graph.json` + `behavior-spec.md`（+ 可选 emit spec）
//
// ════════════════════════════════════════════════════════════════════════════
// 为什么会「两条腿走路」→ 现在只剩一条腿，另一条变成可选校验
// ════════════════════════════════════════════════════════════════════════════
//
//   ① 控件层：`tools/gil/gilread.mjs`。不依赖任何外部代码，永远可用。
//
//   ② 节点图层：**2026-11 改成原生读**（`giaread.mjs`），不再需要 Python 和外部仓库。
//      旧版只能走外部解码器（`--ayaya=<仓库>` + `python.exe` → parse_gil_payload_to_graph_ir）：
//        · 本机 `python` 是 WindowsApps 的 Store stub，`python --version` 不打印 ⇒ 实际不可用；
//        · 产物落在**外部仓库**的 `out/` 里，不能入库当 fixture；
//        · 端口语义名（哪个 pin 是「变量名」）外部解码器也给不出 ⇒ 只能写 UNKNOWN。
//      现在 wire 结构我们自己解出来了（用 5 份官方/社区 `.gia` 实测反推，
//      见 `docs/official-gia-coverage.md`），节点/连线/常量/端口名**全部本地可读**。
//      `--ayaya` 保留为**可选交叉校验**：给了就连外部解码器跑一遍，只打印对照，不参与产物。
//
//   ★ 教训（别重犯）：第一版工具用「ID 命名空间」启发式找节点图段，跑本工程 5 个存档
//     全部报「0 候选」，我差点据此写下"我们这些档没有节点图"。接上外部解码器一跑，
//     `graphs_count: 1` —— **结论是错的**。原因：图的 `graph_id_int=1073741825` 正好落在
//     控件 ID 的同一数值区间（1073741824+），启发式根本区分不了。
//     ⇒ **启发式的"没找到"不等于"不存在"**。这条写进报告了。
//
// ════════════════════════════════════════════════════════════════════════════
// 用法
// ════════════════════════════════════════════════════════════════════════════
//   node tools/qx/graphcode/read.mjs --gil="517-模板测试-v2.gil"
//   node tools/qx/graphcode/read.mjs --gil="assets/保护玩家防止坠崖掉落自动传送.gia"
//   node tools/qx/graphcode/read.mjs --gil=... --spec          # 顺带出 emit 能吃的 spec
//   node tools/qx/graphcode/read.mjs --gil=... --ayaya=<外部仓库> --python=<python.exe>   # 可选交叉校验
//
// 产物（写到 --outdir，默认 tools/qx/graphcode/out）：
//   <basename>.graph.json        归一化后的图（节点/连线/常量/端口名）+ 控件层 + 资源引用 + 证据来源
//   <basename>.behavior-spec.md  人类可读规格，每条结论带 [实测]/[推断]/UNKNOWN
//   <basename>.<graphId>.translate.json   仅 --spec：翻译报告（blocker 分类）
//   <graphName>.spec.json                 仅 --spec：可译的图才写
//
// 退出码：0 产出成功；2 输入不可用

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { readGil } from '../../gil/gilread.mjs';
import { readGia, summarize, UNIT_KIND } from './giaread.mjs';
import { graphToSpec, BLOCKERS } from './read2spec.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..', '..');

const argv = process.argv.slice(2);
const argOf = (k) => {
  const a = argv.find((s) => s.startsWith('--' + k + '='));
  return a ? a.slice(k.length + 3) : null;
};
const has = (k) => argv.includes('--' + k);

const gilArg = argOf('gil');
const ayayaArg = argOf('ayaya') || process.env.QX_AYAYA_REPO || '';
const pyExe = argOf('python') || process.env.QX_PYTHON || 'python';
const outdir = path.resolve(ROOT, argOf('outdir') || path.join('tools', 'qx', 'graphcode', 'out'));
const wantSpec = has('spec');

if (!gilArg) {
  console.error('用法: node tools/qx/graphcode/read.mjs --gil=<文件.gil|.gia> [--outdir=...] [--spec] [--ayaya=<外部仓库>] [--python=<python.exe>]');
  process.exit(2);
}
const gilPath = path.isAbsolute(gilArg) ? gilArg : path.resolve(ROOT, gilArg);
if (!fs.existsSync(gilPath)) {
  console.error('❌ 输入文件不存在: ' + gilPath);
  process.exit(2);
}

// ════════════════════════════════════════════════════════════════════════════
// A. 控件层（本工程自己的读法，复用 gilread.mjs，不重写）
// ════════════════════════════════════════════════════════════════════════════
let g;
try {
  g = readGil(gilPath);
} catch (e) {
  console.error('❌ gilread.mjs 解析失败: ' + e.message);
  process.exit(2);
}

// ════════════════════════════════════════════════════════════════════════════
// B. 节点图层（原生；不需要 Python / 外部仓库）
// ════════════════════════════════════════════════════════════════════════════
const catalogPath = path.join(HERE, 'nodes.json');
let catalog = null;
try {
  catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
} catch {
  /* 缺 nodes.json 也能读，只是节点没有中文名/方法名 */
}

let native = null;
try {
  native = readGia(gilPath, { catalog: catalog || {} });
} catch (e) {
  console.error('❌ 节点图层原生解码失败: ' + (e && e.message));
  native = { graphs: [], nodeDefs: [], units: { total: 0, whichCounts: {}, list: [] }, resources: { variables: [], signals: [], composites: [] }, envelope: {} };
}
const graphs = native.graphs || [];

// ── B2. 可选：外部解码器交叉校验（GPL 隔离：只起子进程，不 import；**不参与产物**） ──
let crossCheck = null;
if (ayayaArg) {
  const AY = path.resolve(ayayaArg);
  const entry = path.join(AY, 'private_extensions', 'run_ugc_file_tools.py');
  const cmd = pyExe + ' -X utf8 ' + entry + ' tool parse_gil_payload_to_graph_ir --input-gil ' + gilPath;
  if (!fs.existsSync(entry)) {
    crossCheck = { ok: false, cmd, why: '外部仓库路径不对（缺 private_extensions/run_ugc_file_tools.py）：' + AY };
  } else {
    try {
      execFileSync(pyExe, ['-X', 'utf8', entry, 'tool', 'parse_gil_payload_to_graph_ir', '--input-gil', gilPath], {
        cwd: AY,
        encoding: 'utf8',
        timeout: 900000,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      const irDir = path.join(AY, 'private_extensions', 'ugc_file_tools', 'out', 'gil_payload_graph_ir');
      const idxPath = path.join(irDir, 'index.json');
      const index = fs.existsSync(idxPath) ? JSON.parse(fs.readFileSync(idxPath, 'utf8')) : null;
      crossCheck = {
        ok: !!index,
        cmd,
        external_graphs: index ? index.length : null,
        // ⚠️ 只对数量，不做「谁对谁错」的裁决：口径不同的东西不能直接比大小
        native_graphs: graphs.length,
        agree:
          index && index.length === graphs.length
            ? '[实测] 图数与原生一致'
            : '[推断] 图数与原生不一致 —— 先查是不是外部解码器把「复合节点定义」也算成图了',
      };
      if (!index) crossCheck.why = '解码器跑完但没有 index.json：' + idxPath;
    } catch (e) {
      crossCheck = { ok: false, cmd, why: ((e.stdout || '') + (e.stderr || '') || e.message || '').toString().slice(0, 2000) };
    }
  }
}

// ════════════════════════════════════════════════════════════════════════════
// C. 落盘：graph.json
// ════════════════════════════════════════════════════════════════════════════
fs.mkdirSync(outdir, { recursive: true });
const base = path.basename(gilPath).replace(/\.(gil|gia)$/i, '');

const graphJson = {
  _kind: 'qx.graphcode.graph',
  input: { file: gilPath, bytes: g.src.length },
  header: { u32: g.hdr, bodyEnd: g.bodyEnd, trailer_bytes: g.trailer.length },
  control_layer: {
    basis: '[实测] tools/gil/gilread.mjs（真机导入验证过）',
    records: g.recs.length,
    maxId: g.maxId,
    named: g.recs.filter((r) => r.name).length,
  },
  node_graph_layer: {
    basis: '[实测] tools/qx/graphcode/giaread.mjs（原生，无 Python/无外部仓库）',
    decoded: native.layout === 'gia-export',
    layout: native.layout || 'other',
    layout_note: native.layoutNote,
    native: true,
    envelope: native.envelope,
    rootFields: native.rootFields,
    units: native.units,
    note: '节点名优先用 nodes.json 按类型 id 翻译；解不出来就老实标 UNKNOWN，不留空。',
    external_cross_check: crossCheck,
  },
  nodeDefs: (native.nodeDefs || []).map((d) => ({
    guid: d.guid,
    name: d.name,
    which: d.which,
    pinCount: d.pinCount,
    pinsNamed: {
      exec_in: d.pins.exec_in.map((p) => p.name),
      exec_out: d.pins.exec_out.map((p) => p.name),
      data_in: d.pins.data_in.map((p) => p.name),
      data_out: d.pins.data_out.map((p) => p.name),
    },
    implGraph: d.implGraph || null,
  })),
  resources: native.resources,
  graphs: graphs.map((gr) => ({
    unit: gr.unit,
    name: gr.name,
    nameFrom: gr.nameFrom || null,
    header: gr.header,
    node_count: gr.nodeCount,
    edge_count: gr.edgeCount,
    edge_split: {
      flow: gr.edges.filter((e) => e.category === 'flow').length,
      data: gr.edges.filter((e) => e.category === 'data').length,
    },
    comments: gr.comments,
    nodes: gr.instances.map((n) => ({
      index: n.index,
      type_id: n.typeId,
      scope: n.tuple ? n.tuple.scope : null,
      resolve: n.resolve.source,
      is_composite: n.resolve.isComposite,
      name_en: n.resolve.name || '',
      name_dsl: n.resolve.dsl || '',
      method: n.resolve.method || '',
      range: n.resolve.range || '',
      class: n.resolve.class || '',
      pos: n.pos,
      comment: n.comment,
      pins: n.bindings.map((b) => ({
        kind: b.pin.kind,
        index: b.pin.index,
        link: b.link,
        constant: b.constant
          ? {
              cat: b.constant.cat,
              typeId: b.constant.typeId,
              typeName: b.constant.typeName,
              valueKind: b.constant.valueKind,
              value: b.constant.value,
              status: b.constant.status,
              note: b.constant.note,
            }
          : null,
      })),
    })),
    edges: gr.edges,
  })),
};

fs.writeFileSync(path.join(outdir, base + '.graph.json'), JSON.stringify(graphJson, null, 1), 'utf8');

// ════════════════════════════════════════════════════════════════════════════
// C2. 可选：翻译 → emit spec + 报告
// ════════════════════════════════════════════════════════════════════════════
let translateReports = [];
if (wantSpec) {
  const aliasDoc = JSON.parse(fs.readFileSync(path.join(HERE, 'node-aliases.json'), 'utf8'));
  const aliases = new Map((aliasDoc.aliases || []).map((a) => [a.type_id, a]));
  const outFields = new Map(Object.entries(aliasDoc.out_fields || {}).map(([k, v]) => [Number(k), Array.isArray(v.fields) ? v.fields : null]));
  for (const gr of graphs) {
    const { spec, report } = graphToSpec(gr, catalog || {}, { aliases, outFields });
    translateReports.push(report);
    fs.writeFileSync(path.join(outdir, base + '.' + gr.header.graphId + '.translate.json'), JSON.stringify(report, null, 1), 'utf8');
    if (report.translatable) {
      fs.writeFileSync(path.join(outdir, spec.graph_name + '.spec.json'), JSON.stringify(spec, null, 1), 'utf8');
    }
  }
}

// ════════════════════════════════════════════════════════════════════════════
// D. 落盘：behavior-spec.md
// ════════════════════════════════════════════════════════════════════════════
const md = [];
md.push('# 行为规格（从存档反向读出）— ' + base);
md.push('');
md.push('> 由 `tools/qx/graphcode/read.mjs` 生成。每条结论都带证据标签：');
md.push('> `[实测]` = 跑出来的；`[推断]` = 有依据但没验证；`UNKNOWN` = 真不知道。');
md.push('');
md.push('## 1. 输入');
md.push('');
md.push('| 项 | 值 | 证据 |');
md.push('| --- | --- | --- |');
md.push('| 文件 | `' + path.basename(gilPath) + '` | [实测] 可读 |');
md.push('| 字节数 | ' + g.src.length + ' | [实测] |');
md.push('| 头 5×u32 | `' + JSON.stringify(g.hdr) + '` | [实测] readGil |');
md.push('');
md.push('## 2. 控件层');
md.push('');
md.push('- 控件记录数：**' + g.recs.length + '**　[实测]');
md.push('- 最大控件 ID：**' + g.maxId + '**　[实测]');
md.push('- 有名字的记录：**' + g.recs.filter((r) => r.name).length + '**　[实测]');
md.push('');
md.push('## 3. 节点图层（原生解码）');
md.push('');
md.push('路径：`tools/qx/graphcode/giaread.mjs`，**不需要 Python、不需要外部仓库**。　[实测]');
md.push('');
const sum = summarize(native);
md.push('| 项 | 值 |');
md.push('| --- | --- |');
md.push('| 单元总数 | ' + native.units.total + ' |');
md.push('| 单元种类(which) | ' + Object.entries(native.units.whichCounts).map(([k, v]) => k + '×' + v).join('，') + ' |');
md.push('| 节点图 | ' + sum.graphs + ' |');
md.push('| 本文件内节点定义（复合节点） | ' + sum.nodeDefs + ' |');
md.push('| 节点 / 连线 | ' + sum.totals.nodes + ' / ' + sum.totals.edges + ' |');
md.push('| 复合节点引用 | ' + sum.totals.compositeRefs + ' |');
md.push('| 解不出来的类型 | ' + sum.totals.unknownNodes + ' |');
md.push('');
if (native.resources && native.resources.variables.length) {
  md.push('- 图变量（**间接**证据：看「获取/设置节点图变量」引用的字符串常量）：' + native.resources.variables.map((v) => '`' + v.name + '`').join('、') + '　[实测-间接]');
}
if (native.resources && native.resources.signals.length) {
  md.push('- 信号（**间接**证据：看「监听/发送信号」引用的字符串常量）：' + native.resources.signals.map((v) => '`' + v.name + '`').join('、') + '　[实测-间接]');
}
if (native.units && native.units.list.some((u) => String(UNIT_KIND[u.which] || '').startsWith('UNKNOWN'))) {
  md.push('- ⚠️ 有 `which` 的语义没解出来（只按原样记录，没猜）：' + native.units.list.filter((u) => String(UNIT_KIND[u.which] || '').startsWith('UNKNOWN')).map((u) => u.which + '（' + (u.name || '无名') + '）').join('、'));
}
md.push('');
if (!graphs.length) {
  if (native.layout && native.layout !== 'gia-export') {
    md.push('**读不出来**：这个文件不是 `.gia` 导出布局。　[实测]');
    md.push('');
    md.push('> ' + (native.layoutNote || ''));
    md.push('> `.gil`（整张地图存档）的节点图段**本工具没解**；要读仍然要走外部解码器：');
    md.push('> `node tools/qx/graphcode/read.mjs --gil=<x.gil> --ayaya=<外部仓库> --python=<python.exe>`。');
  } else {
    md.push('**这个档里没有节点图**（`graphs_found: 0`）。　[实测]');
    md.push('');
    md.push('> ⚠️ 缺失 ≠ 不存在。但这次是**真的**没有：原生解码器把整个 body 都走了一遍。');
  }
} else {
  for (const gr of graphs) {
    md.push('### `' + (gr.name || '(无名)') + '`（graphId=' + gr.header.graphId + '，' + gr.unit.bucket + '[' + gr.unit.index + ']' + (gr.nameFrom ? '，名字取自' + gr.nameFrom : '') + '）');
    md.push('');
    md.push(
      '- 节点 **' + gr.nodeCount + '**，连线 **' + gr.edgeCount + '**（执行 ' +
        gr.edges.filter((e) => e.category === 'flow').length + ' / 数据 ' + gr.edges.filter((e) => e.category === 'data').length +
        '），注释组 ' + gr.comments.length + '　[实测]'
    );
    md.push('- 图头：tag1=' + gr.header.tag1 + ' tag2=' + gr.header.tag2 + ' tag3=' + gr.header.tag3 + '（tag2/tag3 的语义 UNKNOWN，只原样记录）');
    md.push('');
    if (gr.nodeCount) {
      md.push('| # | type_id | 来源 | 中文名 | 英文名 | 方法名 | 类 | 注释 |');
      md.push('| --- | --- | --- | --- | --- | --- | --- | --- |');
      for (const n of gr.instances) {
        const r = n.resolve;
        md.push(
          '| ' + n.index + ' | `' + n.typeId + '` | ' + r.source + ' | ' + (r.dsl || '—') + ' | ' + (r.name || '—') + ' | ' + (r.method ? '`' + r.method + '`' : '—') + ' | ' + (r.class || '—') + ' | ' + (n.comment || '') + ' |'
        );
      }
      md.push('');
      // 端口语义名：本文件内定义的能给出，全局目录的给不出
      const withPins = gr.instances.filter((n) => n.resolve.pins);
      if (withPins.length) {
        md.push('#### 端口语义名（本文件内定义的节点才有 —— 这是旧版最缺的一层）');
        md.push('');
        for (const n of withPins.slice(0, 12)) {
          const p = n.resolve.pins;
          md.push(
            '- `' + n.resolve.name + '`：执行入 [' + p.exec_in.map((x) => x.name).join(', ') + '] 执行出 [' +
              p.exec_out.map((x) => x.name).join(', ') + '] 参数入 [' + p.data_in.map((x) => x.name).join(', ') +
              '] 参数出 [' + p.data_out.map((x) => x.name).join(', ') + ']'
          );
        }
        md.push('');
      }
    }
  }
  md.push('> 端口**语义名**这一层：本文件内定义（which=12/14）的节点能给出（定义里就有引脚名）；');
  md.push('> 全局目录的节点靠 `nodes.json` 的 `inputs[].name`，上游没给名字的（321 个）仍然是 null —— 那部分是**上游**的缺口，不是我们的。');
}
md.push('');
md.push('## 4. 下一步');
md.push('');
md.push('1. `read2spec.mjs` 把图翻成 emit spec；不可译的地方会给出 blocker 分类（见 `docs/official-gia-coverage.md`）。');
md.push('2. `roundtrip.mjs` 跑「读→译→编译」全链，与基线比。');
md.push('3. 想真的落盘，用 `emit.mjs` → `gts-build.mjs`（只写 `.gia`；注入只对 `.gil` **副本**做）。');

fs.writeFileSync(path.join(outdir, base + '.behavior-spec.md'), md.join('\n'), 'utf8');

// ════════════════════════════════════════════════════════════════════════════
// E. 控制台摘要
// ════════════════════════════════════════════════════════════════════════════
console.log('✅ ' + base);
console.log('   控件记录 ' + g.recs.length + '，最大 ID ' + g.maxId);
if (native.layout && native.layout !== 'gia-export') {
  console.log('   节点图层（原生）：读不出来 —— 布局不是 .gia 导出（layout=' + native.layout + '）');
  console.log('     ' + (native.layoutNote || ''));
} else {
  console.log('   节点图层（原生）：' + graphs.length + ' 张图 / ' + sum.totals.nodes + ' 节点 / ' + sum.totals.edges + ' 连线');
  console.log('   本文件内节点定义（复合节点）：' + sum.nodeDefs + '，被引用 ' + sum.totals.compositeRefs + ' 次');
  for (const gr of graphs) {
    console.log('     · ' + (gr.name || '(无名)') + '  id=' + gr.header.graphId + '  ' + gr.nodeCount + ' 节点 / ' + gr.edgeCount + ' 连线');
  }
}
if (native.resources) {
  if (native.resources.variables.length) console.log('   图变量（间接）：' + native.resources.variables.map((v) => v.name).join('、'));
  if (native.resources.signals.length) console.log('   信号（间接）：' + native.resources.signals.map((v) => v.name).join('、'));
}
if (crossCheck) console.log('   外部交叉校验：' + (crossCheck.ok ? crossCheck.agree : '❌ ' + (crossCheck.why || '').split('\n')[0]));
if (translateReports.length) {
  const ok = translateReports.filter((r) => r.translatable).length;
  console.log('   翻译：' + ok + '/' + translateReports.length + ' 张图可译');
  for (const r of translateReports.filter((x) => !x.translatable)) {
    console.log('     ✗ ' + (r.graph.name || r.graph.graphId) + '：' + [...new Set(r.blockers.map((b) => b.category))].join('/') + '（' + BLOCKERS[r.blockers[0].category] + '…）');
  }
}
console.log('   产物：');
console.log('     ' + path.join(outdir, base + '.graph.json'));
console.log('     ' + path.join(outdir, base + '.behavior-spec.md'));
