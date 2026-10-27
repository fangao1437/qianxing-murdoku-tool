import path from 'node:path';
import { makeController, loadPlan, buildProject, indexTree, textOf, WORKSPACE } from './kit.mjs';
const c = await makeController();
const plan = loadPlan();
buildProject(c, plan, path.join(WORKSPACE, 'dist', 'client_script.lua'));
const get = async () => { const g = await c.play('get', { inspect: true }); return g && g.result ? g.result : g; };
const tick = async (dt) => { await c.play('step', { dt }); };
const click = async (n) => { await c.play('click', { name: n }); };
await c.play('start', {}); await tick(0.3);
await click('home.select'); await tick(0.3);
await click('select.card.2'); await tick(0.3);
await click('intro.skip'); await tick(0.3);
const ri = await get(); const idx = indexTree(ri);
const ids = ['hud.title', 'action.back', 'right', 'action.undo', 'action.submit', 'action.reveal', 'hud.violations', 'board', 'topbar'];
for (const id of ids) {
  const k = idx.get(id);
  const pl = plan.nodes.find(n => n.id === id);
  console.log('    ' + id.padEnd(16)
    + (k && k.box ? ' box=' + k.box.left + ',' + k.box.bottom + ' ' + k.box.width + 'x' + k.box.height : ' （无 box）')
    + '   计划父=' + (pl ? pl.parent : '-') + '  计划层序=' + (pl ? plan.nodes.indexOf(pl) : '-')
    + (k ? '  文字「' + String(textOf(ri, id) || '').slice(0, 14) + '」' : ''));
}
process.exit(0);
