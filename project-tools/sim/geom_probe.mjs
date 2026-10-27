// tools/sim/geom_probe.mjs —— ★ 量「运行时几何」：把 .gil 转出来的存档装进模拟器，
//   挂上指定的客户端脚本，跑起来，按**脚本化的时序**取多帧读数，
//   每个被观察的控件都做「存档值 vs 运行时值」对照。
//
// ════════════════════════════════════════════════════════════════════════════
// ★★★ 为什么必须有这个工具（2026-10-16 立）
// ════════════════════════════════════════════════════════════════════════════
//   ★ 本项目的旧试玩工具（`play_test.mjs` / `verify_art.mjs` …）都走
//     `kit.mjs:buildProject()` —— 那是**按 `layout-plan.json` 从零建树** ✗。
//   ★ 而这一轮要回答的问题恰恰是：
//       ★「**存档里那份几何**（用户在编辑器里摆的）在运行时**有没有被脚本覆盖**」✗
//     ⇒ ★ 必须拿**存档自己的树**跑 ✓（否则量的是"脚本自己建的树"，永远自洽 ✓ 无意义 ✗）。
//   ⇒ ★ 本工具：`loadArchive(存档)` → `newAsset(client)` ＋ `addScript(脚本源码)` → 试玩 → 读数 ✓
//
// ★ 实测到的两种树形状（2026-10-16 ✓ 写在这里省得下一位再摸）：
//   · `ri.tree`   —— **嵌套**（`tree[0]` = `root`，其 `children` 才是其余 124 个 ✓）
//                    字段：`anchoredPositionX/Y`、`sizeDeltaX/Y`、`box`、`visible`、`instantiated` ✓
//   · `ri.scene`  —— **画出来的那一层**（`format:"tree-v1"`、`nodes[]`，只含可见节点 ✓）
//                    ⇒ 只用来判"这个控件这一帧画出来了没有"✓
//   · `ri.paint`  —— 本版本为空数组（别再拿它当读数来源 ✗）
//
// ★ 用法：
//   node tools/sim/geom_probe.mjs --save=tools/sim/out/390.1.save.json \
//        --lua=dist/client_script.lua --tag=red \
//        [--canvas=pc-16-9] [--seq="step:0.6|measure|click:home.select|step:0.4|measure"]
//
// ★ 产物（都在 tools/sim/out/）：`geom-<tag>-<i>.json` / `geom-<tag>-<i>.png` / `geom-<tag>.run.txt`
// ★ 判据：每个控件打「存档 / 运行 / 一致|不一致」；末尾汇总 `一致 N / 不一致 M`
//          —— **不许只看"跑了没报错"** ✓
// ════════════════════════════════════════════════════════════════════════════

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const OUT = path.join(REPO, 'tools', 'sim', 'out');

const PLUGIN = process.env.SIM_PLUGIN
  || 'C:/Users/18182/.dsh/profiles/web/node_modules/dsh-plugin-beyond-simulator/dsh-plugin/dist/index.js';

const argv = process.argv.slice(2);
const argOf = (k, d) => {
  const a = argv.find((s) => s.startsWith('--' + k + '='));
  return a ? a.slice(k.length + 3).replace(/^"|"$/g, '') : d;
};
const SAVE = argOf('save', 'tools/sim/out/390.1.save.json');
const LUA = argOf('lua', 'dist/client_script.lua');
const TAG = argOf('tag', 'probe');
const CANVAS = argOf('canvas', 'pc-16-9');
const SEQ = argOf('seq', 'step:0.6|measure');

// ★ 被量的控件（这一轮的症状名单 ✓ 全都在 `390.1.gil` 里有实体 ✓）
const WATCH = argOf('names',
  'root,stage,board.bg,settle.btn,hex.hint,'
  + 'select.card.1,select.card.2,select.card.3,select.card.4,'
  + 'hit.select.card.1,hit.select.card.4,select.card.1.title,select.card.1.info,'
  + 'clues,clues.bg,clues.grid,home.select,hud.title').split(',').filter(Boolean);

const mod = await import('file://' + PLUGIN);
const { SimulatorController } = mod;
const c = new SimulatorController(REPO);

const log = [];
const say = (...a) => { const s = a.map(String).join(' '); log.push(s); console.log(s); };

/** 从"会话工程快照"（loadArchive 之后、脚本动手之前）里读某个控件的 KEYBOARD 变换
 *  ★ 为什么要这一份：`gil_to_save.mjs` 是**别处的产物** ✓ ——
 *    它把 `.gil` 换成存档时可能做锚点兜底/口径换算（它自己会报 `anchorFallbacks` ✓）。
 *    ⇒ 「运行时 ≠ 存档」有两种可能：① 脚本改了 ✓ ② 换档时就变了 ✗
 *    有这一份才能把两者**分开** ✓（否则会把换档的账记到脚本头上 ✗） */
function sessionGeom(snapshot) {
  const out = new Map();
  (function walk(n, parent) {
    if (!n || typeof n !== 'object') return;
    if (Array.isArray(n)) { for (const x of n) walk(x, parent); return; }
    if (n.name && n.kind && n.transformByPlatform) {
      const t = n.transformByPlatform.KEYBOARD || null;
      if (t && !out.has(n.name)) {
        out.set(n.name, {
          x: t.offset ? t.offset.x : null, y: t.offset ? t.offset.y : null,
          w: t.size ? t.size.x : null, h: t.size ? t.size.y : null,
          aMin: t.anchorMin || null, aMax: t.anchorMax || null,
          parent: parent || null,
        });
      }
    }
    for (const k of Object.keys(n)) walk(n[k], (n && n.name) ? n.name : parent);
  })(snapshot, null);
  return out;
}

/** 从"存档 JSON"（qxqy-simulator-save）里读某个控件的 KEYBOARD 变换 */
function archiveGeom(saveFile) {
  const j = JSON.parse(fs.readFileSync(saveFile, 'utf8'));
  const out = new Map();
  (function walk(n, parent) {
    if (!n || typeof n !== 'object') return;
    if (Array.isArray(n)) { for (const x of n) walk(x, parent); return; }
    if (n.name && n.kind) {
      const t = (n.transformByPlatform && n.transformByPlatform.KEYBOARD) || null;
      if (t && !out.has(n.name)) {
        out.set(n.name, {
          x: t.offset ? t.offset.x : null, y: t.offset ? t.offset.y : null,
          w: t.size ? t.size.x : null, h: t.size ? t.size.y : null,
          parent: parent || null,
        });
      }
    }
    for (const k of Object.keys(n)) walk(n[k], (n && n.name) ? n.name : parent);
  })(j, null);
  return out;
}

/** 运行时树里按名字取节点（同名取第一个）＋ 这一帧画出来了哪些 ＋ **绝对坐标**
 *  ★ 2026-10-16 追加（用户报"首页四个按键不见了" ✓）：
 *    只用"相对父级的 offset"做对照是**不够的** ✗ —— ★ 父级自己被移动/改尺寸时，
 *    子控件的 offset 一个都没变，**可它们整体跑到屏幕外去了** ✓
 *    ⇒ 必须把父级链上的 anchoredPosition **累加**起来，得到"画布绝对中心" ✓
 *    ★ 口径：每个节点的 anchored 都是"相对其父级中心" ⇒ 绝对 = 画布中心 + Σ(anchored) ✓
 *      （与适配器 `rect` 分支里那条换算链同源 ✓） */
function runtimeNodes(ri) {
  const m = new Map();
  const abs = new Map();
  const put = (x, chain) => {
    if (!x || !x.name) return;
    if (!m.has(x.name)) m.set(x.name, x);
    let sx = 0, sy = 0;
    for (const a of chain) { sx += (typeof a.anchoredPositionX === 'number' ? a.anchoredPositionX : 0); sy += (typeof a.anchoredPositionY === 'number' ? a.anchoredPositionY : 0); }
    if (!abs.has(x.name)) abs.set(x.name, { x: sx, y: sy, depth: chain.length });
  };
  (function walk(x, chain) {
    if (!x || typeof x !== 'object') return;
    if (Array.isArray(x)) { for (const y of x) walk(y, chain); return; }
    if (x.name) { put(x, chain.concat([x])); chain = chain.concat([x]); }
    for (const k of (x.children || [])) walk(k, chain);
  })(ri && ri.tree, []);
  const painted = new Set();
  for (const x of ((ri && ri.scene && ri.scene.nodes) || [])) if (x && x.name) painted.add(x.name);
  return { byName: m, painted, abs };
}

/** 从运行时节点上取几何（字段名随版本可能不同 ⇒ 全试一遍，实测命中前两个 ✓） */
function geomOf(n) {
  if (!n) return null;
  const pick = (...keys) => { for (const k of keys) if (typeof n[k] === 'number') return n[k]; return null; };
  return {
    x: pick('anchoredPositionX', 'posX', 'x', 'offsetX'),
    y: pick('anchoredPositionY', 'posY', 'y', 'offsetY'),
    w: pick('sizeDeltaX', 'width', 'w', 'sizeX'),
    h: pick('sizeDeltaY', 'height', 'h', 'sizeY'),
    visible: n.visible,
    instantiated: n.instantiated,
    // ★ 2026-10-16 加 ✓：图与色 —— ★ 「头像被棋盘染色」那条要用它判（`imageColor` 是**乘算** ✓）
    imageId: (typeof n.imageId === 'number' ? n.imageId : null),
    imageColor: (typeof n.imageColor === 'number' ? n.imageColor : null),
  };
}

function logsOf(ri) {
  return (ri.logs || []).map((x) => (typeof x === 'string' ? x : (x && x.text) || JSON.stringify(x)));
}

const ARCH = archiveGeom(path.resolve(REPO, SAVE));
say('== geom_probe tag=' + TAG + '  脚本=' + LUA + '  存档=' + SAVE + '  时序=' + SEQ);
say('   存档里读到的控件数 = ' + ARCH.size);

const snapshots = [];

try {
  c.loadArchive(SAVE);
  say('   loadArchive ok');
  const base = c.get();
  const SESS = sessionGeom(base && base.project ? base.project : base);
  say('   ★ 会话基线控件数 = ' + SESS.size + '（脚本动手【之前】引擎里的值 ✓）');

  // ★ 客户端半边：**另建一个模板来承载脚本**（与 kit.mjs 同一套路 ✓）
  const p = c.patch({ op: 'newAsset', assetType: 'client-control-template' });
  const tplRoot = p && p.asset && p.asset.currentTemplateId;
  const src = fs.readFileSync(path.resolve(REPO, LUA), 'utf8');
  const m = /构建标记\s*(v\d+)/.exec(src);
  say('   client 模板根 = ' + tplRoot + '   脚本内嵌标记 = ' + (m ? m[1] : '(没找到)')
    + '   字节 = ' + src.length);
  c.patch({
    op: 'addScript', path: 'client_script.lua', source: src,
    controlId: tplRoot, controlAsset: 'client',
  });

  await c.play('start', { canvasId: CANVAS });

  let idx = 0;
  for (const tk of SEQ.split('|').map((s) => s.trim()).filter(Boolean)) {
    const [cmd, val] = tk.split(':');
    if (cmd === 'step') {
      await c.play('step', { dt: Number(val || 0.2) });
      continue;
    }
    if (cmd === 'click') {
      const r = await c.play('click', { name: val });
      say('   click ' + val + ' -> ' + JSON.stringify(r && r.result ? r.result : r).slice(0, 160));
      continue;
    }
    if (cmd === 'key') { await c.play('key', { key: val }); continue; }
    if (cmd !== 'measure') { say('   ⚠️ 未知时序项 ' + tk); continue; }

    idx += 1;
    const g = await c.play('get', { inspect: true, view: true });
    const ri = g && g.result ? g.result : g;
    const { byName: rn, painted, abs } = runtimeNodes(ri);
    const cw = ri.canvasWidth || 1600, chh = ri.canvasHeight || 900;
    const lg = logsOf(ri);
    say('   -- measure #' + idx + '  frame=' + ri.frame + ' time=' + ri.time
      + ' 节点=' + rn.size + ' 绘制=' + painted.size);

    const rows = [];
    let same = 0, diff = 0, missing = 0, touched = 0;
    for (const nm of WATCH) {
      const a = ARCH.get(nm) || null;
      const b = SESS.get(nm) || null;
      const r = geomOf(rn.get(nm) || null);
      const has = !!(a && r && r.x !== null && r.w !== null);
      const eq = has
        && Math.abs(a.x - r.x) < 0.51 && Math.abs(a.y - r.y) < 0.51
        && Math.abs(a.w - r.w) < 0.51 && Math.abs(a.h - r.h) < 0.51;
      // ★「脚本动过手没有」= 会话基线 vs 运行时（与换档产物无关 ✓）
      const scriptTouched = !!(b && r && r.x !== null
        && (Math.abs(b.x - r.x) > 0.51 || Math.abs(b.y - r.y) > 0.51
            || Math.abs(b.w - r.w) > 0.51 || Math.abs(b.h - r.h) > 0.51));
      if (!a || !r) missing += 1; else if (eq) same += 1; else diff += 1;
      if (scriptTouched) touched += 1;
      rows.push({ name: nm, archive: a, session: b, runtime: r, same: eq, scriptTouched, painted: painted.has(nm) });
      const tag = !a ? '存档缺' : (!r ? '运行缺' : (eq ? '与编辑器一致' : '与编辑器不一致'));
      const ab = abs.get(nm) || null;
      // ★ 绝对盒子（画布中心为原点）→ 屏幕像素（左上原点）
      let onscreen = '';
      if (ab && r && r.w !== null) {
        const cx = cw / 2 + ab.x, cy = chh / 2 + ab.y;
        const L = cx - r.w / 2, R = cx + r.w / 2, B = chh - (cy - r.h / 2), T = chh - (cy + r.h / 2);
        const inx = (R > 0 && L < cw && T > 0 && B < chh);
        onscreen = `　屏幕像素 X[${L.toFixed(0)}..${R.toFixed(0)}] Y[${T.toFixed(0)}..${B.toFixed(0)}]`
          + (inx ? '' : ' ★★ 跑出画布 ✗');
      }
      say('     [' + tag + '] ' + nm + (scriptTouched ? ' ★脚本改过' : '') + (painted.has(nm) ? ' (已绘制)' : ' (没绘制)'));
      say('          编辑器 ' + (a ? `(${a.x},${a.y}) ${a.w}x${a.h}` : '—')
        + '　基线 ' + (b ? `(${b.x},${b.y}) ${b.w}x${b.h}` : '—')
        + '　运行 ' + (r ? `(${r.x},${r.y}) ${r.w}x${r.h})` : '—'));
      if (r && (r.imageId !== null || r.imageColor !== null)) {
        say('          图/色 imageId=' + r.imageId + '　imageColor='
          + (r.imageColor === null ? '—' : r.imageColor + '（0x' + (r.imageColor >>> 0).toString(16).toUpperCase() + '）'));
      }
      if (onscreen !== '') say('         ' + onscreen);
    }
    say('     == 汇总 #' + idx + '：与编辑器一致 ' + same + ' / 不一致 ' + diff
      + ' / 缺 ' + missing + '　脚本改过 ' + touched + ' 个');

    fs.writeFileSync(path.join(OUT, `geom-${TAG}-${idx}.json`),
      JSON.stringify({ tag: TAG, lua: LUA, save: SAVE, canvas: CANVAS, seq: SEQ, measure: idx, rows }, null, 2));
    fs.writeFileSync(path.join(OUT, `geom-${TAG}-${idx}.log.txt`), lg.join('\n'));

    const s = await c.requestScreenshot();
    const data = s && (s.png || s.data || s.base64 || s.image);
    if (data) {
      fs.writeFileSync(path.join(OUT, `geom-${TAG}-${idx}.png`), Buffer.from(data, 'base64'));
      say('     截图 -> tools/sim/out/geom-' + TAG + '-' + idx + '.png  frame=' + s.frame);
    }
    snapshots.push({ idx, same, diff, missing });
  }
  await c.play('stop', {});
} catch (e) {
  say('!!! 失败：' + (e && e.message));
  if (process.env.SIM_DEBUG) say(e && e.stack);
} finally {
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'geom-' + TAG + '.run.txt'), log.join('\n'));
  say('== 总汇总：' + snapshots.map((s) => '#' + s.idx + ' 一致' + s.same + '/不一致' + s.diff + '/缺' + s.missing).join('  '));
  await c.dispose();
}
say('=== done');
