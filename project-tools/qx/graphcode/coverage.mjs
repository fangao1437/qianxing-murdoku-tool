// tools/qx/graphcode/coverage.mjs —— 官方/社区 `.gia` 样本的**覆盖度体检** + fixture 固化
//
// 干三件事：
//   ① 逐份读（giaread）→ 打读数表：图数 / 节点数 / 连线 / 变量 / 信号 / 复合节点引用
//   ② 把所有出现过的节点类型 id 归到五类，算命中率、列出缺失、「复合节点」单列
//   ③ 把结果写成两类东西：
//        · fixtures/*.digest.json（**只存提取出来的 JSON，不复制 .gia 二进制**）
//        · docs/official-gia-coverage.md（人看的那份）
//
// 为什么要 fixtures：`assets/` 里的 `.gia` 是别人的产物，**不能进回归**（跨仓库、跨版本）。
// 只有「我们自己的解码器从它身上读出来的结论」才是我们可以钉死的基线：
// 解码器一改，digest 一 diff，就知道是变好了还是坏了。
//
// 用法：
//   node tools/qx/graphcode/coverage.mjs --in=assets --md=docs/official-gia-coverage.md
//   node tools/qx/graphcode/coverage.mjs --files="a.gia,b.gia" --no-fixtures
//
// 退出码：0 = 全部样本读成功；1 = 有样本读失败

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { readGia, summarize } from './giaread.mjs';
import { graphToSpec } from './read2spec.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..', '..');

const argv = process.argv.slice(2);
const argOf = (k) => {
  const a = argv.find((s) => s.startsWith('--' + k + '='));
  return a ? a.slice(k.length + 3) : null;
};

/** 样本清单（**写死**，保证 fixture 可复现；不写死就会随 assets 目录变化而漂） */
export const SAMPLES = [
  { slug: 'fall-protect', file: '保护玩家防止坠崖掉落自动传送.gia', note: '最简单的官方图（7 节点）—— 反向回编译主用例' },
  { slug: 'composite-atlas', file: '常用复合节点大全v1.7(补充包同步更新中).gia', note: '87 个复合节点定义 + 87 张实现图' },
  { slug: 'projectile-coords', file: '实时获取投射物坐标（最快每0.06s获取一次）.gia', note: '定时器 + 拼装列表 + 3 个复合节点' },
  { slug: 'disconnect-detect', file: '玩家掉线检测、重连检测、断网检测.gia', note: '信号（监听/发送）+ 界面控件组 + 客户端脚本' },
  { slug: 'double-jump', file: '只按空格实现二段跳.gia', note: '40 节点大图 + 节点图变量 + 枚举常量' },
];

function sha256(p) {
  return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
}

function histOf(graph) {
  const h = {};
  for (const n of graph.instances) h[String(n.typeId)] = (h[String(n.typeId)] || 0) + 1;
  return h;
}

/** 一份样本 → digest（可入库、可比对、不含二进制） */
function digestOf(sample, full) {
  const s = summarize(full);
  return {
    _kind: 'qx.graphcode.gia-digest',
    sample: { slug: sample.slug, file: sample.file, bytes: full.file.bytes, sha256: sha256(path.join(argOf('in') || 'assets', sample.file)) },
    note: sample.note,
    envelope: full.envelope,
    rootFields: full.rootFields,
    units: { total: full.units.total, whichCounts: full.units.whichCounts, list: full.units.list },
    nodeDefs: full.nodeDefs.map((d) => ({
      guid: d.guid,
      name: d.name,
      which: d.which,
      pinCount: d.pinCount,
      implGraph: d.implGraph || null,
    })),
    graphs: full.graphs.map((g) => ({
      bucket: g.unit.bucket,
      unitIndex: g.unit.index,
      name: g.name,
      graphId: g.header.graphId,
      header: g.header,
      nodes: g.nodeCount,
      edges: g.edgeCount,
      flowEdges: g.edges.filter((e) => e.category === 'flow').length,
      dataEdges: g.edges.filter((e) => e.category === 'data').length,
      comments: g.comments.length,
      typeHistogram: histOf(g),
      compositeRefs: g.instances.filter((n) => n.resolve.source.startsWith('local_def')).length,
      unknownRefs: g.instances.filter((n) => n.resolve.source === 'unknown').length,
    })),
    resources: full.resources,
    totals: s.totals,
  };
}

/** 单个节点的完整解码（golden 用；只对小图存） */
function nodesOf(full) {
  return full.graphs.map((g) => ({
    name: g.name,
    graphId: g.header.graphId,
    nodes: g.instances.map((n) => ({
      index: n.index,
      typeId: n.typeId,
      scope: n.tuple && n.tuple.scope,
      source: n.resolve.source,
      name: n.resolve.name,
      dsl: n.resolve.dsl,
      method: n.resolve.method,
      pos: n.pos,
      comment: n.comment,
    })),
    edges: g.edges,
  }));
}

// ════════════════════════════════════════════════════════════════════════════
// 类型覆盖度：每个出现过（被实例引用）的类型 id → 归一类
// ════════════════════════════════════════════════════════════════════════════
export const CATS = {
  SERVER_OK: '服务端节点，有中文名 + gts 方法名 → 可直接翻译',
  CLIENT_OK: '客户端节点，有中文名（无 gts 方法名）→ 只能读，不能翻成 gts',
  ALIAS_OK: 'nodes.json 里没有方法名，靠 node-aliases.json 人工签名核对补上 → 可翻译（[推断]）',
  NO_METHOD: '在 nodes.json 里但**没有 gts 方法名**（上游措辞漂移）→ 拒绝生成',
  NO_DSL: '在 nodes.json 里但**没有中文名**（只有英文显示名）→ 拒绝生成',
  COMPOSITE: '本文件内定义的**复合节点**（type 元组 scope=22001）→ 拒绝生成（需展开实现图）',
  UNKNOWN: '两边都没有 → UNKNOWN，拒绝生成',
};

function classify(typeId, cat, alias, defsById) {
  if (defsById.has(typeId)) return 'COMPOSITE';
  if (!cat) return alias ? 'ALIAS_OK' : 'UNKNOWN';
  if (!cat.dsl && !cat.method && alias) return 'ALIAS_OK';
  if (!cat.method) return alias ? 'ALIAS_OK' : cat.dsl ? 'NO_METHOD' : 'NO_DSL';
  if (cat.range === 'Client') return 'CLIENT_OK';
  return 'SERVER_OK';
}

function main() {
  const inDir = path.resolve(ROOT, argOf('in') || 'assets');
  const filesArg = argOf('files');
  const mdPath = argOf('md') ? path.resolve(ROOT, argOf('md')) : null;
  const fixturesDir = path.resolve(ROOT, argOf('fixtures') || path.join('tools', 'qx', 'graphcode', 'fixtures'));
  const noFixtures = argv.includes('--no-fixtures');

  let samples = SAMPLES;
  if (filesArg) {
    samples = filesArg.split(',').map((f, i) => ({ slug: 'sample' + (i + 1), file: f.trim(), note: '(命令行给的)' }));
  }

  const catalog = JSON.parse(fs.readFileSync(path.join(HERE, 'nodes.json'), 'utf8'));
  const aliasDoc = JSON.parse(fs.readFileSync(path.join(HERE, 'node-aliases.json'), 'utf8'));
  const aliases = new Map((aliasDoc.aliases || []).map((a) => [a.type_id, a]));
  const catById = new Map(catalog.nodes.map((n) => [n.id, n]));

  const rows = [];
  const typeUse = new Map(); // typeId → {count, graphs:Set, cat, catClass}
  let failed = 0;
  const digests = new Map();
  const decodes = new Map();

  for (const s of samples) {
    const p = path.join(inDir, s.file);
    if (!fs.existsSync(p)) {
      console.error('❌ 样本不存在: ' + p);
      failed++;
      continue;
    }
    let full;
    try {
      full = readGia(p, { catalog });
    } catch (e) {
      console.error('❌ 解码失败 ' + s.file + ': ' + (e && e.message));
      failed++;
      continue;
    }
    const sum = summarize(full);
    const defsById = new Map(full.nodeDefs.map((d) => [d.guid, d]));

    // 逐图可译性
    const perGraph = [];
    for (const g of full.graphs) {
      const { report } = graphToSpec(g, catalog, { aliases });
      perGraph.push({
        name: g.name || (defsById.get(g.header.graphId) || {}).name || '(无名)',
        graphId: g.header.graphId,
        nodes: g.nodeCount,
        edges: g.edgeCount,
        translatable: report.translatable,
        blockers: report.blockers,
        warnings: report.warnings,
      });
      for (const n of g.instances) {
        if (!typeUse.has(n.typeId)) {
          typeUse.set(n.typeId, { typeId: n.typeId, count: 0, graphs: new Set(), cat: catById.get(n.typeId) || null });
        }
        const u = typeUse.get(n.typeId);
        u.count++;
        u.graphs.add(s.slug);
      }
    }

    rows.push({ sample: s, sum, perGraph, defsById, full });
    digests.set(s.slug, digestOf(s, full));
    decodes.set(s.slug, nodesOf(full));
    console.log(`· ${s.slug}  ${sum.graphs} 图 / ${sum.totals.nodes} 节点 / ${sum.totals.edges} 连线 / 复合引用 ${sum.totals.compositeRefs} / 未知 ${sum.totals.unknownNodes}`);
  }

  // ── 类型覆盖度汇总 ─────────────────────────────────────────────────────
  // ⚠️ 判「是不是复合节点」必须用**全部样本的**定义表：先汇总，再分类。
  //    我第一版分类时传了个空 Map，结果 22 个复合节点全被算成 UNKNOWN。
  const allDefs = new Map();
  for (const r of rows) for (const d of r.full.nodeDefs) allDefs.set(d.guid, d);
  const catRows = [];
  for (const u of [...typeUse.values()].sort((a, b) => b.count - a.count)) {
    const cls = classify(u.typeId, u.cat, aliases.get(u.typeId), allDefs);
    catRows.push({ ...u, cls, graphs: [...u.graphs] });
  }
  const byCls = {};
  for (const r of catRows) (byCls[r.cls] = byCls[r.cls] || []).push(r);
  const distinct = catRows.length;
  const hit = catRows.filter((r) => ['SERVER_OK', 'CLIENT_OK', 'ALIAS_OK'].includes(r.cls)).length;

  // 多出参节点（out_fields 缺口）
  const outFields = new Map(Object.entries(aliasDoc.out_fields || {}).map(([k, v]) => [Number(k), v.fields]));
  const multiOut = [];
  for (const row of rows) {
    for (const g of row.full.graphs) {
      for (const e of g.edges) {
        if (e.category !== 'data' || e.from.pin !== 'data_out') continue;
        const src = g.instances.find((x) => x.index === e.from.node);
        const c = src && catById.get(src.typeId);
        if (!c || (c.outputs || []).length <= 1) continue;
        const key = src.typeId + '#' + e.from.index;
        if (!multiOut.find((m) => m.key === key)) {
          multiOut.push({ key, typeId: src.typeId, pin: e.from.index, name: c.name, method: c.method || null, outs: (c.outputs || []).length, mapped: !!(outFields.get(src.typeId) || [])[e.from.index] });
        }
      }
    }
  }

  // ── 写 fixtures ────────────────────────────────────────────────────────
  if (!noFixtures) {
    fs.mkdirSync(fixturesDir, { recursive: true });
    const index = { _kind: 'qx.graphcode.fixtures-index', samples: [] };
    for (const s of samples) {
      if (!digests.has(s.slug)) continue;
      const dg = digests.get(s.slug);
      fs.writeFileSync(path.join(fixturesDir, s.slug + '.digest.json'), JSON.stringify(dg, null, 1) + '\n', 'utf8');
      index.samples.push({ slug: s.slug, file: s.file, digest: s.slug + '.digest.json', graphs: dg.graphs.length, nodes: dg.totals.nodes });
      // 小图（单图 ≤ 16 节点）才存完整节点表，免得 fixture 膨胀；大图只留 digest
      const maxNodes = Math.max(0, ...dg.graphs.map((g) => g.nodes));
      if (maxNodes <= 16) {
        fs.writeFileSync(path.join(fixturesDir, s.slug + '.decode.json'), JSON.stringify(decodes.get(s.slug), null, 1) + '\n', 'utf8');
        index.samples[index.samples.length - 1].decode = s.slug + '.decode.json';
      }
    }
    fs.writeFileSync(path.join(fixturesDir, 'index.json'), JSON.stringify(index, null, 1) + '\n', 'utf8');
    console.log('\n📦 fixtures → ' + fixturesDir);
  }

  // ── 写 markdown ────────────────────────────────────────────────────────
  if (mdPath) {
    const L = [];
    const W = (x) => L.push(x);
    W('# 官方/社区 `.gia` 样本覆盖度报告');
    W('');
    W('> 由 `node tools/qx/graphcode/coverage.mjs --in=assets` 生成。**别手改**，改了下次跑就没了。');
    W('> 证据标签口径：`[实测]` 跑出来的 / `[推断]` 有依据没验证 / `UNKNOWN` 真不知道。');
    W('');
    W('## 0. 这份报告在回答什么');
    W('');
    W('我们的「节点图 → 规格/IR」读取算法（`giaread.mjs`）和「规格 → gts 源码」翻译算法（`read2spec.mjs` + `emit.mjs`）');
    W('到底能覆盖官方图多少？哪些地方一碰就碎？这份报告用 5 份真实样本给出**可复现的数字**。');
    W('');
    W('## 1. 样本读数表　[实测]');
    W('');
    W('命令：`node tools/qx/graphcode/coverage.mjs --in=assets --md=docs/official-gia-coverage.md`');
    W('');
    W('| # | 样本 | 字节 | 单元(which) | 节点图 | 节点定义(复合) | 节点 | 连线(执行/数据) | 图变量 | 信号 | 复合引用 | 未知类型 |');
    W('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
    rows.forEach((r, i) => {
      const kinds = Object.entries(r.full.units.whichCounts).map(([k, v]) => k + '×' + v).join(' ');
      const vars = r.full.resources.variables.map((v) => v.name);
      const sigs = r.full.resources.signals.map((v) => v.name);
      const t = r.sum.totals;
      const flow = r.sum.rows.reduce((a, x) => a + x.flowEdges, 0);
      const data = r.sum.rows.reduce((a, x) => a + x.dataEdges, 0);
      W(
        `| ${i + 1} | \`${r.sample.slug}\`<br>${r.sample.file} | ${r.full.file.bytes} | ${kinds} | ${r.sum.graphs} | ${r.sum.nodeDefs} | ${t.nodes} | ${t.edges}（${flow}/${data}） | ${vars.length ? vars.map((v) => '`' + v + '`').join(' ') : '—'} | ${sigs.length ? sigs.map((v) => '`' + v + '`').join(' ') : '—'} | ${t.compositeRefs} | ${t.unknownNodes} |`
      );
    });
    W('');
    W('### 逐份结论');
    W('');
    for (const r of rows) {
      W(`#### ${r.sample.slug} —— \`${r.sample.file}\``);
      W('');
      W(r.sample.note);
      W('');
      const kinds = Object.entries(r.full.units.whichCounts).map(([k, v]) => `which=${k}×${v}`).join('，');
      W(`- 单元：${r.full.units.total} 个（${kinds}）　[实测]`);
      W(`- 信封：header=[${r.full.envelope.headerU32.join(', ')}]，body=${r.full.envelope.bodyLen} B，trailer=${r.full.envelope.trailerLen} B　[实测]`);
      if (r.full.nodeDefs.length) {
        W(`- 节点定义（复合节点）：**${r.full.nodeDefs.length}** 个；其中 ${r.full.nodeDefs.filter((d) => d.implGraph).length} 个能对上实现图（graphId == guid）　[实测]`);
      }
      W('');
      W('| 图 | graphId | 节点 | 连线 | 执行/数据 | 复合引用 | 未知 | 可译 |');
      W('| --- | --- | --- | --- | --- | --- | --- | --- |');
      for (const g of r.perGraph) {
        const fl = g.warnings.length;
        W(
          `| ${g.name} | ${g.graphId} | ${g.nodes} | ${g.edges} | — | — | — | ${g.translatable ? '✅' : '❌ ' + [...new Set(g.blockers.map((b) => b.category))].join('/')}${fl ? ' ⚠️' + fl : ''} |`
        );
      }
      W('');
    }

    W('## 2. 节点类型覆盖度　[实测]');
    W('');
    W(`5 份样本一共用到 **${distinct}** 个不同的节点类型 id，其中 **${hit}** 个能被识别（命中率 **${((hit / distinct) * 100).toFixed(1)}%**），` +
      `**${distinct - hit}** 个有问题。按类分组：`);
    W('');
    W('| 类别 | 种类数 | 含义 | 处置 |');
    W('| --- | --- | --- | --- |');
    const POLICY = {
      SERVER_OK: '直接翻译（`nodes.json` 的 `method`）',
      CLIENT_OK: '只读，不生成 gts（gts 客户端节点表另算）',
      ALIAS_OK: '查 `node-aliases.json` 的 `gts_method`（**[推断]**，需 compile 兜底）',
      NO_METHOD: '**拒绝生成**；可在 `node-aliases.json` 里按签名核对后补',
      NO_DSL: '**拒绝生成**；同上',
      COMPOSITE: '**拒绝生成**；要么展开实现图（本工具没做），要么当黑盒',
      UNKNOWN: '**拒绝生成**，标 UNKNOWN',
    };
    for (const k of Object.keys(CATS)) {
      const list = byCls[k] || [];
      W(`| \`${k}\` | ${list.length} | ${CATS[k]} | ${POLICY[k]} |`);
    }
    W('');
    for (const k of ['SERVER_OK', 'CLIENT_OK', 'ALIAS_OK']) {
      const list = byCls[k] || [];
      if (!list.length) continue;
      W(`### ${k}（${list.length} 种）`);
      W('');
      W('| type_id | 次数 | 中文名 | 英文名 | 方法名 |');
      W('| --- | --- | --- | --- | --- |');
      for (const r of list) {
        const a = aliases.get(r.typeId);
        const dsl = (r.cat && r.cat.dsl) || (a && a.zh) || '';
        const nm = (r.cat && r.cat.name) || (a && a.name_en) || '';
        const mt = (r.cat && r.cat.method) || (a && a.gts_method) || '';
        W(`| ${r.typeId} | ${r.count} | ${dsl} | ${nm} | ${mt ? '`' + mt + '`' : '—'} |`);
      }
      W('');
    }
    for (const k of ['NO_METHOD', 'NO_DSL', 'UNKNOWN', 'COMPOSITE']) {
      const list = byCls[k] || [];
      W(`### ${k}（${list.length} 种）`);
      W('');
      if (!list.length) {
        W('（本轮样本里没有）');
        W('');
        continue;
      }
      W('| type_id | 次数 | 中文名 | 英文名 | 端口(入→出) | 处置 |');
      W('| --- | --- | --- | --- | --- | --- |');
      for (const r of list) {
        const c = r.cat || {};
        const ins = (c.inputs_types || []).join(',');
        const outs = (c.outputs_types || []).join(',');
        W(`| ${r.typeId} | ${r.count} | ${c.dsl || ''} | ${c.name || ''} | ${ins || '—'} → ${outs || '—'} | ${POLICY[k]} |`);
      }
      W('');
    }

    W('### 2b. 复合节点（本文件内定义的类型）');
    W('');
    const defTotal = rows.reduce((a, r) => a + r.full.nodeDefs.length, 0);
    W(`5 份样本一共定义 **${defTotal}** 个本文件内节点单元（which=12/14，type 元组 scope=22001），`);
    W('`nodes.json` 里当然没有这些 id —— 它们**不是缺失**，而是「定义在这儿」。');
    W('我们的读法：按 `guid` 建表 → 实例的 `type_id == guid` 时从表里取**名字 + 引脚名**。');
    W('⇒ 复合节点在**读**的层面是**全解**的（名字、端口、连线都在），在**译**的层面一律拒绝（要展开实现图）。');
    W('');
    W('| 样本 | 定义数 | 名字样例 |');
    W('| --- | --- | --- |');
    for (const r of rows) {
      if (!r.full.nodeDefs.length) continue;
      const names = r.full.nodeDefs.slice(0, 4).map((d) => d.name).join(' / ');
      W(`| ${r.sample.slug} | ${r.full.nodeDefs.length} | ${names} … |`);
    }
    W('');

    W('## 3. 多出参节点：`out_fields` 缺口');
    W('');
    W('`emit` 的 spec 里 `out` 只能命名「整个返回值」；取第 N 个出参要靠**属性名**（gts 返回对象）。');
    W('属性名不在 `nodes.json` 里（端口名常常是 `null`）⇒ 必须在 `node-aliases.json` 的 `out_fields` 里登记，否则报 `MULTI_OUT_PIN` 拒绝生成。');
    W('');
    if (!multiOut.length) W('（本轮样本里没有被消费的多出参节点）');
    else {
      W('| type_id | 出参序号 | 英文名 | 方法名 | 出参数 | 已登记 out_fields |');
      W('| --- | --- | --- | --- | --- | --- |');
      for (const m of multiOut) W(`| ${m.typeId} | ${m.pin} | ${m.name} | ${m.method ? '`' + m.method + '`' : '—'} | ${m.outs} | ${m.mapped ? '✅' : '❌'} |`);
    }
    W('');

    W('## 4. 仍缺什么（未解项）');
    W('');
    W('1. **多出参属性名**：只有 `node-aliases.json` 里登记过的才译得出（见 §3），其余一律 `MULTI_OUT_PIN`。');
    W('2. **109 个服务端节点没有 gts 方法名**：`nodes.json` 的 `counts.server_without_dsl = 109`，本报告只对样本里用到的做了签名核对。');
    W('3. **枚举常量**：`#106` 里的枚举项（如 `1200`）没映射到 gts 枚举成员 ⇒ `ENUM_CONSTANT`。');
    W('4. **列表 / 字典常量**：`#109` 能拆出元素，但 gts 的列表字面量写法没验证 ⇒ `LIST_CONSTANT`；字典布局未解 ⇒ `DICT_CONSTANT`。');
    W('5. **语义等价**：`emit` 的 spec 是「一串顺序调用」，表达不了双分支/多分支/遍历的控制流，也表达不了图的注释分组。');
    W('   能读到、能生成、能编译，但**语义不等价** —— 这一层没做，也不假装做了。');
    W('6. **`which` 的种类语义**：`7`（`#15` 载荷，样本里叫「监听移动速率」）、`61`、`69` 的完整语义未解，只按原样记录。');
    W('7. **图头的 `tag2`(20000/20002) / `tag3`(21001/21002)** 到底是不是「服务端/客户端」，**没验证出来**，只原样记录。');
    W('8. **图变量 / 信号没有独立表**：现在的读法是「看引用它们的节点 + 那个字符串常量」，是**间接**证据。');
    W('');
    fs.mkdirSync(path.dirname(mdPath), { recursive: true });
    fs.writeFileSync(mdPath, L.join('\n'), 'utf8');
    console.log('📄 报告 → ' + mdPath);
  }

  console.log('\n类型覆盖：' + distinct + ' 种，命中 ' + hit + '（' + ((hit / distinct) * 100).toFixed(1) + '%）');
  for (const k of Object.keys(CATS)) console.log('  ' + k.padEnd(12) + (byCls[k] || []).length);
  process.exit(failed ? 1 : 0);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main();
