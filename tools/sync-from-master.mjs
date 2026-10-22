#!/usr/bin/env node
// tools/sync-from-master.mjs —— 从「主工作仓库」同步节点图工具链到本仓库，并施加**写死的**路径适配
//
// ════════════════════════════════════════════════════════════════════════════
// 为什么需要它
// ════════════════════════════════════════════════════════════════════════════
//
//   本仓库的 `src/**`、`data/nodes.json`、`specs/**`、`test/**` **不是**这里手写的，
//   它们的唯一事实源是主工作仓库的 `tools/qx/graphcode/`（外加 `tools/gil/gilread.mjs`）。
//   两边的**目录形状不同**（上游 `tools/qx/graphcode/` → 本仓库 `src/` + `data/`），
//   所以同步时必须改一小撮路径表达式。这套改动不允许"每次都手改一下"：
//   手改会漂、会漏、会让测试时绿时红。⇒ 改法写死在本文件里，锚点找不到就报错退出。
//
//   如果上游加了新文件（例如 task-8 正在加的 `fixtures/`），照旧同步；
//   新文件若引用了新的路径形状，就在下面的 `PATCHES` 里加一条，别临时手改产物。
//
// ════════════════════════════════════════════════════════════════════════════
// 用法
// ════════════════════════════════════════════════════════════════════════════
//
//   node tools/sync-from-master.mjs --from="<主仓库>/qianxing-murdoku/tools/qx/graphcode"
//   # 或
//   $env:QX_MASTER_GRAPHCODE = "<主仓库>/qianxing-murdoku/tools/qx/graphcode"
//   node tools/sync-from-master.mjs
//
//   同步完**必须**跑：node test/run-tests.mjs
//
// 退出码：0 = 同步并全部锚点命中；1 = 有锚点没命中（产物可能已写，看报告）；2 = 参数/源目录不对

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..');

const USAGE =
  '用法: node tools/sync-from-master.mjs --from="<主仓库>/qianxing-murdoku/tools/qx/graphcode"\n' +
  '      或设置环境变量 QX_MASTER_GRAPHCODE 后直接运行。';

const argv = process.argv.slice(2);
const argOf = (k) => {
  const a = argv.find((s) => s.startsWith('--' + k + '='));
  return a ? a.slice(k.length + 3) : null;
};

const FROM = path.resolve(argOf('from') || process.env.QX_MASTER_GRAPHCODE || '');
if (!argOf('from') && !process.env.QX_MASTER_GRAPHCODE) {
  console.error(USAGE);
  process.exit(2);
}
if (!fs.existsSync(FROM)) {
  console.error('❌ --from 不存在: ' + FROM + '\n' + USAGE);
  process.exit(2);
}

// ════════════════════════════════════════════════════════════════════════════
// 1. 拷贝清单（上游相对路径 → 本仓库相对路径）
//    · 根目录的 *.mjs 与 *.json **自动发现**（上游会加新工具/新数据表，别写死清单）
//    · specs/ 下所有 *.json 自动发现
//    · test/run-tests.mjs、以及 tools/gil/gilread.mjs 显式列出
// ════════════════════════════════════════════════════════════════════════════
const listFiles = (dir, ext) =>
  fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith(ext))
    .map((e) => e.name)
    .sort();

const rootMjs = listFiles(FROM, '.mjs');
const rootJson = listFiles(FROM, '.json');
const specsDir = path.join(FROM, 'specs');
const specJson = fs.existsSync(specsDir) ? listFiles(specsDir, '.json') : [];

// 上游根目录的 .json 都是**数据表**（nodes.json / node-aliases.json …）⇒ 一律进本仓库 data/
const COPY = [
  ...rootMjs.map((n) => [n, 'src/' + n]),
  ...rootJson.map((n) => [n, 'data/' + n]),
  ...specJson.map((n) => ['specs/' + n, 'specs/' + n]),
  ['test/run-tests.mjs', 'test/run-tests.mjs'],
  // 控件层读取器：上游在 tools/gil/，不在 graphcode/ 里，但 read.mjs 直接 import 它
  ['../../gil/gilread.mjs', 'src/gilread.mjs'],
];

// 整目录同步（存在才同步）：只放"从 .gia 抽取出来的 JSON/规格"，不放 .gia 二进制
const COPY_TREES = [['fixtures', 'fixtures']];

// 主仓库 docs/ 里的报告（相对 FROM 往上三层 = 主仓库根）：有就带一份过来，没有就跳过
const EXTRA_DOCS = [['../../../docs/official-gia-coverage.md', 'docs/official-gia-coverage.md']];

// ════════════════════════════════════════════════════════════════════════════
// 2. 路径适配规则（每条都必须命中，或者"已经命中"）
//    格式: [本仓库相对路径, [[原文, 新文], ...]]
// ════════════════════════════════════════════════════════════════════════════
// 每条规则 = { f: 原文, t: 新文, req: 是否必须命中 }
//   · req:true  = 上游一定有这行，没命中就是"上游改了形状" → 报错（不许静默放过）
//   · req:false = 只有文件里恰好提到时才需要（例如提示文本里的 specs/out 子路径）
// 幂等：原文已不在、新文已在 → 视为已同步，不算错。所以本脚本可以反复跑。
const req = (f, t) => ({ f, t, req: true });
const opt = (f, t) => ({ f, t, req: false });

// 上游把「仓库根」往上数三层（tools/qx/graphcode/ → 主仓库根）；本仓库 src/ 只往上一层
const ROOT_FIX = req("const ROOT = path.resolve(HERE, '..', '..', '..');", "const ROOT = path.resolve(HERE, '..');");
// 节点表从同目录搬到 data/
const NODES_FIX = req("path.join(HERE, 'nodes.json')", "path.join(ROOT, 'data', 'nodes.json')");
const OUTDIR_FIX = req("path.join('tools', 'qx', 'graphcode', 'out')", "path.join('out')");
// 文本里的路径：tools/qx/graphcode/<x> → src/<x>；随后收两条被这步"带歪"的子目录
const TEXT_FIX = [
  req('tools/qx/graphcode/', 'src/'),
  opt('src/specs/', 'specs/'), // 「--spec=tools/qx/graphcode/specs/x.json」→「--spec=specs/x.json」
  opt('src/out', 'out'), //       「默认 --outdir=tools/qx/graphcode/out」→「--outdir=out」
  opt('docs/节点图双向工具-spike报告.md', 'docs/spike-报告摘要.md'), // 主仓库的报告在本仓库是摘要
  // 主仓库的存档名/仓库名不进公开仓库（例子里的文件名改成占位符）
  opt('qianxing-murdoku/485-教程teach-v289.gil', '<你的存档>.gil'),
  opt('517-模板测试-v2.gil', '<你的存档>.gil'),
];

// 上游以后**新加**的 src 工具（没有显式规则时用这一组）：全是"可选"，只做通用适配，不判定漂移
const BASE_SRC_RULES = [
  opt("const ROOT = path.resolve(HERE, '..', '..', '..');", "const ROOT = path.resolve(HERE, '..');"),
  opt("path.join(HERE, 'nodes.json')", "path.join(ROOT, 'data', 'nodes.json')"),
  opt("path.join('tools', 'qx', 'graphcode', 'out')", "path.join('out')"),
  opt("path.join('tools', 'qx', 'graphcode', 'fixtures')", "path.join('fixtures')"),
  ...TEXT_FIX.map((r) => opt(r.f, r.t)),
];

// 正则规则（对所有 src/*.mjs 生效）：同目录读的 json 数据表已搬到 data/。
// 注意 `$1` 是捕获的表名 —— nodes.json / node-aliases.json / 以后新加的都覆盖。
const REGEX_RULES = [
  { re: /path\.join\(HERE, '([\w.-]+\.json)'\)/g, to: "path.join(ROOT, 'data', '$1')" },
  // 控件层读取器在主仓库 tools/gil/ 下，本仓库与 src 同目录 ⇒ 相对 import 要跟着改（read.mjs / giaread.mjs 都用它）
  { re: /\.\.\/\.\.\/gil\/gilread\.mjs/g, to: './gilread.mjs' },
];

const PATCHES = [
  [
    'src/read.mjs',
    [
      ROOT_FIX,
      NODES_FIX,
      OUTDIR_FIX,
      req("'../../gil/gilread.mjs'", "'./gilread.mjs'"), // 控件层读取器已同目录拷进来
      req('tools/gil/gilread.mjs', 'src/gilread.mjs'), //   注释里的出处
      ...TEXT_FIX,
    ],
  ],
  ['src/emit.mjs', [ROOT_FIX, NODES_FIX, OUTDIR_FIX, ...TEXT_FIX]],
  [
    'src/gen-nodes.mjs',
    [
      ROOT_FIX,
      req("path.join('tools', 'qx', 'graphcode', 'nodes.json')", "path.join('data', 'nodes.json')"),
      ...TEXT_FIX,
    ],
  ],
  ['src/gts-build.mjs', [ROOT_FIX, ...TEXT_FIX]],
  ['src/gen-ports.mjs', [ROOT_FIX, NODES_FIX, ...TEXT_FIX]],
  [
    'test/run-tests.mjs',
    [
      // test/ 在本仓库根，src/ 是代码目录：GC = 代码目录，ROOT = 仓库根
      req("const GC = path.resolve(HERE, '..');", "const GC = path.resolve(HERE, '..', 'src');"),
      req("const ROOT = path.resolve(GC, '..', '..', '..');", "const ROOT = path.resolve(HERE, '..');"),
      req("path.join(GC, 'nodes.json')", "path.join(ROOT, 'data', 'nodes.json')"),
      req("path.join(GC, 'node-aliases.json')", "path.join(ROOT, 'data', 'node-aliases.json')"),
      req("path.join(GC, 'specs'", "path.join(ROOT, 'specs'"),
      opt("path.join(GC, 'fixtures'", "path.join(ROOT, 'fixtures'"), // 上游以后加 fixtures 断言时用（注意 t 不带右括号）
      req('tools/qx/graphcode/test/run-tests.mjs', 'test/run-tests.mjs'),
    ],
  ],
  // 节点表头里的 regenerate 命令跟着目录形状改（这份文件的唯一手改点，其余字节原样）
  ['data/nodes.json', [req('tools/qx/graphcode/', 'src/')]],
  // 覆盖度报告是 coverage.mjs 生成的，开头两行写着"怎么复现" —— 命令里的目录形状跟着改
  ['docs/official-gia-coverage.md', [opt('tools/qx/graphcode/', 'src/')]],
];

// ════════════════════════════════════════════════════════════════════════════
// 3. 执行
// ════════════════════════════════════════════════════════════════════════════
const enc = 'utf8';
let copied = 0;
let copiedBytes = 0;
const missingFiles = [];

for (const [rel, dest] of COPY) {
  const srcPath = path.resolve(FROM, rel);
  if (!fs.existsSync(srcPath)) {
    missingFiles.push(rel);
    continue;
  }
  const dstPath = path.join(REPO, dest);
  fs.mkdirSync(path.dirname(dstPath), { recursive: true });
  fs.copyFileSync(srcPath, dstPath);
  const n = fs.statSync(dstPath).size;
  copied++;
  copiedBytes += n;
  console.log('  copy  ' + rel.padEnd(26) + ' → ' + dest.padEnd(22) + n.toString().padStart(8) + ' B');
}

for (const [relDir, destDir] of COPY_TREES) {
  const srcDir = path.resolve(FROM, relDir);
  if (!fs.existsSync(srcDir)) {
    console.log('  skip  ' + relDir.padEnd(26) + ' → 上游没有这个目录（正常：任务 8 还没产出）');
    continue;
  }
  const walk = (d, relBase) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      const r = path.posix.join(relBase, e.name);
      if (e.isDirectory()) walk(p, r);
      else {
        const dstPath = path.join(REPO, destDir, r);
        fs.mkdirSync(path.dirname(dstPath), { recursive: true });
        // 二进制素材一律拒绝入包（.gia/.gil 不随仓库分发）
        if (/\.(gia|gil)$/i.test(e.name)) {
          console.log('  ⛔ 拒绝同步二进制素材: ' + p);
          continue;
        }
        fs.copyFileSync(p, dstPath);
        const n = fs.statSync(dstPath).size;
        copied++;
        copiedBytes += n;
        console.log('  copy  ' + r.padEnd(26) + ' → ' + path.posix.join(destDir, r).padEnd(22) + n.toString().padStart(8) + ' B');
      }
    }
  };
  walk(srcDir, '');
}

for (const [rel, dest] of EXTRA_DOCS) {
  const srcPath = path.resolve(FROM, rel);
  if (!fs.existsSync(srcPath)) {
    console.log('  skip  ' + rel.padEnd(26) + ' → 主仓库还没有这份报告（正常：上游任务未完成）');
    continue;
  }
  const dstPath = path.join(REPO, dest);
  fs.mkdirSync(path.dirname(dstPath), { recursive: true });
  fs.copyFileSync(srcPath, dstPath);
  const n = fs.statSync(dstPath).size;
  copied++;
  copiedBytes += n;
  console.log('  copy  ' + path.basename(rel).padEnd(26) + ' → ' + dest.padEnd(22) + n.toString().padStart(8) + ' B');
}

console.log('\n── 路径适配 ─────────────────────────────────────────────────');
let anchorsMissing = 0;
let regexHits = 0;
const patched = new Set(PATCHES.map(([rel]) => rel));

/** 应用一组规则；bad 只收 req:true 且没命中的 */
function applyRules(rel, rules, { quiet = false } = {}) {
  const p = path.join(REPO, rel);
  if (!fs.existsSync(p)) {
    if (!quiet) console.log('  ⚠️  ' + rel + ' 不存在，跳过');
    return;
  }
  let text = fs.readFileSync(p, enc);
  const applied = [];
  const bad = [];
  for (const rule of rules) {
    if (text.includes(rule.f)) {
      const count = text.split(rule.f).length - 1;
      text = text.split(rule.f).join(rule.t);
      applied.push(rule.f + '  ×' + count);
    } else if (text.includes(rule.t)) {
      // 已经同步过 → 幂等，不算错
    } else if (rule.req) {
      bad.push(rule.f);
    }
  }
  let re = 0;
  for (const rule of REGEX_RULES) {
    const before = text;
    text = text.replace(rule.re, rule.to);
    if (text !== before) re++;
  }
  fs.writeFileSync(p, text, enc);
  regexHits += re;
  if (bad.length) {
    anchorsMissing += bad.length;
    console.log('  ❌ ' + rel + ' 有 ' + bad.length + ' 条必撞锚点没命中（上游改了形状？）：');
    for (const b of bad) console.log('       · ' + b);
  } else if (!quiet) {
    console.log(
      '  ✅ ' + rel + (applied.length || re ? '  （改了 ' + applied.length + ' 条规则' + (re ? ' + ' + re + ' 条正则' : '') + '）' : '  （已是适配后的状态）')
    );
  }
}

for (const [rel, rules] of PATCHES) applyRules(rel, rules);

// 上游新加、本文件没有显式规则的 src 工具：只做通用适配（全可选，不判定漂移）
for (const name of fs.readdirSync(path.join(REPO, 'src')).sort()) {
  if (!name.endsWith('.mjs')) continue;
  const rel = 'src/' + name;
  if (patched.has(rel)) continue;
  const before = fs.readFileSync(path.join(REPO, rel), enc);
  applyRules(rel, BASE_SRC_RULES, { quiet: true });
  const after = fs.readFileSync(path.join(REPO, rel), enc);
  console.log('  ✅ ' + rel + (before === after ? '  （通用适配：无需改动）' : '  （通用适配：已改）'));
}

console.log('\n── 汇总 ─────────────────────────────────────────────────────');
console.log('  源目录      : ' + FROM);
console.log('  拷贝文件    : ' + copied + ' 个，' + copiedBytes + ' B');
console.log('  正则适配    : ' + regexHits + ' 处（src/*.mjs 里 path.join(HERE,\'x.json\') → data/）');
if (missingFiles.length) console.log('  源里缺文件  : ' + missingFiles.join(', '));
if (anchorsMissing) console.log('  ❌ 锚点未命中: ' + anchorsMissing + ' 条（见上）—— 上游改了形状，先改本文件的 PATCHES 再同步');
console.log('  下一步      : node test/run-tests.mjs');

process.exit(anchorsMissing ? 1 : 0);
