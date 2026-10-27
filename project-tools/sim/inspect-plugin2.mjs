// tools/sim/inspect-plugin2.mjs —— 在插件 bundle 里定位「worker 的动作分发」
// 用法：node tools/sim/inspect-plugin2.mjs
import fs from 'node:fs';
const F = process.env.SIM_PLUGIN
  || 'C:/Users/18182/.dsh/profiles/web/node_modules/dsh-plugin-beyond-simulator/dsh-plugin/dist/index.js';
const s = fs.readFileSync(F, 'utf8');

// worker 侧对 postMessage 的响应大概长这样：{id, action, args} → 分派
const marks = ['onmessage', 'addEventListener("message"', 'self.addEventListener', 'case"stop"', 'action==="start"', '"pointer"'];
for (const m of marks) {
  const i = s.indexOf(m);
  console.log('--- ' + m + '  @' + i);
  if (i >= 0) console.log(s.slice(Math.max(0, i - 200), i + 900));
  console.log();
}
