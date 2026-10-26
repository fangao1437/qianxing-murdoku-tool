#!/usr/bin/env node
// 云端 / 无 DSH 环境用的命令行入口：直接调用插件的 5 个阶段，不依赖 DSH 运行时。
//
// 用法（在插件根目录执行）：
//   node cloud/bin/scene-cli.mjs parse    --design plan.png --legend plan.legend.json --out spec.json [--preview parse.png]
//   node cloud/bin/scene-cli.mjs validate --spec spec.json [--out norm.json]
//   node cloud/bin/scene-cli.mjs preview  --spec spec.json --out preview.png [--scale 100] [--no-grid] [--no-labels]
//   node cloud/bin/scene-cli.mjs build    --spec spec.json --outDir scene [--blender /opt/blender/blender] [--no-render] [--no-glb]
//   node cloud/bin/scene-cli.mjs qx       --spec spec.json --outDir scene-qx [--format md|json|both]
//   node cloud/bin/scene-cli.mjs all      --design plan.png --legend plan.legend.json --outDir out
//
// 设计目标：容器里只需 Node + Blender，就能把「设计图 → SceneSpec → 预览 → .blend/GLB → 千星清单」跑完；
// 所有输出保持在 outDir / 指定路径，不修改输入。退出码：0 成功，1 阶段错误，2 参数错误。
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath, pathToFileURL } from 'node:url'

const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

/** 解析 `--key value` / `--flag` 形式参数。 */
function parseArgs(argv) {
  const args = { _: [] }
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]
    if (!token.startsWith('--')) {
      args._.push(token)
      continue
    }
    const key = token.slice(2)
    if (key.startsWith('no-')) {
      args[key.slice(3)] = false
      continue
    }
    const next = argv[i + 1]
    if (next === undefined || next.startsWith('--')) {
      args[key] = true
    } else {
      args[key] = next
      i++
    }
  }
  return args
}

function usage() {
  console.error(`scene-cli —— 设计图 → 3D 场景（云端命令行）

命令：
  parse     --design <png> --legend <json> --out <spec.json> [--preview <png>] [--metersPerCell <m>]
  validate  --spec <spec.json> [--out <normalized.json>]
  preview   --spec <spec.json> --out <png> [--scale <px/m>] [--grid=false] [--labels=false]
  build     --spec <spec.json> --outDir <dir> [--blender <exe>] [--render=false] [--glb=false] [--views top,perspective]
  qx        --spec <spec.json> --outDir <dir> [--format md|json|both]
  all       --design <png> --legend <json> --outDir <dir> [--blender <exe>] [--scale <px/m>]

环境变量：BLENDER_PATH（可选，等价于 --blender）；DSH_WORKSPACE_ROOT（可选，相对路径解析根，默认当前目录）。
`)
}

const args = parseArgs(process.argv.slice(2))
const command = args._[0]
if (!command || command === 'help' || args.help) {
  usage()
  process.exit(command ? 0 : 2)
}

const root = path.resolve(args.workspace || process.env.DSH_WORKSPACE_ROOT || process.cwd())
const env = { root, config: {}, BLENDER_PATH: process.env.BLENDER_PATH || '' }

async function loadStage(name) {
  // 插件源码与 CLI 同包：从插件根 src/stages 动态导入
  return import(pathToFileURL(path.join(PLUGIN_ROOT, 'src', 'stages', name)).href)
}

function requireArg(name) {
  const value = args[name]
  if (typeof value !== 'string' || !value) {
    console.error(`缺少参数 --${name}`)
    usage()
    process.exit(2)
  }
  return value
}

function printJson(label, value) {
  console.log(`\n== ${label} ==`)
  console.log(JSON.stringify(value, null, 2))
}

try {
  if (command === 'parse') {
    const { parsePlanDesign } = await loadStage('parse-plan.js')
    const result = await parsePlanDesign(
      {
        design: requireArg('design'),
        legend: args.legend,
        out: args.out,
        previewOut: args.preview,
        metersPerCell: args.metersPerCell ? Number(args.metersPerCell) : undefined,
      },
      env,
    )
    printJson('parse', { stats: result.stats, warnings: result.warnings, out: result.out, previewOut: result.previewOut, report: { ok: result.report.ok } })
    if (!result.report.ok) process.exit(1)
  } else if (command === 'validate') {
    const { validateSceneSpecStage } = await loadStage('validate-spec.js')
    const result = await validateSceneSpecStage({ spec: requireArg('spec'), out: args.out }, env)
    printJson('validate', { ok: result.report.ok, stats: result.stats, out: result.out })
    if (!result.report.ok) process.exit(1)
  } else if (command === 'preview') {
    const { renderScenePreviewStage } = await loadStage('preview.js')
    const result = await renderScenePreviewStage(
      {
        spec: requireArg('spec'),
        out: requireArg('out'),
        scale: args.scale ? Number(args.scale) : undefined,
        gridLines: args.grid !== false,
        labels: args.labels !== false,
      },
      env,
    )
    printJson('preview', { out: result.out, width: result.width, height: result.height, bytes: result.bytes })
  } else if (command === 'build') {
    const { buildSceneBlenderStage } = await loadStage('build-blender.js')
    const views = typeof args.views === 'string' ? args.views.split(',').filter(Boolean) : undefined
    const result = await buildSceneBlenderStage(
      {
        spec: requireArg('spec'),
        outDir: requireArg('outDir'),
        blenderPath: typeof args.blender === 'string' ? args.blender : undefined,
        render: args.render !== false,
        exportGlb: args.glb !== false,
        views,
      },
      env,
    )
    printJson('build', {
      executed: result.executed,
      blenderPath: result.blenderPath,
      blendPath: result.blendPath,
      glbPath: result.glbPath,
      renders: result.renders,
      report: { ok: result.report.ok, checks: result.report.checks.filter((c) => !c.ok) },
    })
    if (!result.report.ok) process.exit(1)
  } else if (command === 'qx') {
    const { emitQianxingPlanStage } = await loadStage('qx-plan.js')
    const result = await emitQianxingPlanStage(
      { spec: requireArg('spec'), outDir: requireArg('outDir'), format: typeof args.format === 'string' ? args.format : undefined },
      env,
    )
    printJson('qx', { outDir: result.outDir, placement: result.placement.length, placementPath: result.placementPath, planPath: result.planPath })
  } else if (command === 'all') {
    const outDir = requireArg('outDir')
    const { parsePlanDesign } = await loadStage('parse-plan.js')
    const { validateSceneSpecStage } = await loadStage('validate-spec.js')
    const { renderScenePreviewStage } = await loadStage('preview.js')
    const { buildSceneBlenderStage } = await loadStage('build-blender.js')
    const { emitQianxingPlanStage } = await loadStage('qx-plan.js')
    const specPath = path.join(outDir, 'scene.spec.json')
    const parsed = await parsePlanDesign(
      { design: requireArg('design'), legend: args.legend, out: specPath, previewOut: path.join(outDir, 'parse-preview.png') },
      env,
    )
    console.log(`[1/5] parse: ${JSON.stringify(parsed.stats)}`)
    const validated = await validateSceneSpecStage({ spec: specPath, out: path.join(outDir, 'scene.spec.normalized.json') }, env)
    if (!validated.report.ok) {
      console.error('[2/5] validate 失败：', validated.report.checks.filter((c) => !c.ok))
      process.exit(1)
    }
    console.log(`[2/5] validate: ok（${validated.report.checks.length} 项）`)
    const preview = await renderScenePreviewStage({ spec: specPath, out: path.join(outDir, 'plan-preview.png'), scale: args.scale ? Number(args.scale) : undefined }, env)
    console.log(`[3/5] preview: ${preview.width}x${preview.height} ${preview.bytes}B`)
    const built = await buildSceneBlenderStage(
      { spec: specPath, outDir: path.join(outDir, 'blender-scene'), blenderPath: typeof args.blender === 'string' ? args.blender : undefined, render: true, exportGlb: true },
      env,
    )
    console.log(`[4/5] build: executed=${built.executed} renders=${built.renders ? built.renders.length : 0} glb=${built.glbPath ? 'yes' : 'no'}`)
    const qx = await emitQianxingPlanStage({ spec: specPath, outDir: path.join(outDir, 'qx-plan') }, env)
    console.log(`[5/5] qx: placement=${qx.placement.length} plan=${qx.planPath}`)
    printJson('done', { outDir, spec: specPath })
    if (!built.report.ok) process.exit(1)
  } else {
    console.error(`未知命令：${command}`)
    usage()
    process.exit(2)
  }
} catch (error) {
  console.error(`\n[失败] ${error?.code ? '[' + error.code + '] ' : ''}${error?.message || error}`)
  if (error?.detail) console.error(JSON.stringify(error.detail, null, 2))
  process.exit(1)
}
