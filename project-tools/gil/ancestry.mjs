// tools/gil/ancestry.mjs —— **只读**：一条控件记录挂在哪个"画布 / 顶层容器"下
//
// 为什么要有它（2026-10-15）：
//   ★ `docs/千星存档-gil格式.md` 的坑 #7 写着：★ **不能跨画布拿原型** ✓
//     （存档里有 4 套"客户端控件容器"，各带一份 board / cell.1.1 ✓）
//   ★ 而**同名记录会出现多次**（`cell.1.1` / `clue` / `home` …）✗
//     ⇒ ★ 只按名字找记录，会拿到**另一个画布**里的同名控件 ✓
//   ★ 本工具把"这条记录住在哪条祖先链下"打出来，用于：
//     · 选原型前先确认"它在不在活动画布"
//     · 判断两条同名记录是不是两份
//
// 用法：
//   node tools/gil/ancestry.mjs <存档.gil> [名字…]
//   node tools/gil/ancestry.mjs "365-选关四张卡-v232.gil" root home clues hex.back select.card.1

import path from 'node:path';
import { readGil, bigIdTop, textsOf, KNOWN_TYPES } from './gilread.mjs';

const file = process.argv[2];
const names = process.argv.slice(3);
if (!file) {
  console.error('用法: node tools/gil/ancestry.mjs <存档.gil> [名字…]');
  process.exit(1);
}

const g = readGil(file);

// 走一遍树：给"记录字段所在的那层数组"记录祖先链（谁的 sub 里）
const parentOfHolder = new Map();   // holder 数组 → 最近的"带名字记录"
const nameOfHolder = new Map();
const pathOfHolder = new Map();

(function walk(fields, p, holderRecName) {
  for (const f of fields) {
    if (!f.sub) continue;
    const sub = f.sub;
    const nm = (() => {
      const t = textsOf(sub, []).map((x) => x.payload.toString('utf8')).find((s) => !KNOWN_TYPES.has(s) && s.length < 48);
      return t || null;
    })();
    pathOfHolder.set(sub, p + '/#' + f.field);
    parentOfHolder.set(sub, holderRecName);
    nameOfHolder.set(sub, nm);
    walk(sub, p + '/#' + f.field, nm || holderRecName);
  }
})(g.tree, '', '(tree)');

function holdersOf(rec) {
  // rec.holder 就是"装着这条记录的字段数组"
  const chain = [];
  let cur = rec.holder, guard = 0;
  while (cur && guard++ < 64) {
    const nm = nameOfHolder.get(cur);
    if (nm) chain.push(nm);
    cur = holderOf(cur);
  }
  return chain;
}
const fieldToHolder = new Map();
for (const [holder] of pathOfHolder) for (const f of holder) fieldToHolder.set(f, holder);
function holderOf(holder) {
  // 找到"装着 holder 里这些字段的那个字段"的 holder
  for (const [h, p] of pathOfHolder) {
    for (const f of h) if (f.sub === holder) return h;
  }
  return null;
}

console.log('文件：' + path.basename(file) + '   记录 ' + g.recs.length + ' 条\n');

const want = names.length ? names : null;
for (const r of g.recs) {
  if (want && !want.includes(r.name)) continue;
  const chain = holdersOf(r);
  const path = pathOfHolder.get(r.holder) || '(顶层)';
  const par = r.parentId != null ? g.recs.find((x) => x.id === r.parentId) : null;
  console.log(String(r.id).padStart(11) + '  ' + String(r.name).padEnd(22)
    + ' 路径=' + path
    + '  祖先链=' + chain.join(' < ')
    + '  #504父=' + (par ? (par.name || '#' + par.id) : String(r.parentId)));
}
