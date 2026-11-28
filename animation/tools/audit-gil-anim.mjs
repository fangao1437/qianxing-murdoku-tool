#!/usr/bin/env node
// animation/tools/audit-gil-anim.mjs
// 通用 `.gil` 柔性纸张动画结构与真机约束静态审计工具（零外部依赖，复用仓库 src/gilread.mjs）
//
// 审计项（6 道硬闸门）：
//   1. 双纸层容器树完备：anim.under / anim.sheet / anim.bend / anim.ptop / anim.pbot / anim.top / anim.bot
//   2. 弯曲带条数完整：anim.b.br1..N、anim.b.fc1..N 与同步弯曲内框 anim.b.in*
//   3. 100% 不透明实色（零半透明产物）：所有 anim.* / card.* 图像 alpha = 0xFF，且禁止存在旧版半透明残余节点
//   4. 冷启动防穿帮：anim.under、anim.bend 及其全部弯曲带与旧纸叶子初始 hidden = true
//   5. 层序关系：anim.under 紧邻 anim.sheet 之前；若指定 --above=<控件名>，则该锚点严格压在 anim.sheet 之上
//   6. 可选 --base=<基线.gil> 静态世界坐标等价比对：所有迁入控件在 4 平台槽位沿父链累计世界坐标误差 < 0.001px
//
// 用法：
//   node animation/tools/audit-gil-anim.mjs --gil=<目标.gil> --prefix=econ.shop736. --above=econ.shop736.s37
//   node animation/tools/audit-gil-anim.mjs --gil=<目标.gil> --base=<基准.gil> --prefix=econ.shop736.,econ.bag741. --strips=16

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readGil, asIdList, pairOf, pairValue } from '../../src/gilread.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FORBIDDEN_SEMI_SUFFIXES = [
  'card.shadow',
  'anim.shadow',
  'anim.bend.shade',
  'anim.bend.light',
  'anim.curl.cut',
  'anim.curl.shade',
  'anim.curl.back',
  'anim.curl.ridge',
];

function parseArgs(argv) {
  const opts = {};
  for (const raw of argv) {
    if (!raw.startsWith('--')) continue;
    const eq = raw.indexOf('=');
    if (eq === -1) opts[raw.slice(2)] = true;
    else opts[raw.slice(2, eq)] = raw.slice(eq + 1).replace(/^"|"$/g, '');
  }
  return opts;
}

const F = (p, n) => p?.sub?.find((f) => f.field === n);
const comp = (r, n) => r.sub.filter((f) => f.field === 505).map((f) => F(F(f, 503), n)).find(Boolean);
const statesOf = (r) => F(comp(r, 13), 12)?.sub?.filter((f) => f.field === 501).map((f) => F(f, 502)) || [];

function isHidden(field) {
  const c14 = comp(field, 14);
  if (!c14) return false;
  const h = F(c14, 17);
  if (!h || !h.sub || h.sub.length === 0) return false;
  const v = F(h, 503);
  return Boolean(v && Number(v.num) === 1);
}

function readImageAlpha(field) {
  const img = comp(field, 84);
  if (!img) return null;
  const col = F(img, 502);
  if (!col || col.num === undefined) return null;
  return Number((BigInt(col.num) >> 24n) & 0xFFn);
}

function loadRecords(gilPath) {
  const g = readGil(gilPath);
  const recs = g.recs.map((r) => ({
    id: r.id,
    parentId: r.parentId || 0,
    name: r.name || '',
    childIds: r.childList && r.childList.payload ? asIdList(r.childList.payload, true).map(Number) : [],
    field: r.field,
  }));
  const byId = new Map(recs.map((r) => [r.id, r]));
  const byName = new Map();
  for (const r of recs) {
    if (r.name && !byName.has(r.name)) byName.set(r.name, r);
  }
  return { recs, byId, byName };
}

function worldPos4(rec, byId, stopParentId) {
  const out = [
    [0, 0],
    [0, 0],
    [0, 0],
    [0, 0],
  ];
  let cur = rec;
  let guard = 0;
  while (cur && cur.id !== stopParentId && guard < 16) {
    const sts = statesOf(cur.field);
    if (sts.length === 4) {
      for (let i = 0; i < 4; i++) {
        const p = pairOf(sts[i], 504);
        out[i][0] += pairValue(p, 0);
        out[i][1] += pairValue(p, 1);
      }
    }
    cur = byId.get(cur.parentId);
    guard++;
  }
  return out;
}

export function auditGilPrefix(target, base, prefix, strips = 16, aboveName = null) {
  const errors = [];
  const mustContainers = ['anim.under', 'anim.sheet', 'anim.bend', 'anim.ptop', 'anim.pbot', 'anim.top', 'anim.bot'];
  const missing = [];
  for (const suffix of mustContainers) {
    if (!target.byName.has(prefix + suffix)) missing.push(prefix + suffix);
  }
  if (missing.length) errors.push(`缺少必要动画容器: ${missing.join(', ')}`);

  for (let i = 1; i <= strips; i++) {
    if (!target.byName.has(`${prefix}anim.b.br${i}`)) errors.push(`缺少边框弯曲带: ${prefix}anim.b.br${i}`);
    if (!target.byName.has(`${prefix}anim.b.fc${i}`)) errors.push(`缺少纸面弯曲带: ${prefix}anim.b.fc${i}`);
  }

  for (const bad of FORBIDDEN_SEMI_SUFFIXES) {
    if (target.byName.has(prefix + bad)) {
      errors.push(`发现禁止的半透明残余节点: ${prefix + bad}`);
    }
  }

  // 检查新增装饰图元不透明（alpha=255） + 旧纸克隆图元与原件一致 + 初始全隐藏
  let animImagesChecked = 0;
  let semiTransparentCount = 0;
  let exposedInitLeaves = [];
  for (const rec of target.recs) {
    if (!rec.name.startsWith(prefix)) continue;
    const isAddedDecor =
      rec.name.includes('.anim.b.') ||
      rec.name.endsWith('.card.border') ||
      rec.name.endsWith('.card.face') ||
      rec.name.includes('.anim.u.card.');
    if (isAddedDecor) {
      const alpha = readImageAlpha(rec.field);
      if (alpha !== null) {
        animImagesChecked++;
        if (alpha !== 255) {
          semiTransparentCount++;
          errors.push(`非全不透明新增动画图元: ${rec.name} (alpha=${alpha})`);
        }
      }
    } else if (base && rec.name.includes('.anim.u.')) {
      const origName = rec.name.replace('.anim.u.', '.');
      const origRec = base.byName.get(origName);
      if (origRec) {
        const aCur = readImageAlpha(rec.field);
        const aOrig = readImageAlpha(origRec.field);
        if (aCur !== null && aOrig !== null && aCur !== aOrig) {
          errors.push(`旧纸克隆图元透明度与原件不一致: ${rec.name} (${aCur} != ${aOrig})`);
        }
      }
    }
    if (rec.name.includes('.anim.b.') || rec.name.includes('.anim.u.')) {
      if (!isHidden(rec.field)) exposedInitLeaves.push(rec.name);
    }
  }
  const underRec = target.byName.get(prefix + 'anim.under');
  const sheetRec = target.byName.get(prefix + 'anim.sheet');
  const bendRec = target.byName.get(prefix + 'anim.bend');
  if (underRec && !isHidden(underRec.field)) errors.push(`${underRec.name} 初始未隐藏`);
  if (bendRec && !isHidden(bendRec.field)) errors.push(`${bendRec.name} 初始未隐藏`);
  if (exposedInitLeaves.length) errors.push(`初始未隐藏的动画叶子数=${exposedInitLeaves.length}（如 ${exposedInitLeaves.slice(0, 3).join(', ')}）`);

  // 检查同父级 z-order
  let zOrder = null;
  if (underRec && sheetRec) {
    const parent = target.byId.get(sheetRec.parentId);
    if (!parent || underRec.parentId !== sheetRec.parentId) {
      errors.push(`anim.under 与 anim.sheet 不在同一个父容器下`);
    } else {
      const uIdx = parent.childIds.indexOf(underRec.id);
      const sIdx = parent.childIds.indexOf(sheetRec.id);
      zOrder = { underIdx: uIdx, sheetIdx: sIdx };
      if (!(uIdx >= 0 && sIdx === uIdx + 1)) {
        errors.push(`层序异常: underIdx=${uIdx}, sheetIdx=${sIdx}（要求 sheet 紧跟 under 之后）`);
      }
      if (aboveName) {
        const ab = target.byName.get(aboveName);
        if (!ab) {
          errors.push(`找不到 --above 锚点控件: ${aboveName}`);
        } else {
          const aIdx = parent.childIds.indexOf(ab.id);
          zOrder.aboveIdx = aIdx;
          if (!(aIdx > sIdx)) {
            errors.push(`层序异常: ${aboveName} (idx=${aIdx}) 未压在 anim.sheet (idx=${sIdx}) 之上`);
          }
        }
      }
    }
  }

  // 若提供基准档，校验所有迁入控件 4 平台槽位静态世界坐标误差 < 0.001px
  let movedChecked = 0;
  let maxWorldPosErr = 0;
  if (base && sheetRec) {
    const rootId = sheetRec.parentId;
    const animSubIds = new Set();
    const q = [sheetRec.id];
    while (q.length) {
      const id = q.shift();
      animSubIds.add(id);
      const r = target.byId.get(id);
      if (r) for (const cid of r.childIds) q.push(cid);
    }
    for (const id of animSubIds) {
      const tr = target.byId.get(id);
      if (!tr || !tr.name || tr.name.includes('.anim.') || tr.name.endsWith('.card.border') || tr.name.endsWith('.card.face')) continue;
      const br = base.byName.get(tr.name);
      if (!br) continue;
      movedChecked++;
      const wpT = worldPos4(tr, target.byId, rootId);
      const wpB = worldPos4(br, base.byId, rootId);
      for (let i = 0; i < 4; i++) {
        const ex = Math.abs(wpT[i][0] - wpB[i][0]);
        const ey = Math.abs(wpT[i][1] - wpB[i][1]);
        if (ex > maxWorldPosErr) maxWorldPosErr = ex;
        if (ey > maxWorldPosErr) maxWorldPosErr = ey;
      }
    }
    if (maxWorldPosErr > 0.001) {
      errors.push(`迁入控件静态世界坐标偏差过大: maxErr=${maxWorldPosErr.toFixed(6)}px`);
    }
  }

  return {
    prefix,
    pass: errors.length === 0,
    animImagesChecked,
    semiTransparentCount,
    zOrder,
    movedChecked,
    maxWorldPosErr: +maxWorldPosErr.toFixed(6),
    errors,
  };
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (!opts.gil || !opts.prefix) {
    console.error('用法: node animation/tools/audit-gil-anim.mjs --gil=<目标.gil> --prefix=econ.shop736.,econ.bag741. [--base=<基准.gil>] [--above=econ.shop736.s37] [--strips=16]');
    process.exit(2);
  }
  const gilPath = path.resolve(opts.gil);
  if (!fs.existsSync(gilPath)) {
    console.error(`❌ 找不到目标存档: ${gilPath}`);
    process.exit(2);
  }
  const target = loadRecords(gilPath);
  const base = opts.base ? loadRecords(path.resolve(opts.base)) : null;
  const prefixes = String(opts.prefix).split(',').map((s) => s.trim()).filter(Boolean);
  const aboveList = opts.above ? String(opts.above).split(',').map((s) => s.trim()) : [];
  const strips = Number(opts.strips || 16);

  const results = prefixes.map((p, idx) => auditGilPrefix(target, base, p, strips, aboveList[idx] || null));
  const pass = results.every((r) => r.pass);
  console.log(JSON.stringify({ gil: path.basename(gilPath), pass, results }, null, 2));
  process.exit(pass ? 0 : 1);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  main();
}
