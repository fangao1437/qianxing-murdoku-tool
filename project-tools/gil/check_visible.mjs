// tools/gil/check_visible.mjs —— 查一个 `.gil` 里控件的【初始可见性】（只读，不改任何文件）
//
// ── 为什么有这个工具 ─────────────────────────────────────────────────────
//   2026-10-09：四键弹窗「有 imageId 却没图」，第一嫌疑是 `bg` 自己 visible=false。
//   当时项目里的 `tools/gil/_probe_visible.mjs` **没能定位到**这条字段，原因有两条：
//     · ✗ 它**不递归**：只遍历 `rec.field.sub` 一层，遇到消息只打印子项个数
//       ⇒ 而可见性在 **`#505` 内部第 4 层**，它永远看不到；
//     · ✗ 它**层级假设错**：把 `face`/`note`/`x` 当 `cell.1.1` 的直接子控件找，
//       实际它们在 `cell.1.1/content/` 下面。
//   ⇒ 本工具按这两条教训写：**递归下钻 + 按 parentId 走层级**。
//
// ── ★ 字段与极性（本工具唯一的判据）───────────────────────────────────────
//   相对控件记录：
//     #505（该记录的第 2 个 #505 块）
//       └─ #503 ── #14 ── #17 ── #503 = 1      ← ★ 这个叶子【存在】⇒ 存档里存的是「隐藏」
//                                               叶子【缺失】  ⇒ 「可见」（默认）
//   ⚠️ **极性是反的**：`=1` 表示隐藏，不是可见。
//      protobuf 稀疏编码 ⇒ "可见"那一侧**根本不写字段**，
//      所以「查不到这个叶子」= 可见，**不是**"查不到 = 未知"。
//
//   可信度标法（照 `docs/资料索引.md` §8-3 的三档）：
//     · [工具实测] 「该叶子存在 ⟺ 存档里是隐藏」这个**对应关系** —— 5 组独立对照读出，极性一致
//     · [推断]     该字段的**语义名** —— 引擎 schema 看不到，官方文档只写运行时 API
//                  （`docs/api-cache/mhtakr07vej4.txt:1216-1219,1294-1299` 只有 `visible` 属性与
//                    `SetVisible(visible)`「仅设置可见性，不改变激活状态」）
//     · 项目文档**没有**记载这条字段：`docs/千星存档-gil格式.md` 全文 grep `可见|visible` = 0 命中
//
//   ⚠️ 它回答的只是**存档里那一层**"初始"值。运行时还会被改：
//      父级 `active`、脚本 `SetVisible`、容器门控「激活且可见」等
//      ⇒ 本工具**不能**用来断言"运行时一定看得见/看不见"。
//
// ── 跑法 ────────────────────────────────────────────────────────────────
//   node tools/gil/check_visible.mjs <存档.gil> <控件名或控件id>
//   node tools/gil/check_visible.mjs 229-四键图片分量补上.gil modal.exit.bg
//   node tools/gil/check_visible.mjs 229-四键图片分量补上.gil note
//   node tools/gil/check_visible.mjs 229-四键图片分量补上.gil 1073742476
//   node tools/gil/check_visible.mjs <存档.gil> --hidden     # 列出全部「存档里存隐藏」的控件
//   node tools/gil/check_visible.mjs <存档.gil> --list       # 列出全部控件的可见性
//
//   子控件支持**点号路径**（`modal.exit.bg`、`cell.1.1/content/face`）——
//   解析顺序：① 整串当 id/整名  ② 取**最长**能对上记录名的前缀，余下按子控件逐级下钻。
//   重名控件会**全部列出**（`byName` 只留最后一个，本工具不用它）。
//
//   退出码：0 = 找到了；1 = 没找到 / 用法错。
//   ⚠️ 别用 `| Select-Object -First N` 截断本工具的输出 —— 管道提前关闭会让 node 收到 EPIPE
//      并返回**非 0**，那**不是**工具失败（本项目实测踩过）。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readGil } from './gilread.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const PROJECT = path.resolve(here, '..', '..');

// 可见性叶子的相对路径：在某个 #505 块内
const FLAG_PATH = '/503/14/17/503';

const C = {
  star: (s) => `★ ${s}`,
};

// ── 在一个控件的所有 #505 块里找可见性叶子 ────────────────────────────────
//   返回 { hidden, blocks, hitBlock, hitHas1417 }
//   · hidden      : true=存档里存的是隐藏（叶子=1 存在）
//   · blocks      : 该记录有几个 #505 块
//   · hitBlock    : 含 `#14/#17` 组的那个 #505 块序号（1 起；没有 = 0）
//   · hitHas1417  : 该块里有没有 `#14/#17` 组（即使为空）
function readVisible(rec) {
  const top = (rec.field && rec.field.sub) || [];
  let blocks = 0;
  let hitBlock = 0;
  let hitHas1417 = false;
  let leafVal = null;

  for (const f of top) {
    if (f.field !== 505 || !f.sub) continue;
    blocks++;
    let has1417 = false;
    let val = null;
    (function walk(fs2, p) {
      for (const x of fs2) {
        const pp = p + '/' + x.field;
        if (x.wt === 0) {
          if (pp === FLAG_PATH) val = Number(x.num);
        } else if (x.sub) {
          if (pp === '/503/14/17') has1417 = true;
          walk(x.sub, pp);
        } else if (pp === '/503/14/17') {
          // 空消息在 parseMsg 里可能被当成 bytes（length 0）⇒ 也算"组存在"
          has1417 = true;
        }
      }
    })(f.sub, '');
    if (has1417 || val !== null) {
      hitBlock = blocks;      // 只会有 1 个这样的块（实测）
      hitHas1417 = has1417;
      if (val !== null) leafVal = val;
    }
  }
  return { hidden: leafVal !== null, blocks, hitBlock, hitHas1417, leafVal };
}

// ── 解析控件：支持 id / 整名 / 点号路径 ──────────────────────────────────
function resolve(g, spec) {
  // ① 纯数字 = 控件 id
  if (/^\d+$/.test(spec)) {
    const r = g.recs.find((x) => String(x.id) === spec);
    return r ? [{ rec: r, how: 'id' }] : [];
  }
  // ② 整串当整名
  const exact = g.recs.filter((r) => r.name === spec);
  if (exact.length) return exact.map((r) => ({ rec: r, how: '整名' }));

  // ③ 最长前缀当记录名，余下按子控件逐级下钻
  const parts = spec.split('.');
  for (let k = parts.length - 1; k >= 1; k--) {
    const head = parts.slice(0, k).join('.');
    const rest = parts.slice(k);
    const roots = g.recs.filter((r) => r.name === head);
    if (!roots.length) continue;
    const out = [];
    for (const root of roots) {
      let cur = [root];
      let okAll = true;
      for (const seg of rest) {
        const next = [];
        for (const c of cur) {
          for (const ch of g.recs) if (ch.parentId === c.id && ch.name === seg) next.push(ch);
        }
        if (!next.length) { okAll = false; break; }
        cur = next;
      }
      if (okAll) for (const r of cur) out.push({ rec: r, how: `路径 ${head} + 子控件 ${rest.join(' → ')}` });
    }
    if (out.length) return out;
  }
  // ④ 退一步：也接受 `a/b/c` 斜杠路径
  if (spec.includes('/')) {
    return resolve(g, spec.replace(/\//g, '.'));
  }
  return [];
}

const byId = (g, id) => g.recs.find((r) => r.id === id) || null;

// 祖先链（从最外层到自身）
function chain(g, rec) {
  const out = [];
  let cur = rec;
  let guard = 0;
  while (cur && guard++ < 32) {
    out.unshift(cur);
    cur = cur.parentId != null ? byId(g, cur.parentId) : null;
  }
  return out;
}
const showPath = (g, rec) => chain(g, rec).map((r) => r.name || `#${r.id}`).join('/');

function describe(rec) {
  const v = readVisible(rec);
  if (v.hidden) {
    return {
      v,
      text: `隐藏（存档里存的是「初始可见性 = 关」）`,
      why: `第 ${v.hitBlock} 个 #505 块里有 \`${FLAG_PATH} = ${v.leafVal}\``,
    };
  }
  if (v.hitHas1417) {
    return {
      v,
      text: `可见（默认）`,
      why: `第 ${v.hitBlock} 个 #505 块里 \`#503/#14/#17\` 组**存在但为空** ⇒ 叶子缺失 = 可见`,
    };
  }
  return {
    v,
    text: `可见（默认）`,
    why: `整条记录里都没有 \`#503/#14/#17\` 组 ⇒ 字段未写 = 可见`,
  };
}

// ── main ────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
if (argv.length < 2) {
  console.log('用法：node tools/gil/check_visible.mjs <存档.gil> <控件名或id>');
  console.log('      node tools/gil/check_visible.mjs <存档.gil> --hidden   # 列出全部"存隐藏"的');
  console.log('      node tools/gil/check_visible.mjs <存档.gil> --list     # 列出全部控件');
  console.log('例：  node tools/gil/check_visible.mjs 229-四键图片分量补上.gil modal.exit.bg');
  process.exit(1);
}
const gilArg = argv[0];
const spec = argv[1];
const gilFile = path.isAbsolute(gilArg) ? gilArg : path.join(PROJECT, gilArg);
if (!fs.existsSync(gilFile)) {
  console.log(`✗ 找不到存档：${gilFile}`);
  process.exit(1);
}

let g;
try {
  g = readGil(gilFile);
} catch (e) {
  console.log(`✗ 解析失败：${e.message}`);
  process.exit(1);
}

console.log(`== 存档 == ${path.basename(gilFile)}   控件记录 ${g.recs.length} 条`);
console.log(`== 判据 == \`${FLAG_PATH}\` 存在 ⇒ 隐藏；缺失 ⇒ 可见（默认）   [工具实测]`);

// ── 模式：--hidden / --list ─────────────────────────────────────────────
if (spec === '--hidden' || spec === '--list') {
  const rows = g.recs.map((r) => ({ r, ...describe(r) }));
  const hidden = rows.filter((x) => x.v.hidden);
  const list = spec === '--hidden' ? hidden : rows;
  list.sort((a, b) => (a.r.name || '').localeCompare(b.r.name || ''));
  console.log(`\n== ${spec === '--hidden' ? '存档里存【隐藏】' : '全部'}的控件：${list.length} / ${rows.length} 条 ==`);
  for (const x of list) {
    const mark = x.v.hidden ? '★隐藏' : '可见 ';
    console.log(`  ${mark} ${showPath(g, x.r).padEnd(40)} id=${x.r.id}`);
  }
  if (spec === '--hidden') {
    console.log(`\n【说明】这 ${hidden.length} 条是"存档里存隐藏"。`);
    console.log(`  ✓ 与编辑器「初始可见性」对照过的已知样本：`);
    console.log(`      note / x            = 隐藏  ⇒ 有 flag ✓`);
    console.log(`      wall.* / door.*     = 隐藏  ⇒ 有 flag ✓（gen_btn_art.mjs:47-58 记过）`);
    console.log(`      home（检视器：初始可见性 关）= 有 flag ✓`);
    console.log(`      face                = 显示  ⇒ 无 flag ✓`);
    console.log(`      root/assets/clues/… = 开    ⇒ 无 flag ✓`);
    console.log(`  ⚠️ 这只说明【存档里那一层】。运行时改可见性（脚本 SetVisible / 父级 active）不在此列。`);
  }
  process.exit(0);
}

// ── 模式：查单个控件 ────────────────────────────────────────────────────
const hits = resolve(g, spec);
if (!hits.length) {
  console.log(`\n✗ 没找到控件「${spec}」`);
  console.log('  · 名字必须是**一字不差**（脚本 `GetChild` 也是按名精确取）');
  console.log('  · 子控件用点号路径：`modal.exit.bg`、`cell.1.1/content/face`');
  console.log('  · 也可以直接给控件 id');
  console.log(`  提示：跑 \`--list\` 看这份存档里都有哪些名字。`);
  process.exit(1);
}

for (const { rec, how } of hits) {
  const d = describe(rec);
  const ch = chain(g, rec);
  console.log(`\n===== ${showPath(g, rec)} =====`);
  console.log(`  匹配方式：${how}`);
  console.log(`  控件 id：${rec.id}   父控件 id：${rec.parentId ?? '(无)'}   #505 块数：${d.v.blocks}`);
  console.log(`\n  ${C.star('存档可见性：' + d.text)}`);
  console.log(`  依据：${d.why}`);

  if (ch.length > 1) {
    console.log(`\n  祖先链的可见性（父级隐藏 ⇒ 子控件一样看不见）：`);
    let ancHidden = 0;
    for (const a of ch.slice(0, -1)) {
      const av = readVisible(a);
      if (av.hidden) ancHidden++;
      console.log(`    ${av.hidden ? '★隐藏' : '可见 '} ${showPath(g, a).padEnd(34)} id=${a.id}`);
    }
    if (ancHidden) {
      console.log(`    ⚠️ 有 ${ancHidden} 个祖先是隐藏的 ⇒ 它自己在运行时**也会看不见**。`);
    } else {
      console.log(`    ✓ 祖先全部是可见的 ⇒ 存档层面没有"被父级连坐"的问题。`);
    }
  }
}

console.log(`\n【可信度】`);
console.log(`  · [工具实测] 「\`${FLAG_PATH}\` 存在 ⟺ 存档里存的是隐藏」这个对应关系；`);
console.log(`  · [推断]     该字段的**语义名** —— 引擎 schema 看不到，官方文档只给运行时 API；`);
console.log(`  · 项目文档未记载此字段（\`docs/千星存档-gil格式.md\` 全文 grep \`可见|visible\` = 0 命中）。`);
console.log(`【边界】本工具只回答**存档里那一层初始值** —— 运行时还会被改：`);
console.log(`  父级 active、脚本 SetVisible、容器门控「激活且可见」等 ⇒ 不能据此断言"运行时看得见/看不见"。`);
process.exit(0);
