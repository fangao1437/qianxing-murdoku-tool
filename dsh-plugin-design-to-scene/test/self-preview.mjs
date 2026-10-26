#!/usr/bin/env node
// S2/S4 自检：俯视预览 PNG（解码回读 + 关键像素抽检）+ 千星落地清单（placement / plan.md / 错误路径）。
//
//   node test/self-preview.mjs
//
// 覆盖：
//   · preview：hall-demo → PNG 尺寸 = 8m×6m×scale + 留白；背景/房间/墙/门/桌子中心像素抽检；
//     labels=true / gridLines=false / scale 变化（50/160）各跑一次；默认输出路径；网格可见性；
//   · qx-plan：placement 16 条与 spec 一致（id/坐标/尺寸/朝向/颜色）、hint 是贴墙/居中/地毯；
//     plan.md 关键词齐全；format=json 只写 json、format=md 只写 md；
//   · 错误路径：缺 spec→E_ARGS；objects[0].kind 非法→E_SPEC_INVALID；out 覆盖输入→E_PATH。
// 纯 node: 内建，不依赖 DSH 运行环境。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const PLUGIN_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SPEC_PATH = path.join(PLUGIN_DIR, 'examples', 'hall-demo.spec.json')
const WORK_DIR = path.join(PLUGIN_DIR, '_work', 'self-preview')
const SPEC_TEXT = fs.readFileSync(SPEC_PATH, 'utf8') // 跑完核对输入没被改写
const SPEC = JSON.parse(SPEC_TEXT)

const { renderScenePreviewStage } = await import(pathToFileURL(path.join(PLUGIN_DIR, 'src', 'stages', 'preview.js')).href)
const { emitQianxingPlanStage } = await import(pathToFileURL(path.join(PLUGIN_DIR, 'src', 'stages', 'qx-plan.js')).href)
const { decodePng } = await import(pathToFileURL(path.join(PLUGIN_DIR, 'src', 'lib', 'png.js')).href)
const { hexToRgb } = await import(pathToFileURL(path.join(PLUGIN_DIR, 'src', 'lib', 'png-write.js')).href)

const env = { root: PLUGIN_DIR, config: {}, signal: new AbortController().signal }
const SCALE = 100
const PADDING = 24
const OUT = (name) => path.join(WORK_DIR, name)

let passed = 0
function pass(label) {
  passed++
  console.log(`  PASS  ${label}`)
}
function check(cond, msg) {
  if (!cond) throw new Error(msg || '断言失败')
}
function checkEq(actual, expected, label) {
  if (actual !== expected) throw new Error(`${label}: 期望 ${JSON.stringify(expected)}，实得 ${JSON.stringify(actual)}`)
}
function decode(file) {
  return decodePng(fs.readFileSync(file))
}
const pixel = (img, x, y) => {
  const i = (y * img.width + x) * 4
  return [img.data[i], img.data[i + 1], img.data[i + 2]]
}
/** 平面米坐标 → 预览像素（留白 24px、100 像素/米）。 */
const sampleAt = (img, xM, zM) => pixel(img, Math.round(PADDING + xM * SCALE), Math.round(PADDING + zM * SCALE))
function checkColor(actual, expected, tol, label) {
  const want = Array.isArray(expected) ? expected : hexToRgb(expected)
  const worst = Math.max(...want.map((v, i) => Math.abs(actual[i] - v)))
  check(worst <= tol, `${label}: 期望 ≈[${want.join(',')}]，实得 [${actual.join(',')}]（最大差 ${worst}）`)
}
/** 期望错误码（ArtError.code 或消息里的 [E_XXX]）。 */
async function expectCode(code, fn, label) {
  try {
    await fn()
  } catch (err) {
    const text = String(err?.message ?? err)
    check(err?.code === code || text.includes(`[${code}]`), `${label}: 期望 ${code}，实得 ${text.slice(0, 300)}`)
    pass(`${label} → ${code}`)
    return err
  }
  throw new Error(`${label}: 应当抛 ${code}，但没有抛错`)
}
function countPixelDiff(a, b) {
  let diff = 0
  for (let i = 0; i < a.data.length; i += 4) {
    if (a.data[i] !== b.data[i] || a.data[i + 1] !== b.data[i + 1] || a.data[i + 2] !== b.data[i + 2]) diff++
  }
  return diff
}

async function main() {
  fs.rmSync(WORK_DIR, { recursive: true, force: true })
  fs.mkdirSync(WORK_DIR, { recursive: true })
  console.log('== design-to-scene · S2 俯视预览 + S4 千星清单自检 ==\n')

  // ── 1. preview：默认参数渲染 + 解码回读 + 像素抽检 ─────────────────────────
  const mainOut = OUT('preview-default.png')
  const res = await renderScenePreviewStage({ spec: SPEC_PATH, out: mainOut }, env)
  checkEq(path.resolve(res.out), path.resolve(mainOut), 'preview.out 应为绝对路径')
  check(fs.existsSync(mainOut), '预览 PNG 应写出')
  checkEq(res.bytes, fs.statSync(mainOut).size, 'preview.bytes = 文件大小')
  const expectW = Math.round(SPEC.bounds.width * SCALE) + PADDING * 2
  const expectH = Math.round(SPEC.bounds.depth * SCALE) + PADDING * 2
  checkEq(res.width, expectW, 'preview.width')
  checkEq(res.height, expectH, 'preview.height')
  check(res.report?.ok === true, 'preview.report.ok 应为 true')
  pass(`默认渲染：${res.width}×${res.height}px / ${res.bytes}B，report.ok=true`)

  const img = decode(mainOut)
  checkEq(img.width, res.width, '解码宽度')
  checkEq(img.height, res.height, '解码高度')
  checkEq(img.data.length, img.width * img.height * 4, '解码像素数据长度')
  pass('PNG 解码回读：尺寸/像素数据长度一致')

  // 背景角：env.background #101826 向白提亮 75%（与 preview.js 的 BG_LIGHTEN 一致）
  const dimBg = hexToRgb(SPEC.env.background)
  const wantBg = dimBg.map((v) => Math.round(v + (255 - v) * 0.75))
  checkColor(pixel(img, 2, 2), wantBg, 2, '背景角(2,2)')
  checkColor(pixel(img, img.width - 3, img.height - 3), wantBg, 2, '背景角(右下)')
  pass(`背景角像素 = 提亮背景色 [${wantBg.join(',')}]`)

  // 房间中心：大厅 (1.25,4.75) / 内室 (5,3) 应等于 room.color
  checkColor(sampleAt(img, 1.25, 4.75), SPEC.rooms[0].color, 2, '大厅中心')
  checkColor(sampleAt(img, 5, 3), SPEC.rooms[1].color, 2, '内室中心')
  pass(`房间中心像素 = room.color（${SPEC.rooms[0].color} / ${SPEC.rooms[1].color}）`)

  // 墙中点：墙 z=0 的 (4,0)；门：墙 z=6 的 opening u=0.25 → (2,6)
  checkColor(sampleAt(img, 4, 0), '#2E3440', 2, '墙中点(4,0)')
  checkColor(sampleAt(img, 2, 6), '#C06A1E', 2, '门中点(2,6)')
  pass('墙中点 = 墙色 #2E3440；门位置 = 门色 #C06A1E')

  // 桌子 footprint 中心 = table color；地毯半透明叠在房间色上（既不是房间色也不是地毯纯色）
  checkColor(sampleAt(img, 2, 3.2), '#AD9C67', 2, '桌子中心(2,3.2)')
  const rugPx = sampleAt(img, 2.9, 2.6)
  const hallRgb = hexToRgb(SPEC.rooms[0].color)
  const rugRgb = hexToRgb('#B89A62')
  const between = rugPx.every((v, i) => v >= Math.min(hallRgb[i], rugRgb[i]) - 2 && v <= Math.max(hallRgb[i], rugRgb[i]) + 2)
  check(between, `地毯像素应为半透明混合：实得 [${rugPx.join(',')}]，房间 [${hallRgb.join(',')}] 地毯 [${rugRgb.join(',')}]`)
  check(rugPx.join(',') !== hallRgb.join(','), '地毯半透明像素不应等于房间底色')
  pass(`桌子中心 = 桌子色；地毯为半透明混合 [${rugPx.join(',')}]`)

  // 图例
  checkEq(res.legend.rooms.length, 2, 'legend.rooms 数量')
  checkEq(res.legend.rooms[0].color, SPEC.rooms[0].color, 'legend.rooms[0].color')
  checkEq(res.legend.rooms[1].name, SPEC.rooms[1].name, 'legend.rooms[1].name')
  const kinds = res.legend.kinds.map((k) => k.kind)
  check(kinds.length === new Set(kinds).size, 'legend.kinds 应去重')
  checkEq(kinds.length, 10, 'legend.kinds 数量（hall-demo 有 10 种 kind）')
  checkEq(res.legend.kinds.find((k) => k.kind === 'chair')?.color, '#D9C08A', 'legend.kinds chair 颜色')
  pass(`图例：房间 ${res.legend.rooms.length} / kind ${kinds.length} 种（去重）`)

  // ── 2. preview 变体：labels / gridLines / scale ────────────────────────────
  const noLabelsOut = OUT('preview-nolabels.png')
  const resNoLabels = await renderScenePreviewStage({ spec: SPEC, out: noLabelsOut, labels: false }, env)
  check(fs.existsSync(noLabelsOut), 'labels=false 应写出 PNG')
  checkEq(resNoLabels.width, res.width, 'labels=false 宽度不变')
  check(fs.readFileSync(noLabelsOut).compare(fs.readFileSync(mainOut)) !== 0, 'labels=false 应改变像素（标签消失）')
  decode(noLabelsOut)
  pass('labels=false：可解码、尺寸不变、与 labels=true 像素不同')

  const gridOffOut = OUT('preview-grid-off.png')
  const resGridOff = await renderScenePreviewStage({ spec: SPEC_PATH, out: gridOffOut, labels: true, gridLines: false }, env)
  checkEq(resGridOff.width, expectW, 'gridLines=false 宽度不变')
  decode(gridOffOut)
  pass('gridLines=false：渲染成功且尺寸不变')

  const scaleOut = OUT('preview-scale50.png')
  const resScale50 = await renderScenePreviewStage({ spec: SPEC, out: scaleOut, scale: 50 }, env)
  checkEq(resScale50.width, Math.round(SPEC.bounds.width * 50) + PADDING * 2, 'scale=50 宽度')
  checkEq(resScale50.height, Math.round(SPEC.bounds.depth * 50) + PADDING * 2, 'scale=50 高度')
  const img50 = decode(scaleOut)
  checkEq(img50.width, resScale50.width, 'scale=50 解码宽度')
  pass(`scale=50：${resScale50.width}×${resScale50.height}，可解码`)

  const scaleOut160 = OUT('preview-scale160.png')
  const resScale160 = await renderScenePreviewStage({ spec: SPEC, out: scaleOut160, scale: 160, labels: true }, env)
  checkEq(resScale160.width, Math.round(SPEC.bounds.width * 160) + PADDING * 2, 'scale=160 宽度')
  checkEq(resScale160.height, Math.round(SPEC.bounds.depth * 160) + PADDING * 2, 'scale=160 高度')
  check(resScale160.width > resScale50.width, '尺寸应随 scale 变大')
  decode(scaleOut160)
  pass(`scale=160：${resScale160.width}×${resScale160.height}，可解码且随 scale 变大`)

  // 网格可见性：把内室格子删到只剩 2 格 → 露出未铺房间的空地，网格线有/无应不同
  const partial = JSON.parse(JSON.stringify(SPEC))
  partial.rooms[1].cells = partial.rooms[1].cells.slice(0, 2)
  const gridOnOut = OUT('preview-partial-grid-on.png')
  const gridOffOut2 = OUT('preview-partial-grid-off.png')
  await renderScenePreviewStage({ spec: partial, out: gridOnOut, labels: false }, env)
  await renderScenePreviewStage({ spec: partial, out: gridOffOut2, labels: false, gridLines: false }, env)
  const gridDiff = countPixelDiff(decode(gridOnOut), decode(gridOffOut2))
  check(gridDiff > 1000, `gridLines 开/关应有可见差异，实际只差 ${gridDiff} 像素`)
  pass(`网格可见性：gridLines 开/关差 ${gridDiff} 像素`)

  // 默认输出路径 = <工作区>/_work/scene-preview.png
  const resDefault = await renderScenePreviewStage({ spec: SPEC, scale: 40 }, env)
  const wantDefault = path.join(PLUGIN_DIR, '_work', 'scene-preview.png')
  checkEq(path.resolve(resDefault.out), wantDefault, '默认 out 路径')
  check(fs.existsSync(wantDefault), '默认 out 文件应存在')
  decode(wantDefault)
  pass(`默认输出路径：${wantDefault}`)

  // ── 3. qx-plan：placement 与 spec 一致 + plan.md 关键词 ───────────────────
  const qxBothDir = OUT('qx-both')
  const plan = await emitQianxingPlanStage({ spec: SPEC_PATH, outDir: qxBothDir }, env)
  checkEq(path.resolve(plan.outDir), path.resolve(qxBothDir), 'qx-plan.outDir 应为绝对目录')
  checkEq(plan.placement.length, SPEC.objects.length, 'placement 条数 = spec 物件数')
  checkEq(plan.placement.length, 16, 'placement 条数 = 16')
  const specIds = SPEC.objects.map((o) => o.id).sort()
  checkEq(plan.placement.map((p) => p.id).sort().join(','), specIds.join(','), 'placement id 集合')
  for (const item of plan.placement) {
    const src = SPEC.objects.find((o) => o.id === item.id)
    check(src, `placement ${item.id} 找不到对应 spec 物件`)
    checkEq(item.kind, src.kind, `${item.id}.kind`)
    check(Math.abs(item.x - src.pos[0]) <= 0.001, `${item.id}.x 偏差过大（${item.x} vs ${src.pos[0]}）`)
    check(Math.abs(item.z - src.pos[2]) <= 0.001, `${item.id}.z 偏差过大（${item.z} vs ${src.pos[2]}）`)
    checkEq(item.size.width, src.size[0], `${item.id}.size.width`)
    checkEq(item.size.height, src.size[1], `${item.id}.size.height`)
    checkEq(item.size.depth, src.size[2], `${item.id}.size.depth`)
    checkEq(item.rotYDeg, src.rotYDeg, `${item.id}.rotYDeg`)
    checkEq(item.color, src.color.toUpperCase(), `${item.id}.color`)
    check(typeof item.hint === 'string' && item.hint.length > 0, `${item.id}.hint 不能为空`)
    check(/「.+」/.test(item.hint), `${item.id}.hint 应带房间名`)
    check(/贴墙|居中|地毯/.test(item.hint), `${item.id}.hint 应是 贴墙/居中/地毯 建议：${item.hint}`)
  }
  check(plan.placement.some((p) => p.hint.includes('地毯')), '应有地毯/放地毯上的 hint')
  check(plan.placement.some((p) => p.hint.includes('贴墙')), '应有贴墙的 hint')
  check(plan.placement.some((p) => p.hint.includes('居中')), '应有居中的 hint')
  pass('placement：16 条、id/坐标/尺寸/朝向/颜色与 spec 一致、hint 语义齐全')

  checkEq(path.resolve(plan.placementPath), path.resolve(qxBothDir, 'placement.json'), 'placementPath 指向 outDir/placement.json')
  checkEq(path.resolve(plan.planPath), path.resolve(qxBothDir, 'plan.md'), 'planPath 指向 outDir/plan.md')
  check(fs.existsSync(plan.placementPath), 'placement.json 应存在')
  check(fs.existsSync(plan.planPath), 'plan.md 应存在')
  const placementDoc = JSON.parse(fs.readFileSync(plan.placementPath, 'utf8'))
  checkEq(placementDoc.version, 1, 'placement.json.version')
  checkEq(placementDoc.unit, 'm', 'placement.json.unit')
  checkEq(placementDoc.metersPerCell, 0.5, 'placement.json.metersPerCell')
  checkEq(placementDoc.placement.length, 16, 'placement.json.placement 条数')
  checkEq(placementDoc.placement.map((p) => p.id).sort().join(','), specIds.join(','), 'placement.json id 集合')
  pass('placement.json 可解析：version/unit/metersPerCell/16 条')

  const md = fs.readFileSync(plan.planPath, 'utf8')
  const keywords = [
    '千星奇域 UGC 工具', 'GIA', 'Blender', 'entitlement', 'entitlement_required', 'placement',
    '渊星工具箱', '插件库', 'v1.2.6', 'module_id', 'host_kind', 'scene_parse_plan', 'scene_build_blender',
    '已知边界', '自检', '1 格 = 0.5 m', '①', '④',
  ]
  for (const kw of keywords) check(md.includes(kw), `plan.md 缺关键词「${kw}」`)
  const tableRows = md.split('\n').filter((line) => line.startsWith('| ') && line.includes('|'))
  check(tableRows.length >= 18, `plan.md 摆放表应有 ≥18 行（表头+16），实得 ${tableRows.length}`)
  check(Array.isArray(plan.notes) && plan.notes.length >= 4, 'notes 应是非空数组')
  check(plan.notes.some((note) => note.includes('placement')), 'notes 应提到 placement')
  check(plan.notes.some((note) => note.includes('entitlement_required')), 'notes 应提到 entitlement_required')
  pass(`plan.md：${md.length} 字符，关键词 ${keywords.length} 个齐全，摆放表 ${tableRows.length} 行`)

  // ── 4. qx-plan format=json / format=md ─────────────────────────────────────
  const qxJsonDir = OUT('qx-json')
  const planJson = await emitQianxingPlanStage({ spec: SPEC, outDir: qxJsonDir, format: 'json' }, env)
  checkEq(planJson.placement.length, 16, 'format=json placement 条数')
  check(fs.existsSync(path.join(qxJsonDir, 'placement.json')), 'format=json 应写 placement.json')
  check(!fs.existsSync(path.join(qxJsonDir, 'plan.md')), 'format=json 不应写 plan.md')
  checkEq(planJson.planPath, undefined, 'format=json 不应返回 planPath')
  pass('format=json：只写 placement.json，不写 plan.md')

  const qxMdDir = OUT('qx-md')
  const planMd = await emitQianxingPlanStage({ spec: SPEC, outDir: qxMdDir, format: 'md' }, env)
  checkEq(planMd.placement.length, 16, 'format=md placement 条数（数据仍返回）')
  check(fs.existsSync(path.join(qxMdDir, 'plan.md')), 'format=md 应写 plan.md')
  check(!fs.existsSync(path.join(qxMdDir, 'placement.json')), 'format=md 不应写 placement.json')
  checkEq(planMd.placementPath, undefined, 'format=md 不应返回 placementPath')
  pass('format=md：只写 plan.md，不写 placement.json')

  // ── 5. 错误路径 ────────────────────────────────────────────────────────────
  await expectCode('E_ARGS', () => renderScenePreviewStage({}, env), 'preview 缺 spec')
  await expectCode('E_ARGS', () => renderScenePreviewStage({ spec: SPEC, scale: 0 }, env), 'preview scale=0')
  await expectCode('E_ARGS', () => renderScenePreviewStage({ spec: SPEC, scale: '100' }, env), 'preview scale 非数字')

  const badKind = JSON.parse(JSON.stringify(SPEC))
  badKind.objects[0].kind = 'spaceship'
  const kindErr = await expectCode('E_SPEC_INVALID', () => renderScenePreviewStage({ spec: badKind }, env), 'preview objects[0].kind 非法')
  checkEq(kindErr.detail?.check?.id, 'scene.objects[0]', 'E_SPEC_INVALID 应带第一处失败 check')
  await expectCode(
    'E_PATH',
    () => renderScenePreviewStage({ spec: 'examples/hall-demo.spec.json', out: 'examples/hall-demo.spec.json' }, env),
    'preview out 覆盖输入',
  )

  await expectCode('E_ARGS', () => emitQianxingPlanStage({}, env), 'qx-plan 缺 spec')
  await expectCode('E_ARGS', () => emitQianxingPlanStage({ spec: SPEC }, env), 'qx-plan 缺 outDir')
  await expectCode('E_ARGS', () => emitQianxingPlanStage({ spec: SPEC, outDir: OUT('qx-bad-format'), format: 'pdf' }, env), 'qx-plan format 非法')
  await expectCode('E_SPEC_INVALID', () => emitQianxingPlanStage({ spec: badKind, outDir: OUT('qx-bad-kind') }, env), 'qx-plan 非法 kind')
  const wallBad = JSON.parse(JSON.stringify(SPEC))
  wallBad.walls[0].to = wallBad.walls[0].from.slice() // 零长度墙 → 校验失败
  await expectCode('E_SPEC_INVALID', () => emitQianxingPlanStage({ spec: wallBad, outDir: OUT('qx-bad-wall') }, env), 'qx-plan 零长度墙')

  // outDir 里的 placement.json 正好是输入 spec 文件 → 写 placement 会覆盖输入 → E_PATH
  const overwriteDir = OUT('qx-overwrite')
  fs.mkdirSync(overwriteDir, { recursive: true })
  const fakeSpecPath = path.join(overwriteDir, 'placement.json')
  fs.writeFileSync(fakeSpecPath, SPEC_TEXT)
  await expectCode('E_PATH', () => emitQianxingPlanStage({ spec: fakeSpecPath, outDir: overwriteDir }, env), 'qx-plan placement 覆盖输入')

  // ── 6. 输入未被改写 ────────────────────────────────────────────────────────
  checkEq(fs.readFileSync(SPEC_PATH, 'utf8'), SPEC_TEXT, '示例 spec 不应被任何阶段改写')
  pass('输入 spec 未被改写（只读契约）')

  console.log(`\nSELF-PREVIEW OK（${passed} 项检查全部通过；产物：${WORK_DIR}）`)
}

main().catch((err) => {
  console.error('\nSELF-PREVIEW FAILED：', err?.stack || err)
  process.exit(1)
})
