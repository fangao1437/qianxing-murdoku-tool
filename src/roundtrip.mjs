// src/roundtrip.mjs —— 反向回编译验证：`.gia` → spec → TS →(编译)→ `.gia`
//
// ════════════════════════════════════════════════════════════════════════════
// 这条链在验什么
// ════════════════════════════════════════════════════════════════════════════
//
//   `.gia` ──giaread──▶ 图 ──read2spec──▶ spec.json ──emit──▶ .ts ──gsts compile──▶ .gia
//
//   「读得回来」和「译得回去」是两件事：
//     · 读：节点/引脚/连线/常量解出来没有（digest 能比）
//     · 译：解出来的东西能不能重新生成一份**能编译**的源码
//   compile 只是**下界**：能编译 ≠ 语义等价（分支/循环/枚举都会退化）。所以每个用例都记
//   `status` + `blockers`/`warnings`，不写成「通过」了事。
//
// 用例是**写死**的（不是扫目录），否则 fixture 不可复现。
//
// 用法：
//   node src/roundtrip.mjs --in=assets \
//        --workbench=../_work/gts --fixtures=src/fixtures
//   不给 --workbench 时**跳过编译**（离线也能跑，只是 compile 那一列写 skipped）
//
// 退出码：0 = 所有用例的观察结果与 `expect` 一致；1 = 有出入；2 = 环境不满足

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { readGia } from './giaread.mjs';
import { graphToSpec } from './read2spec.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

/** 用例表。`expect.status` 是**实测基线**：变了就说明算法变了，必须有人解释。 */
export const CASES = [
  {
    slug: 'fall-protect-strict',
    file: '保护玩家防止坠崖掉落自动传送.gia',
    note: '最简单的官方图。含「双分支」⇒ strict 模式必须拒绝生成',
    opts: {},
    expect: { status: 'blocked', blockerCategories: ['CONTROL_FLOW_NODE'] },
  },
  {
    slug: 'fall-protect-linear',
    file: '保护玩家防止坠崖掉落自动传送.gia',
    note: '同上，但把分支降级成顺序调用 —— 用来**实测** gts 那条回调式 API 的边界',
    opts: { treatBranchAsLinear: true },
    expect: { status: 'generated', compile: 'failed', compileErrorMatch: 'fn is not a function' },
  },
  {
    slug: 'atlas-collision-death',
    file: '常用复合节点大全v1.7(补充包同步更新中).gia',
    graph: '1073741843',
    note: '复合节点「[执行]角色碰撞死亡」的实现图：1 触发器 + 1 执行节点，最干净的一条链',
    opts: {},
    expect: { status: 'generated', compile: 'ok' },
  },
  {
    slug: 'atlas-hide-player-model',
    file: '常用复合节点大全v1.7(补充包同步更新中).gia',
    graph: '1073741827',
    note: '复合节点「[执行]隐藏玩家模型」的实现图：1 触发器 + 1 执行节点 + 1 个布尔常量',
    opts: {},
    expect: { status: 'generated', compile: 'ok' },
  },
  {
    slug: 'projectile-coords',
    file: '实时获取投射物坐标（最快每0.06s获取一次）.gia',
    graph: '示例',
    note: '含 2 个复合节点引用 ⇒ 读得出来，译不出来',
    opts: {},
    expect: { status: 'blocked', blockerCategories: ['COMPOSITE_NODE'] },
  },
  {
    slug: 'disconnect-detect',
    file: '玩家掉线检测、重连检测、断网检测.gia',
    graph: '掉线检测',
    note: '信号 + 界面控件组 + 没中文名的节点（755 Query Timestamp）⇒ 多层缺失叠加',
    opts: {},
    expect: { status: 'blocked', blockerCategories: ['COMPOSITE_NODE', 'NO_DSL_NAME', 'NO_METHOD'] },
  },
  {
    slug: 'double-jump',
    file: '只按空格实现二段跳.gia',
    note: '40 节点大图：4 个触发器、枚举常量、非空列表常量、图变量',
    opts: {},
    expect: { status: 'blocked', blockerCategories: ['CONTROL_FLOW_NODE', 'ENUM_CONSTANT', 'LIST_CONSTANT'] },
  },
];

const argv = process.argv.slice(2);
const argOf = (k) => {
  const a = argv.find((s) => s.startsWith('--' + k + '='));
  return a ? a.slice(k.length + 3) : null;
};
const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex').slice(0, 16);

function main() {
  const inDir = path.resolve(ROOT, argOf('in') || 'assets');
  const fixturesDir = path.resolve(ROOT, argOf('fixtures') || path.join('fixtures'));
  const wb = argOf('workbench') ? path.resolve(ROOT, argOf('workbench')) : null;
  const canCompile = !!(wb && fs.existsSync(path.join(wb, 'node_modules', 'genshin-ts', 'bin', 'gsts.mjs')));
  const scratch = path.join(fixturesDir, '_scratch');
  fs.mkdirSync(scratch, { recursive: true });

  const catalog = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'nodes.json'), 'utf8'));
  const aliasDoc = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'node-aliases.json'), 'utf8'));
  const aliases = new Map((aliasDoc.aliases || []).map((a) => [a.type_id, a]));
  const outFields = new Map(Object.entries(aliasDoc.out_fields || {}).map(([k, v]) => [Number(k), Array.isArray(v.fields) ? v.fields : null]));

  const results = [];
  let mismatched = 0;

  for (const c of CASES) {
    const p = path.join(inDir, c.file);
    const rec = { slug: c.slug, file: c.file, graph: c.graph || null, note: c.note, expect: c.expect };
    if (!fs.existsSync(p)) {
      rec.status = 'skipped-missing-sample';
      results.push(rec);
      console.log('⏭  ' + c.slug + '  （样本不存在：' + c.file + '）');
      continue;
    }
    const full = readGia(p, { catalog });
    const targets = c.graph
      ? full.graphs.filter((g) => String(g.header.graphId) === c.graph || (g.name || '').includes(c.graph))
      : full.graphs;
    if (!targets.length) {
      rec.status = 'error';
      rec.error = '找不到图 ' + c.graph;
      results.push(rec);
      mismatched++;
      continue;
    }
    const g = targets[0];
    const { spec, report } = graphToSpec(g, catalog, { aliases, outFields, ...c.opts });
    rec.graphId = g.header.graphId;
    rec.graphName = spec.graph_name;
    rec.nodes = g.nodeCount;
    rec.edges = g.edgeCount;
    rec.blockers = [...new Set(report.blockers.map((b) => b.category))];
    rec.warnings = report.warnings;
    rec.status = report.translatable ? 'generated' : 'blocked';

    if (report.translatable) {
      const specName = c.slug + '.spec.json';
      fs.writeFileSync(path.join(fixturesDir, specName), JSON.stringify(spec, null, 1) + '\n', 'utf8');
      rec.spec = specName;
      // emit（离线，纯文本生成）
      const tsPath = path.join(scratch, spec.graph_name + '.ts');
      const em = spawnSync(process.execPath, [path.join(HERE, 'emit.mjs'), '--spec=' + path.join(fixturesDir, specName), '--outdir=' + scratch], {
        cwd: ROOT,
        encoding: 'utf8',
      });
      if (em.status !== 0) {
        rec.status = 'emit-failed';
        rec.emitError = ((em.stdout || '') + (em.stderr || '')).slice(0, 1500);
        mismatched++;
      } else if (fs.existsSync(tsPath)) {
        const tsText = fs.readFileSync(tsPath, 'utf8');
        const tsName = c.slug + '.emit.ts';
        fs.writeFileSync(path.join(fixturesDir, tsName), tsText, 'utf8');
        rec.emit = { ts: tsName, sha256: sha256(Buffer.from(tsText, 'utf8')), bytes: tsText.length };
        // 可选：真编译
        if (canCompile) {
          const gb = spawnSync(
            process.execPath,
            [path.join(HERE, 'gts-build.mjs'), '--src=' + tsPath, '--workbench=' + wb],
            { cwd: ROOT, encoding: 'utf8', timeout: 600000 }
          );
          const out = ((gb.stdout || '') + (gb.stderr || '')).toString();
          const ok = gb.status === 0;
          rec.compile = { status: ok ? 'ok' : 'failed', exit: gb.status ?? -1 };
          if (!ok) {
            const line = out.split(/\r?\n/).find((l) => /Error|error|failed/.test(l)) || out.split(/\r?\n/)[0] || '';
            rec.compile.errorLine = line.trim().slice(0, 300);
          } else {
            const m = out.match(/✅ \.gia (.+?)  \((\d+) bytes, sha256=([0-9a-f]+)/);
            if (m) rec.compile.gia = { bytes: Number(m[2]), sha256: m[3] };
          }
        } else rec.compile = { status: 'skipped' };
      }
    }
    results.push(rec);

    // ── 与基线比对 ───────────────────────────────────────────────────────
    const diffs = [];
    if (c.expect.status && c.expect.status !== rec.status) diffs.push(`status 期望 ${c.expect.status}，实际 ${rec.status}`);
    for (const cat of c.expect.blockerCategories || []) if (!rec.blockers.includes(cat)) diffs.push('缺 blocker ' + cat);
    if (c.expect.compile && rec.compile && c.expect.compile !== rec.compile.status) {
      diffs.push(`compile 期望 ${c.expect.compile}，实际 ${rec.compile.status}`);
    }
    if (c.expect.compileErrorMatch && rec.compile && rec.compile.errorLine && !rec.compile.errorLine.includes(c.expect.compileErrorMatch)) {
      diffs.push('compile 报错不含「' + c.expect.compileErrorMatch + '」');
    }
    rec.diffs = diffs;
    if (diffs.length) mismatched++;

    const flag = rec.status === 'generated' ? (rec.compile ? (rec.compile.status === 'ok' ? '✅' : '❌') : '✅') : '⛔';
    console.log(
      flag +
        ' ' + c.slug.padEnd(26) +
        ' ' + rec.status.padEnd(10) +
        (rec.compile ? ' compile=' + rec.compile.status : '') +
        (rec.blockers.length ? '  blockers=' + rec.blockers.join(',') : '') +
        (diffs.length ? '  ⚠️ ' + diffs.join('；') : '')
    );
  }

  // ⚠️ 一个样本都不在时**不要写** fixture —— 早先的版本会把全部 skipped 的用例表
  //    覆盖到 fixtures/roundtrip.json 上，等于把基线清空（自测里踩过）。
  const anyReal = results.some((r) => r.status !== 'skipped-missing-sample');
  if (anyReal) {
    fs.writeFileSync(
      path.join(fixturesDir, 'roundtrip.json'),
      JSON.stringify({ _kind: 'qx.graphcode.roundtrip', _note: '由 src/roundtrip.mjs 生成；status/compile 是实测基线', cases: results }, null, 1) + '\n',
      'utf8'
    );
    console.log('\n📦 反向回编译用例 → ' + path.join(fixturesDir, 'roundtrip.json'));
  } else {
    console.log('\n⚠️ 一个样本都没读到 ⇒ 不写 fixtures/roundtrip.json（避免清空基线）');
  }
  fs.rmSync(scratch, { recursive: true, force: true });
  console.log(mismatched ? '⚠️ ' + mismatched + ' 个用例与基线不一致' : '✅ 全部用例与基线一致');
  process.exit(mismatched ? 1 : 0);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main();
