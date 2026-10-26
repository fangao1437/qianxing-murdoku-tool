#!/usr/bin/env node
// 集成验收：不依赖 DSH 运行环境，用 mock ctx 加载本插件并逐个调用 5 个工具。
//
//   node test/run-tests.mjs [--workspace=<根>] [--only=<子串>] [--keep]
//
// 覆盖：注册 / SceneSpec 校验 / 设计图解析（与 ground-truth 对拍）/ 俯视预览 PNG 回读 /
//       千星落地清单 / Blender 端到端（找不到 Blender 时 SKIP，不判失败）/ 端到端串联 / 错误路径。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'

const PLUGIN_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const argv = process.argv.slice(2)
const argOf = (k, d = '') => {
  const hit = argv.find((s) => s.startsWith(`--${k}=`))
  return hit ? hit.slice(k.length + 3) : d
}
const WORKSPACE = path.resolve(argOf('workspace', path.resolve(PLUGIN_DIR, '..')))
const ONLY = argOf('only')
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'design2scene-test-'))

const abs = (rel) => path.resolve(WORKSPACE, rel)
const pabs = (rel) => path.resolve(PLUGIN_DIR, rel)
const has = (rel) => fs.existsSync(abs(rel))
const phas = (rel) => fs.existsSync(pabs(rel))
const tmp = (name) => path.join(TMP, name)

const DEMO_SPEC = pabs('examples/hall-demo.spec.json')
const DEMO_PLAN = pabs('examples/design-demo.png')
const DEMO_LEGEND = pabs('examples/design-demo.legend.json')
const DEMO_TRUTH = pabs('examples/design-demo.ground-truth.json')

const results = []
async function test(name, fn) {
  if (ONLY && !name.includes(ONLY)) return
  const started = Date.now()
  try {
    await fn()
    results.push({ name, ok: true, ms: Date.now() - started })
    console.log(`  PASS  ${name}  (${Date.now() - started}ms)`)
  } catch (err) {
    results.push({ name, ok: false, err })
    console.log(`  FAIL  ${name}  (${Date.now() - started}ms)\n        ${String(err?.message ?? err).split('\n').join('\n        ')}`)
  }
}
function skip(name, why) {
  if (ONLY && !name.includes(ONLY)) return
  console.log(`  SKIP  ${name}  (${why})`)
  results.push({ name, ok: true, skipped: true, ms: 0 })
}
function assert(cond, msg) { if (!cond) throw new Error(msg || '断言失败') }
function assertEq(a, b, label) { if (a !== b) throw new Error(`${label}: 期望 ${JSON.stringify(b)}，实得 ${JSON.stringify(a)}`) }
function assertCode(err, code) {
  const text = String(err?.message ?? err)
  assert(text.includes(`[${code}]`), `期望错误码 ${code}，实得：${text.slice(0, 300)}`)
}

async function loadPlugin(config) {
  const tools = new Map()
  const skills = new Map()
  const ctx = {
    tools: { register(d) { assert(!tools.has(d.name), `重复注册 ${d.name}`); tools.set(d.name, d); return () => tools.delete(d.name) } },
    skills: { register(s) { skills.set(s.name, s); return () => skills.delete(s.name) } },
    effect() { return () => {} },
    on() { return () => {} },
  }
  const mod = await import(pathToFileURL(path.join(PLUGIN_DIR, 'index.js')).href)
  mod.apply(ctx, config)
  return {
    mod, tools, skills,
    exec: { signal: new AbortController().signal, agent: { session: { header: { cwd: WORKSPACE } } } },
  }
}

const call = (p, name, args) => p.tools.get(name).execute(args, p.exec)
const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'))

async function main() {
  console.log(`== dsh-plugin-design-to-scene 集成验收 ==`)
  console.log(`   插件：${PLUGIN_DIR}`)
  console.log(`   工作区：${WORKSPACE}`)
  console.log(`   临时目录：${TMP}\n`)

  const plugin = await loadPlugin({})
  const { tools, skills } = plugin
  const demo = fs.existsSync(DEMO_SPEC) ? readJson(DEMO_SPEC) : null

  await test('registration: 5 个 scene_* 工具 + 1 个技能', async () => {
    const names = [...tools.keys()].sort()
    const want = ['scene_build_blender', 'scene_parse_plan', 'scene_preview', 'scene_qx_plan', 'scene_spec_validate']
    assertEq(JSON.stringify(names), JSON.stringify(want), '工具集合')
    assertEq([...skills.keys()].join(','), 'design-to-3d-scene', '技能')
    for (const n of names) {
      const d = tools.get(n)
      assert(d.description && d.parameters?.type === 'object' && typeof d.output.render === 'function' && typeof d.execute === 'function', `${n} 定义不完整`)
    }
  })

  await test('scene_spec_validate: hall-demo 合法 → ok=true；非法 kind → ok=false', async () => {
    if (!demo) return skip('scene_spec_validate', '缺 examples/hall-demo.spec.json')
    const res = await call(plugin, 'scene_spec_validate', { spec: DEMO_SPEC, out: tmp('hall.normalized.json') })
    assertEq(res.report.ok, true, 'report.ok')
    assert(res.report.checks.length >= 10, `checks 数量 ${res.report.checks.length}`)
    assertEq(JSON.stringify(res.stats.bounds), JSON.stringify([8, 6]), 'bounds')
    assertEq(res.stats.objects, demo.objects.length, '物件数')
    assert(fs.existsSync(tmp('hall.normalized.json')), '规范化 spec 应写出')
    const bad = JSON.parse(JSON.stringify(demo))
    bad.objects[0].kind = 'spaceship'
    const badRes = await call(plugin, 'scene_spec_validate', { spec: bad })
    assertEq(badRes.report.ok, false, '非法 kind 应 ok=false')
    assert(badRes.report.checks.some((c) => !c.ok), '应有失败检查项')
  })

  await test('scene_parse_plan: 演示设计图 → SceneSpec 且与 ground-truth 对拍', async () => {
    if (!phas('examples/design-demo.png') || !phas('examples/design-demo.legend.json')) {
      return skip('scene_parse_plan', '缺 examples/design-demo.*（跑 test/fixtures/make-demo-plan.mjs 生成）')
    }
    const res = await call(plugin, 'scene_parse_plan', {
      design: DEMO_PLAN, legend: DEMO_LEGEND, out: tmp('parsed.spec.json'),
    })
    assertEq(res.spec.version, 1, 'spec.version')
    assertEq(res.report.ok, true, '解析产物校验 ok')
    assert(res.stats.rooms >= 1 && res.stats.walls >= 3 && res.stats.objects >= 3, `统计偏低：${JSON.stringify(res.stats)}`)
    assert(fs.existsSync(tmp('parsed.spec.json')), '应写出 spec')
    if (fs.existsSync(DEMO_TRUTH)) {
      const truth = readJson(DEMO_TRUTH)
      assertEq(res.spec.rooms.length, truth.rooms.length, '房间数')
      assertEq(res.spec.objects.length, truth.objects.length, '物件数')
      assertEq(res.spec.walls.length, truth.walls.length, '墙数')
      const truthKind = truth.objects.map((o) => o.kind).sort().join(',')
      const gotKind = res.spec.objects.map((o) => o.kind).sort().join(',')
      assertEq(gotKind, truthKind, '物件 kind 集合')
      const truthDoors = truth.walls.reduce((n, w) => n + (w.openings?.length || 0), 0)
      const gotDoors = res.spec.walls.reduce((n, w) => n + (w.openings?.length || 0), 0)
      assertEq(gotDoors, truthDoors, '门数')
    } else {
      console.log('        （ground-truth 缺失：跳过逐项对拍）')
    }
  })

  await test('scene_preview: hall-demo → 可解码 PNG + 尺寸/像素抽检', async () => {
    if (!demo) return skip('scene_preview', '缺 hall-demo.spec.json')
    const out = tmp('preview.png')
    const res = await call(plugin, 'scene_preview', { spec: DEMO_SPEC, out, scale: 60, labels: true })
    assert(fs.existsSync(out), '应写出 PNG')
    assert(res.bytes > 1000, `PNG 太小 ${res.bytes}`)
    const { decodePng } = await import(pathToFileURL(path.join(PLUGIN_DIR, 'src', 'lib', 'png.js')).href)
    const img = decodePng(fs.readFileSync(out))
    assertEq(img.width, res.width, '解码宽度')
    assertEq(img.height, res.height, '解码高度')
    assert(img.width > 8 * 60, `宽度应 > 8m*60=${8 * 60}（实际 ${img.width}）`)
    // 四角应是背景色（不等于纯黑/纯白），中心区域应有非背景像素（墙/家具）
    const px = (x, y) => {
      const i = (y * img.width + x) * 4
      return [img.data[i], img.data[i + 1], img.data[i + 2]]
    }
    const corner = px(2, 2)
    assert(!(corner[0] === 0 && corner[1] === 0 && corner[2] === 0), '角落不应是纯黑')
    let nonBg = 0
    const bg = corner
    for (let y = 0; y < img.height; y += 3) {
      for (let x = 0; x < img.width; x += 3) {
        const c = px(x, y)
        if (Math.abs(c[0] - bg[0]) + Math.abs(c[1] - bg[1]) + Math.abs(c[2] - bg[2]) > 30) nonBg++
      }
    }
    assert(nonBg > 500, `非背景像素过少（${nonBg}）`)
  })

  await test('scene_qx_plan: placement 条数=物件数 + plan.md 要素齐全', async () => {
    if (!demo) return skip('scene_qx_plan', '缺 hall-demo.spec.json')
    const outDir = tmp('qx-plan')
    const res = await call(plugin, 'scene_qx_plan', { spec: DEMO_SPEC, outDir })
    assertEq(res.placement.length, demo.objects.length, 'placement 条数')
    const ids = res.placement.map((p) => p.id).sort().join(',')
    assertEq(ids, demo.objects.map((o) => o.id).sort().join(','), 'placement id 集合')
    for (const p of res.placement) {
      const src = demo.objects.find((o) => o.id === p.id)
      assert(Math.abs(p.x - src.pos[0]) < 1e-6 && Math.abs(p.z - src.pos[2]) < 1e-6, `${p.id} 坐标不一致`)
    }
    const md = fs.readFileSync(res.planPath, 'utf8')
    for (const kw of ['千星奇域 UGC 工具', 'GIA', 'Blender', 'entitlement', 'placement']) {
      assert(md.includes(kw), `plan.md 缺关键词「${kw}」`)
    }
    assert(fs.existsSync(res.placementPath), 'placement.json 应存在')
  })

  await test('scene_build_blender: 生成脚本 + （有 Blender 则）真跑出 .blend/渲染/GLB', async () => {
    if (!demo) return skip('scene_build_blender', '缺 hall-demo.spec.json')
    const outDir = tmp('blender-out')
    const res = await call(plugin, 'scene_build_blender', { spec: DEMO_SPEC, outDir, render: true, exportGlb: true })
    assert(fs.existsSync(res.scriptPath), 'build_scene.py 应存在')
    const script = fs.readFileSync(res.scriptPath, 'utf8')
    for (const kw of ['import bpy', 'SCENE_REPORT', 'export_scene.gltf', 'save_as_mainfile']) assert(script.includes(kw), `脚本缺「${kw}」`)
    if (!res.executed) {
      console.log(`        （未执行 Blender：${res.blenderPath ? '路径存在但失败' : '未找到'}；script=${path.basename(res.scriptPath)}）`)
      assert(res.report.checks.some((c) => c.id === 'blender.found'), 'report 应说明 blender.found')
      return
    }
    assert(fs.existsSync(res.blendPath), '.blend 应存在')
    assert(fs.statSync(res.blendPath).size > 10000, '.blend 太小')
    assert(Array.isArray(res.renders) && res.renders.length >= 2, '应至少 2 张渲染')
    for (const r of res.renders) {
      assert(fs.existsSync(r.path), `渲染缺失 ${r.path}`)
      assert(fs.statSync(r.path).size > 10000, `渲染太小 ${r.path}`)
    }
    assert(fs.existsSync(res.glbPath), 'GLB 应存在')
    assert(fs.statSync(res.glbPath).size > 10000, 'GLB 太小')
  })

  await test('端到端：parse → validate → preview → qx_plan（全部走工具）', async () => {
    if (!phas('examples/design-demo.png')) return skip('端到端串联', '缺 examples/design-demo.png')
    const parsed = await call(plugin, 'scene_parse_plan', { design: DEMO_PLAN, legend: DEMO_LEGEND, out: tmp('e2e.spec.json') })
    const validated = await call(plugin, 'scene_spec_validate', { spec: tmp('e2e.spec.json'), out: tmp('e2e.norm.json') })
    assertEq(validated.report.ok, true, 'e2e 校验')
    const prev = await call(plugin, 'scene_preview', { spec: tmp('e2e.norm.json'), out: tmp('e2e.preview.png') })
    assert(prev.bytes > 1000, 'e2e 预览')
    const plan = await call(plugin, 'scene_qx_plan', { spec: tmp('e2e.norm.json'), outDir: tmp('e2e-qx') })
    assertEq(plan.placement.length, parsed.spec.objects.length, 'e2e placement')
  })

  await test('错误路径：非法 spec → E_SPEC_INVALID；out==输入 → E_PATH；缺 design → E_ARGS', async () => {
    if (!demo) return skip('错误路径', '缺 hall-demo.spec.json')
    const bad = JSON.parse(JSON.stringify(demo))
    bad.walls[0].to = bad.walls[0].from.slice()
    try { await call(plugin, 'scene_preview', { spec: bad }); throw new Error('应当抛 E_SPEC_INVALID') } catch (e) { assertCode(e, 'E_SPEC_INVALID') }
    try { await call(plugin, 'scene_spec_validate', { spec: DEMO_SPEC, out: DEMO_SPEC }); throw new Error('应当抛 E_PATH') } catch (e) { assertCode(e, 'E_PATH') }
    try { await call(plugin, 'scene_parse_plan', {}); throw new Error('应当抛 E_ARGS') } catch (e) { assertCode(e, 'E_ARGS') }
  })

  const failed = results.filter((r) => !r.ok)
  const skipped = results.filter((r) => r.skipped)
  console.log(`\n== 结果：${results.length - failed.length - skipped.length} passed, ${failed.length} failed, ${skipped.length} skipped ==`)
  if (!argv.includes('--keep')) {
    try { fs.rmSync(TMP, { recursive: true, force: true }) } catch {}
  } else {
    console.log(`（--keep：临时目录 ${TMP}）`)
  }
  process.exit(failed.length === 0 ? 0 : 1)
}

main().catch((err) => {
  console.error('\n测试运行器自身失败：', err)
  process.exit(2)
})
