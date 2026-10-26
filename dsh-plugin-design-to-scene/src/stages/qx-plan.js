// S4 千星落地：SceneSpec v1 → 千星/渊星落地清单（markdown + placement.json）
//
// 输入：{ spec, outDir, format?: 'md'|'json'|'both'(默认 both) }
// 输出：{ outDir, placementPath, planPath?, placement: [...], notes: string[] }
//   （路径都是绝对路径：调用方/验收脚本可以直接 fs 打开）
//
// placement.json：每个物件一条，给"在千星编辑器里摆放"用：
//   { id, kind, x, z, size: {width,height,depth}, rotYDeg, color, hint }
//   （x/z 单位米，坐标系与设计图一致；hint 是人话摆放建议：贴墙/居中/放在地毯上）
//
// markdown 必须包含：
//   1. 概览（房间/物件/包围盒/比例参考）；
//   2. 四步落地流程：① 设计图→SceneSpec（scene_parse_plan/代理写 spec）
//      ② scene_build_blender 出 .blend/GLB ③「千星奇域 UGC 工具」（渊星工具箱→插件库，
//      module blender v1.2.6，entitlement_required，需 Blender+账号权益）导 GIA
//      ④ 千星编辑器按 placement 摆放/核对；
//   3. 已知边界：千星 3D 场景不能由本插件直接写存档（UI 层 .gil 与本场景无关），
//      本插件到 Blender + 清单为止；渊星插件是手工 Blender 插件、需要 Blender + 账号权益；
//   4. 自检表：物件数/坐标抽查/GLB 与渲染产物/与设计图并排核对。
//
// 只读契约：不改输入 spec；输出不得覆盖输入（placement.json / plan.md 与 spec 同路径时抛 E_PATH）。
import path from 'node:path'
import { LIGHT_KINDS, OBJECT_KINDS, normalizeSceneSpec, validateSceneSpec } from '../scene-spec.js'
import { assertNotOverwrite, loadJsonArg, resolvePath, writeJsonFile, writeTextFile } from '../paths.js'
import { CODES, fail } from '../errors.js'

const DEFAULT_CELL = 0.5 // SceneSpec 没给 grid 时，1 格按 0.5m 计（与设计图约定一致）
const WALL_HINT_GAP_M = 0.35 // 物件外沿离墙 ≤ 0.35m 视为"贴墙摆放"
const FORMATS = Object.freeze(['md', 'json', 'both'])

/** 原始 spec 的 kind 白名单前置检查（normalize 会把非法 kind 静默改成 custom/sun，契约不允许）。 */
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

/** 读入 → kind 前置检查 → normalize → validate；结构不合法抛 E_SPEC_INVALID（带第一处 check）。 */
function loadSceneSpec(specArg, root) {
  const loaded = loadJsonArg(specArg, root, 'spec')
  if (loaded.value === null || typeof loaded.value !== 'object' || Array.isArray(loaded.value)) {
    const check = { id: 'scene', ok: false, detail: 'spec 必须是 SceneSpec 对象（不能是数组/基本类型）' }
    fail(CODES.SPEC, 'SceneSpec 结构非法：spec 必须是对象', { check })
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

/** 数字展示：最多 3 位小数、去掉多余的 0。 */
function fmtNum(value) {
  return String(Math.round(value * 1000) / 1000)
}

/**
 * 点在物件 footprint 内（考虑 rotYDeg）：把世界坐标逆旋转回物件局部坐标再比半宽/半深。
 * 平面 (x,z) 里绕 +y 的 R_y(θ) 正变换：world = [lx*cos + lz*sin, -lx*sin + lz*cos]，
 * 逆变换：lx = dx*cos - dz*sin，lz = dx*sin + dz*cos。
 */
function containsPoint(obj, x, z) {
  const rad = (obj.rotYDeg * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  const dx = x - obj.pos[0]
  const dz = z - obj.pos[2]
  const lx = dx * cos - dz * sin
  const lz = dx * sin + dz * cos
  return Math.abs(lx) <= obj.size[0] / 2 && Math.abs(lz) <= obj.size[2] / 2
}

/** 点到线段距离（米）。 */
function pointSegmentDistance(px, pz, from, to) {
  const vx = to[0] - from[0]
  const vz = to[1] - from[1]
  const wx = px - from[0]
  const wz = pz - from[1]
  const len2 = vx * vx + vz * vz
  const t = len2 > 0 ? Math.max(0, Math.min(1, (wx * vx + wz * vz) / len2)) : 0
  return Math.hypot(wx - t * vx, wz - t * vz)
}

/** 物件到最近墙的近似净间距（扣掉 footprint 短边的一半）：返回 { gap, wall }。 */
function nearestWall(obj, walls) {
  let best = null
  const halfShort = Math.min(obj.size[0], obj.size[2]) / 2
  for (const wall of walls) {
    const distance = pointSegmentDistance(obj.pos[0], obj.pos[2], wall.from, wall.to)
    const gap = Math.max(0, distance - halfShort)
    if (best === null || gap < best.gap) best = { gap, wall }
  }
  return best
}

/** 房间查表：米坐标 → 所在房间名（按 grid 格号反查，房间外返回 null）。 */
function buildRoomLookup(spec, cell) {
  const cells = new Map()
  for (const room of spec.rooms) for (const [row, col] of room.cells) cells.set(`${row},${col}`, room.name)
  return (x, z) => {
    const col = Math.floor(x / cell) + 1
    const row = Math.floor(z / cell) + 1
    return cells.get(`${row},${col}`) ?? null
  }
}

/** 人话摆放建议：地毯先铺 → 放地毯上 → 贴墙 → 居中。 */
function buildHint(obj, ctx) {
  const roomName = ctx.roomAt(obj.pos[0], obj.pos[2])
  const prefix = roomName ? `「${roomName}」内：` : ''
  if (obj.kind === 'rug') {
    return `${prefix}地毯先铺（y≈${fmtNum(obj.pos[1])}m），其余家具叠在它上面`
  }
  const rug = ctx.rugs.find((item) => item !== obj && containsPoint(item, obj.pos[0], obj.pos[2]))
  if (rug) return `${prefix}放在地毯 ${rug.id} 上（y≈${fmtNum(rug.pos[1])}m），x/z 对齐`
  const near = nearestWall(obj, ctx.walls)
  if (near && near.gap <= WALL_HINT_GAP_M) {
    const doorNote = near.wall.openings.length > 0 ? '，这段墙有门洞，别堵门' : ''
    return `${prefix}贴墙摆放（离墙约 ${near.gap.toFixed(2)}m${doorNote}），朝向 rotY=${fmtNum(obj.rotYDeg)}°`
  }
  return `${prefix}居中摆放：按 x/z 定位，朝向 rotY=${fmtNum(obj.rotYDeg)}°（1 格 = ${fmtNum(ctx.cell)} m 吸附）`
}

/** 生成 placement 数组（顺序 = spec.objects 顺序，坐标 = 设计图/SceneSpec 坐标）。 */
function buildPlacement(spec, cell) {
  const roomAt = buildRoomLookup(spec, cell)
  const rugs = spec.objects.filter((obj) => obj.kind === 'rug')
  const ctx = { cell, walls: spec.walls, rugs, roomAt }
  return spec.objects.map((obj) => ({
    id: obj.id,
    kind: obj.kind,
    x: obj.pos[0],
    z: obj.pos[2],
    size: { width: obj.size[0], height: obj.size[1], depth: obj.size[2] },
    rotYDeg: obj.rotYDeg,
    color: obj.color,
    hint: buildHint(obj, ctx),
  }))
}

/** 物件按 kind 计数：chair×5、table×1 …（按首次出现顺序，结果确定）。 */
function summarizeObjects(objects) {
  const counts = new Map()
  for (const obj of objects) counts.set(obj.kind, (counts.get(obj.kind) || 0) + 1)
  return [...counts.entries()].map(([kind, n]) => `${kind}×${n}`).join('、') || '（无物件）'
}

/** 生成 plan.md（纯文本、确定性：不含时间戳/随机）。 */
function buildPlanMarkdown(spec, placement, cell, format) {
  const lines = []
  const roomAt = buildRoomLookup(spec, cell)
  const push = (...items) => lines.push(...items)

  const roomsText = spec.rooms.length
    ? spec.rooms.map((room) => `${room.name}（${room.color}，${room.cells.length} 格）`).join('、')
    : '（无房间）'
  const openings = spec.walls.reduce((n, wall) => n + wall.openings.length, 0)
  const area = spec.bounds.width * spec.bounds.depth
  const gridNote =
    spec.grid && spec.grid.cols && spec.grid.rows
      ? `网格 ${spec.grid.cols}×${spec.grid.rows} 格，1 格 = ${fmtNum(cell)} m（1 m = ${fmtNum(1 / cell)} 格）；`
      : `1 格 = ${fmtNum(cell)} m；`

  push(`# 千星落地清单：${spec.name}`, '')
  push(
    `> 由 \`scene_qx_plan\` 从 SceneSpec v1 生成（本次 format=${format}` +
      `${format === 'md' ? '，只写 plan.md' : '，同目录另有 placement.json'}），只读输入、不覆盖输入。`,
    '> 坐标系（米）：`x` 向右、`z` 向前（设计图向下）、`y` 向上；坐标 = 物件**底面中心**。',
    `> ${gridNote}千星编辑器里按此换算成格摆放。`,
    '',
  )

  push('## 1. 概览', '')
  push(`- **场景名**：${spec.name}`)
  push(`- **房间**：${spec.rooms.length} 个 —— ${roomsText}`)
  push(`- **物件**：${spec.objects.length} 件（${summarizeObjects(spec.objects)}）`)
  push(`- **墙 / 门洞**：${spec.walls.length} 段墙 / ${openings} 个门洞`)
  push(`- **包围盒**：${fmtNum(spec.bounds.width)} m × ${fmtNum(spec.bounds.depth)} m（宽 × 深），平面面积 ${fmtNum(area)} m²`)
  push(`- **灯光**：${spec.lights.length} 盏（Blender 场景按 spec 建灯与环境光）`)
  push('')

  push('## 2. 四步落地流程', '')
  push('### ① 设计图 → SceneSpec', '')
  push(
    '- 网格平面设计图：`scene_parse_plan { design, legend }` 自动解析成 SceneSpec v1（约定见 `examples/DESIGN-FORMAT.md`）。',
    '- 概念图/手绘图：代理用 `read_image` 看图后直接写 SceneSpec JSON，再 `scene_spec_validate` 校验。',
    '- 本清单的所有坐标都来自已校验的 SceneSpec，和 `scene_preview` 的俯视 PNG 同源。',
    '',
  )
  push('### ② Blender 自动搭建（scene_build_blender）', '')
  push(
    '- 调 `scene_build_blender { spec, outDir }`：生成 `build_scene.py`，在本机 Blender（4.x，headless）里',
    '  自动建地面/房间/墙与门洞/家具/灯光/相机，产出 `.blend` + 俯视与透视渲染 PNG + `scene.glb`。',
    '- 未找到 Blender 时仍会生成脚本与导出清单（`executed=false`，不静默跳过）；装好 Blender 后重跑即可。',
    '',
  )
  push('### ③ 导 GIA：渊星「千星奇域 UGC 工具」', '')
  push(
    '- 打开**渊星工具箱 → 插件库 →「千星奇域 UGC 工具」**（Blender 插件：`module_id=blender`、`host_kind=blender`、',
    '  版本 `v1.2.6`、`access=entitlement_required`——需要本机有 Blender + 渊星账号权益）。',
    '- 在 Blender 里用它配置光源/环境并执行 `gia_export` 导出 GIA（插件 operations 含 `gia_export` / `gia_import` / `asset_unlock`）。',
    '- 注意：它是**手工 Blender 插件**，负责"在 Blender 里创作/配灯/导 GIA"，**不做「设计图 → 自动搭场景」**；',
    '  那段自动化由本插件（② 的 `scene_build_blender`）补齐，两边用同一份 SceneSpec 对齐。',
    '',
  )
  push('### ④ 千星编辑器：按 placement 摆放 / 核对', '')
  push(
    '- 千星编辑器导入 GIA（或按本清单手工摆放），以 1 格 = ' + fmtNum(cell) + ' m 吸附。',
    '- 按下面第 3 节的 placement 表逐条核对：`id` / `kind` / `x,z` / `rotY` / 尺寸，先摆地毯再摆家具。',
    '- 重点核对门洞可通行、家具不穿墙、朝向（rotY 0/90/180/270 最易错）。',
    '',
  )

  push('## 3. 物件摆放表（placement）', '')
  push(
    `> 共 ${placement.length} 条；坐标单位米，原点 = 场景平面左下角，放置点 = 底面中心；朝向 rotY 绕 +y。`,
    '',
    '| # | id | kind | 房间 | x (m) | z (m) | rotY | 尺寸 宽×高×深 (m) | 颜色 | 摆放建议 |',
    '|---|---|---|---|---|---|---|---|---|---|',
  )
  placement.forEach((item, index) => {
    const room = roomAt(item.x, item.z) || '—'
    lines.push(
      `| ${index + 1} | ${item.id} | ${item.kind} | ${room} | ${fmtNum(item.x)} | ${fmtNum(item.z)} | ${fmtNum(item.rotYDeg)}° | ` +
        `${fmtNum(item.size.width)}×${fmtNum(item.size.height)}×${fmtNum(item.size.depth)} | ${item.color} | ${item.hint} |`,
    )
  })
  push('')

  push('## 4. 已知边界（先看清再动手）', '')
  push(
    '1. **千星 3D 场景不能由本插件直接写存档**：本插件没有千星编辑器存档的写入口；`.gil` 是 2D 客户端 UI 存档，与本 3D 场景无关。',
    '2. **本插件到「Blender 场景 + GLB + 摆放清单」为止**：GIA 的导出/导入由渊星「千星奇域 UGC 工具」完成。',
    '3. 「千星奇域 UGC 工具」是**手工 Blender 插件**（建场景/配灯光环境/导 GIA），不做设计图自动搭场景；',
    '   需要 Blender + 渊星账号权益（`entitlement_required`），本插件不代登录、不绕过权益。',
    '4. `placement` 是"底面中心 + 米"的近似表：千星编辑器按格吸附时坐标会取整到最近格；异形/曲线物件按包围盒近似。',
    '',
  )

  push('## 5. 自检表', '')
  push(
    '| # | 检查项 | 期望 | 怎么查 |',
    '|---|---|---|---|',
    `| 1 | 物件数 | placement ${placement.length} 条 = spec.objects ${spec.objects.length} 件 | 数 placement.json 的 placement 数组 / 本表行数 |`,
    '| 2 | 坐标抽查 | 抽 3 件 x/z 与设计图/spec 一致（±0.001 m） | 拿 rug/table/desk 与本表、`scene_preview` 俯视 PNG 对照 |',
    '| 3 | 朝向抽查 | rotY 与设计图一致 | 椅子是否朝桌、柜子/雕像背面是否贴墙 |',
    '| 4 | GLB 与渲染产物 | `.blend` + `scene.glb` + 俯视/透视渲染 PNG 都存在且非空 | `scene_build_blender` 返回 `executed=true`、`renders` ≥ 2 |',
    '| 5 | 与设计图并排核对 | 房间形状/墙/门/家具位置一致 | 把 `scene_preview` 的 PNG 和设计图并排看 |',
    '| 6 | 门洞可通行 | 门洞位置/宽度与设计图一致，家具不堵门 | 千星里走一遍；或看俯视预览的门色短线 |',
    '| 7 | GIA 回读 | 导入千星后材质/灯光/尺寸正确 | 渊星插件 `gia_import` / 千星编辑器打开检查 |',
    '',
    '> 建议顺序：先 `scene_preview` 与设计图并排核对 → 改坐标 → 再 `scene_build_blender` → 最后按本清单落地千星。',
  )
  return lines.join('\n') + '\n'
}

/**
 * S4 阶段入口。
 * @param {{ spec?: any, outDir?: string, format?: 'md'|'json'|'both' }} args
 * @param {{ root?: string, signal?: AbortSignal }} [env]
 */
export async function emitQianxingPlanStage({ spec: specArg, outDir, format } = {}, env = {}) {
  const root = typeof env?.root === 'string' && env.root ? env.root : process.cwd()
  const fmt = format === undefined || format === null || format === '' ? 'both' : format
  if (typeof fmt !== 'string' || !FORMATS.includes(fmt)) {
    fail(CODES.ARGS, `format 必须是 ${FORMATS.join('|')} 之一（实得 ${JSON.stringify(format)}）`, { format })
  }
  if (typeof outDir !== 'string' || !outDir.trim()) {
    fail(CODES.ARGS, '缺少 outDir（落地清单输出目录，必填）', { outDir })
  }

  const { spec, source } = loadSceneSpec(specArg, root)
  const cell = Number.isFinite(spec.grid?.cell) && spec.grid.cell > 0 ? spec.grid.cell : DEFAULT_CELL
  const placement = buildPlacement(spec, cell)

  const absDir = resolvePath(outDir, root)
  const placementPath = path.join(absDir, 'placement.json')
  const planPath = path.join(absDir, 'plan.md')
  // 输出不得覆盖输入（例如把 spec 直接放在 outDir 下并命名为 placement.json）
  if (fmt !== 'md') assertNotOverwrite([source], placementPath)
  if (fmt !== 'json') assertNotOverwrite([source], planPath)

  const written = []
  if (fmt !== 'md') {
    writeJsonFile(placementPath, {
      version: 1,
      name: spec.name,
      unit: 'm',
      metersPerCell: cell,
      coordinateSystem: 'x 向右 / z 向前（设计图向下） / y 向上；单位米；坐标为物件底面中心（pos[0], pos[2]）',
      bounds: { width: spec.bounds.width, depth: spec.bounds.depth },
      grid: spec.grid ? { cell: spec.grid.cell, rows: spec.grid.rows, cols: spec.grid.cols } : { cell },
      placement,
    })
    written.push('placement.json')
  }
  if (fmt !== 'json') {
    writeTextFile(planPath, buildPlanMarkdown(spec, placement, cell, fmt))
    written.push('plan.md')
  }

  const notes = [
    '坐标单位米，坐标系与设计图一致（x 向右 / z 向前（设计图向下） / y 向上），放置点 = 物件底面中心。',
    `千星编辑器换算：1 格 = ${fmtNum(cell)} m` +
      (spec.grid?.cols && spec.grid?.rows
        ? `（本场景 ${spec.grid.cols}×${spec.grid.rows} 格 = ${fmtNum(spec.grid.cols * cell)} m × ${fmtNum(spec.grid.rows * cell)} m）`
        : '') +
      '。',
    `placement 共 ${placement.length} 条，覆盖 ${spec.objects.length} 件物件（${summarizeObjects(spec.objects)}）。`,
    `本次 format=${fmt}，写出：${written.join(' + ')}（输出目录 ${absDir}）。`,
    '千星 3D 场景不能由本插件直接写存档（.gil 是 2D 客户端 UI 存档，与 3D 场景无关）；本清单是人工摆放 / GIA 导入后的核对依据。',
    'GIA 导出导入由渊星「千星奇域 UGC 工具」完成（Blender 插件 v1.2.6，entitlement_required，需 Blender + 账号权益；本插件不代登录、不绕过权益）。',
  ]

  return {
    outDir: absDir,
    ...(fmt !== 'md' ? { placementPath } : {}),
    ...(fmt !== 'json' ? { planPath } : {}),
    placement,
    notes,
  }
}
