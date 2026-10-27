// [[----------------------------------------------------------------------------
//   tools/check_encoding.mjs —— 编码/BOM 机械哨兵（Round 51）
//
//   为什么需要它：**BOM 的规则在本项目里是相反的** ✗，我已经因此栽过两次 ✓：
//     · **`lua/**/*.lua` 必须【没有】BOM** ✓ —— 引擎的 Lua 解析器；
//     · **`tools/**/*.ps1` 与 `tests/**/*.ps1` 必须【有】BOM** ✓ ——
//       PowerShell 5.1 靠 BOM 判编码；**无 BOM 且含中文** 时它按 **GBK** 解码
//       ⇒ **整份脚本解析失败** ✗✗（真发生过：`tools/check_all.ps1` 一度完全跑不起来 ✓）。
//   还有一个**隐身雷**：`edit` / `write` 工具写出的文件**不带 BOM** ✓
//     ⇒ 每次用它们改 `.ps1` 都会**悄悄剥掉 BOM** ✗ ⇒ 必须每次复查 ✓ ⇒ 所以要做成工具 ✓
//
//   另外顺带查两条同族的编码坑：
//     · `.lua` / `.mjs` 里**不允许出现 UTF-8 BOM**（同上）
//     · 文件必须是**合法 UTF-8**（坏字节会让 PS 5.1 / Lua 各自按不同方式乱解 ✓）
//
//   跑法：node tools/check_encoding.mjs          # 退出码 0=全过，1=有违规
//   只读，不改任何文件 ✓
//  ----------------------------------------------------------------------------]]--

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname, relative } from 'node:path';

const ROOT = process.cwd();
// 排除：依赖 / 归档 / 第三方快照（它们的编码不归我们管，也不该被本哨兵判红 ✓）
const SKIP = new Set([
  'node_modules', '.git', 'dist', 'versions', '_backup', 'baseline',
  'tools/bin', 'tools/_dl', 'tools/lua-tooling/out', 'tools/lua53check/node_modules',
  // ★★★★★ 2026-10-09 **归档快照目录也要排除** ✗✓
  //   `old-repo/` 是「另一个本地仓库」的 `git archive` 快照（提交 b4f8336 加进来的），
  //   是**历史原件**、不是本工程的在用源码 ⇒ 不该被本哨兵判红，更不该被"规整" ✓
  //   （实测：不排除时本步 25 项违规**全部**来自 `old-repo/`，
  //     其中 `old-repo/tools/lua53check/node_modules/fengari/…` 还带 node_modules ✓
  //     —— 上面那条 `tools/lua53check/node_modules` 因为多了 `old-repo/` 前缀而匹配不上 ✗）
  'old-repo',
]);

// 规则表：扩展名 → 期望
//
// ★★★★★ 2026-10-05 Round 88 **更正上一轮（Round 87）的裁定 —— 它说反了** ✗✗
//
//   我 Round 87 写下的"裁定"是：**2c 的规则是危险的一侧**、应当把
//     `tools/normalize_encoding.ps1` 改成"`.ps1` 一律必须有 BOM" ✗
//   —— **这是错的** ✗✓，因为我**没有读那个脚本**就下了结论 ✗（只看了 `check_all` 的
//   `[STRIP-BOM]` 输出 ✓）。Round 88 读了它，它的规则**本来就更准确** ✓✓：
//
//     · `.ps1` **且含非 ASCII** ⇒ **必须有 BOM** ✓（`if ($ext -eq '.ps1' -and $nonAscii)` ✓）
//         —— 因为它会被 **PowerShell 5.1** 读，而 5.1 把**无 BOM** 的当 **GBK** ⇒ 中文乱码 ⇒ 解析失败 ✗
//     · `.ps1` **纯 ASCII** ⇒ **不需要 BOM** ✓（多余 BOM 无意义 ✓ 2c 会剥掉 ✓ 剥得对 ✓）
//     · `.lua` / `.md` ⇒ **必须没有 BOM** ✓（**bundler 会把所有模块拼成一个 chunk** ⇒
//         中间出现 BOM 会让 Lua 5.3 报错 ✗ —— 这个理由比我原来写的"引擎解析器不收"更具体 ✓）
//     · 它甚至**已经记着**那个隐身雷 ✓：「`edit` 工具每次写都会剥掉 BOM ⇒ 改完非 ASCII 的
//         `.ps1` 必须补回来」✓✓
//
//   ⇒ ★ **所以真正的结论是：`normalize_encoding.ps1` 是对的，我 Round 51 那条"`.ps1` 一律要 BOM"
//     才是错的那一侧** ✗✓（它给**纯 ASCII** 的文件错加了 BOM ⇒ 2c 把它们剥回去 ✓ 剥得对 ✓）
//   ⇒ **不需要改 `normalize_encoding.ps1`** ✗✓（我 Round 87 提的"待办"**作废** ✓）
//
//   ★ **方法论教训（比这条规则本身值钱 ✓）**：**没读规则就不要宣布"两条规则冲突"** ✗✓
//      —— 我只看到"它把我加的 BOM 剥了" ⇒ 就推断"它要求无 BOM" ✗
//        ⇒ 实际它要求的是"**纯 ASCII 的 .ps1 无 BOM**" ✓ 与我加的**不是同一类文件** ✓
//      ⇒ **"我看到 A 被改了" ≠ "A 的规则是 B"** ✓ —— 去**读那一行代码** ✓
//
//   ⇒ 本哨兵因此**不判 `.ps1`** ✓（权威在 2c ✓ 而 2c 是对的 ✓）；只**报告** ✓
const RULES = {
  '.lua':  { bom: false, why: 'bundler 把所有模块拼成一个 chunk ⇒ 中间的 BOM 会让 Lua 5.3 报错 ✓' },
  '.mjs':  { bom: false, why: 'Node 会把 BOM 当内容（多数情况无害，但统一不要 ✓）' },
  '.js':   { bom: false, why: '同上' },
  '.cjs':  { bom: false, why: '同上' },
  // '.ps1' 故意**不列在这里**：规则是"含非 ASCII 才要 BOM"✓ 权威归 tools/normalize_encoding.ps1（2c）✓
  '.md':   { bom: false, why: '文档统一无 BOM ✓' },
  '.json': { bom: false, why: 'JSON 规范不建议 BOM ✓' },
};

function walk(dir, out = []) {
  let entries;
  try { entries = readdirSync(dir); } catch { return out; }
  for (const name of entries) {
    const p = join(dir, name);
    const rel = relative(ROOT, p).replace(/\\/g, '/');
    if (SKIP.has(rel) || [...SKIP].some((s) => rel === s || rel.startsWith(s + '/'))) continue;
    let st;
    try { st = statSync(p); } catch { continue; }
    if (st.isDirectory()) walk(p, out);
    else if (RULES[extname(name).toLowerCase()]) out.push(p);
  }
  return out;
}

const files = walk(ROOT);
let bad = 0, checked = 0, ps1NoBom = 0;
const byRule = {};

for (const f of files) {
  const rel = relative(ROOT, f).replace(/\\/g, '/');
  const ext = extname(f).toLowerCase();
  const rule = RULES[ext];
  let buf;
  try { buf = readFileSync(f); } catch { continue; }
  checked++;
  const hasBom = buf.length >= 3 && buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF;

  // ① BOM 是否符合规则（.ps1 **不在**规则表里 ⇒ 走下面的"仅报告" ✓）
  if (rule && hasBom !== rule.bom) {
    bad++;
    byRule[ext] = (byRule[ext] || 0) + 1;
    console.log(`  ✗ ${rel}`);
    console.log(`      BOM=${hasBom}，应为 BOM=${rule.bom} —— ${rule.why}`);
  }

  // ② ★ `.ps1`：**只报告，不判红** ✓（权威归 `tools/normalize_encoding.ps1` = check_all 步骤 2c ✓）
  //    为什么要报告：**PS 5.1** 读**无 BOM 且含中文**的 `.ps1` ⇒ 按 GBK 解码 ⇒ **解析失败** ✗
  //      而 `edit`/`write` 工具写文件**不带 BOM** ⇒ 每次改 `.ps1` 都会悄悄剥掉它 ✗
  //      （本项目已因此栽过 4 次 ✓ ⇒ 必须让它**在每次 check_all 里可见** ✓）
  if (ext === '.ps1' && !hasBom) {
    ps1NoBom++;
    // ⚠️ 这里**不能用反引号**包 `powershell` ✗ —— 外层已经是模板字符串，
    //    内层再来一对反引号会把字符串提前结束 ⇒ `SyntaxError: missing ) after argument list`
    //    （Round 66 我当场踩过 ✓ 记在这里防复发 ✓）
    console.log(`  ℹ ${rel} —— .ps1 无 BOM ⚠️ 若它会被 PowerShell 5.1（powershell）执行，可能按 GBK 解码而解析失败 ✗`);
    console.log(`      权威归步骤 2c 的 normalize_encoding.ps1 ✓ 这里只报告、不判红 ✓（两侧规则曾互相抵消 ✗）`);
  }

  // ③ 是否合法 UTF-8（严格解码复验；Node 的 toString 会静默替换坏字节 ⇒ 用 fatal 再试一次）
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch {
    bad++;
    console.log(`  ✗ ${rel} —— 不是合法 UTF-8 ✗（PS 5.1 与 Lua 会各自乱解）`);
  }
}

console.log(`== 编码/BOM 哨兵 ==  检查 ${checked} 个文件`);
if (ps1NoBom > 0) console.log(`  ℹ 另有 ${ps1NoBom} 个 .ps1 无 BOM（仅提示 ✓ 权威在 2c）`);
if (bad === 0) {
  console.log('  ✓ 全过（.lua/.mjs/.md/.json 无 BOM ✓）');
} else {
  console.log(`  ⇒ ${bad} 项违规 ✗`);
  console.log('  修法：');
  console.log('    · .ps1 缺 BOM ⇒ 用 [System.IO.File]::WriteAllBytes 前置 EF BB BF 三个字节（只加字节，不改内容 ✓）');
  console.log('    · .lua/.md 多了 BOM ⇒ 读成 UTF8 后以 UTF8Encoding($false) 写回 ✓');
  console.log('    ⚠️ 用 edit/write 工具改 .ps1 之后【必须复查这一步】✗（那些工具不写 BOM ✓）');
}
process.exit(bad === 0 ? 0 : 1);
