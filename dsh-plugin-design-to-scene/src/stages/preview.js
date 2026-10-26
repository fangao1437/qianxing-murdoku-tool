// S2 场景预览：SceneSpec v1 → 俯视预览 PNG（纯 JS 光栅化，零依赖）
//
// 输入：{ spec, out?, scale?(默认100 像素/米), gridLines?(默认true), labels?(默认true) }
// 输出：
//   { out, bytes, width, height, report: ValidationReport,
//     legend: { rooms:[{name,color}], kinds:[{kind,color}] } }
//
// 画什么（从下到上）：
//   1. 背景（spec.env.background 提亮版）+ 网格（spec.grid.cell 或 0.5m，1px 半透明）；
//   2. 房间：按 spec.rooms[].cells → 格矩形填 room.color（实色，便于和设计图并排取色对照）；
//   3. 墙：from/to 线段按 thickness 加粗；openings 处断开，门位置画门色（#C06A1E）短线段；
//   4. 家具：footprint = size[0]×size[2] 的旋转矩形（rotYDeg），填 color + 深色描边；
//      rug 用半透明填充 + 虚线描边，且先画（避免地毯盖住椅子/桌子）；
//   5. 标签：5×7 点阵只覆盖 ASCII——物件画 kind 前 3 字母（同 kind 多件加序号），
//      房间画编号 R1/R2（中文房间名没有字形，硬画会变成 '?'）。
//
// 坐标映射：平面 (x,z) → 像素 (px,py) = (PADDING + x*scale, PADDING + z*scale)；
//   z 向下 = 设计图向下。旋转：rotYDeg 是绕 +y 的右手旋转，换到"x 右 / z 下"的俯视像素后
//   等价于屏幕坐标的 -rotYDeg（Canvas.fillRotatedRect 的旋转正方向是屏幕顺时针）。
// 注意：输出必须是真实可解码的 PNG（IHDR/IDAT(zlib)/IEND）——test/self-preview.mjs 会解码回读校验。
import path from 'node:path'
import { Canvas, hexToRgb } from '../lib/png-write.js'
import { LIGHT_KINDS, OBJECT_KINDS, normalizeSceneSpec, validateSceneSpec } from '../scene-spec.js'
import { assertNotOverwrite, loadJsonArg, resolvePath, writeBinaryFile } from '../paths.js'
import { CODES, fail } from '../errors.js'

const DEFAULT_SCALE = 100 // 像素/米
const PADDING = 24 // 画布留白（像素）
const BG_LIGHTEN = 0.75 // env.background 向白色提亮的比例（浅底上画深色墙/家具）
const WALL_COLOR = '#2E3440' // 墙色（SceneSpec 没有墙色字段：俯视预览用固定深色）
const DOOR_COLOR = '#C06A1E' // 门色（与 examples/DESIGN-FORMAT.md 的 doorColor 一致）
const GRID_COLOR = [150, 160, 178, 80] // 网格：半透明灰蓝，画在房间下面
const LABEL_COLOR = '#1A1F2B'
const LABEL_SHADOW = [255, 255, 255, 190]
const MAX_CANVAS_PIXELS = 32 * 1024 * 1024 // 防 scale 乱填把内存吃光

/** 颜色向白色提亮 t（0..1）。 */
function lighten(rgb, t) {
  return rgb.map((v) => Math.round(v + (255 - v) * t))
}

/** 颜色整体压暗（乘系数，用于描边）。 */
function darken(rgb, k) {
  return rgb.map((v) => Math.round(v * k))
}

/**
 * 原始 spec 的 kind 白名单前置检查：normalizeSceneSpec 会把非法 kind 静默改成 custom/sun
 * （契约 §0 不允许静默降级），所以必须在规范化前先拦下来。
 * @param {object} raw 原始 spec（未经 normalize）
 */
function assertRawKinds(raw) {
  const reject = (id, detail) => {
    const check = { id, ok: false, detail }
    fail(CODES.SPEC, `SceneSpec 结构非法：${id} — ${detail}`, { check })
  }
  if (Array.isArray(raw?.objects)) {
    raw.objects.forEach((obj, i) => {
      if (obj && typeof obj === 'object' && obj.kind !== undefined && !OBJECT_KINDS.includes(obj.kind)) {
        reject(`scene.objects[${i}]`, `kind 非法：${JSON.stringify(obj.kind)}（允许：${OBJECT_KINDS.join('/')}）`)
      }
    })
  }
  if (Array.isArray(raw?.lights)) {
    raw.lights.forEach((light, i) => {
      if (light && typeof light === 'object' && light.kind !== undefined && !LIGHT_KINDS.includes(light.kind)) {
        reject(`scene.lights[${i}]`, `kind 非法：${JSON.stringify(light.kind)}（允许：${LIGHT_KINDS.join('/')}）`)
      }
    })
  }
}

/**
 * 读入（对象或路径）→ 前置 kind 检查 → normalize → validate。
 * 结构不合法抛 E_SPEC_INVALID，detail 里带第一处失败 check（契约 §0：失败不静默）。
 * @returns {{ spec: object, source: string|null, report: object }}
 */
function loadSceneSpec(specArg, root) {
  const loaded = loadJsonArg(specArg, root, 'spec')
  if (loaded.value === null || typeof loaded.value !== 'object' || Array.isArray(loaded.value)) {
    const check = { id: 'scene', ok: false, detail: 'spec 必须是 SceneSpec 对象（不能是数组/基本类型）' }
    fail(CODES.SPEC, `SceneSpec 结构非法：spec 必须是对象`, { check })
  }
  assertRawKinds(loaded.value)
  const spec = normalizeSceneSpec(loaded.value)
  const report = validateSceneSpec(spec)
  if (!report.ok) {
    const first = report.checks.find((c) => !c.ok) || { id: 'scene', ok: false }
    fail(CODES.SPEC, `SceneSpec 结构非法：${first.id}${first.detail ? ` — ${first.detail}` : ''}`, {
      check: first,
      failed: report.checks.filter((c) => !c.ok),
    })
  }
  return { spec, source: loaded.source, report }
}

/** 网格线（0.5m 或 spec.grid.cell），只画在 bounds 区域内。 */
function drawGridLines(canvas, extentW, extentD, cell, pxPerMeter) {
  const stepPx = cell * pxPerMeter
  if (!(stepPx > 0.5)) return
  const xEnd = PADDING + extentW * pxPerMeter
  const yEnd = PADDING + extentD * pxPerMeter
  const cols = Math.max(1, Math.round(extentW / cell))
  const rows = Math.max(1, Math.round(extentD / cell))
  for (let i = 0; i <= cols; i++) {
    const x = PADDING + i * stepPx
    canvas.drawLine(x, PADDING, x, yEnd, 1, GRID_COLOR)
  }
  for (let i = 0; i <= rows; i++) {
    const y = PADDING + i * stepPx
    canvas.drawLine(PADDING, y, xEnd, y, 1, GRID_COLOR)
  }
}

/** 房间：cells 是 1-based [row, col]，一格 = cell 米。 */
function drawRooms(canvas, rooms, cell, pxPerMeter) {
  for (const room of rooms) {
    const rgb = hexToRgb(room.color) || [204, 204, 204]
    const stepPx = cell * pxPerMeter
    for (const [row, col] of room.cells) {
      const x0 = PADDING + (col - 1) * stepPx
      const y0 = PADDING + (row - 1) * stepPx
      canvas.fillRect(x0, y0, x0 + stepPx, y0 + stepPx, rgb)
    }
  }
}

/** 墙 + 门：openings 用 u（0..1）与 width（米）在墙上切出缺口，缺口里画门色短线段。 */
function drawWalls(canvas, walls, pxPerMeter) {
  const wallRgb = hexToRgb(WALL_COLOR)
  const doorRgb = hexToRgb(DOOR_COLOR)
  for (const wall of walls) {
    const ax = PADDING + wall.from[0] * pxPerMeter
    const ay = PADDING + wall.from[1] * pxPerMeter
    const bx = PADDING + wall.to[0] * pxPerMeter
    const by = PADDING + wall.to[1] * pxPerMeter
    const lenPx = Math.hypot(bx - ax, by - ay)
    const lenM = Math.hypot(wall.to[0] - wall.from[0], wall.to[1] - wall.from[1])
    if (!(lenPx > 0) || !(lenM > 0)) continue
    const thicknessPx = Math.max(1, Math.round(wall.thickness * pxPerMeter))
    const at = (u) => [ax + (bx - ax) * u, ay + (by - ay) * u]

    const cuts = wall.openings
      .map((opening) => {
        const halfU = opening.width / 2 / lenM
        return {
          start: Math.max(0, Math.min(1, opening.u - halfU)),
          end: Math.max(0, Math.min(1, opening.u + halfU)),
        }
      })
      .sort((p, q) => p.start - q.start)

    if (cuts.length === 0) {
      canvas.drawLine(ax, ay, bx, by, thicknessPx, wallRgb)
      continue
    }
    // 先按缺口切墙段，再在缺口里补门色短线
    const doorThickness = Math.max(2, Math.round(thicknessPx * 0.45))
    let cursor = 0
    for (const cut of cuts) {
      if (cut.start > cursor + 1e-9) {
        const [x0, y0] = at(cursor)
        const [x1, y1] = at(cut.start)
        canvas.drawLine(x0, y0, x1, y1, thicknessPx, wallRgb)
      }
      const [dx0, dy0] = at(cut.start)
      const [dx1, dy1] = at(cut.end)
      canvas.drawLine(dx0, dy0, dx1, dy1, doorThickness, doorRgb)
      cursor = Math.max(cursor, cut.end)
    }
    if (cursor < 1 - 1e-9) {
      const [x0, y0] = at(cursor)
      canvas.drawLine(x0, y0, bx, by, thicknessPx, wallRgb)
    }
  }
}

/** 旋转矩形的四个像素角点（rotDeg 为屏幕顺时针正方向，与 Canvas.fillRotatedRect 同口径）。 */
function rotatedCorners(cx, cy, w, h, rotDeg) {
  const rad = (rotDeg * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  const hw = w / 2
  const hh = h / 2
  return [
    [-hw, -hh],
    [hw, -hh],
    [hw, hh],
    [-hw, hh],
  ].map(([lx, ly]) => [cx + lx * cos - ly * sin, cy + lx * sin + ly * cos])
}

/** 旋转矩形描边。 */
function drawRotatedRectOutline(canvas, cx, cy, w, h, rotDeg, color, thickness) {
  const corners = rotatedCorners(cx, cy, w, h, rotDeg)
  for (let i = 0; i < corners.length; i++) {
    const a = corners[i]
    const b = corners[(i + 1) % corners.length]
    canvas.drawLine(a[0], a[1], b[0], b[1], thickness, color)
  }
}

/** 虚线线段（用于地毯描边）。 */
function drawDashedLine(canvas, x0, y0, x1, y1, dash, gap, thickness, color) {
  const len = Math.hypot(x1 - x0, y1 - y0)
  if (!(len > 0)) return
  const ux = (x1 - x0) / len
  const uy = (y1 - y0) / len
  let t = 0
  while (t < len) {
    const end = Math.min(len, t + dash)
    canvas.drawLine(x0 + ux * t, y0 + uy * t, x0 + ux * end, y0 + uy * end, thickness, color)
    t = end + gap
  }
}

/** 旋转矩形虚线描边。 */
function drawDashedRotatedRect(canvas, cx, cy, w, h, rotDeg, color, dash, gap, thickness) {
  const corners = rotatedCorners(cx, cy, w, h, rotDeg)
  for (let i = 0; i < corners.length; i++) {
    const a = corners[i]
    const b = corners[(i + 1) % corners.length]
    drawDashedLine(canvas, a[0], a[1], b[0], b[1], dash, gap, thickness, color)
  }
}

/** 单个家具 footprint：中心 = pos(x,z)，宽 = size[0]，深 = size[2]，绕 +y 转 rotYDeg。 */
function drawObjectFootprint(canvas, obj, pxPerMeter) {
  const cx = PADDING + obj.pos[0] * pxPerMeter
  const cy = PADDING + obj.pos[2] * pxPerMeter
  const w = Math.max(1, obj.size[0] * pxPerMeter)
  const h = Math.max(1, obj.size[2] * pxPerMeter)
  const screenRot = -obj.rotYDeg // R_y(rotYDeg) 在"x 右 / z 下"的俯视图中 = 屏幕 -rotYDeg
  const rgb = hexToRgb(obj.color) || [204, 204, 204]
  if (obj.kind === 'rug') {
    // 地毯半透明 + 虚线描边：看得出底下房间色，又不会盖住家具
    canvas.fillRotatedRect(cx, cy, w, h, screenRot, [...rgb, 110])
    drawDashedRotatedRect(canvas, cx, cy, w, h, screenRot, darken(rgb, 0.5), 6, 4, Math.max(1, Math.round(pxPerMeter / 100)))
  } else {
    canvas.fillRotatedRect(cx, cy, w, h, screenRot, rgb)
    drawRotatedRectOutline(canvas, cx, cy, w, h, screenRot, darken(rgb, 0.45), Math.max(1, Math.round(pxPerMeter / 80)))
  }
}

/** 房间包围盒（格坐标，1-based）。 */
function roomBBox(room) {
  if (!room.cells.length) return null
  let minRow = Infinity
  let maxRow = -Infinity
  let minCol = Infinity
  let maxCol = -Infinity
  for (const [row, col] of room.cells) {
    if (row < minRow) minRow = row
    if (row > maxRow) maxRow = row
    if (col < minCol) minCol = col
    if (col > maxCol) maxCol = col
  }
  return { minRow, maxRow, minCol, maxCol }
}

/** 文字先画 1px 白色阴影再画深色主体，保证在浅色房间/深色墙上的可读性。 */
function drawLabel(canvas, text, x, y, fontScale) {
  canvas.drawText(text, x + 1, y + 1, fontScale, LABEL_SHADOW)
  canvas.drawText(text, x, y, fontScale, LABEL_COLOR)
}

/**
 * 标签层：房间编号 + 物件 kind 缩写。
 * 5×7 点阵只有 ASCII，中文不画（会变 '?'）——房间用 R1/R2 编号，kind 取前 3 字母。
 */
function drawLabels(canvas, spec, cell, pxPerMeter) {
  const fontScale = pxPerMeter >= 90 ? 2 : 1
  const textH = 7 * fontScale
  const inset = Math.max(4, Math.round(pxPerMeter * 0.1))

  spec.rooms.forEach((room, index) => {
    const bbox = roomBBox(room)
    if (!bbox) return
    const text = `R${index + 1}`
    const x = PADDING + (bbox.minCol - 1) * cell * pxPerMeter + inset
    const y = PADDING + (bbox.minRow - 1) * cell * pxPerMeter + inset
    drawLabel(canvas, text, x, y, fontScale)
  })

  // 同 kind 多件时加序号（CHA1..CHA5），方便和 placement 表对上
  const kindCount = new Map()
  for (const obj of spec.objects) kindCount.set(obj.kind, (kindCount.get(obj.kind) || 0) + 1)
  const seq = new Map()
  for (const obj of spec.objects) {
    const n = (seq.get(obj.kind) || 0) + 1
    seq.set(obj.kind, n)
    let text = obj.kind.slice(0, 3).toUpperCase()
    if ((kindCount.get(obj.kind) || 0) > 1) text += String(n)

    const cx = PADDING + obj.pos[0] * pxPerMeter
    const cy = PADDING + obj.pos[2] * pxPerMeter
    const w = Math.max(1, obj.size[0] * pxPerMeter)
    const h = Math.max(1, obj.size[2] * pxPerMeter)
    const corners = rotatedCorners(cx, cy, w, h, -obj.rotYDeg)
    const topY = Math.min(...corners.map((p) => p[1]))
    const inkW = (text.length * 6 - 1) * fontScale
    const x = Math.max(1, Math.min(canvas.width - inkW - 1, cx - inkW / 2))
    const y = Math.max(1, Math.min(canvas.height - textH - 1, topY - textH - 4))
    drawLabel(canvas, text, x, y, fontScale)
  }
}

/** 图例：房间名/色 + 出现过的物件 kind/色（按 spec 首次出现顺序，结果确定）。 */
function buildLegend(spec) {
  const rooms = spec.rooms.map((room) => ({ name: room.name, color: room.color }))
  const kindColors = new Map()
  for (const obj of spec.objects) if (!kindColors.has(obj.kind)) kindColors.set(obj.kind, obj.color)
  const kinds = [...kindColors.entries()].map(([kind, color]) => ({ kind, color }))
  return { rooms, kinds }
}

/**
 * S2 阶段入口。
 * @param {{ spec?: any, out?: string, scale?: number, gridLines?: boolean, labels?: boolean }} args
 * @param {{ root?: string, signal?: AbortSignal }} [env]
 */
export async function renderScenePreviewStage({ spec: specArg, out, scale, gridLines, labels } = {}, env = {}) {
  const root = typeof env?.root === 'string' && env.root ? env.root : process.cwd()
  const { spec, source, report } = loadSceneSpec(specArg, root)

  const pxPerMeter = scale === undefined || scale === null ? DEFAULT_SCALE : scale
  if (typeof pxPerMeter !== 'number' || !Number.isFinite(pxPerMeter) || pxPerMeter <= 0) {
    fail(CODES.ARGS, `scale 必须是 > 0 的数字（实得 ${JSON.stringify(scale)}）`, { scale })
  }
  if (out !== undefined && out !== null && out !== '' && (typeof out !== 'string' || !out.trim())) {
    fail(CODES.ARGS, 'out 必须是非空字符串路径', { out })
  }
  const drawGrid = gridLines !== false
  const drawTextLabels = labels !== false

  const cell = Number.isFinite(spec.grid?.cell) && spec.grid.cell > 0 ? spec.grid.cell : 0.5
  // 画布范围按 bounds；万一 room.cells 超出 bounds（数据不一致），用格范围兜底，避免把房间裁掉
  let maxRow = 0
  let maxCol = 0
  for (const room of spec.rooms) {
    for (const [row, col] of room.cells) {
      if (row > maxRow) maxRow = row
      if (col > maxCol) maxCol = col
    }
  }
  const extentW = Math.max(spec.bounds.width, maxCol * cell)
  const extentD = Math.max(spec.bounds.depth, maxRow * cell)
  const width = Math.round(extentW * pxPerMeter) + PADDING * 2
  const height = Math.round(extentD * pxPerMeter) + PADDING * 2
  if (!(width > 2) || !(height > 2)) fail(CODES.ARGS, `画布尺寸非法：${width}×${height}`, { width, height, scale: pxPerMeter })
  if (width * height > MAX_CANVAS_PIXELS) {
    fail(CODES.ARGS, `画布过大（${width}×${height} 像素）：请降低 scale`, { width, height, scale: pxPerMeter })
  }

  const background = lighten(hexToRgb(spec.env.background) || [16, 24, 38], BG_LIGHTEN)
  const canvas = new Canvas(width, height, [...background, 255])

  if (drawGrid) drawGridLines(canvas, extentW, extentD, cell, pxPerMeter)
  drawRooms(canvas, spec.rooms, cell, pxPerMeter)
  drawWalls(canvas, spec.walls, pxPerMeter)
  // 地毯先画（floor covering），再画其它家具
  for (const obj of spec.objects.filter((o) => o.kind === 'rug')) drawObjectFootprint(canvas, obj, pxPerMeter)
  for (const obj of spec.objects.filter((o) => o.kind !== 'rug')) drawObjectFootprint(canvas, obj, pxPerMeter)
  if (drawTextLabels) drawLabels(canvas, spec, cell, pxPerMeter)

  const png = canvas.toPng()
  const absOut = out === undefined || out === null || out === ''
    ? path.join(root, '_work', 'scene-preview.png')
    : resolvePath(out, root)
  assertNotOverwrite([source], absOut)
  writeBinaryFile(absOut, png)

  return {
    out: absOut,
    bytes: png.length,
    width,
    height,
    report,
    legend: buildLegend(spec),
  }
}
