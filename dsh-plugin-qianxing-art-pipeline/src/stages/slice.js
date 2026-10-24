// S3a · 切件：Layout → 每件家具的模板键/锚点/span/偏移（交接包 02 §5、06 §4、04 §4）
//
// 输入：
//   layout          json   Layout 对象或 JSON 路径（契约 §4）
//   carpetTemplate? string 'auto'（默认）| 'single' —— 多格地毯模板键口径：
//                          auto  = 运行时 v320+ 契约口径（交接包 04 §4 / 07 坑19）：
//                                  单格 furn.rug、横跨 furn.rug.2、竖跨 furn.rug.3；
//                          single = 旧离线参考工具 slice-layout.mjs 口径（一律 furn.rug，
//                                   跨格时运行时实际是「按 span 拉伸单格模板」的观感）。
//   out?            string 输出切片 JSON 路径（可选）
//
// 输出：
//   {
//     version: 1,
//     geometry: { n, pitch, cell, gx, gy },   // n = max(rows, cols)；与 preview 同源
//     pieces: [
//       { name, kind, templateKey, anchor:{r,c}, span:{r,c}, offsetCells:{dx,dy},
//         cells:[{r,c},…] }   // 单格件 span={r:1,c:1}
//     ],
//     out?: string
//   }
//
// 规则（分组/锚点/偏移与 qianxing-murdoku-tool/art/tools/slice-layout.mjs 完全一致，逐字段可对拍）：
//   · table/carpet 按 4 邻接合并同物件；锚点 = 包围盒右下格；
//   · offsetCells.dx = (c1+c2)/2 - anchor.c；dy = (r1+r2)/2 - anchor.r（dy 向下为正）；
//   · 模板键 table：横跨 h2 / 竖跨 v2 / 单格 table.1（参考实现不变）；
//   · 模板键 carpet：auto（默认）按 span 选 rug.rug.2/rug.3（契约口径），single 一律 furn.rug；
//   · cells 顺序 = 参考实现的 BFS 顺序（与契约 examples/slice.example.json 一致）。
import { KINDS } from '../contract.js'
import { CODES, fail } from '../errors.js'
import { boardGeometry, normalizeLayout } from '../geometry.js'
import { assertNotOverwrite, displayPath, loadJsonArg, resolvePath, writeJsonFile } from '../paths.js'

/** 需要做 4 邻接合并的家具种类（参考实现 COMBINE_KINDS）。 */
const COMBINE_KINDS = new Set(['table', 'carpet'])

/** 地毯模板键口径（art_slice / art_preview 共用的枚举）。 */
const CARPET_TEMPLATE_MODES = new Set(['auto', 'single'])

/**
 * 归一化 `carpetTemplate` 参数：缺省 = 'auto'（契约口径），非法值抛 E_ARGS。
 * @param {unknown} value
 * @returns {'auto'|'single'}
 */
export function normalizeCarpetTemplate(value) {
  if (value === undefined || value === null || value === '') return 'auto'
  const mode = String(value)
  if (!CARPET_TEMPLATE_MODES.has(mode)) {
    fail(CODES.ARGS, `carpetTemplate 必须是 auto|single 之一（实际 ${JSON.stringify(value)}）`, {
      field: 'carpetTemplate',
      got: value,
      allowed: [...CARPET_TEMPLATE_MODES],
    })
  }
  return /** @type {'auto'|'single'} */ (mode)
}

/**
 * 家具种类 + 跨格数 → 模板键（参考实现 templateKey 的等价物）。
 * @param {string} kind
 * @param {number} spanR
 * @param {number} spanC
 * @param {'auto'|'single'} [carpetTemplate] 地毯口径，默认 auto（契约口径）
 * @returns {string}
 */
export function templateKeyOf(kind, spanR, spanC, carpetTemplate = 'auto') {
  if (kind === 'table') {
    if (spanC > 1) return 'furn.table.h2'
    if (spanR > 1) return 'furn.table.v2'
    return 'furn.table.1'
  }
  if (kind === 'carpet') {
    // single：旧参考工具口径（一律 furn.rug）；auto：运行时 v320+ 专用模板口径。
    if (carpetTemplate === 'single') return 'furn.rug'
    if (spanC > 1) return 'furn.rug.2'
    if (spanR > 1) return 'furn.rug.3'
    return 'furn.rug'
  }
  return `furn.${kind}`
}

/**
 * 纯函数切件：输入已规范化的 Layout（normalizeLayout 的输出），返回 pieces。
 * preview 复用同一份分组规则（= render-preview.mjs 的内联 slice），保证预览与切件同源。
 * @param {ReturnType<typeof normalizeLayout>} layout
 * @param {{ carpetTemplate?: 'auto'|'single' }} [options]
 * @returns {Array<{name:string,kind:string,templateKey:string,anchor:{r:number,c:number},span:{r:number,c:number},offsetCells:{dx:number,dy:number},cells:Array<{r:number,c:number}>}>}
 */
export function slicePieces(layout, options = {}) {
  const rows = layout.rows
  const cols = layout.cols
  const carpetTemplate = normalizeCarpetTemplate(options.carpetTemplate)

  // 格子占用表：同时检测越界/重复占用（参考实现把这类问题收进 errors 并退出码 1；
  // 插件契约要求失败必须抛结构化错误，不能静默降级 ⇒ 这里直接抛 E_SPEC_INVALID）。
  const grid = Array.from({ length: rows + 1 }, () => Array(cols + 1).fill(null))
  for (const obj of layout.objects) {
    if (!KINDS.includes(obj.kind)) {
      fail(CODES.SPEC, `未知家具类型：${obj.kind}（${obj.name || '(未命名)'}）`, {
        field: 'layout.objects.kind',
        kind: obj.kind,
        name: obj.name,
      })
    }
    for (const [r, c] of obj.cells) {
      if (r < 1 || r > rows || c < 1 || c > cols) {
        fail(CODES.SPEC, `${obj.name || obj.kind}: 格子 (${r},${c}) 越界（布局 ${rows}×${cols}）`, {
          field: 'layout.objects.cells',
          cell: [r, c],
          name: obj.name,
        })
      }
      if (grid[r][c] !== null) {
        fail(CODES.SPEC, `${obj.name || obj.kind}: 格子 (${r},${c}) 已被 ${grid[r][c].name || grid[r][c].kind} 占用`, {
          field: 'layout.objects.cells',
          cell: [r, c],
          name: obj.name,
          occupiedBy: grid[r][c].name,
        })
      }
      grid[r][c] = obj
    }
  }

  const seen = new Set()
  const pieces = []
  for (let r = 1; r <= rows; r++) {
    for (let c = 1; c <= cols; c++) {
      const obj = grid[r][c]
      if (obj === null || seen.has(`${r},${c}`)) continue
      if (!COMBINE_KINDS.has(obj.kind)) {
        // 单格家具：一个格子 = 一件（与参考实现一致；同物件多格会切成多件）。
        seen.add(`${r},${c}`)
        pieces.push({
          name: obj.name,
          kind: obj.kind,
          templateKey: templateKeyOf(obj.kind, 1, 1, carpetTemplate),
          anchor: { r, c },
          span: { r: 1, c: 1 },
          offsetCells: { dx: 0, dy: 0 },
          cells: [{ r, c }],
        })
        continue
      }

      // 4 邻接 BFS：只合并「同一个 object 且同 kind」的格子（参考实现同队列/同方向顺序）。
      const group = []
      const queue = [[r, c]]
      seen.add(`${r},${c}`)
      while (queue.length > 0) {
        const [cr, cc] = queue.shift()
        group.push({ r: cr, c: cc })
        for (const [dr, dc] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ]) {
          const nr = cr + dr
          const nc = cc + dc
          if (nr < 1 || nr > rows || nc < 1 || nc > cols) continue
          if (grid[nr][nc] !== obj || seen.has(`${nr},${nc}`)) continue
          seen.add(`${nr},${nc}`)
          queue.push([nr, nc])
        }
      }

      const rs = group.map((point) => point.r)
      const cs = group.map((point) => point.c)
      const box = { r1: Math.min(...rs), r2: Math.max(...rs), c1: Math.min(...cs), c2: Math.max(...cs) }
      const span = { r: box.r2 - box.r1 + 1, c: box.c2 - box.c1 + 1 }
      const anchor = { r: box.r2, c: box.c2 } // 锚点格 = 包围盒右下格（与主项目/参考实现一致）
      pieces.push({
        name: obj.name,
        kind: obj.kind,
        templateKey: templateKeyOf(obj.kind, span.r, span.c, carpetTemplate),
        anchor,
        span,
        offsetCells: {
          // 整件包围盒中心相对锚点格中心的偏移（单位=格，dy 向下为正）。
          dx: (box.c1 + box.c2) / 2 - anchor.c,
          dy: (box.r1 + box.r2) / 2 - anchor.r,
        },
        cells: group,
      })
    }
  }
  return pieces
}

/**
 * S3a：Layout → 切件结果（模板键/锚点/span/偏移）。可选写出 JSON。
 * @param {{ layout?: object|string, carpetTemplate?: 'auto'|'single', out?: string }} args
 * @param {{ root?: string }} [env]
 * @returns {Promise<{ version:number, geometry:{n:number,pitch:number,cell:number,gx:number,gy:number}, pieces:Array, out?: string }>}
 */
export async function sliceLayout(args = {}, env = {}) {
  const root = env.root || process.cwd()
  const carpetTemplate = normalizeCarpetTemplate(args.carpetTemplate)
  const loaded = loadJsonArg(args.layout, root, 'layout')
  const layout = normalizeLayout(loaded.value)

  const pieces = slicePieces(layout, { carpetTemplate })
  // 棋盘几何与 preview 同源：n = max(rows, cols)（5×5=108、6×6≈89）。
  const g = boardGeometry(Math.max(layout.rows, layout.cols))
  const result = {
    version: 1,
    geometry: { n: g.n, pitch: g.pitch, cell: g.cell, gx: g.gx, gy: g.gy },
    pieces,
  }

  if (args.out !== undefined && args.out !== null && args.out !== '') {
    if (typeof args.out !== 'string') fail(CODES.ARGS, 'out 必须是路径字符串', { field: 'out' })
    const outAbs = resolvePath(args.out, root)
    assertNotOverwrite([loaded.source], outAbs)
    writeJsonFile(outAbs, result)
    result.out = displayPath(outAbs, root)
  }
  return result
}
