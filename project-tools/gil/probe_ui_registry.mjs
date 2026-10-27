// tools/gil/probe_ui_registry.mjs —— 只读：**界面控件登记表**审计（自身 GUID / 模板族 / 母本链 / 父子表）
//
// ════════════════════════════════════════════════════════════════════════════
// 为什么要有它（2026-10-21）
// ════════════════════════════════════════════════════════════════════════════
//   编辑器报「界面控件设置错误 → 界面控件里的开关控件GUID重复:<号>」时，光查
//   「顶层 #501 有没有重复」**不够** —— 2026-10-21 实测：
//     · `479-教程UI并入-v284.gil` 全档**只有一个**记录带 1074000025（tut.btn.close）；
//     · 顶层 GUID 唯一、父子表自洽、往返一致 ⇒ 但它们**全是"外来记录"**；
//     · 它们的**母本引用（#502 组件 4 → #14）指向源工程才有的号**，本档根本没有那些记录；
//     · 它们的**模板族序号（#502 组件 2 → #12）又和主档已有的族号重叠**。
//   ⇒ 所以「GUID 重复」这类报错必须按**登记关系**查，而不是按数字查。
//
//   本工具把每个界面上会被编辑器读到的地方摊开：
//     ① 自身 GUID（顶层 `#501`）是否两处一致、是否重复
//     ② 实例表内那份（`#502 组件1 → #11 → #501`）
//     ③ 母本链：`#502 组件4 → #14 → #501`（空 = 无母本；指向本档不存在的记录 = 悬空）
//     ④ 模板族序号：`#502 组件2 → #12 → #501`（一族多母本 / 与参考档撞族）
//     ⑤ 父子表：父指针 `#504`、父的子列表 `#503`、重复项、未登记
//     ⑥ 模板容器：**不是记录**却收着一堆记录的父级（例：472 的 1073741844、477 的 1073742015）
//
//   ★ 只读：不写任何文件，不改任何 .gil。
//
// 用法：
//   node tools/gil/probe_ui_registry.mjs <存档.gil> [--base=<参考档.gil>] [--verbose] [--json]
//   node tools/gil/probe_ui_registry.mjs 479-教程UI并入-v284.gil --base=472.gil
//   node tools/gil/probe_ui_registry.mjs 479-教程UI并入-v284.gil --id=1074000025   # 单条详情
//   node tools/gil/probe_ui_registry.mjs 479-教程UI并入-v284.gil --name=btn.close
// 退出码：0 = 登记关系自洽；3 = 有硬问题（①/③悬空/④撞族/⑤重复）；2 = 用法或解析错误
// ════════════════════════════════════════════════════════════════════════════
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readGil, asIdList, ID_LO, ID_HI } from './gilread.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const P = (p) => (path.isAbsolute(p) ? p : path.join(ROOT, p));
const argv = process.argv.slice(2);
const flag = (k, d) => {
  const h = argv.find((s) => s.startsWith('--' + k + '='));
  return h ? h.slice(k.length + 3).replace(/^"|"$/g, '') : d;
};
const FILE = argv.find((s) => !s.startsWith('--'));
const BASE = flag('base', null);
const VERBOSE = argv.includes('--verbose');
const JSONOUT = argv.includes('--json');
const ONLY_ID = flag('id', null);
const ONLY_NAME = flag('name', null);
if (!FILE) {
  console.error('用法: node tools/gil/probe_ui_registry.mjs <存档.gil> [--base=<参考档>] [--id=] [--name=] [--verbose] [--json]');
  process.exit(2);
}

const isId = (v) => v >= Number(ID_LO) && v <= Number(ID_HI);
const numOf = (fields, field, wt) => {
  const f = (fields || []).find((x) => x.field === field && (wt === undefined || x.wt === wt));
  return f ? Number(f.num ?? (f.sub ? NaN : NaN)) : null;
};
/** 不透明 payload 常常其实是**裸 varint**（紧凑形式的 id），统一试解 */
function asVarint(pay) {
  if (!pay || !pay.length) return null;
  let r = 0n, s = 0n, p = 0;
  while (p < pay.length) {
    const x = pay[p++];
    r |= BigInt(x & 0x7f) << s;
    if ((x & 0x80) === 0) return p === pay.length ? Number(r) : null;
    s += 7n;
  }
  return null;
}
/** 记录顶层的组件表：每个 `#502` 一条，取它的 组件号(#501) 与各个子块(#11/#12/#13/#14) */
function compsOf(rec) {
  const out = [];
  for (const f of rec.field.sub || []) {
    if (!(f.field === 502 && f.sub)) continue;
    const n = numOf(f.sub, 501, 0);
    const item = { n, tag: numOf(f.sub, 502, 0), kind: null, ref: null, sub: null };
    for (const g of f.sub) {
      if (g.field === 11 || g.field === 12 || g.field === 13 || g.field === 14) {
        item.kind = g.field;
        const inner = g.sub || [];
        const v = inner.find((x) => x.field === 501);
        if (v && v.wt === 0) item.ref = Number(v.num);
        else if (v && v.payload) item.ref = asVarint(v.payload);
        item.sub = g.sub;
      }
    }
    out.push(item);
  }
  return out;
}
const findComp = (comps, n) => comps.find((c) => c.n === n) || null;
/** 记录顶层的子控件 ID 列表（只认 `#503` 且 payload 能整段解析成 id） */
function childListOf(rec) {
  for (const f of rec.field.sub || []) {
    if (!(f.field === 503 && f.wt === 2 && !f.isText && f.payload)) continue;
    const ids = asIdList(f.payload, true);
    if (ids !== null) return ids.map(Number);
  }
  return null;
}

function load(file) {
  const g = readGil(P(file));
  const byId = new Map();
  for (const r of g.recs) byId.set(Number(r.id), r);  const rows = g.recs.map((r) => {
    const comps = compsOf(r);
    const fam = findComp(comps, 2);
    const master = findComp(comps, 4);
    const src = findComp(comps, 3);
    const self = findComp(comps, 1);
    const own = (r.field.sub || []).find((x) => x.field === 501 && x.wt === 0);
    return {
      rec: r, id: Number(r.id), name: r.name,
      ownGuid: own ? Number(own.num) : null,
      innerGuid: self ? self.ref : null,
      family: fam ? fam.ref : null,
      master: master ? master.ref : null,     // null = 组件4 存在但 #14 是空消息
      hasComp4: !!master,
      src: src ? src.ref : null,
      parent: r.parentId == null ? null : Number(r.parentId),
      kids: childListOf(r),
      compNos: comps.map((c) => c.n),
    };
  });
  const ids = new Set(rows.map((x) => x.id));
  // 模板容器：不是记录的父级
  const containers = new Map();
  for (const x of rows) {
    if (x.parent == null || ids.has(x.parent)) continue;
    if (!containers.has(x.parent)) containers.set(x.parent, []);
    containers.get(x.parent).push(x);
  }
  return { g, rows, ids, containers, byId, rootLines: rootLinesOf(g) };
}

/** 记录数组之外的顶层字段（序列化成"路径=值"行），用于"并入时有没有动到别处" */
function rootLinesOf(g) {
  const out = [];
  const recHolder = (() => {
    const c = new Map();
    for (const r of g.recs) c.set(r.holder, (c.get(r.holder) || 0) + 1);
    let best = null, n = -1;
    for (const [h, k] of c) if (k > n) { best = h; n = k; }
    return best;
  })();
  const walk = (fields, p) => {
    for (const f of fields || []) {
      const np = p + '/#' + f.field;
      if (f.wt === 0) out.push(np + '=' + f.num.toString());
      else if (f.wt === 5) out.push(np + '=f:' + f.f);
      else if (f.wt === 1) out.push(np + '=x:' + f.raw.toString('hex'));
      else if (f.sub) walk(f.sub, np);
      else if (f.isText) {
        const s = f.payload.toString('utf8');
        out.push(np + '=s[len' + s.length + ']:' + JSON.stringify(s.slice(0, 60)));
      } else if (f.payload) out.push(np + '=b[len' + f.payload.length + ']:' + f.payload.subarray(0, 24).toString('hex'));
    }
  };
  for (let i = 0; i < g.tree.length; i++) {
    const f = g.tree[i];
    if (f.sub === recHolder) { continue; }   // 记录数组本身不参与"根级"比较（记录级已单独比）
    if (f.wt === 0) out.push('/#' + f.field + '=' + f.num.toString());
    else if (f.wt === 5) out.push('/#' + f.field + '=f:' + f.f);
    else if (f.wt === 1) out.push('/#' + f.field + '=x:' + f.raw.toString('hex'));
    else if (f.sub) walk(f.sub, '/#' + f.field);
    else if (f.isText) {
      const s = f.payload.toString('utf8');
      out.push('/#' + f.field + '=s[len' + s.length + ']:' + JSON.stringify(s.slice(0, 60)));
    } else if (f.payload) out.push('/#' + f.field + '=b[len' + f.payload.length + ']:' + f.payload.subarray(0, 24).toString('hex'));
  }
  return out;
}

const A = load(FILE);
const B = BASE ? load(BASE) : null;

// ── ① 自身 GUID 重复 ─────────────────────────────────────────────────────────
const guidCount = new Map();
for (const x of A.rows) {
  if (x.ownGuid == null) continue;
  if (!guidCount.has(x.ownGuid)) guidCount.set(x.ownGuid, []);
  guidCount.get(x.ownGuid).push(x);
}
const dupGuid = [...guidCount.entries()].filter(([, l]) => l.length > 1);

// ── ② 实例表内那份 ───────────────────────────────────────────────────────────
const innerMismatch = A.rows.filter((x) => x.ownGuid != null && x.innerGuid != null && x.ownGuid !== x.innerGuid);
const innerMissing = A.rows.filter((x) => x.ownGuid != null && x.innerGuid == null);

// ── ③ 母本链 ─────────────────────────────────────────────────────────────────
const danglingMaster = A.rows.filter((x) => x.hasComp4 && x.master != null && !A.ids.has(x.master));
const emptyMaster = A.rows.filter((x) => x.hasComp4 && x.master == null);
const validMaster = A.rows.filter((x) => x.hasComp4 && x.master != null && A.ids.has(x.master));
// 反向：母本记录有没有实例引用它
const masterUse = new Map();
for (const x of validMaster) masterUse.set(x.master, (masterUse.get(x.master) || 0) + 1);
const orphanMasters = A.rows.filter((x) => x.parent != null && !A.ids.has(x.parent) && !masterUse.has(x.id));

// ── ④ 模板族序号 ─────────────────────────────────────────────────────────────
const fam = new Map();
for (const x of A.rows) {
  if (x.family == null) continue;
  if (!fam.has(x.family)) fam.set(x.family, []);
  fam.get(x.family).push(x);
}
const famReport = [...fam.entries()].map(([n, list]) => {
  const masters = [...new Set(list.filter((x) => x.master != null).map((x) => x.master))];
  const dangling = masters.filter((m) => !A.ids.has(m));
  return { family: n, n: list.length, masters, dangling, list };
}).sort((a, b) => a.family - b.family);
const famMultiMaster = famReport.filter((f) => f.masters.length > 1);
// 与参考档撞族：本档出现、且参考档里已有该族号，但母本集合不同
let famClash = [];
if (B) {
  const bfam = new Map();
  for (const x of B.rows) { if (x.family == null) continue; if (!bfam.has(x.family)) bfam.set(x.family, []); bfam.get(x.family).push(x); }
  for (const f of famReport) {
    const bl = bfam.get(f.family);
    if (!bl) continue;
    const bm = new Set(bl.filter((x) => x.master != null).map((x) => x.master));
    const outside = f.masters.filter((m) => !bm.has(m));
    if (outside.length) famClash.push({ family: f.family, baseMembers: bl.length, baseMasters: [...bm], outside });
  }
}

// ── ⑤ 父子表 ─────────────────────────────────────────────────────────────────
const parentProblems = [];
const kidDupes = [];
for (const x of A.rows) {
  if (!x.kids) continue;
  const seen = new Map();
  for (const k of x.kids) {
    seen.set(k, (seen.get(k) || 0) + 1);
    if (!A.ids.has(k)) parentProblems.push('#' + x.id + ' ' + JSON.stringify(x.name) + ' 子列表登记了不存在的 #' + k);
    else {
      const c = A.rows.find((y) => y.id === k);
      if (c.parent !== x.id) parentProblems.push('#' + x.id + ' 子列表有 #' + k + '（' + JSON.stringify(c.name) + '），但它的父指针指向 #' + c.parent);
    }
  }
  for (const [k, n] of seen) if (n > 1) kidDupes.push('#' + x.id + ' ' + JSON.stringify(x.name) + ' 子列表里 #' + k + ' 出现 ' + n + ' 次');
}
const danglingParent = A.rows.filter((x) => x.parent != null && !A.ids.has(x.parent) && !A.containers.has(x.parent));

// ── ⑦ 与参考档的记录级差异（按 id 配对，比"字段路径→值"序列）───────────────
function ser(fields, p, out) {
  for (const f of fields || []) {
    const np = p + '/#' + f.field;
    if (f.wt === 0) out.push(np + '=' + f.num.toString());
    else if (f.wt === 5) out.push(np + '=f:' + f.f);
    else if (f.wt === 1) out.push(np + '=x:' + f.raw.toString('hex'));
    else if (f.sub) ser(f.sub, np, out);
    else if (f.isText) out.push(np + '=s:' + JSON.stringify(f.payload.toString('utf8')));
    else if (f.payload) {
      const ids = f.field === 503 ? asIdList(f.payload, true) : null;
      if (ids) out.push(np + '=ids[' + ids.length + ']' + (ids.length ? '…' + ids.slice(-3).join(',') : ''));
      else out.push(np + '=b:' + f.payload.toString('hex'));
    }
  }
  return out;
}
function diffBase() {
  if (!B) return null;
  const bid = new Map(B.rows.map((x) => [x.id, x]));
  const aid = new Map(A.rows.map((x) => [x.id, x]));
  const onlyA = A.rows.filter((x) => !bid.has(x.id)).map((x) => x.id);
  const onlyB = B.rows.filter((x) => !aid.has(x.id)).map((x) => x.id);
  // 记录数组之外的顶层字段差异（"并入时有没有动到别处"）
  const bset = new Set(B.rootLines), aset = new Set(A.rootLines);
  const rootOnlyA = A.rootLines.filter((l) => !bset.has(l));
  const rootOnlyB = B.rootLines.filter((l) => !aset.has(l));
  const changed = [];
  for (const [id, ra] of aid) {
    const rb = bid.get(id);
    if (!rb) continue;
    const la = ser(ra.rec.field.sub, '', []), lb = ser(rb.rec.field.sub, '', []);
    if (la.join('\n') === lb.join('\n')) continue;
    let i = 0;
    while (i < la.length && i < lb.length && la[i] === lb[i]) i++;
    let ta = la.length, tb = lb.length;
    while (ta > i && tb > i && la[ta - 1] === lb[tb - 1]) { ta--; tb--; }
    changed.push({ id, name: ra.name, a: la.slice(i, ta), b: lb.slice(i, tb) });
  }
  return { onlyA, onlyB, changed, rootOnlyA: rootOnlyA, rootOnlyB: rootOnlyB };
}
const D = diffBase();

// ── 单条详情 ─────────────────────────────────────────────────────────────────
if (ONLY_ID || ONLY_NAME) {
  const hit = A.rows.filter((x) => (ONLY_ID && String(x.id) === String(ONLY_ID))
    || (ONLY_NAME && (x.name === ONLY_NAME || String(x.name).endsWith('.' + ONLY_NAME))));
  console.log('=== ' + path.basename(FILE) + ' 里匹配的登记行 ' + hit.length + ' 条 ===');
  for (const x of hit) {
    console.log('#' + x.id + '　名 ' + JSON.stringify(x.name));
    console.log('  自身 GUID   #501        = ' + x.ownGuid);
    console.log('  实例表 GUID #502[1]/#11  = ' + x.innerGuid);
    console.log('  模板族序号  #502[2]/#12  = ' + x.family);
    console.log('  母本 GUID   #502[4]/#14  = ' + (x.hasComp4 ? (x.master == null ? '(空消息 => 无母本)' : x.master + (A.ids.has(x.master) ? ' ✅ 本档有' : ' ❌ 本档无此记录')) : '(无组件4)'));
    console.log('  源控件 GUID #502[3]/#13  = ' + (x.src == null ? '(无组件3)' : x.src));
    console.log('  父指针 #504              = ' + x.parent + (x.parent == null ? '' : (A.ids.has(x.parent) ? ' ✅ 记录' : ' ⚠ 不是记录')));
    console.log('  子列表 #503              = ' + (x.kids ? x.kids.length + ' 项 ' + JSON.stringify(x.kids) : '(无)'));
    console.log('  组件号                    = [' + x.compNos.join(',') + ']');
    if (x.kids) for (const k of x.kids) {
      const c = A.rows.find((y) => y.id === k);
      console.log('      └ #' + k + ' ' + JSON.stringify(c ? c.name : '(缺失)') + '  parent=' + (c ? c.parent : '?'));
    }
  }
  process.exit(0);
}

// ── 报告 ─────────────────────────────────────────────────────────────────────
if (JSONOUT) {
  console.log(JSON.stringify({
    file: FILE, base: BASE, recs: A.rows.length,
    dupGuid: dupGuid.map(([v, l]) => ({ guid: v, who: l.map((x) => ({ id: x.id, name: x.name })) })),
    innerMismatch: innerMismatch.map((x) => ({ id: x.id, name: x.name, own: x.ownGuid, inner: x.innerGuid })),
    danglingMaster: danglingMaster.map((x) => ({ id: x.id, name: x.name, master: x.master })),
    emptyMaster: emptyMaster.length,
    families: famReport.map((f) => ({ family: f.family, n: f.n, masters: f.masters, dangling: f.dangling })),
    famClash, parentProblems, kidDupes,
    containers: [...A.containers.entries()].map(([p, l]) => ({ container: p, n: l.length, names: l.slice(0, 6).map((x) => x.name) })),
  }, null, 2));
  process.exit(0);
}

console.log('════════════════════════════════════════════════════════════════════════');
console.log('文件 ' + path.basename(FILE) + '　记录 ' + A.rows.length
  + (B ? '　参考档 ' + path.basename(BASE) + '（' + B.rows.length + ' 条）' : ''));
console.log('');

console.log('① 自身 GUID（顶层 #501）重复：' + (dupGuid.length ? '❌ ' + dupGuid.length + ' 处' : '✅ 0 处（每条记录唯一）'));
for (const [v, l] of dupGuid.slice(0, 20)) console.log('   #' + v + ' ← ' + l.map((x) => JSON.stringify(x.name) + '#' + x.id).join(' , '));
console.log('   自身 GUID 唯一值 ' + guidCount.size + ' / 记录 ' + A.rows.length);
console.log('');

console.log('② 实例表内那份（#502[1]/#11/#501）：与顶层一致 ' + (A.rows.length - innerMismatch.length - innerMissing.length)
  + ' 条，不一致 ' + innerMismatch.length + ' 条（ℹ 提示：472 实测带 1 条也照跑），缺失 ' + innerMissing.length + ' 条');
for (const x of innerMismatch.slice(0, 10)) console.log('   ' + JSON.stringify(x.name) + '#' + x.id + '  #501=' + x.ownGuid + ' vs #11=' + x.innerGuid);
console.log('');

console.log('③ 母本链（#502[4]/#14）：有引用 ' + (validMaster.length + danglingMaster.length + emptyMaster.length)
  + ' 条 = 指向本档记录 ' + validMaster.length + ' ＋ 空母本 ' + emptyMaster.length + ' ＋ 悬空 ' + danglingMaster.length
  + (danglingMaster.length ? ' ❌' : ' ✅'));
for (const x of danglingMaster.slice(0, VERBOSE ? 999 : 12)) {
  console.log('   ❌ ' + JSON.stringify(x.name) + '#' + x.id + ' → 母本 #' + x.master + '（本档没有这条记录）');
}
if (danglingMaster.length > 12 && !VERBOSE) console.log('   …共 ' + danglingMaster.length + ' 条，加 --verbose 看全');
if (emptyMaster.length) console.log('   （空母本 ' + emptyMaster.length + ' 条属合法：素材/内置模板记录常见，例：'
  + emptyMaster.slice(0, 4).map((x) => JSON.stringify(x.name) + '#' + x.id).join(' , ') + '）');
if (orphanMasters.length) console.log('   ℹ 模板容器下"没人引用"的母本 ' + orphanMasters.length + ' 条（可能是给脚本实例化用的）');
console.log('');

console.log('④ 模板族序号（#502[2]/#12）：共 ' + famReport.length + ' 族');
console.log('   族号  成员数  母本集合');
for (const f of famReport) {
  const mark = f.dangling.length ? ' ❌悬空' : (f.masters.length > 1 ? ' ⚠一族多母本' : '');
  if (!VERBOSE && f.family > 90 && !f.dangling.length) continue;
  console.log('   ' + String(f.family).padStart(4) + '  ' + String(f.n).padStart(5) + '   '
    + (f.masters.length ? f.masters.join(',') : '(无母本)') + mark);
}
if (famClash.length) {
  console.log('   ❌ 与参考档撞族（同一个族号，却带来了参考档没有的母本）：' + famClash.length + ' 个');
  for (const c of famClash) {
    console.log('      族 ' + c.family + '：参考档 ' + c.baseMembers + ' 条 / 母本 ' + (c.baseMasters.join(',') || '(无)')
      + '　本档多出母本 ' + c.outside.join(','));
  }
}
console.log('');

console.log('⑤ 父子表：' + (kidDupes.length ? '❌ 子列表重复 ' + kidDupes.length + ' 处' : '✅ 子列表无重复')
  + '；' + (parentProblems.length ? '❌ 不一致 ' + parentProblems.length + ' 处' : '✅ 子列表与父指针一致'));
for (const s of kidDupes.slice(0, 10)) console.log('   ❌ ' + s);
for (const s of parentProblems.slice(0, VERBOSE ? 999 : 10)) console.log('   ❌ ' + s);
if (danglingParent.length) console.log('   ℹ 父指针指向非记录/非容器 ' + danglingParent.length + ' 条：'
  + danglingParent.slice(0, 5).map((x) => JSON.stringify(x.name) + '#' + x.id + '→' + x.parent).join(' , '));
console.log('');

console.log('⑥ 模板容器（不是记录、却收着记录）：');
for (const [p, l] of A.containers) {
  console.log('   #' + p + '　' + l.length + ' 条　例：' + l.slice(0, 6).map((x) => JSON.stringify(x.name) + '#' + x.id).join(' , '));
}
console.log('');

if (D) {
  console.log('⑦ 与参考档的差异：');
  console.log('   记录：本档多出 ' + D.onlyA.length + ' 条：' + (D.onlyA.slice(0, 12).join(',') || '(无)') + (D.onlyA.length > 12 ? ' …' : ''));
  console.log('   记录：参考档多出 ' + D.onlyB.length + ' 条：' + (D.onlyB.slice(0, 12).join(',') || '(无)') + (D.onlyB.length > 12 ? ' …' : ''));
  console.log('   记录：同 id 但内容不同 ' + D.changed.length + ' 条：');
  for (const c of D.changed.slice(0, VERBOSE ? 999 : 8)) {
    console.log('     ' + JSON.stringify(c.name) + '#' + c.id + '　参考档变 ' + c.b.length + ' 行 / 本档变 ' + c.a.length + ' 行');
    for (let k = 0; k < Math.min(VERBOSE ? 999 : 3, Math.max(c.a.length, c.b.length)); k++) {
      console.log('        - ' + (c.b[k] ?? ''));
      console.log('        + ' + (c.a[k] ?? ''));
    }
  }
  console.log('   根级（记录数组之外）不同 ' + (D.rootOnlyA.length + D.rootOnlyB.length) + ' 行'
    + (D.rootOnlyA.length + D.rootOnlyB.length ? '：' : '（并入没有动到别处）'));
  for (const l of D.rootOnlyB.slice(0, VERBOSE ? 999 : 6)) console.log('        - ' + l);
  for (const l of D.rootOnlyA.slice(0, VERBOSE ? 999 : 6)) console.log('        + ' + l);
  console.log('');
}

const bad = dupGuid.length + danglingMaster.length + famClash.length + kidDupes.length + parentProblems.length;
console.log(bad === 0
  ? '★ 结论：登记关系自洽（真实撞号 0、母本链闭合、族号无外来母本、父子表一致）'
  : '★ 结论：有 ' + bad + ' 处硬问题 —— 逐条见 ①③④⑤');
process.exit(bad === 0 ? 0 : 3);
