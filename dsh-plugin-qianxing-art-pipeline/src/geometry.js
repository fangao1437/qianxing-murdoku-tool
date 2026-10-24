// 棋盘几何：与游戏/预览一致的唯一口径（交接包 06 §7、02 §5）。
//   画布 1600×900；棋盘框 584@(608,138)；ruler 12；gap 4；
//   pitch = floor((584 - 2*12) / n)；cell = pitch - 4。
import { CANVAS, FRAME } from './contract.js'
import { CODES, fail } from './errors.js'

/**
 * 按格数算棋盘几何。
 * @param {number} n 行列数（取 max(rows, cols)）
 */
export function boardGeometry(n) {
  const count = Math.max(1, Math.floor(Number(n) || 1))
  const avail = FRAME.size - 2 * FRAME.ruler
  const pitch = Math.floor(avail / count)
  const cell = pitch - FRAME.gap
  const grid = count * pitch - FRAME.gap
  const gx = FRAME.x + FRAME.ruler + Math.floor((avail - grid) / 2)
  const gy = FRAME.y + FRAME.ruler + Math.floor((avail - grid) / 2)
  return { n: count, pitch, cell, gx, gy, avail, grid }
}

/** 1..N 的整数数组。 */
export function range(n) {
  return Array.from({ length: n }, (_, i) => i + 1)
}

/**
 * 规范化/校验 Layout（契约 §4）。
 * @param {object} layout
 * @returns {{ version:number, name:string, rows:number, cols:number, frame:object, rooms:Array, cells:string[], objects:Array }}
 */
export function normalizeLayout(layout) {
  if (!layout || typeof layout !== 'object') fail(CODES.SPEC, 'Layout 必须是对象')
  const rows = Math.floor(Number(layout.rows))
  const cols = Math.floor(Number(layout.cols))
  if (!(rows > 0 && rows <= 100) || !(cols > 0 && cols <= 100)) {
    fail(CODES.SPEC, `Layout.rows/cols 必须是 1..100 的整数`, { rows: layout.rows, cols: layout.cols })
  }
  const cells = Array.isArray(layout.cells) ? layout.cells.map(String) : []
  if (cells.length !== rows) fail(CODES.SPEC, `Layout.cells 必须有 ${rows} 行`, { got: cells.length })
  for (let r = 0; r < rows; r++) {
    if (cells[r].length !== cols) fail(CODES.SPEC, `Layout.cells[${r}] 必须有 ${cols} 个字符`, { row: r, got: cells[r].length })
  }
  const rooms = Array.isArray(layout.rooms)
    ? layout.rooms.map((room) => ({ id: String(room?.id ?? ''), name: String(room?.name ?? ''), color: String(room?.color ?? '#CCCCCC') }))
    : []
  const objects = Array.isArray(layout.objects)
    ? layout.objects.map((obj) => ({
        name: String(obj?.name ?? ''),
        kind: String(obj?.kind ?? ''),
        cells: Array.isArray(obj?.cells) ? obj.cells.map((pair) => [Number(pair?.[0]), Number(pair?.[1])]) : [],
      }))
    : []
  for (const obj of objects) {
    if (!obj.kind) fail(CODES.SPEC, 'Layout.objects[].kind 必填', { name: obj.name })
    if (obj.cells.length === 0) fail(CODES.SPEC, `Layout 物件 ${obj.name || obj.kind} 没有 cells`, { name: obj.name })
    for (const [r, c] of obj.cells) {
      if (!(r >= 1 && r <= rows && c >= 1 && c <= cols)) {
        fail(CODES.SPEC, `Layout 物件 ${obj.name || obj.kind} 的 cell 越界`, { cell: [r, c], rows, cols })
      }
    }
  }
  return {
    version: Number(layout.version ?? 1),
    name: String(layout.name ?? 'layout'),
    rows,
    cols,
    frame: {
      x: Number(layout.frame?.x ?? FRAME.x),
      y: Number(layout.frame?.y ?? FRAME.y),
      size: Number(layout.frame?.size ?? FRAME.size),
      ruler: Number(layout.frame?.ruler ?? FRAME.ruler),
      gap: Number(layout.frame?.gap ?? FRAME.gap),
    },
    rooms,
    cells,
    objects,
  }
}

export { CANVAS, FRAME }
