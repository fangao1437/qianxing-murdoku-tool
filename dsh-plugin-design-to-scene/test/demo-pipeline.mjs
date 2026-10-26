// 端到端 demo：造设计图 → 插件解析 → 预览 → Blender 搭建 → 千星清单
// 产物落在 _work/design-to-scene-demo/（可给用户看）
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const WORKSPACE = 'D:/新建文件夹/miHoYo Launcher'
const PLUGIN = path.join(WORKSPACE, 'dsh-plugin-design-to-scene')
const OUT = path.join(WORKSPACE, '_work', 'design-to-scene-demo')
fs.mkdirSync(OUT, { recursive: true })

const tools = new Map()
const skills = new Map()
const ctx = {
  tools: { register(d) { tools.set(d.name, d); return () => {} } },
  skills: { register(s) { skills.set(s.name, s); return () => {} } },
}
const mod = await import(pathToFileURL(path.join(PLUGIN, 'index.js')).href)
mod.apply(ctx, {})
const exec = { signal: new AbortController().signal, agent: { session: { header: { cwd: WORKSPACE } } } }
const call = (name, args) => tools.get(name).execute(args, exec)
const rel = (p) => path.relative(WORKSPACE, p).split(path.sep).join('/')

// ① 设计图（已由 fixture 脚本生成示例；这里直接用 A 版）
const design = path.join(PLUGIN, 'examples', 'design-demo.png')
const legend = path.join(PLUGIN, 'examples', 'design-demo.legend.json')
const specPath = path.join(OUT, 'hall.spec.json')
const parsed = await call('scene_parse_plan', { design, legend, out: specPath, previewOut: path.join(OUT, 'parse-preview.png') })
console.log('① parse:', JSON.stringify(parsed.stats), 'warnings', parsed.warnings.length)

// ② 校验（顺手规范化）
const validated = await call('scene_spec_validate', { spec: specPath, out: path.join(OUT, 'hall.spec.normalized.json') })
console.log('② validate:', validated.report.ok, 'checks', validated.report.checks.length, 'bounds', validated.stats.bounds)

// ③ 俯视预览
const preview = await call('scene_preview', { spec: specPath, out: path.join(OUT, 'plan-preview.png'), scale: 100 })
console.log('③ preview:', preview.width + 'x' + preview.height, preview.bytes + 'B')

// ④ Blender 搭建（hall-demo.spec.json 用双房间大样例，更直观）
const bigSpec = path.join(PLUGIN, 'examples', 'hall-demo.spec.json')
const blender = await call('scene_build_blender', { spec: bigSpec, outDir: path.join(OUT, 'blender-scene') })
console.log('④ blender: executed=' + blender.executed, 'blenderPath=' + blender.blenderPath)
if (blender.renders) for (const r of blender.renders) console.log('   render:', rel(r.path), r.bytes + 'B')
if (blender.glbPath) console.log('   glb:', rel(blender.glbPath), fs.statSync(blender.glbPath).size + 'B')
if (blender.blendPath) console.log('   blend:', rel(blender.blendPath), fs.statSync(blender.blendPath).size + 'B')

// ⑤ 千星落地清单
const plan = await call('scene_qx_plan', { spec: bigSpec, outDir: path.join(OUT, 'qx-plan') })
console.log('⑤ qx-plan: placement', plan.placement.length, 'plan', rel(plan.planPath))

// ⑥ 把大样例的俯视预览也出一张（方便和 3D 渲染对照）
const bigPreview = await call('scene_preview', { spec: bigSpec, out: path.join(OUT, 'hall-demo-preview.png'), scale: 100 })
console.log('⑥ big preview:', bigPreview.width + 'x' + bigPreview.height)

console.log('\nDEMO OUT:', OUT)
