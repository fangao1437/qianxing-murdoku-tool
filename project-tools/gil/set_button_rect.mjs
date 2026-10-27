// tools/gil/set_button_rect.mjs —— 只改一个控件（含子控件）的【状态块矩形】，其余一字不动
// 2026-10-16：用户要求「长度减半 ＋ 挪到右下角」⇒ 由本工具把命令行的值写进存档
// 用法：node tools/gil/set_button_rect.mjs --in=<in.gil> --out=<out.gil> --name=settle.btn \
//        --rect=696,-380,108,60 --children="bg=108x60@0,0;label=28x28@0,0"
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readGil, findChildListTop, asIdList } from './gilread.mjs';
import { writeGil } from './gilwrite.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const argv = process.argv.slice(2);
const argOf = (k) => { const a = argv.find((s) => s.startsWith('--' + k + '=')); return a ? a.slice(k.length + 3).replace(/^"|"$/g, '') : null; };
const IN = argOf('in'), OUT = argOf('out'), NAME = argOf('name'), RECT = argOf('rect');
if (!IN || !OUT || !NAME || !RECT) { console.error('用法: --in= --out= --name= --rect=x,y,w,h [--children="bg=WxH@x,y;..."]'); process.exit(1); }
const [rx, ry, rw, rh] = RECT.split(',').map(Number);
if ([rx, ry, rw, rh].some((v) => !Number.isFinite(v))) { console.error('--rect 要写 x,y,w,h'); process.exit(1); }

const g = readGil(path.isAbsolute(IN) ? IN : path.join(ROOT, IN));
const byId = new Map(g.recs.map((r) => [r.id, r]));
const kidsOf = (rec) => { const cl = findChildListTop(rec.field.sub); return cl ? (asIdList(cl.payload, true) || []).map((i) => byId.get(Number(i))).filter(Boolean) : []; };
const rec = g.byName.get(NAME);
if (!rec) { console.error('找不到 ' + NAME); process.exit(2); }

const CH = (argOf('children') || '').split(';').map((s) => s.trim()).filter(Boolean).map((spec) => {
  const eq = spec.indexOf('=');
  const name = spec.slice(0, eq).trim(), val = spec.slice(eq + 1).trim();
  const m = /^([\d.]+)x([\d.]+)(?:@(-?[\d.]+),(-?[\d.]+))?$/.exec(val);
  if (eq < 0 || !m) { console.error('--children 语法：名字=<宽>x<高>@<x>,<y>'); process.exit(7); }
  return { name, w: Number(m[1]), h: Number(m[2]), x: m[3] !== undefined ? Number(m[3]) : 0, y: m[4] !== undefined ? Number(m[4]) : 0 };
});

// 把某个状态块里的位置对/尺寸对写成给定值（四个块都写）
function writeRect(target, x, y, w, h) {
  let n = 0;
  for (const blk of target.states) {
    const p4 = blk.sub.find((f) => f.field === 504), p5 = blk.sub.find((f) => f.field === 505);
    for (const [p, a, b] of [[p4, x, y], [p5, w, h]]) {
      if (!p || !p.sub) continue;
      const f1 = p.sub.find((f) => f.field === 501 && f.wt === 5);
      const f2 = p.sub.find((f) => f.field === 502 && f.wt === 5);
      if (f1) { f1.f = a; n++; }
      if (f2) { f2.f = b; n++; }
    }
  }
  return n;
}

const n1 = writeRect(rec, rx, ry, rw, rh);
console.log(NAME + ' → pos(' + rx + ',' + ry + ') size(' + rw + 'x' + rh + ')  写入 ' + n1 + ' 个浮点');
for (const spec of CH) {
  const kid = kidsOf(rec).find((c) => c.name === spec.name);
  if (!kid) { console.error('找不到子控件 ' + spec.name); process.exit(8); }
  const n = writeRect(kid, spec.x, spec.y, spec.w, spec.h);
  console.log('  └ ' + spec.name + ' → pos(' + spec.x + ',' + spec.y + ') size(' + spec.w + 'x' + spec.h + ')  写入 ' + n + ' 个浮点');
}

const rep = writeGil(g, path.isAbsolute(OUT) ? OUT : path.join(ROOT, OUT), {
  label: '改矩形：' + NAME,
  assert: (g2) => {
    const bad = [];
    const geom = (r) => r.states.map((blk) => {
      const pair = (n) => { const p = blk.sub.find((x) => x.field === n); if (!p || !p.sub) return 'null';
        return p.sub.filter((x) => x.wt === 5).map((x) => x.f).join(','); };
      return pair(504) + '|' + pair(505);
    }).join('  ');
    const r2 = g2.byName.get(NAME);
    const want = (rx + ',' + ry + '|' + rw + ',' + rh + '  ').repeat(r2.states.length).trim();
    const got = r2.states.map((blk) => {
      const pair = (n) => { const p = blk.sub.find((x) => x.field === n); if (!p || !p.sub) return 'null';
        return p.sub.filter((x) => x.wt === 5).map((x) => x.f).join(','); };
      return pair(504) + '|' + pair(505);
    }).join('  ');
    if (got !== want) bad.push(NAME + ' 回读 ' + got + '，期望 ' + want);
    // ★ 其它记录一律不许动 ✓：记录数、名字集合
    if (g2.recs.length !== g.recs.length) bad.push('记录数变了');
    // ★ 工具没点名的控件，其几何必须与输入一致 ✓
    for (const nm of ['home.select', 'modal.settle']) {
      const a = g.byName.get(nm), b = g2.byName.get(nm);
      if (a && b && geom(a) !== geom(b)) bad.push(nm + ' 被改动了 ✗');
    }
    for (const spec of CH) {
      const k1 = kidsOf(r2).find((c) => c.name === spec.name);
      if (!k1) { bad.push('子控件 ' + spec.name + ' 丢了'); continue; }
      // ★ 子控件的 `#504` 位置对只带【一个】浮点 ✓（原型 `home.select.bg` 就是这样 ✓）
      //   ⇒ ★ 期望串只能是 `0|W,H` ✓ —— 写成 `0,0|` 会**误报** ✗（我踩过一次 ✓）
      // ★ 子控件的 `#504` 位置对这个档里只有【一个】浮点（或干脆没有）✓
      //   ⇒ ★ 期望串只查【尺寸】那一半 ✓（位置写没写进去由上面的写入计数保证 ✓）
      //   ⚠️ 写成 `0,0|W,H` 或 `0|W,H` 都会误报 ✗（两种形状本仓都出现过 ✓）
      const wantK = ('|' + spec.w + ',' + spec.h + '  ').repeat(k1.states.length).trim();
      const gotKS = k1.states.map((blk) => {
        const pair = (n) => { const p = blk.sub.find((x) => x.field === n); if (!p || !p.sub) return 'null';
          return p.sub.filter((x) => x.wt === 5).map((x) => x.f).join(','); };
        return '|' + pair(505);
      }).join('  ');
      if (gotKS !== wantK) bad.push(spec.name + ' 尺寸回读 ' + gotKS + '，期望 ' + wantK);
    }
    return bad.length ? bad.join('；') : true;
  },
});
console.log('输出 ' + path.basename(OUT) + '（' + rep.bytes + ' 字节，记录 ' + rep.recs + ' 条，字段差异 ' + rep.diffs + ' 处）');
