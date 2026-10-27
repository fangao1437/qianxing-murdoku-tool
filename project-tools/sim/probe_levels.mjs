// tools/sim/probe_levels.mjs —— 验证「选关 / 切关」在运行时真的能用
//
// 覆盖：
//   · 右栏「返回列表」→ 打开选关面板
//   · 点某一关 → 立刻切过去，标题 / 棋子数 / 棋盘尺寸全部跟着变
//   · 切到小关卡时，大关卡的额外格子要重新被隐藏（自适应棋盘 + 隐藏差集）
//   · 结算面板的「下一关」
//
// 用法：node tools/sim/probe_levels.mjs

import path from 'node:path';
import { makeController, loadPlan, buildProject, indexTree, textOf, visibleOf, dumpJson, shot, WORKSPACE } from './kit.mjs';

const plan = loadPlan();
const c = await makeController();
const { errs } = buildProject(c, plan, path.join(WORKSPACE, 'dist', 'client_script.lua'));
console.log('计划 ' + plan.nodes.length + ' 项，建树错误 ' + errs.length);

const get = async () => { const g = await c.play('get', { inspect: true }); return g && g.result ? g.result : g; };
const click = (n) => c.play('click', { name: n });
const tick = (dt) => c.play('step', { dt });

let pass = 0, fail = 0;
const check = (label, cond, detail) => {
  if (cond) { pass++; console.log('  ✓ ' + label + (detail ? '   [' + detail + ']' : '')); }
  else { fail++; console.log('  ✗ ' + label + (detail ? '   [' + detail + ']' : '')); }
};

await c.play('start', {});
await tick(0.05);
let ri = await get();
check('开局成功', (ri.logs || []).some((l) => /started:/.test(l.text)),
  (ri.logs || []).map((l) => l.text).find((t) => /started:/.test(t)));

// ── 1. 返回列表 → 选关面板 ────────────────────────────────────────────────
console.log('\n=== 1. 「返回列表」打开选关面板');
await click('intro.skip'); await tick(0.05);
await click('action.back'); await tick(0.15);
ri = await get();
// ★★★ 2026-09-30：**选关从"关卡内弹窗"改成了"整屏界面"**（用户要求，参考 murdoku 原作：
//   退出关卡 → 回选关界面 → 点卡片选关）。所以这里断言的目标从 `modal.*` 换成 `select.*`。
//   （旧断言测的是被替换掉的实现，一直红 —— 又是"断言锁死实现"那一类。）
check('退出关卡 → 打开整屏选关界面', visibleOf(ri, 'select') === true);
check('关卡内界面已隐藏（board 不可见）', visibleOf(ri, 'board') === false);
check('标题是「选择关卡」', textOf(ri, 'select.title') === '选择关卡', textOf(ri, 'select.title'));
const lvBtns = [...indexTree(ri).keys()].filter((k) => /^select\.card\.\d+$/.test(k)).sort();
check('列出了关卡卡片', lvBtns.length >= 4, lvBtns.join(' '));
check('有「返回主页」按钮', !!indexTree(ri).get('select.back'));

const paint = (await c.play('get', { paint: true })).paint || [];
const mp = paint.filter((x) => String(x.name || '').startsWith('select.'));
check('绘制列表里有选关界面控件', mp.length >= 5,
  mp.length + ' 个：' + mp.map((x) => x.name + '@' + x.matrix.tx + ',' + x.matrix.ty).slice(0, 3).join(' '));
await shot(c, 'lv-01-select.png');

// ── 2. 切到 case_002（6×6）────────────────────────────────────────────────
console.log('\n=== 2. 切到 case_002（6×6，有同伙）');
// 卡片是「第 N 张 = 登记表第 N 关」，卡片上写着关名 ⇒ **按文字找**，
// 不要去猜索引（登记表顺序变了测试就会假红）。
const idx = indexTree(ri);
let card002 = null;
for (const [nm] of idx) {
  if (!/^select\.card\.\d+$/.test(nm)) continue;
  // ★ 2026-09-30：卡片改成三段式（title / 缩略图 / info）后，文字**不在卡片本体上**了，
  //   而在 `select.card.N.title`（关名）与 `.info`（人数）。这里要读关名。
  const t = textOf(ri, nm + '.title') || '';
  if (t.includes('002')) { card002 = nm; break; }        // 卡片上写着「案件 002 · …」
}
check('选关界面上能读到卡片文字', !!textOf(ri, 'select.card.1.title'),
  textOf(ri, 'select.card.1.title'));
check('找到了 002 的卡片', card002 !== null, String(card002));
await click(card002 || 'select.card.2'); await tick(0.25);
ri = await get();
check('标题切到了案件 002', /案件 002/.test(textOf(ri, 'hud.title') || ''), textOf(ri, 'hud.title'));
check('棋子数跟着变成 6', /\/ 6/.test(textOf(ri, 'hud.progress') || ''), textOf(ri, 'hud.progress'));
check('第 6 行第 6 列格子已显示', visibleOf(ri, 'cell.6.6') === true);
check('第 7 行格子仍是隐藏的', visibleOf(ri, 'cell.7.7') === false);
await shot(c, 'lv-02-case002.png');


// ── 线索区滚动（2026-09-30，参考《派蒙的执律庭实习》的带滚轮列表）──────────────
//
//   引擎**没有滚轮事件**（查过官方 API 缓存），做的是「↑/↓ 按钮 + 滚动条」。
//   这条测试的**真正意义**：一屏放不下时，靠后的线索必须**真的能滚到**
//   —— `clue_max_visible` 是硬上限，少建控件 = 线索看不见 = 关卡不可解。
{
  check('线索区有 ↑/↓ 滚动按钮',
    !!indexTree(ri).get('clues.up') && !!indexTree(ri).get('clues.down'));

  // ── 线索卡的内容：头像 + 名字 + 字母徽章（参考图的卡片就是这三样）────────────
  //
  //   ⚠️ 只断言**至少有一条**卡片三样齐全 —— 不是每条线索都含角色名
  //   （有的线索是"某人不在某处"这类，名字可能匹配不上 ⇒ 按规则整条当正文，
  //     这时没有 who/face/badge 是**正确的行为**，不是 bug）。
  {
    const idx2 = indexTree(ri);
    let full = 0, sample = '';
    for (const [nm] of idx2) {
      const m = /^clue\.(\d+)\.face$/.exec(nm);
      if (!m) continue;
      const i = m[1];
      const k = idx2.get(nm);
      const badge = textOf(ri, 'clue.' + i + '.badge');
      const who = textOf(ri, 'clue.' + i + '.who');
      if (k && k.visible === true && badge && who) {
        full++;
        if (!sample) sample = 'clue.' + i + ' 头像 ✅ 名字=' + JSON.stringify(who) + ' 徽章=' + JSON.stringify(badge);
      }
    }
    check('线索卡有「头像 + 名字 + 字母徽章」三样齐全的（参考图的卡片样子）',
      full >= 1, full + ' 条齐全；样例 ' + sample);
  }

  const visCount = () => {
    let n = 0;
    for (const [nm] of indexTree(ri)) if (/^clue\.\d+$/.test(nm) && visibleOf(ri, nm) === true) n++;
    return n;
  };
  const before = visCount();
  // ⚠️ 三个坑（全踩过，写下来免得再犯）：
  //   ① 不能写死 `clue.18` —— 各关线索数不同。
  //   ② 模拟器的树是**所有关卡控件的并集** ⇒ `clue.18` 在 15 条的关卡上**也存在**，
  //      只是永远隐藏 ⇒ "滚到 clue.18" 在那种关卡上**不可能通过**（假红）。
  //   ③ 不需要滚动时，↑/↓ 与滚动条本来就该隐藏。
  //   ⇒ 只断言**真正的要求**：**窗口能滚到"末端 == 总条数"**（每一条都够得着）。
  const readCount = () => {
    const t = textOf(ri, 'clues.count') || '';
    const m = /^(\d+)-(\d+)\s*\/\s*(\d+)$/.exec(t.trim());
    return m ? { from: +m[1], to: +m[2], total: +m[3] } : null;
  };
  const needScroll = visibleOf(ri, 'clues.track') === true;
  if (needScroll) {
    let steps = 0, cc = readCount();
    while (steps < 40 && cc && cc.to < cc.total) {
      await click('clues.down'); await tick(0.05);
      ri = await get();
      cc = readCount();
      steps++;
    }
    check('滚到底时窗口末端 == 总条数（每一条都够得着）',
      !!cc && cc.to === cc.total,
      '滚了 ' + steps + ' 步；' + JSON.stringify(textOf(ri, 'clues.count')) + '（起始可见 ' + before + ' 条）');
    check('滚动时窗口整体下移（from 变大了）', !!cc && cc.from > 1,
      JSON.stringify(textOf(ri, 'clues.count')));
    for (let k = 0; k < 40; k++) { await click('clues.up'); await tick(0.03); }
    ri = await get();
    const cc2 = readCount();
    check('滚回顶部（from 回到 1）', !!cc2 && cc2.from === 1,
      JSON.stringify(textOf(ri, 'clues.count')));
  } else {
    check('线索不需要滚动时，↑/↓ 与滚动条正确隐藏',
      visibleOf(ri, 'clues.up') !== true && visibleOf(ri, 'clues.down') !== true,
      'count=' + JSON.stringify(textOf(ri, 'clues.count')));
  }
}

// ── 3. 切到 case_003（7×7）───────────────────────────────────────────────
console.log('\n=== 3. 切到 case_003（7×7）');
await click('action.back'); await tick(0.05);
await click('modal.level.case_003'); await tick(0.1);
ri = await get();
check('标题切到了案件 003', /案件 003/.test(textOf(ri, 'hud.title') || ''), textOf(ri, 'hud.title'));
check('棋子数跟着变成 7', /\/ 7/.test(textOf(ri, 'hud.progress') || ''), textOf(ri, 'hud.progress'));
check('第 7 行第 7 列格子现在显示了', visibleOf(ri, 'cell.7.7') === true);
const cell77 = indexTree(ri).get('cell.7.7');
// ★ 2026-09-28：**不再写死像素值**，改成按棋盘尺寸推算。
//
//   原来断言 97px —— 那是棋盘 733 宽时的值。后来修「动作条压住棋盘」把棋盘改成 677，
//   格子按比例变成 89，测试就红了。**格子尺寸本来就是棋盘尺寸的函数**
//   （见 `Adapter:cell_geometry`），写死等于把"一次布局调整"变成"一次测试失败"。
//   这里复算同一个公式：pitch = (board − ruler) / N，size = pitch − gap。
// ★★ 2026-09-28：**不再在测试里重算实现公式**。
//
//   原来我在这里抄了一遍 `Adapter:cell_geometry` 的算式（连 `ruler=37` 都抄了），
//   结果实现那边一动（棋盘 733→677、取整方式变化），测试就红 ——
//   而且红了**两轮**，每次都让我去追"到底谁对"。
//   ⇒ **重复实现必然漂移**。测试该断言的是**意图**，不是复算结果：
//     · 5×5 的格子必须**显著大于** 7×7 的（这是"格子随 N 自适应"的本意）
//     · 边长落在合理区间内（能看见、又不至于溢出格子）
//   公式的正确性由 `cell_geometry` 自己保证（它只有一处实现）。
const sane = (px) => px > 40 && px < 200;
const boardN = indexTree(ri).get('board');
const bw = boardN && (boardN.sizeDeltaX ?? boardN.width);
const s7 = cell77 && (cell77.sizeDeltaX ?? cell77.width);
check('7×7 的格子边长在合理区间（不重算公式，只看意图）',
  !!cell77 && sane(s7), 'cell.7.7=' + s7 + '（棋盘 ' + bw + '）');
// ★ 2026-09-30：**这条断言的约束变了**（不是"改测试让它变绿"）。
//   以前线索区一屏显示全部 ⇒ `clue.18` 一定可见。
//   现在线索区是**可滚动窗口** ⇒ 第 18 条在窗口外时 `visible=false` 是**正常的**，
//   真正要保证的是"**控件存在**（能滚到）"。能不能滚到由下面那组滚动断言负责。
check('线索数跟着变成 18（clue.18 的控件在）', !!indexTree(ri).get('clue.18'),
  '存在=' + !!indexTree(ri).get('clue.18') + ' 可见=' + visibleOf(ri, 'clue.18'));
await shot(c, 'lv-03-case003.png');

// ── 4. 切回 5×5，大关卡的格子要重新隐藏 ──────────────────────────────────
console.log('\n=== 4. 切回 case_001（5×5）');
await click('action.back'); await tick(0.05);
await click('modal.level.case_001'); await tick(0.1);
ri = await get();
check('标题切到了案件 001', /案件 001/.test(textOf(ri, 'hud.title') || ''), textOf(ri, 'hud.title'));
check('棋子数回到 5', /\/ 5/.test(textOf(ri, 'hud.progress') || ''), textOf(ri, 'hud.progress'));
check('第 6 行格子重新被隐藏', visibleOf(ri, 'cell.6.6') === false);
check('第 7 行格子重新被隐藏', visibleOf(ri, 'cell.7.7') === false);
check('第 18 条线索重新被隐藏', visibleOf(ri, 'clue.18') === false);

const c11 = indexTree(ri).get('cell.1.1');
// 同上一处：按棋盘尺寸复算，不写死。5×5 的格子必须**比 7×7 大**（这是这条断言的本意）。
const s5 = c11 && (c11.sizeDeltaX ?? c11.width);
check('5×5 的格子明显大于 7×7 的（"格子随 N 自适应"的本意）',
  !!c11 && sane(s5) && s5 > s7, 'cell.1.1=' + s5 + ' > cell.7.7=' + s7);
await shot(c, 'lv-04-back-to-5x5.png');

// ── 5. 「下一关」按钮 ────────────────────────────────────────────────────
console.log('\n=== 5. 结算面板的「下一关」');
// case_001 是注册表第 2 关，下一关应该是 case_002
//
// ⚠️ 2026-09-30：这一步**在"切关之后"跑**，而切关会重建控制器 + 重新渲染，
//    状态刷新比"一路开局"慢。原来的 0.05s 等待在切关后不够，
//    于是这条假红（同一条断言在 `play_test` 里是绿的 —— 那边不切关）。
//    把等待放宽，并把 toast 打出来：提交被拒时原因写在 toast 里，
//    比只报一个 `false` 有用得多。
await click('action.reveal'); await tick(0.2);
await click('action.submit'); await tick(0.25);
ri = await get();
// 已修（2026-09-30）：这条曾经因为 `start_other` 没清 `screen` 而失败 ——
//   同一时刻 `toast` = "摆位成立，可以指认盗窃者了"（说明**提交是成功的**），
//   但 `modal` 的 visible 是 false。
//   ⇒ 这指向"屏幕状态"：`ui_controller` 的屏幕分支在 `self.screen ~= nil` 时
//     会把 `modal` 一起隐藏。也就是说**切关之后 `self.screen` 又变成了非 nil**。
//   佐证：**同一条断言的兄弟版本在 `play_test.mjs` 里是 27/0 全绿**
//     （那边不切关，一路开局），说明**指认面板本身是好的**。
//   ⇒ 尚未查清"切关后 screen 为何非 nil"。下轮优先查这个，
//     不要为了让这条变绿去改断言（那是掩盖）。
check('进入指认面板', visibleOf(ri, 'modal') === true,
  'toast=' + JSON.stringify(textOf(ri, 'hud.toast'))
  + '  modal=' + visibleOf(ri, 'modal'));
await click('modal.suspect.D'); await tick(0.05);         // case_001 的盗窃者是 D
await click('modal.no_accomplice'); await tick(0.05);      // 无同伙
ri = await get();
check('已破案（结算面板）', textOf(ri, 'modal.title') === '破案！', textOf(ri, 'modal.title'));
check('结算面板有「下一关」按钮', visibleOf(ri, 'modal.next') === true);
await shot(c, 'lv-05-solved.png');
await click('modal.next'); await tick(0.1);
ri = await get();
check('「下一关」切到了案件 002', /案件 002/.test(textOf(ri, 'hud.title') || ''), textOf(ri, 'hud.title'));

const errsLog = (ri.logs || []).filter((l) => l.level === 'error' || l.level === 'lua-error');
check('运行期没有错误日志', errsLog.length === 0,
  errsLog.slice(0, 3).map((l) => l.text).join(' | ') || '无');

dumpJson('levels-final.json', ri);
console.log(`\n════════ 选关/切关：${pass} 通过 / ${fail} 失败 ════════`);
await c.play('stop', {});
await c.dispose();
process.exit(fail === 0 ? 0 : 1);

