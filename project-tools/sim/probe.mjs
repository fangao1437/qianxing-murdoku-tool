// tools/sim/probe.mjs —— 直接从 Node 驱动「千星沙箱模拟器」插件核心
// 用途：绕过 DSH 工具注入，在当前会话内就能建 UI / 挂脚本 / 试玩 / 读日志 / 截图。
//
// 用法：
//   node tools/sim/probe.mjs            # 打印初始工程 JSON（探 schema）
//   node tools/sim/probe.mjs <cmd.json> # 按命令文件执行一串操作
//
// 命令文件格式（一个 JSON 数组）：
//   [ { "cmd": "get" },
//     { "cmd": "patch", "op": { ... } },
//     { "cmd": "play", "action": "start", "args": {} },
//     { "cmd": "shot", "out": "tools/sim/out/play.png", "kind": "play" } ]

import fs from 'node:fs';
import path from 'node:path';

const PLUGIN = process.env.SIM_PLUGIN
  || 'C:/Users/18182/.dsh/profiles/web/node_modules/dsh-plugin-beyond-simulator/dsh-plugin/dist/index.js';

const mod = await import('file://' + PLUGIN);
const { SimulatorController } = mod;

const WORKSPACE = process.env.SIM_WORKSPACE
  || 'D:\\新建文件夹\\miHoYo Launcher\\qianxing-murdoku';

const c = new SimulatorController(WORKSPACE);

function brief(v, n = 1200) {
  const s = typeof v === 'string' ? v : JSON.stringify(v, null, 2);
  return s.length > n ? s.slice(0, n) + `\n...(${s.length} 字符)` : s;
}

const cmdFile = process.argv[2];
const cmds = cmdFile
  ? JSON.parse(fs.readFileSync(cmdFile, 'utf8'))
  : [{ cmd: 'get' }];

for (const step of cmds) {
  try {
    if (step.cmd === 'get') {
      const snap = c.get();
      console.log('--- get() revision=' + (snap && snap.revision));
      console.log(brief(step.full ? snap : (snap && snap.project ? snap.project : snap), step.n || 2500));
    } else if (step.cmd === 'keys') {
      const snap = c.get();
      console.log('--- 顶层字段');
      for (const k of Object.keys(snap)) {
        const v = snap[k];
        const t = Array.isArray(v) ? `array(${v.length})` : typeof v;
        console.log(`  ${k}: ${t}`);
      }
      console.log('--- 其它可能带 revision 的入口');
      for (const k of ['revision', 'rev', 'expectedRevision']) console.log('  ' + k + ' = ' + snap[k]);
      if (snap.project) console.log('  project keys = ' + Object.keys(snap.project).join(','));
    } else if (step.cmd === 'dump') {
      const out = path.resolve(step.out);
      fs.mkdirSync(path.dirname(out), { recursive: true });
      fs.writeFileSync(out, JSON.stringify(c.get(), null, 2));
      console.log('--- dump -> ' + out + ' (' + fs.statSync(out).size + ' 字节)');
    } else if (step.cmd === 'patch') {
      const r = c.patch(step.op);
      const t = r && r.tree ? r.tree : [];
      console.log('--- patch ' + JSON.stringify(step.op).slice(0, 200));
      console.log('    version=' + (r && r.version) + '  selectedId=' + (r && r.selectedId)
        + '  tree=' + t.length + '  nodes=' + t.map(x => x.id + ':' + x.name).slice(-4).join(' | '));
    } else if (step.cmd === 'play') {
      const r = await c.play(step.action, step.args || {});
      console.log('--- play ' + step.action);
      console.log('  -> ' + brief(step.full ? r : (r && r.result ? r.result : r), step.n || 3000));
    } else if (step.cmd === 'shot') {
      const out = path.resolve(step.out);
      fs.mkdirSync(path.dirname(out), { recursive: true });
      const r = step.kind === 'ui' ? c.requestUiScreenshot() : await c.requestScreenshot();
      const data = r && (r.png || r.data || r.base64 || r.image);
      if (!data) { console.log('--- shot: 没拿到 PNG，返回=' + brief(r, 600)); continue; }
      fs.writeFileSync(out, Buffer.from(data, 'base64'));
      console.log('--- shot -> ' + out + '  (' + fs.statSync(out).size + ' 字节)');
      console.log('    meta: ' + brief({ canvasId: r.canvasId, frame: r.frame, time: r.time,
        width: r.width, height: r.height, canvas: r.canvas }, 400));
    } else if (step.cmd === 'archives') {
      console.log('--- archives: ' + brief(c.listArchives(), 800));
    } else if (step.cmd === 'load') {
      console.log('--- loadArchive(' + step.path + ')');
      console.log('  -> ' + brief(c.loadArchive(step.path), 400));
    } else if (step.cmd === 'import') {
      const buf = fs.readFileSync(step.file);
      const r = c.importData(step.kind || 'lua', buf.toString('base64'), step.name ? { name: step.name } : undefined);
      console.log('--- import ' + (step.kind || 'lua') + ' ' + step.file);
      console.log('  -> ' + brief(r, 600));
    } else {
      console.log('--- 未知命令: ' + JSON.stringify(step));
    }
  } catch (e) {
    console.log('!!! ' + step.cmd + ' 失败: ' + (e && e.message));
    if (process.env.SIM_DEBUG) console.log(e && e.stack);
  }
}

await c.dispose();
console.log('=== done');
