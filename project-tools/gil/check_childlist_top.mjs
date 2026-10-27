// tools/gil/check_childlist_top.mjs —— 【顶层子列表】自检 + 副本防漂移闸门
//
// 为什么要有它（2026-10-07，同类"导不进去"第三次发生）：
//   `gilread.mjs` **不是唯一实现** —— `gen_bulk.mjs` / `gen.mjs` 各自抄了一套。
//   公共库在 2026-09-30 就修好了顶层子列表，但 `gen_bulk.mjs` 自带的
//   `ensureChildListTop` 一直停在旧版：判定写成 `f.wt === 0 && f.field === 502`，
//   而记录顶层的 `#502` 是**消息**（实测 408/408 条都是 wt2）⇒ 该判定**永不命中**
//   ⇒ 退化成 `unshift` ⇒ 新建的 `#503` 落到**位置 0**（要求位置 2，与 `board` 同构）。
//   ⇒ 本脚本把"谁有自己的副本 / 副本有没有漂移"变成**可执行检查**。
//
// 检查项：
//   ① 库自检：对一个"没有顶层 #503"的容器（正是踩坑形状），
//      findChildListTop 必须返回 null；ensureChildListTop 新建的 #503 必须在**位置 2**，
//      写入 ID 后能读回，且**嵌套字段不被覆写**（递归版老毛病）。
//   ② 副本比对：从 `gen_bulk.mjs` 源码里抽出它自己的 findChildListTop + ensureChildListTop，
//      用**同一份合成输入**跑一遍，必须与库给出同样的结果。
//      抽不出来 ⇒ 退出码 2（副本被改名/搬走了，需要人工看一眼）。
//   ③ 旧写法扫描：全目录扫两个致病形状（去行注释后匹配）
//        · `f.wt === 0 && f.field === 502`  —— 永不命中的守卫
//        · `ensureChildListTop`/`ensureChildList` 函数体里出现 `unshift(` —— 位置 0 回退
//      另 WARN：谁 import 了**递归版** `findChildList`（应只用于读/诊断）。
//   ④ 可选 `--gil=<文件>`：真实存档体检 —— 统计记录顶层 ID 列表字段的位置分布，
//      并断言"有子控件的容器里不存在位置 0 的 `#503`"。
//
// 用法：
//   node tools/gil/check_childlist_top.mjs
//   node tools/gil/check_childlist_top.mjs --gil=223-完整界面-可导入.gil
//
// 退出码：0=全过 / 1=有漂移或旧写法 / 2=副本抽取失败 / 3=存档体检不通过

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  findChildListTop, ensureChildListTop, findChildList, setChildList, asIdList, writeVarint, readGil,
} from './gilread.mjs';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const GIL = (argv.find((s) => s.startsWith('--gil=')) || '').slice(6) || null;

const fails = [];
const warns = [];

// ── 合成用例：一个"没有顶层 #503"的容器 ───────────────────────────────────
//   #502 故意做成**消息**（与真实记录一致）；`#505` 状态块**里面**放一个"空的 wt2 字段"
//   —— 这正是历史踩坑形状：顶层没有列表 ⇒ 递归版会钻进去把它当命中。
function syntheticContainer() {
  return {
    field: {
      sub: [
        { field: 501, wt: 0, num: 1073742000n },
        { field: 502, wt: 2, sub: [{ field: 501, wt: 5, f: 8 }], payload: Buffer.alloc(5), len: 5, isText: false, s0: 0, s1: 0 },
        {
          field: 505, wt: 2, payload: Buffer.alloc(0), len: 0, isText: false, s0: 0, s1: 0,
          sub: [
            { field: 501, wt: 5, f: 100 },
            { field: 502, wt: 5, f: 50 },
            { field: 507, wt: 2, sub: null, payload: Buffer.alloc(0), len: 0, isText: false, s0: 0, s1: 0 },
          ],
        },
      ],
    },
  };
}
const shapeOf = (rec) => rec.field.sub.map((f) => '#' + f.field).join(' ');
const nestedProbe = (rec) => {                      // #505 状态块里的那个空 wt2 字段
  const block = rec.field.sub.find((f) => f.field === 505);
  return block.sub.find((f) => f.field === 507);
};

function runCase(label, fclt, eclt) {
  const rec = syntheticContainer();
  const before = shapeOf(rec);
  if (fclt(rec.field.sub) !== null) {
    fails.push(label + '：合成容器本来没有顶层列表，findChildListTop 却返回了非 null');
    return { at: -1, after: before };
  }
  const created = eclt(rec, null);
  const at = rec.field.sub.indexOf(created);
  if (at !== 2) fails.push(label + '：新建 #503 的位置 = ' + at + '（**要求 2**，与 board 同构）  形状 ' + shapeOf(rec));
  if (created.field !== 503) fails.push(label + '：新建字段号 = ' + created.field + '（要求 503）');
  if (fclt(rec.field.sub) !== created) fails.push(label + '：新建之后 findChildListTop 找不回它');
  setChildList(created, [1073742001]);
  const back = asIdList(created.payload, true);
  if (JSON.stringify(back) !== '[1073742001]') fails.push(label + '：写入 ID 后读不回（' + JSON.stringify(back) + '）');
  if (nestedProbe(rec).payload.length !== 0) fails.push(label + '：**嵌套字段被覆写**（递归版老毛病复发）');
  return { at, after: shapeOf(rec) };
}

// 阴性对照：确认这个 fixture **确实是**危险形状 —— 递归版必须真的抓错（否则用例是空的）
{
  const probe = syntheticContainer();
  const wrong = findChildList(probe.field.sub, true);
  if (wrong !== nestedProbe(probe)) {
    fails.push('阴性对照失败：递归 findChildList 在本 fixture 上没抓到嵌套字段，用例失去意义');
  } else {
    console.log('══ 阴性对照：递归 findChildList 抓到了 #505 里的嵌套字段（= 历史踩坑形状）✅');
  }
}

console.log('══ ① 库自检（gilread.ensureChildListTop）');
const libCase = runCase('库', findChildListTop, ensureChildListTop);
console.log('   无顶层列表 → 新建 #503 位置 = ' + libCase.at + '   形状 ' + libCase.after);

// ── ② 从 gen_bulk.mjs 抽出副本，用同一份输入比对 ──────────────────────────
function extractFn(src, name) {
  const start = src.indexOf('function ' + name + '(');
  if (start < 0) return null;
  const open = src.indexOf('{', start);
  if (open < 0) return null;
  let depth = 0;
  for (let j = open; j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}') { depth--; if (depth === 0) return src.slice(start, j + 1); }
  }
  return null;
}

const BULK = path.join(DIR, 'gen_bulk.mjs');
console.log('══ ② 副本比对（gen_bulk.mjs —— 它【不 import】公共库）');
let copyCase = null;
if (!fs.existsSync(BULK)) {
  fails.push('找不到 gen_bulk.mjs');
} else {
  const src = fs.readFileSync(BULK, 'utf8');
  const fSrc = extractFn(src, 'findChildListTop');
  const eSrc = extractFn(src, 'ensureChildListTop');
  if (!fSrc || !eSrc) {
    console.error('   ✗ 抽不出 findChildListTop / ensureChildListTop —— 副本被改名或搬走了，请人工核对');
    process.exit(2);
  }
  const make = new Function('asIdList', fSrc + '\n' + eSrc + '\nreturn { findChildListTop, ensureChildListTop };');
  const copy = make(asIdList);
  copyCase = runCase('gen_bulk 副本', copy.findChildListTop, copy.ensureChildListTop);
  console.log('   无顶层列表 → 新建 #503 位置 = ' + copyCase.at + '   形状 ' + copyCase.after);
  const same = copyCase.at === libCase.at && copyCase.after === libCase.after;
  console.log('   ' + (same ? '✅ 与库同构' : '❌ 与库**不同构** —— 副本漂移了'));
  if (!same) fails.push('gen_bulk 副本与库不同构：库 ' + libCase.after + ' vs 副本 ' + copyCase.after);
}

// ── ③ 旧写法扫描 ──────────────────────────────────────────────────────────
console.log('══ ③ 旧写法扫描（' + fs.readdirSync(DIR).filter((f) => f.endsWith('.mjs')).length + ' 个 .mjs）');
const scanBefore = fails.length;
const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.mjs')).sort();
for (const f of files) {
  const text = fs.readFileSync(path.join(DIR, f), 'utf8');
  text.split('\n').forEach((line, i) => {
    const code = line.replace(/\/\/.*$/, '');
    if (/f\.wt\s*===\s*0\s*&&\s*f\.field\s*===\s*502/.test(code)) {
      fails.push(f + ':' + (i + 1) + '  出现"把顶层 #502 当 varint"的旧判定（永不命中 ⇒ 退化成位置 0）');
    }
  });
  for (const fn of ['ensureChildListTop', 'ensureChildList']) {
    const body = extractFn(text, fn);
    if (body && /\.unshift\s*\(/.test(body)) {
      fails.push(f + '：' + fn + ' 函数体里有 unshift ⇒ 会把新建的 #503 插到位置 0');
    }
  }
  const joined = text.replace(/\n/g, ' ');
  if (/import\s*\{[^}]*\bfindChildList\b[^}]*\}\s*from\s*'\.\/gilread\.mjs'/.test(joined)) {
    warns.push(f + '：import 了**递归版** findChildList —— 确认只用于读/诊断');
  }
}
console.log('   ' + (fails.length === scanBefore ? '✅ 没有致病写法' : '❌ 命中 ' + (fails.length - scanBefore) + ' 处'));
for (const w of warns) console.log('   ⚠️  ' + w);

// ── ④ 可选：真实存档体检 ──────────────────────────────────────────────────
let gilBad = 0;
if (GIL) {
  console.log('══ ④ 存档体检：' + GIL);
  const g = readGil(GIL);
  const dist = new Map();
  let haveList = 0, emptyList = 0, pos0 = [], not503 = [];
  for (const r of g.recs) {
    const fs2 = r.field.sub;
    const at = fs2.findIndex((x) => x.wt === 2 && x.sub === null && !x.isText && x.payload && asIdList(x.payload, true) !== null);
    if (at < 0) continue;
    haveList++;
    dist.set(at, (dist.get(at) || 0) + 1);
    if (asIdList(fs2[at].payload, true).length === 0) emptyList++;
    // 字段号非 503 的"形状命中"：说明顶层存在**更靠前**的无关空消息字段，规则要重新审
    if (fs2[at].field !== 503) not503.push((r.name || '#' + r.id) + '(#' + fs2[at].field + ' @pos' + at + ')');
    // "有子控件"= 这条记录的 ID 被别的记录当成 parentId
    const kids = g.recs.filter((x) => x.parentId === r.id).length;
    if (at === 0 && kids > 0) pos0.push((r.name || '#' + r.id) + '(子 ' + kids + ')');
  }
  console.log('   记录 ' + g.recs.length + ' 条；有顶层 ID 列表字段 ' + haveList + ' 条（其中 payload 为空 ' + emptyList + ' 条）');
  console.log('   位置分布：' + [...dist.entries()].sort((a, b) => a[0] - b[0]).map(([k, v]) => 'pos' + k + '×' + v).join('  '));
  console.log('   ' + (not503.length === 0 ? '✅ 命中的字段号全是 #503' : '⚠️ 字段号非 #503 的命中 ' + not503.length + ' 条：' + not503.slice(0, 8).join(', ')));
  gilBad = pos0.length;
  console.log('   ' + (pos0.length === 0 ? '✅ 没有"有子控件却把列表放在位置 0"的容器' : '❌ 位置 0 且有子控件：' + pos0.join(', ')));
  if (pos0.length) fails.push('存档里存在位置 0 且有子控件的记录：' + pos0.join(', '));
}

// ── 汇总 ──────────────────────────────────────────────────────────────────
console.log('');
if (fails.length === 0) {
  console.log('★ 顶层子列表自检通过（库 + gen_bulk 副本同构，无致病写法' + (GIL ? '，存档体检通过' : '') + '）');
  process.exit(0);
}
console.error('❌ 未通过，' + fails.length + ' 项：');
for (const x of fails) console.error('   · ' + x);
process.exit(GIL && gilBad ? 3 : 1);
