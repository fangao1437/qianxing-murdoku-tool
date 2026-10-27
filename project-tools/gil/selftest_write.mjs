// tools/gil/selftest_write.mjs —— 写通道守卫的**自证**（★ 守卫必须会响 ✓）
//
// ════════════════════════════════════════════════════════════════════════════
// ★★★ 为什么要有这个自测（2026-10-10 立 ✓）
// ════════════════════════════════════════════════════════════════════════════
//
//   ★ 一个**从不报警**的守卫，和一个没有守卫，**在事故现场看起来一模一样** ✗。
//   ★ 2026-10-10 的事故正是"工具打印 ✅ 成功、文件却逐字节没变" ✗。
//   ⇒ ★ 所以 `gilwrite.mjs` 的每一条守卫，都要**证明它真的会拦** ✓：
//     ★ 故意制造那个失败场景 ⇒ ★ 断言它**抛异常** ✓（而不是"应该会拦" ✓）
//
//   ★ 本自测覆盖 4 件事：
//     ① 正路：改一个值 ⇒ 落盘 ⇒ **重读磁盘**看到新值 ✓
//     ② ★ 历史事故复现：改**不在树里**的对象 ⇒ 必须抛「输出与输入逐字节相同」✗
//        （★ 这正是 `encodeMsg` 的 `#503` 冻结干的事 ✓）
//     ③ ★ "只改一个值"的强制：多改一处而 `expectDiffs=2` ⇒ 必须抛「差异条数不符」✗
//     ④ 往返闸门：输出文件重编码 == 自身字节 ✓（由 `writeGil` 第 ⑤ 步保证 ✓）
//
// 用法：
//   node tools/gil/selftest_write.mjs                  # 默认拿 290.gil（或第一个能找到的 .gil）
//   node tools/gil/selftest_write.mjs <某个.gil>
// 退出码：0 = 全部通过；1 = 有失败（★ 失败时明细直接打出来 ✓）

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readGil, stateBlocks, pairOf, pairValue, cloneField } from './gilread.mjs';
import { writeGil, GilWriteError } from './gilwrite.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUTDIR = path.join(ROOT, 'tools', 'gil', 'out');
fs.mkdirSync(OUTDIR, { recursive: true });

function pickInput() {
  const a = process.argv[2];
  if (a) return path.isAbsolute(a) ? a : path.resolve(ROOT, a);
  for (const c of ['290.gil', '249-占位项改前两项-v111.gil']) {
    const p = path.join(ROOT, c);
    if (fs.existsSync(p)) return p;
  }
  const any = fs.readdirSync(ROOT).find((f) => f.endsWith('.gil'));
  if (!any) throw new Error('找不到任何 .gil 作输入');
  return path.join(ROOT, any);
}

const IN = pickInput();
const TMP = (n) => path.join(OUTDIR, n);

let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log('  ✅ ' + name + (detail ? '　' + detail : '')); }
  else { fail++; console.log('  ❌ ' + name + (detail ? '　' + detail : '')); }
};
const expectThrow = (name, fn, re) => {
  try { fn(); fail++; console.log('  ❌ ' + name + '　★ 没抛异常 ⇒ 守卫是【空转】的 ✗'); }
  catch (e) {
    if (e instanceof GilWriteError && (!re || re.test(e.message))) {
      pass++; console.log('  ✅ ' + name + '　★ 守卫按预期拦截 ✓（' + e.message.split('\n')[0].slice(0, 70) + '…）');
    } else { fail++; console.log('  ❌ ' + name + '　抛了别的异常：' + e.message); }
  }
};

const posPairOf = (g, name) => {
  const r = g.recs.find((x) => x.name === name);
  if (!r) return null;
  const o = []; stateBlocks(r.field.sub, o);
  return o[0] ? pairOf(o[0], 504) : null;
};
const setLeaf = (pair, field, v) => {
  for (const f of pair.sub || []) if (f.field === field && f.wt === 5) { f.f = v; return true; }
  return false;
};

console.log('输入：' + path.basename(IN) + '（' + fs.statSync(IN).size + ' 字节）');
const probe = readGil(IN);
const TPL = probe.recs.some((r) => r.name === 'clue') ? 'clue' : (probe.recs.find((r) => r.name) || {}).name;
if (!TPL) { console.error('✗ 这个存档里没有带名字的记录，无法自测'); process.exit(1); }
console.log('用记录：' + TPL + '\n');

// ── ① 正路：改一个值 ⇒ 重读磁盘必须看到新值 ────────────────────────────────
console.log('① 正路（改一个值 ⇒ 落盘 ⇒ 重读磁盘）');
{
  const g = readGil(IN);
  const p = posPairOf(g, TPL);
  const x0 = pairValue(p, 0), y0 = pairValue(p, 1);
  const nx = x0 === 0 ? 1 : 0, ny = y0 === 0 ? 1 : 0;     // 改成和原值不同
  let nDiff = 0;
  if (setLeaf(p, 501, nx)) nDiff++;
  if (setLeaf(p, 502, ny)) nDiff++;
  const out = TMP('selftest-ok.gil');
  const rep = writeGil(g, out, {
    label: 'selftest 正路', expectDiffs: nDiff, quiet: true,
    assert: (g2) => {
      const p2 = posPairOf(g2, TPL);
      const ax = pairValue(p2, 0), ay = pairValue(p2, 1);
      return (ax === nx && ay === ny) || `重读 = (${ax}, ${ay})，应为 (${nx}, ${ny})`;
    },
  });
  ok('落盘后重读 == 新值', true, `(${x0}, ${y0}) → (${nx}, ${ny})，差异 ${rep.diffs} 处`);
  ok('输出与输入不同', !fs.readFileSync(out).equals(fs.readFileSync(IN)));
  fs.unlinkSync(out);
}

// ── ② 历史事故复现：改"不在树里"的对象 ⇒ 必须被拦 ─────────────────────────
console.log('\n② 历史事故复现（改一个脱离对象图的对象 ⇒ 输出会逐字节相同）');
{
  const g = readGil(IN);
  const p = posPairOf(g, TPL);
  const detached = cloneField(p);            // ★ 改的是副本 ⇒ 树里那份没动 ✓
  setLeaf(detached, 501, 999);
  expectThrow('脱离对象图的修改必须被拦', () => {
    writeGil(g, TMP('selftest-detached.gil'), { label: 'selftest 脱离对象图' });
  }, /逐字节相同/);
}

// ── ③ "只改一个值"的强制：多改一处 ⇒ expectDiffs 必须拦 ────────────────────
console.log('\n③ 多改了别处（expectDiffs 的强制力）');
{
  const g = readGil(IN);
  const r = g.recs.find((x) => x.name === TPL);
  const o = []; stateBlocks(r.field.sub, o);
  if (o.length >= 2) {
    const p0 = pairOf(o[0], 504), p1 = pairOf(o[1], 504);
    const v = pairValue(p0, 0) === 0 ? 1 : 0;
    setLeaf(p0, 501, v);
    setLeaf(p1, 501, v);                     // ★ 第 2 个状态块也动了 ⇒ 差异 ≥ 2 处
    expectThrow('多改的字段必须被 diff 断言抓到', () => {
      writeGil(g, TMP('selftest-extra.gil'), { label: 'selftest 多改', expectDiffs: 1 });
    }, /差异条数不符/);
    for (const f of ['selftest-extra.gil']) { try { fs.unlinkSync(TMP(f)); } catch { } }
  } else {
    console.log('  ⏭ 这个记录只有 ' + o.length + ' 个状态块，跳过（不改判据 ✓）');
  }
}

// ── ④ 往返闸门（由 writeGil 第 ⑤ 步保证；这里独立再核一次）────────────────
console.log('\n④ 往返闸门（独立复核）');
{
  const { execFileSync } = await import('node:child_process');
  const g = readGil(IN);
  const p = posPairOf(g, TPL);
  const v = pairValue(p, 0) === 0 ? 1 : 0;
  setLeaf(p, 501, v);
  const out = TMP('selftest-rt.gil');
  writeGil(g, out, { label: 'selftest 往返', quiet: true, expectDiffs: 1 });
  try {
    execFileSync(process.execPath, [path.join(ROOT, 'tools', 'gil', 'roundtrip.mjs'), out], { stdio: 'pipe' });
    ok('独立闸门 roundtrip.mjs 通过', true);
  } catch (e) {
    ok('独立闸门 roundtrip.mjs 通过', false, String(e.stdout || e.message).slice(0, 200));
  }
  fs.unlinkSync(out);
}

console.log('\n══ 自测结果：' + pass + ' 通过 / ' + fail + ' 失败 ══');
process.exit(fail === 0 ? 0 : 1);
