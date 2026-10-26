#!/usr/bin/env node
// S1 自检：从零生成演示设计图（A/B）→ 解析 → 与 ground-truth 逐字段对拍。
//
// 覆盖：
//   1. 生成：两张演示设计图 + 图例 + ground-truth（examples/design-demo*.png/legend/ground-truth）
//   2. 解析 A/B：房间数 / 房间 cells 集合 / 墙数（含门位置）/ 物件 kind+pos+size+rot / 门数 全部一致
//   3. legend 两种输入形态（文件路径 / 内联对象）+ 工具参数覆盖 + 旁挂图例
//   4. 未分类颜色：warnings 非空、stats.unassigned>0、report.ok 仍为 true
//   5. 错误路径：缺 design → E_ARGS；坏 PNG → E_SPEC_INVALID；out/previewOut==输入 → E_PATH；网格不符 → E_SPEC_INVALID
//   6. 端到端：parse 写出 spec → 回读 → validateSceneSpec 通过；previewOut PNG 可解码回验
//
// 通过时打印 "SELF-PARSE OK（N 项断言全部通过）"；失败打印明细并以退出码 1 结束。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parsePlanDesign } from '../src/stages/parse-plan.js'
import { decodePng } from '../src/lib/png.js'
import { validateSceneSpec } from '../src/scene-spec.js'
import { readJsonFile } from '../src/paths.js'
import {
  DEMO_GRID,
  demoAPlan,
  demoBPlan,
  generateDemoPlans,
  unknownColorVariant,
} from './fixtures/make-demo-plan.mjs'

const PLUGIN_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const EXAMPLES = path.join(PLUGIN_DIR, 'examples')
const WORK = path.join(PLUGIN_DIR, '_work', 'self-parse')
const env = { root: PLUGIN_DIR, config: {}, signal: null }

const A_PNG = path.join(EXAMPLES, 'design-demo.png')
const A_LEGEND = path.join(EXAMPLES, 'design-demo.legend.json')
const A_TRUTH = path.join(EXAMPLES, 'design-demo.ground-truth.json')
const B_PNG = path.join(EXAMPLES, 'design-demo-b.png')
const B_LEGEND = path.join(EXAMPLES, 'design-demo-b.legend.json')
const B_TRUTH = path.join(EXAMPLES, 'design-demo-b.ground-truth.json')

let assertions = 0
let currentSection = ''
const failures = []
const sectionStats = new Map() // section → { assertions, failures }

function beginSection(name) {
  currentSection = name
  if (!sectionStats.has(name)) sectionStats.set(name, { assertions: 0, failures: 0 })
  console.log(`\n[${name}]`)
}

function tally(pass) {
  assertions++
  const stats = sectionStats.get(currentSection)
  stats.assertions++
  if (!pass) stats.failures++
  return pass
}

/** 布尔断言。 */
function ok(condition, label) {
  if (!tally(!!condition)) failures.push(label)
}

/** 严格相等断言（对象用 JSON 比较请先自己签名）。 */
function eq(actual, expected, label) {
  if (!tally(Object.is(actual, expected))) {
    failures.push(`${label}: 期望 ${JSON.stringify(expected)}，实得 ${JSON.stringify(actual)}`)
  }
}

/** 浮点断言（默认容差 ±0.01 米，符合 SceneSpec 的 3 位小数口径）。 */
function close(actual, expected, epsilon, label) {
  const pass = typeof actual === 'number' && Number.isFinite(actual) && Math.abs(actual - expected) <= epsilon
  if (!tally(pass)) failures.push(`${label}: 期望 ${expected}±${epsilon}，实得 ${actual}`)
}

/** 断言 fn 抛出带指定错误码的 ArtError（stage 直调看 err.code；经工具层时文本里含 [CODE]）。 */
async function expectCode(fn, code, label) {
  try {
    await fn()
    tally(false)
    failures.push(`${label}: 未抛错，期望 ${code}`)
  } catch (err) {
    const text = String(err?.message ?? err)
    const hasCode = err?.code === code || text.includes(`[${code}]`)
    if (!tally(hasCode)) failures.push(`${label}: 期望 ${code}，实得 code=${err?.code} / ${text.slice(0, 240)}`)
  }
}

// ── ground-truth 对拍辅助 ───────────────────────────────────────────────────

const cellSignature = (cells) => cells.map(([r, c]) => `${r},${c}`).join(';')

const round3 = (value) => {
  const r = Math.round(value * 1000) / 1000
  return Object.is(r, -0) ? 0 : r
}

function wallKey(wall) {
  const [fx, fz] = wall.from
  const [tx, tz] = wall.to
  return `${round3(fx).toFixed(3)},${round3(fz).toFixed(3)}>${round3(tx).toFixed(3)},${round3(tz).toFixed(3)}`
}

/** 排序 + 签名的墙列表（与输出顺序无关的对拍口径）。 */
function canonicalWalls(walls) {
  return walls
    .map((wall) => ({
      key: wallKey(wall),
      height: wall.height,
      thickness: wall.thickness,
      openings: JSON.stringify(wall.openings ?? []),
      door: (wall.openings ?? []).length > 0,
    }))
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
}

function doorSignature(walls) {
  return walls
    .filter((wall) => wall.door)
    .map((wall) => `${wall.key}|${wall.openings}`)
    .sort()
    .join(';')
}

function objectSortKey(object) {
  return `${round3(object.pos[0]).toFixed(3)},${round3(object.pos[2]).toFixed(3)},${object.kind}`
}

/**
 * 逐字段对拍：version/unit/name/bounds/grid/rooms(含 cells 集合)/walls(含门位置)/objects(kind,pos,size,rot,color)/门数。
 * @param {string} label
 * @param {object} spec 解析产物（已规范化）
 * @param {object} truth ground-truth spec
 */
function comparePlan(label, spec, truth) {
  eq(spec.version, truth.version, `${label}.version`)
  eq(spec.unit, truth.unit, `${label}.unit`)
  eq(spec.name, truth.name, `${label}.name`)
  close(spec.bounds.width, truth.bounds.width, 1e-6, `${label}.bounds.width`)
  close(spec.bounds.depth, truth.bounds.depth, 1e-6, `${label}.bounds.depth`)
  eq(spec.grid.rows, truth.grid.rows, `${label}.grid.rows`)
  eq(spec.grid.cols, truth.grid.cols, `${label}.grid.cols`)
  close(spec.grid.cell, truth.grid.cell, 1e-6, `${label}.grid.cell`)

  // 房间：数量 + 每个房间 id/name/color/cells 集合（顺序无关）
  eq(spec.rooms.length, truth.rooms.length, `${label}.rooms.length`)
  const gotRooms = [...spec.rooms].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
  const truthRooms = [...truth.rooms].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
  truthRooms.forEach((truthRoom, index) => {
    const gotRoom = gotRooms[index]
    if (!gotRoom) {
      tally(false)
      failures.push(`${label}.rooms[${index}] 缺失（期望「${truthRoom.name}」）`)
      return
    }
    eq(gotRoom.id, truthRoom.id, `${label}.rooms[${index}].id`)
    eq(gotRoom.name, truthRoom.name, `${label}.rooms[${index}].name`)
    eq(gotRoom.color, truthRoom.color, `${label}.rooms[${index}].color`)
    eq(cellSignature([...gotRoom.cells].sort((a, b) => a[0] - b[0] || a[1] - b[1])), cellSignature(truthRoom.cells), `${label}.rooms[${index}].cells`)
  })

  // 墙：数量 + 每条 from/to 精确、height/thickness、门洞；门位置集合单独对拍
  eq(spec.walls.length, truth.walls.length, `${label}.walls.length`)
  const gotWalls = canonicalWalls(spec.walls)
  const truthWalls = canonicalWalls(truth.walls)
  truthWalls.forEach((truthWall, index) => {
    const gotWall = gotWalls[index]
    if (!gotWall) {
      tally(false)
      failures.push(`${label}.walls[${index}] 缺失（期望 ${truthWall.key}）`)
      return
    }
    eq(gotWall.key, truthWall.key, `${label}.walls[${index}].from-to`)
    close(gotWall.height, truthWall.height, 1e-6, `${label}.walls[${index}].height`)
    close(gotWall.thickness, truthWall.thickness, 1e-6, `${label}.walls[${index}].thickness`)
    eq(gotWall.openings, truthWall.openings, `${label}.walls[${index}].openings`)
  })
  eq(doorSignature(gotWalls), doorSignature(truthWalls), `${label}.doors(位置集合)`)

  // 物件：数量 + kind/pos/size/rot/color（pos/size 容差 ±0.01m）
  eq(spec.objects.length, truth.objects.length, `${label}.objects.length`)
  const gotObjects = [...spec.objects].sort((a, b) => (objectSortKey(a) < objectSortKey(b) ? -1 : objectSortKey(a) > objectSortKey(b) ? 1 : 0))
  const truthObjects = [...truth.objects].sort((a, b) => (objectSortKey(a) < objectSortKey(b) ? -1 : objectSortKey(a) > objectSortKey(b) ? 1 : 0))
  truthObjects.forEach((truthObject, index) => {
    const gotObject = gotObjects[index]
    if (!gotObject) {
      tally(false)
      failures.push(`${label}.objects[${index}] 缺失（期望 ${truthObject.kind} ${objectSortKey(truthObject)}）`)
      return
    }
    eq(gotObject.kind, truthObject.kind, `${label}.objects[${index}].kind`)
    close(gotObject.pos[0], truthObject.pos[0], 0.01, `${label}.objects[${index}].pos.x`)
    close(gotObject.pos[1], truthObject.pos[1], 0.01, `${label}.objects[${index}].pos.y`)
    close(gotObject.pos[2], truthObject.pos[2], 0.01, `${label}.objects[${index}].pos.z`)
    close(gotObject.size[0], truthObject.size[0], 0.01, `${label}.objects[${index}].size.w`)
    close(gotObject.size[1], truthObject.size[1], 0.01, `${label}.objects[${index}].size.h`)
    close(gotObject.size[2], truthObject.size[2], 0.01, `${label}.objects[${index}].size.d`)
    eq(gotObject.rotYDeg, truthObject.rotYDeg, `${label}.objects[${index}].rotYDeg`)
    eq(gotObject.color, truthObject.color, `${label}.objects[${index}].color`)
  })
}

/** stats 与 ground-truth 对拍。 */
function compareStats(label, stats, truth) {
  eq(stats.rows, truth.grid.rows, `${label}.stats.rows`)
  eq(stats.cols, truth.grid.cols, `${label}.stats.cols`)
  eq(stats.cellPx, DEMO_GRID.cellPx, `${label}.stats.cellPx`)
  close(stats.cellMeters, truth.grid.cell, 1e-6, `${label}.stats.cellMeters`)
  eq(stats.rooms, truth.rooms.length, `${label}.stats.rooms`)
  eq(stats.walls, truth.walls.length, `${label}.stats.walls`)
  eq(stats.doors, truth.walls.reduce((n, wall) => n + (wall.openings?.length ?? 0), 0), `${label}.stats.doors`)
  eq(stats.objects, truth.objects.length, `${label}.stats.objects`)
  eq(stats.unassigned, 0, `${label}.stats.unassigned`)
}

/** 校验返回的 report 是 ok 的 ValidationReport。 */
function compareReport(label, report) {
  ok(report && typeof report === 'object', `${label}.report 存在`)
  eq(report?.version, 1, `${label}.report.version`)
  eq(report?.ok, true, `${label}.report.ok`)
  ok(Array.isArray(report?.checks) && report.checks.length >= 10, `${label}.report.checks 数量 ≥10（实际 ${report?.checks?.length}）`)
}

/** 断言返回的展示路径能解析回期望的绝对路径并已写盘。 */
function checkWritten(label, displayPathValue, expectedAbs) {
  ok(typeof displayPathValue === 'string' && displayPathValue.length > 0, `${label} 路径已返回`)
  if (typeof displayPathValue === 'string') {
    eq(path.resolve(env.root, displayPathValue), expectedAbs, `${label} 展示路径可还原`)
  }
  ok(fs.existsSync(expectedAbs), `${label} 文件已写出：${path.basename(expectedAbs)}`)
}

// ── 主流程 ─────────────────────────────────────────────────────────────────

async function main() {
  fs.rmSync(WORK, { recursive: true, force: true })
  fs.mkdirSync(WORK, { recursive: true })

  // ── 1. 从零生成演示设计图（examples/*）──────────────────────────────────
  beginSection('生成演示设计图')
  const written = generateDemoPlans(EXAMPLES)
  eq(written.length, 2, '生成两张演示设计图')
  const planA = demoAPlan()
  const planB = demoBPlan()
  for (const [label, item] of [['A', written[0]], ['B', written[1]]]) {
    ok(fs.existsSync(item.png), `${label} PNG 已生成`)
    ok(fs.existsSync(item.legend), `${label} legend 已生成`)
    ok(fs.existsSync(item.groundTruth), `${label} ground-truth 已生成`)
  }
  for (const [label, pngPath, plan] of [['A', A_PNG, planA], ['B', B_PNG, planB]]) {
    const image = decodePng(fs.readFileSync(pngPath))
    eq(image.width, plan.cols * DEMO_GRID.cellPx + DEMO_GRID.margin * 2, `${label} PNG 宽度 = cols*cellPx+2*margin`)
    eq(image.height, plan.rows * DEMO_GRID.cellPx + DEMO_GRID.margin * 2, `${label} PNG 高度 = rows*cellPx+2*margin`)
  }
  const truthA = readJsonFile(A_TRUTH, 'A ground-truth')
  const truthB = readJsonFile(B_TRUTH, 'B ground-truth')
  eq(truthA.rooms.length, 1, 'A ground-truth 房间数 = 1')
  eq(truthB.rooms.length, 2, 'B ground-truth 房间数 = 2')
  eq(truthA.walls.length, 28, 'A ground-truth 墙数 = 28（8×6 外框 28 条格边）')
  eq(truthB.walls.length, 66, 'B ground-truth 墙数 = 66（外框 56 + 隔墙 10）')
  eq(
    truthA.walls.reduce((n, wall) => n + (wall.openings?.length ?? 0), 0) +
      truthB.walls.reduce((n, wall) => n + (wall.openings?.length ?? 0), 0),
    3,
    '两张图共 3 个门洞',
  )
  ok(
    truthB.objects.some((object) => object.size[0] > planB.metersPerCell * 0.7 + 1e-9 || object.size[2] > planB.metersPerCell * 0.7 + 1e-9),
    'B 至少 1 件家具跨 2 格（size 超过单格色块）',
  )

  // ── 2. 解析 A（legend 走文件路径）+ 逐字段对拍 ────────────────────────
  beginSection('解析 A（单房间 8×6）')
  const aOutPath = path.join(WORK, 'a.spec.json')
  const aPreviewPath = path.join(WORK, 'a.preview.png')
  const resA = await parsePlanDesign({ design: A_PNG, legend: A_LEGEND, out: aOutPath, previewOut: aPreviewPath }, env)
  compareReport('A', resA.report)
  comparePlan('A', resA.spec, truthA)
  compareStats('A', resA.stats, truthA)
  eq(resA.warnings.length, 0, 'A warnings 为空（没有未分类颜色）')
  eq(resA.stats.rooms, 1, 'A stats.rooms = 1')
  eq(resA.stats.walls, 28, 'A stats.walls = 28')
  eq(resA.stats.doors, 1, 'A stats.doors = 1')
  eq(resA.stats.objects, 4, 'A stats.objects = 4')
  eq(resA.spec.name, 'demo-a', 'A spec.name 取 legend.name')
  checkWritten('A.out', resA.out, aOutPath)
  checkWritten('A.previewOut', resA.previewOut, aPreviewPath)

  // ── 3. 解析 B（legend 走内联对象）+ 逐字段对拍 ────────────────────────
  beginSection('解析 B（双房间 16×12）')
  const resB = await parsePlanDesign({ design: B_PNG, legend: readJsonFile(B_LEGEND, 'B legend') }, env)
  compareReport('B', resB.report)
  comparePlan('B', resB.spec, truthB)
  compareStats('B', resB.stats, truthB)
  eq(resB.warnings.length, 0, 'B warnings 为空（没有未分类颜色）')
  eq(resB.stats.rooms, 2, 'B stats.rooms = 2')
  eq(resB.stats.walls, 66, 'B stats.walls = 66')
  eq(resB.stats.doors, 2, 'B stats.doors = 2')
  eq(resB.stats.objects, 9, 'B stats.objects = 9')
  eq(resB.spec.rooms.map((room) => room.name).join(','), '书房,画廊', 'B 房间名按首个格排序')
  // 跨 2 格家具：书架（竖 2 格）/ 书桌（横 2 格）
  const shelf = resB.spec.objects.find((object) => object.kind === 'shelf')
  const desk = resB.spec.objects.find((object) => object.kind === 'desk')
  close(shelf?.size[2], 0.7, 0.01, 'B 书架跨 2 格 → size.d = 2*0.5*0.7')
  close(desk?.size[0], 0.7, 0.01, 'B 书桌跨 2 格 → size.w = 2*0.5*0.7')
  eq(shelf?.size[1], 1.8, 'B 书架高度用 kind 默认（1.8）')
  eq(resB.spec.objects.find((object) => object.kind === 'statue')?.size[1], 1.8, 'B 雕像高度用 legend.heightM 覆盖（1.8）')
  eq(resB.spec.objects.filter((object) => object.kind === 'crate').map((object) => object.color).join(','), '#A08E62,#A08E62', 'B 箱子颜色用 legend.color 覆盖')

  // ── 4. legend 入口形态 + 工具参数覆盖 + 旁挂图例 ─────────────────────
  beginSection('legend 入口与参数覆盖')
  const sidecar = await parsePlanDesign({ design: A_PNG }, env) // 旁挂 examples/design-demo.legend.json
  comparePlan('A-sidecar', sidecar.spec, truthA)
  eq(sidecar.warnings.length, 0, 'A-sidecar warnings 为空')

  const overridden = await parsePlanDesign(
    { design: A_PNG, legend: A_LEGEND, rows: 6, cols: 8, cellPx: 48, margin: 24, metersPerCell: 0.5 },
    env,
  )
  comparePlan('A-override', overridden.spec, truthA)
  compareStats('A-override', overridden.stats, truthA)

  const metersOverride = await parsePlanDesign({ design: A_PNG, legend: A_LEGEND, metersPerCell: 1 }, env)
  close(metersOverride.spec.bounds.width, 8, 1e-6, 'A metersPerCell=1 → bounds.width=8')
  close(metersOverride.spec.bounds.depth, 6, 1e-6, 'A metersPerCell=1 → bounds.depth=6')
  close(metersOverride.spec.grid.cell, 1, 1e-6, 'A metersPerCell=1 → grid.cell=1')
  close(metersOverride.stats.cellMeters, 1, 1e-6, 'A metersPerCell=1 → stats.cellMeters=1')
  close(metersOverride.spec.objects[0].pos[0], 6.5, 0.01, 'A metersPerCell=1 → 物件 x 坐标翻倍')
  eq(metersOverride.stats.rooms, 1, 'A 覆盖后房间数不变')

  // ── 5. 未分类颜色：warnings 非空 + unassigned > 0，但结构仍合法 ───────
  beginSection('未分类颜色（不静默吞）')
  const variant = unknownColorVariant()
  const variantPng = path.join(WORK, 'design-unknown.png')
  fs.writeFileSync(variantPng, variant.png)
  const resUnknown = await parsePlanDesign({ design: variantPng, legend: variant.legend }, env)
  eq(resUnknown.stats.unassigned, 1, '未知颜色格数 = 1')
  ok(resUnknown.warnings.length > 0, 'warnings 非空')
  ok(resUnknown.warnings.some((warning) => warning.includes('#FF00FF')), 'warnings 列出颜色 #FF00FF')
  ok(resUnknown.warnings.some((warning) => warning.includes('1 格')), 'warnings 列出格数')
  eq(resUnknown.report.ok, true, '有未分类颜色时 report.ok 仍为 true')
  eq(resUnknown.spec.rooms.length, 1, '未分类颜色不影响房间数')
  eq(resUnknown.spec.rooms[0].cells.length, 47, '未知颜色格不计入房间（48-1=47）')
  eq(resUnknown.stats.walls, 28, '未分类颜色不影响墙数')
  eq(resUnknown.stats.objects, 4, '未分类颜色不影响物件数')

  // ── 6. 错误路径 ─────────────────────────────────────────────────────
  beginSection('错误路径')
  await expectCode(() => parsePlanDesign({}, env), 'E_ARGS', '缺 design')
  await expectCode(() => parsePlanDesign({ design: '' }, env), 'E_ARGS', 'design 空串')
  await expectCode(() => parsePlanDesign({ design: variantPng }, env), 'E_ARGS', '缺 legend 且无旁挂文件')
  const badPng = path.join(WORK, 'bad.png')
  fs.writeFileSync(badPng, Buffer.from('this is definitely not a png file, just bytes', 'utf8'))
  await expectCode(() => parsePlanDesign({ design: badPng, legend: A_LEGEND }, env), 'E_SPEC_INVALID', '坏 PNG')
  await expectCode(() => parsePlanDesign({ design: A_PNG, legend: A_LEGEND, out: A_PNG }, env), 'E_PATH', 'out == design')
  await expectCode(() => parsePlanDesign({ design: A_PNG, legend: A_LEGEND, previewOut: A_LEGEND }, env), 'E_PATH', 'previewOut == legend 输入')
  await expectCode(
    () => parsePlanDesign({ design: A_PNG, legend: A_LEGEND, rows: 7 }, env),
    'E_SPEC_INVALID',
    'rows 与图尺寸不符',
  )
  await expectCode(
    () => parsePlanDesign({ design: A_PNG, legend: A_LEGEND, cellPx: 50 }, env),
    'E_SPEC_INVALID',
    'cellPx 与图尺寸不符',
  )
  await expectCode(() => parsePlanDesign({ design: A_PNG, legend: {} }, env), 'E_ARGS', 'legend 缺 roomColors')
  await expectCode(
    () => parsePlanDesign({ design: A_PNG, legend: { roomColors: { '#D9CDB4': { name: '客厅' } }, objectColors: { '#D9CDB4': { kind: 'table' } } } }, env),
    'E_ARGS',
    '颜色同时映射房间与家具（二义）',
  )

  // ── 7. 端到端：写出 → 回读 → validateSceneSpec；previewOut PNG 回验 ──
  beginSection('端到端（写盘 / 回读 / 预览回验）')
  const savedA = readJsonFile(aOutPath, '解析写出的 A spec')
  comparePlan('A-readback', savedA, truthA)
  const readbackReport = validateSceneSpec(savedA)
  eq(readbackReport.ok, true, '回读 spec validateSceneSpec ok')
  ok(Array.isArray(readbackReport.checks) && readbackReport.checks.length >= 10, `回读 spec checks 数量 ≥10（实际 ${readbackReport.checks?.length}）`)
  const savedB = await parsePlanDesign({ design: B_PNG, legend: B_LEGEND, out: path.join(WORK, 'b.spec.json') }, env)
  const rereadB = readJsonFile(path.join(WORK, 'b.spec.json'), '解析写出的 B spec')
  eq(validateSceneSpec(rereadB).ok, true, 'B 回读 spec validateSceneSpec ok')
  eq(rereadB.objects.length, savedB.spec.objects.length, 'B 回读物件数一致')

  // previewOut：真实可解码 PNG，画幅对应 bounds（含同一套网格像素比例）
  const preview = decodePng(fs.readFileSync(aPreviewPath))
  ok(preview.width > 100 && preview.height > 100, `预览 PNG 尺寸合理（${preview.width}×${preview.height}）`)
  const widthPerMeter = (preview.width - 32) / resA.spec.bounds.width
  const heightPerMeter = (preview.height - 32) / resA.spec.bounds.depth
  close(widthPerMeter, heightPerMeter, 0.5, '预览横竖向像素比例一致（同一 cellPx/metersPerCell）')
  close(preview.width / preview.height, 4 / 3, 0.06, '预览画幅比例 ≈ A 的 4m×3m')
  // 背景以外像素应足够多（房间/墙/家具都画了，不是空白图）
  let nonBackground = 0
  const bg = [preview.data[0], preview.data[1], preview.data[2]]
  for (let i = 0; i < preview.data.length; i += 4) {
    const diff = Math.abs(preview.data[i] - bg[0]) + Math.abs(preview.data[i + 1] - bg[1]) + Math.abs(preview.data[i + 2] - bg[2])
    if (diff > 30) nonBackground++
  }
  ok(nonBackground > 5000, `预览非背景像素足够多（${nonBackground}）`)

  // ── 汇总 ─────────────────────────────────────────────────────────────
  console.log('\n各节断言：')
  for (const [name, stats] of sectionStats) {
    console.log(`  ${stats.failures === 0 ? '✓' : '✗'} ${name}：${stats.assertions} 项${stats.failures ? `，${stats.failures} 项失败` : ''}`)
  }
  if (failures.length > 0) {
    console.error(`\nSELF-PARSE FAILED：${failures.length} 项断言失败（共 ${assertions} 项）`)
    for (const failure of failures.slice(0, 60)) console.error(`  ✗ ${failure}`)
    if (failures.length > 60) console.error(`  … 其余 ${failures.length - 60} 项省略`)
    process.exit(1)
  }
  console.log(`\nSELF-PARSE OK（${assertions} 项断言全部通过）`)
}

main().catch((err) => {
  console.error('\n自检运行器自身失败：', err)
  process.exit(2)
})
