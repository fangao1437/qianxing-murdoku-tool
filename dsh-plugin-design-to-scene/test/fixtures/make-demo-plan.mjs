#!/usr/bin/env node
// S1 演示设计图生成器：按 examples/DESIGN-FORMAT.md 画「网格平面设计图」PNG，
// 同步写 legend 图例 + ground-truth SceneSpec（解析器的对拍基准）。
//
//   A = 单房间 8×6 格（0.5 m/格；1 门；桌 / 椅 / 植物 / 地毯）
//   B = 双房间 16×12 格（0.5 m/格；2 门；书架 / 书桌 / 椅 / 灯 / 雕像 / 箱子×2 / 柱子×2，
//       其中书架、书桌跨 2 格；右下角留 void 区）
//
// 用法：node test/fixtures/make-demo-plan.mjs [--out=<目录>]（默认 <插件>/examples）
// 产出：examples/design-demo.{png,legend.json,ground-truth.json}
//       examples/design-demo-b.{png,legend.json,ground-truth.json}
// 自检脚本 test/self-parse.mjs 直接 import 这里的函数：从零生成 → 解析 → 对拍。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Canvas, hexToRgb } from '../../src/lib/png-write.js'
import { KIND_DEFAULTS } from '../../src/scene-spec.js'

/** 演示图固定网格参数（PNG 像素口径，与解析器默认值一致）。 */
export const DEMO_GRID = Object.freeze({ cellPx: 48, margin: 24 })

const WALL_COLOR = '#1F1A14' // 墙色（约定默认，与网格线同色，靠粗细区分）
const DOOR_COLOR = '#C06A1E' // 门色（约定默认）
const VOID_COLOR = '#FFFFFF' // 空白/不可用（约定默认）
const OBJECT_RATIO = 0.7 // 家具块默认占格宽比例（约定 §4）
const WALL_HEIGHT = 2.8 // ground-truth 墙高（SceneSpec 默认）
const WALL_THICKNESS = 0.15 // ground-truth 墙厚（SceneSpec 默认）
const DOOR_OPENING = Object.freeze({ u: 0.5, width: 0.9, height: 2.1, kind: 'door' })

const round3 = (value) => {
  const r = Math.round(value * 1000) / 1000
  return Object.is(r, -0) ? 0 : r
}

/** hex → Canvas 用的 [r,g,b,a]。 */
const rgba = (hex) => {
  const rgb = hexToRgb(hex)
  if (!rgb) throw new Error(`颜色非法：${hex}`)
  return [rgb[0], rgb[1], rgb[2], 255]
}

/** 1 基矩形格集合（含边界），行主序：cellsRect(1, rows, 1, cols)。 */
function cellsRect(rowFrom, rowTo, colFrom, colTo) {
  const cells = []
  for (let r = rowFrom; r <= rowTo; r++) for (let c = colFrom; c <= colTo; c++) cells.push([r, c])
  return cells
}

/** 网格外框四面墙（按 DESIGN-FORMAT.md §3 的格边口径：一条格边 = 一段墙）。 */
function perimeter(rows, cols) {
  const edges = []
  for (let c = 0; c < cols; c++) edges.push({ o: 'h', line: 0, index: c }) // 上
  for (let c = 0; c < cols; c++) edges.push({ o: 'h', line: rows, index: c }) // 下
  for (let r = 0; r < rows; r++) edges.push({ o: 'v', line: 0, index: r }) // 左
  for (let r = 0; r < rows; r++) edges.push({ o: 'v', line: cols, index: r }) // 右
  return edges
}

/** 统一墙面顺序（与解析器输出顺序一致：水平边按行线/列号，再垂直边按列线/行号）。 */
function sortWalls(edges) {
  return [...edges].sort((a, b) => {
    if (a.o !== b.o) return a.o === 'h' ? -1 : 1
    return a.line - b.line || a.index - b.index
  })
}

const edgeKey = (edge) => `${edge.o}:${edge.line}:${edge.index}`
const hEdge = (line, index) => ({ o: 'h', line, index })
const vEdge = (line, index) => ({ o: 'v', line, index })

// ── 绘制设计图 PNG ──────────────────────────────────────────────────────────

/**
 * 按设计计划画 PNG。
 * 设计计划（1 基格坐标）：
 *   { name, rows, cols, metersPerCell,
 *     rooms:   [{ name, fill, color?, cells:[[r,c],...] }],
 *     objects: [{ kind, color, cells:[[r,c],...], sizeCells?, heightM?, legendColor? }],
 *     walls:   [{ o:'h'|'v', line, index }],   // 0 基格线
 *     doors:   [{ o:'h'|'v', line, index }],   // 画 doorColor 覆盖的短线段
 *     extraCellColors?: [{ row, col, color }]  // 非图例颜色（未分类颜色用例）
 *   }
 */
function drawPlanPng(plan) {
  const { rows, cols } = plan
  const { cellPx, margin } = DEMO_GRID
  const canvas = new Canvas(cols * cellPx + margin * 2, rows * cellPx + margin * 2, rgba(VOID_COLOR))
  const fillCell = (row, col, color) => {
    const x0 = margin + (col - 1) * cellPx
    const y0 = margin + (row - 1) * cellPx
    canvas.fillRect(x0, y0, x0 + cellPx, y0 + cellPx, rgba(color))
  }

  // 1) 房间地板（整格填充）
  for (const room of plan.rooms) for (const [r, c] of room.cells) fillCell(r, c, room.fill)

  // 2) 未分类颜色块（自检用：不进 legend，解析后应进 warnings/unassigned）
  for (const extra of plan.extraCellColors ?? []) fillCell(extra.row, extra.col, extra.color)

  // 3) 网格线（#1F1A14，2px，含外框；DESIGN-FORMAT.md §1）
  const gridRgb = rgba(WALL_COLOR)
  for (let k = 0; k <= cols; k++) {
    const x = margin + k * cellPx
    canvas.fillRect(x - 1, margin, x + 1, margin + rows * cellPx, gridRgb)
  }
  for (let k = 0; k <= rows; k++) {
    const y = margin + k * cellPx
    canvas.fillRect(margin, y - 1, margin + cols * cellPx, y + 1, gridRgb)
  }

  // 4) 墙（4px 粗线，盖在网格线上：约定要求墙宽 ≥ 3px，靠粗细与 2px 网格线区分）
  for (const wall of plan.walls) {
    if (wall.o === 'h') {
      const y = margin + wall.line * cellPx
      const x0 = margin + wall.index * cellPx
      canvas.fillRect(x0, y - 2, x0 + cellPx, y + 2, rgba(WALL_COLOR))
    } else {
      const x = margin + wall.line * cellPx
      const y0 = margin + wall.index * cellPx
      canvas.fillRect(x - 2, y0, x + 2, y0 + cellPx, rgba(WALL_COLOR))
    }
  }

  // 5) 门（doorColor 短线段，长度 0.7 格 ≥ cellPx/2，画在墙上面；DESIGN-FORMAT.md §3）
  for (const door of plan.doors ?? []) {
    const half = Math.round(cellPx * 0.35)
    if (door.o === 'h') {
      const y = margin + door.line * cellPx
      const cx = margin + (door.index + 0.5) * cellPx
      canvas.fillRect(cx - half, y - 2, cx + half, y + 2, rgba(DOOR_COLOR))
    } else {
      const x = margin + door.line * cellPx
      const cy = margin + (door.index + 0.5) * cellPx
      canvas.fillRect(x - 2, cy - half, x + 2, cy + half, rgba(DOOR_COLOR))
    }
  }

  // 6) 家具色块（默认占格宽 70% 的居中矩形；sizeCells 覆盖比例；DESIGN-FORMAT.md §4）
  for (const object of plan.objects) {
    const ratio = Number.isFinite(object.sizeCells) ? object.sizeCells : OBJECT_RATIO
    const block = Math.max(3, Math.round(cellPx * ratio))
    for (const [r, c] of object.cells) {
      const cx = margin + (c - 1) * cellPx + cellPx / 2
      const cy = margin + (r - 1) * cellPx + cellPx / 2
      const x0 = Math.round(cx - block / 2)
      const y0 = Math.round(cy - block / 2)
      canvas.fillRect(x0, y0, x0 + block, y0 + block, rgba(object.color))
    }
  }

  return canvas.toPng()
}

// ── legend 图例 ─────────────────────────────────────────────────────────────

/** 从设计计划生成 legend（颜色 → 房间/家具的映射）。 */
function buildLegend(plan) {
  const { cellPx, margin } = DEMO_GRID
  const legend = {
    name: plan.name,
    cellPx,
    margin,
    rows: plan.rows,
    cols: plan.cols,
    metersPerCell: plan.metersPerCell,
    roomColors: {},
    objectColors: {},
    wallColor: WALL_COLOR,
    doorColor: DOOR_COLOR,
    voidColor: VOID_COLOR,
  }
  for (const room of plan.rooms) {
    const existing = legend.roomColors[room.fill]
    const entry = { name: room.name, ...(room.color ? { color: room.color } : {}) }
    if (existing) {
      if (JSON.stringify(existing) !== JSON.stringify(entry)) {
        throw new Error(`同一房间填充色 ${room.fill} 被映射到不同房间：${JSON.stringify(existing)} vs ${JSON.stringify(entry)}`)
      }
      continue
    }
    legend.roomColors[room.fill] = entry
  }
  for (const object of plan.objects) {
    const entry = {
      kind: object.kind,
      ...(Number.isFinite(object.sizeCells) ? { sizeCells: object.sizeCells } : {}),
      ...(Number.isFinite(object.heightM) ? { heightM: object.heightM } : {}),
      ...(object.legendColor ? { color: object.legendColor } : {}),
    }
    const existing = legend.objectColors[object.color]
    if (existing) {
      if (JSON.stringify(existing) !== JSON.stringify(entry)) {
        throw new Error(`同一家具色 ${object.color} 被映射到不同条目：${JSON.stringify(existing)} vs ${JSON.stringify(entry)}`)
      }
      continue
    }
    legend.objectColors[object.color] = entry
  }
  // 颜色表之间不允许撞色（解析器也会校验，这里提前在生成端拦住）
  const keys = new Set(Object.keys(legend.roomColors))
  if (keys.has(WALL_COLOR) || keys.has(DOOR_COLOR)) throw new Error('房间填充色不能与 wallColor/doorColor 相同')
  for (const color of Object.keys(legend.objectColors)) {
    if (keys.has(color)) throw new Error(`家具色 ${color} 与房间填充色重复，格中心色会二义`)
    if (color === WALL_COLOR || color === DOOR_COLOR) throw new Error(`家具色 ${color} 不能与 wallColor/doorColor 相同`)
  }
  return legend
}

// ── ground-truth SceneSpec ──────────────────────────────────────────────────

/**
 * 从设计计划独立推导 ground-truth SceneSpec（解析器逐字段对拍用）。
 * 房间/墙/物件口径与 DESIGN-FORMAT.md 一致；灯光/相机/环境不参与对拍，不写进 truth。
 */
function buildGroundTruth(plan) {
  const { rows, cols, metersPerCell: meters } = plan

  // 房间：同名合并（本演示没有同名），cells 1 基行主序
  const byName = new Map()
  for (const room of plan.rooms) {
    const cells = [...room.cells].sort((a, b) => a[0] - b[0] || a[1] - b[1])
    const existing = byName.get(room.name)
    if (existing) {
      if (existing.color !== (room.color ?? room.fill)) throw new Error(`同名房间「${room.name}」颜色不一致`)
      existing.cells.push(...cells)
      existing.cells.sort((a, b) => a[0] - b[0] || a[1] - b[1])
    } else {
      byName.set(room.name, { name: room.name, color: room.color ?? room.fill, cells })
    }
  }
  const rooms = [...byName.values()]
    .sort((a, b) => a.cells[0][0] - b.cells[0][0] || a.cells[0][1] - b.cells[0][1] || a.name.localeCompare(b.name))
    .map((room, i) => ({ id: `r${i + 1}`, name: room.name, color: room.color, cells: room.cells }))

  // 墙：一条格边 = 一段墙；门位置仍记墙 + openings
  const doorKeys = new Set((plan.doors ?? []).map(edgeKey))
  const walls = sortWalls(plan.walls).map((edge) => {
    const from = edge.o === 'h' ? [round3(edge.index * meters), round3(edge.line * meters)] : [round3(edge.line * meters), round3(edge.index * meters)]
    const to = edge.o === 'h' ? [round3((edge.index + 1) * meters), round3(edge.line * meters)] : [round3(edge.line * meters), round3((edge.index + 1) * meters)]
    return {
      from,
      to,
      height: WALL_HEIGHT,
      thickness: WALL_THICKNESS,
      openings: doorKeys.has(edgeKey(edge)) ? [{ ...DOOR_OPENING }] : [],
    }
  })

  // 物件：同色 4 邻接合并（同一 object 定义里的 cells 就是一个物件）；按首个格排序后编号 o1..oN
  const drafts = plan.objects.map((object) => {
    const cells = [...object.cells].sort((a, b) => a[0] - b[0] || a[1] - b[1])
    const rowFrom = Math.min(...cells.map(([r]) => r))
    const rowTo = Math.max(...cells.map(([r]) => r))
    const colFrom = Math.min(...cells.map(([, c]) => c))
    const colTo = Math.max(...cells.map(([, c]) => c))
    const spanR = rowTo - rowFrom + 1
    const spanC = colTo - colFrom + 1
    if (spanR * spanC !== cells.length) throw new Error(`演示家具 ${object.kind} 的 cells 不是矩形`)
    const ratio = Number.isFinite(object.sizeCells) ? object.sizeCells : OBJECT_RATIO
    const kindDefaults = KIND_DEFAULTS[object.kind]
    if (!kindDefaults) throw new Error(`演示家具 kind 非法：${object.kind}`)
    return {
      kind: object.kind,
      pos: [round3((colFrom - 1 + spanC / 2) * meters), 0, round3((rowFrom - 1 + spanR / 2) * meters)],
      rotYDeg: 0,
      size: [
        round3(spanC * meters * ratio),
        round3(Number.isFinite(object.heightM) ? object.heightM : kindDefaults.size[1]),
        round3(spanR * meters * ratio),
      ],
      color: object.legendColor ?? kindDefaults.color,
      rowFrom,
      colFrom,
    }
  })
  drafts.sort((a, b) => a.rowFrom - b.rowFrom || a.colFrom - b.colFrom)
  const objects = drafts.map((draft, i) => ({
    id: `o${i + 1}`,
    kind: draft.kind,
    pos: draft.pos,
    rotYDeg: draft.rotYDeg,
    size: draft.size,
    color: draft.color,
  }))

  return {
    version: 1,
    name: plan.name,
    unit: 'm',
    bounds: { width: round3(cols * meters), depth: round3(rows * meters) },
    grid: { cell: round3(meters), rows, cols },
    rooms,
    walls,
    objects,
  }
}

/**
 * 生成一套演示资产：PNG + legend + ground-truth。
 * @returns {{ png:Buffer, legend:object, groundTruth:object }}
 */
export function buildDemoPlan(plan) {
  return { png: drawPlanPng(plan), legend: buildLegend(plan), groundTruth: buildGroundTruth(plan) }
}

// ── 两张演示设计图 ─────────────────────────────────────────────────────────

/** A：单房间 8×6 格（0.5 m/格），1 门，桌 + 椅 + 植物 + 地毯。 */
export function demoAPlan() {
  const rows = 6
  const cols = 8
  return {
    name: 'demo-a',
    rows,
    cols,
    metersPerCell: 0.5,
    rooms: [{ name: '客厅', fill: '#D9CDB4', cells: cellsRect(1, rows, 1, cols) }],
    objects: [
      { kind: 'table', color: '#AD9C67', cells: [[3, 4]] },
      { kind: 'chair', color: '#D9C08A', cells: [[3, 3]] },
      { kind: 'plant', color: '#79CFA1', cells: [[1, 7]] },
      { kind: 'rug', color: '#B89A62', cells: [[5, 5]], sizeCells: 0.9 },
    ],
    walls: perimeter(rows, cols),
    doors: [hEdge(rows, 3)], // 下边框第 4 列：房间入口
  }
}

/** B：双房间 16×12 格（0.5 m/格），4 段外框墙 + 1 段隔墙、2 门，家具 9 件（2 件跨 2 格）。 */
export function demoBPlan() {
  const rows = 12
  const cols = 16
  const divider = []
  for (let r = 0; r < 10; r++) divider.push(vEdge(8, r)) // 书房(1..8 列) 与 画廊(9..16 列) 之间，仅前 10 行
  return {
    name: 'demo-b',
    rows,
    cols,
    metersPerCell: 0.5,
    rooms: [
      { name: '书房', fill: '#CFE0D2', cells: cellsRect(1, 12, 1, 8) },
      { name: '画廊', fill: '#D9CDB4', cells: cellsRect(1, 10, 9, 16) },
      // rows 11..12 × cols 9..16 留白 = void 区（洞/外部，不计入房间）
    ],
    objects: [
      { kind: 'shelf', color: '#D0B0D9', cells: [[2, 1], [3, 1]] }, // 竖向跨 2 格
      { kind: 'desk', color: '#AD9C67', cells: [[5, 3], [5, 4]] }, // 横向跨 2 格
      { kind: 'chair', color: '#D9C08A', cells: [[6, 3]] },
      { kind: 'lamp', color: '#EFE9D6', cells: [[2, 7]] },
      { kind: 'statue', color: '#9AA3B8', cells: [[4, 12]], heightM: 1.8 },
      { kind: 'crate', color: '#8C7F52', legendColor: '#A08E62', cells: [[8, 10]] },
      { kind: 'crate', color: '#8C7F52', legendColor: '#A08E62', cells: [[7, 15]] },
      { kind: 'pillar', color: '#C6CBDD', cells: [[1, 9]] },
      { kind: 'pillar', color: '#C6CBDD', cells: [[1, 16]] },
    ],
    walls: [...perimeter(rows, cols), ...divider],
    doors: [hEdge(rows, 4), vEdge(8, 5)], // 下边框 1 门 + 隔墙 1 门（书房↔画廊）
  }
}

/** 未分类颜色用例：A 的布局里把 1 个格子涂成非图例颜色（#FF00FF）。 */
export function unknownColorVariant() {
  return buildDemoPlan({ ...demoAPlan(), extraCellColors: [{ row: 2, col: 6, color: '#FF00FF' }] })
}

// ── 生成到 examples/ ───────────────────────────────────────────────────────

const DEMO_FILES = Object.freeze([
  { plan: 'a', png: 'design-demo.png', legend: 'design-demo.legend.json', truth: 'design-demo.ground-truth.json' },
  { plan: 'b', png: 'design-demo-b.png', legend: 'design-demo-b.legend.json', truth: 'design-demo-b.ground-truth.json' },
])

/**
 * 把两张演示设计图 + 图例 + ground-truth 写到目录（默认 <插件>/examples）。
 * @param {string} [outDir]
 * @returns {{ name:string, png:string, legend:string, groundTruth:string }[]}
 */
export function generateDemoPlans(outDir) {
  const examplesDir = outDir || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'examples')
  fs.mkdirSync(examplesDir, { recursive: true })
  const written = []
  for (const spec of DEMO_FILES) {
    const plan = spec.plan === 'a' ? demoAPlan() : demoBPlan()
    const built = buildDemoPlan(plan)
    const pngPath = path.join(examplesDir, spec.png)
    const legendPath = path.join(examplesDir, spec.legend)
    const truthPath = path.join(examplesDir, spec.truth)
    fs.writeFileSync(pngPath, built.png)
    fs.writeFileSync(legendPath, JSON.stringify(built.legend, null, 2) + '\n', 'utf8')
    fs.writeFileSync(truthPath, JSON.stringify(built.groundTruth, null, 2) + '\n', 'utf8')
    written.push({ name: plan.name, png: pngPath, legend: legendPath, groundTruth: truthPath })
  }
  return written
}

// ── CLI ────────────────────────────────────────────────────────────────────
const invokedDirectly = (() => {
  try {
    return process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  } catch {
    return false
  }
})()

if (invokedDirectly) {
  const argv = process.argv.slice(2)
  const outArg = argv.find((arg) => arg.startsWith('--out='))
  const outDir = outArg ? path.resolve(process.cwd(), outArg.slice('--out='.length)) : undefined
  const written = generateDemoPlans(outDir)
  for (const item of written) {
    console.log(`生成 ${item.name}：`)
    console.log(`  PNG         ${item.png}`)
    console.log(`  legend      ${item.legend}`)
    console.log(`  ground-truth ${item.groundTruth}`)
  }
  const variant = unknownColorVariant()
  console.log(`未知颜色变体（内存）：PNG ${variant.png.length} 字节，未进 legend 的颜色 #FF00FF`)
}
