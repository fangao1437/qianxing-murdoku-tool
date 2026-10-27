#!/usr/bin/env node
/**
 * dump_row.mjs —— 只读：把一个 `.gil` 里 `assets/row.<关>.<行>` 的槽位**照着存档**打出来。
 *
 * 为什么要它（✗ 目标）：
 *   `row.*` 的槽位（`who`/`what`/`letter`/`face`）到底有哪些字段、
 *   用户配的那段字到底挂在【哪一层】—— 只能从存档读，不能从代码注释推 ✓
 *
 * 用法：node tools/gil/dump_row.mjs <存档.gil> [关序] [--all]
 *   `--all` ⇒ 把 **20 个 row** 全打（默认只打每关第一行 + 汇总）
 * 全程只读 ✓ 不改文件 ✓
 */
import { readGil, findChildListTop, asIdList, KNOWN_TYPES } from './gilread.mjs';

const argv = process.argv.slice(2);
const all = argv.includes('--all');
const rest = argv.filter((a) => !a.startsWith('--'));
const file = rest[0];
const wantLv = rest[1] ? String(rest[1]) : null;
if (!file) {
  console.error('用法: node tools/gil/dump_row.mjs <存档.gil> [关序] [--all]');
  process.exit(2);
}

const G = readGil(file);
const recs = G.recs;
const byId = new Map(recs.map((r) => [r.id, r]));

function kidsOf(r) {
  if (!r || !r.field || !r.field.sub) return [];
  const cl = findChildListTop(r.field.sub);
  if (!cl) return [];
  return (asIdList(cl.payload, true) || []).map(Number);
}

// 走字段树，收：文字叶子 / 大数叶子 / 结构轮廓
function survey(fields, depth, acc, path) {
  for (const f of fields) {
    const p = path ? path + '/' + f.field : String(f.field);
    if (f.wt === 2 && f.isText) {
      const s = f.payload.toString('utf8');
      acc.texts.push({ path: p, s });
    } else if (f.wt === 0 && typeof f.num === 'bigint') {
      if (f.num > 1000000n) acc.bigs.push({ path: p, n: Number(f.num) });
    }
    if (f.sub && depth < 3) survey(f.sub, depth + 1, acc, p);
  }
  return acc;
}

function profile(r) {
  const acc = { texts: [], bigs: [] };
  survey(r.field.sub, 0, acc, '');
  // 控件类型名（KNOWN_TYPES）不算内容
  acc.texts = acc.texts.filter((t) => !KNOWN_TYPES.has(t.s));
  return acc;
}

const rowNames = recs
  .filter((r) => r.name && /^row\.\d+\.\d+$/.test(String(r.name)))
  .map((r) => String(r.name))
  .sort((a, b) => {
    const [a1, a2] = a.slice(4).split('.').map(Number);
    const [b1, b2] = b.slice(4).split('.').map(Number);
    return a1 - b1 || a2 - b2;
  });

console.log(`文件：${file}`);
console.log(`row.* 共 ${rowNames.length} 个` + (wantLv ? `（只看第 ${wantLv} 关）` : ''));

const slotStats = {};   // slot -> { seen, withText, texts:[], withImg, imgs:[] }

for (const rn of rowNames) {
  const lv = rn.split('.')[1];
  if (wantLv && lv !== wantLv) continue;
  const rec = G.byName.get(rn);
  const kids = kidsOf(rec);
  const show = all || !globalThis.__seenLv;
  globalThis.__seenLv = globalThis.__seenLv || {};
  const verbose = all || !globalThis.__seenLv[lv];
  globalThis.__seenLv[lv] = true;

  if (verbose) console.log(`\n── ${rn}  #${rec.id}  子列表 ${kids.length} 项 ──`);
  for (const kid of kids) {
    const krec = byId.get(kid);
    if (!krec) continue;
    const slot = String(krec.name || '').split('.')[0];
    const st = (slotStats[slot] = slotStats[slot] || { seen: 0, withText: 0, texts: [], withImg: 0, imgs: [] });
    st.seen++;
    const pf = profile(krec);
    const content = pf.texts.filter((t) => t.s !== krec.name);
    const imgs = pf.bigs.filter((b) => /\/501$|image/i.test(b.path) === false ? true : true);
    if (content.length) {
      st.withText++;
      for (const t of content) if (st.texts.length < 8) st.texts.push(`${krec.name}: ${JSON.stringify(t.s)} @${t.path}`);
    }
    // 图片：`face` 槽位关心
    const imgBigs = pf.bigs.filter((b) => b.n >= 100000 && b.n < 1073000000);
    if (imgBigs.length) {
      st.withImg++;
      for (const b of imgBigs) if (st.imgs.length < 12) st.imgs.push(`${krec.name}: ${b.n} @${b.path}`);
    }
    if (verbose) {
      console.log(`   #${krec.id}  ${krec.name}  父=${krec.parentId}  状态块=${(krec.states || []).length}`);
      console.log(`        文字：${content.length ? content.map((t) => JSON.stringify(t.s) + '@' + t.path).join(' , ') : '（无 ✗）'}`);
      const other = pf.bigs.filter((b) => !(b.n >= 100000 && b.n < 1073000000)).slice(0, 6);
      console.log(`        大数：${pf.bigs.length ? pf.bigs.slice(0, 6).map((b) => b.n + '@' + b.path).join(' , ') : '（无）'}`);
    }
  }
}

console.log('\n── 槽位汇总（20 行全扫）──');
for (const slot of ['who', 'what', 'letter', 'face']) {
  const st = slotStats[slot];
  if (!st) {
    console.log(`  ${slot}：★ 一个都没有 ✗`);
    continue;
  }
  console.log(`  ${slot}：${st.seen} 个；自带文字 ${st.withText} 个；自带图片 ID ${st.withImg} 个`);
  if (st.texts.length) console.log(`      样例文字：${st.texts.slice(0, 4).join(' | ')}`);
  if (st.imgs.length) console.log(`      样例图号：${st.imgs.slice(0, 4).join(' | ')}`);
}
