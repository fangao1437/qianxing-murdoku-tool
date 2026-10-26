// SceneSpec v1 —— 设计图→3D 场景的数据契约（唯一事实源，所有阶段只认它）
//
// 坐标系（米）：
//   x = 右（东）    z = 前（南，设计图向下）    y = 上
//   平面坐标 = (x, z)；Blender 里对应 (x, y=z, z=y)，本插件所有脚本负责换算。
//
// SceneSpec v1 结构（version 固定为 1）：
// {
//   "version": 1,
//   "name": "hall-demo",
//   "unit": "m",
//   "bounds": { "width": 8.0, "depth": 6.0 },          // 平面外包（x 向 / z 向）
//   "grid": { "cell": 0.5, "rows": 12, "cols": 16 },    // 可选：来源设计图的网格
//   "rooms":  [ { "id":"r1", "name":"大厅", "color":"#D9CDB4", "cells":[[r,c],...] } ],
//   "walls":  [ { "from":[x,z], "to":[x,z], "height":2.8, "thickness":0.15,
//                 "openings":[{"u":0.5,"width":0.9,"height":2.1,"kind":"door"}] } ],
//   "objects":[ { "id":"o1", "kind":"table", "pos":[x,y,z], "rotYDeg":0,
//                 "size":[w,h,d], "color":"#AD9C67", "asset":null, "tags":[] } ],
//   "lights": [ { "kind":"sun", "rotDeg":[45,30,0], "intensity":3, "color":"#FFF6E0",
//                 "pos":[x,y,z] } ],
//   "env":    { "ambientColor":"#CFE0FF", "ambientStrength":0.4, "background":"#101826" },
//   "camera": { "pos":[x,y,z], "lookAt":[x,y,z], "fov":50 }
// }
export const SCENE_SPEC_VERSION = 1

/** 支持的对象 kind 及其默认值（尺寸=米，颜色=十六进制，shape=Blender 生成方式）。 */
export const KIND_DEFAULTS = Object.freeze({
  table: { size: [0.9, 0.75, 0.9], color: '#AD9C67', shape: 'box' },
  desk: { size: [1.4, 0.75, 0.7], color: '#AD9C67', shape: 'box' },
  chair: { size: [0.45, 0.95, 0.45], color: '#D9C08A', shape: 'box' },
  bench: { size: [1.2, 0.45, 0.4], color: '#B89A62', shape: 'box' },
  shelf: { size: [0.9, 1.8, 0.35], color: '#D0B0D9', shape: 'box' },
  plant: { size: [0.5, 1.1, 0.5], color: '#79CFA1', shape: 'cylinder' },
  statue: { size: [0.6, 1.6, 0.6], color: '#9AA3B8', shape: 'cylinder' },
  rug: { size: [1.8, 0.02, 1.2], color: '#B89A62', shape: 'plane' },
  pillar: { size: [0.35, 2.8, 0.35], color: '#C6CBDD', shape: 'cylinder' },
  crate: { size: [0.6, 0.6, 0.6], color: '#8C7F52', shape: 'box' },
  lamp: { size: [0.25, 1.6, 0.25], color: '#EFE9D6', shape: 'cylinder' },
  arch: { size: [1.6, 2.2, 0.25], color: '#D0B0D9', shape: 'box' },
  custom: { size: [0.5, 0.5, 0.5], color: '#CCCCCC', shape: 'box' },
})

export const OBJECT_KINDS = Object.freeze(Object.keys(KIND_DEFAULTS))
export const LIGHT_KINDS = Object.freeze(['sun', 'point', 'area'])
export const UNIT = 'm'

const DEFAULT_WALL_HEIGHT = 2.8
const DEFAULT_WALL_THICKNESS = 0.15

function finite(v) {
  return typeof v === 'number' && Number.isFinite(v)
}

function round3(v) {
  const r = Math.round(v * 1000) / 1000
  return Object.is(r, -0) ? 0 : r
}

/** 接受 "#RRGGBB" / "0xAARRGGBB" / "0xRRGGBB"，统一成 "#RRGGBB"（大写）。非法返回 null。 */
export function normalizeHexColor(input) {
  if (typeof input !== 'string') return null
  let s = input.trim()
  if (/^#[0-9A-Fa-f]{6}$/.test(s)) return '#' + s.slice(1).toUpperCase()
  if (/^0x[0-9A-Fa-f]{8}$/.test(s)) return '#' + s.slice(4).toUpperCase()
  if (/^0x[0-9A-Fa-f]{6}$/.test(s)) return '#' + s.slice(2).toUpperCase()
  if (/^#[0-9A-Fa-f]{3}$/.test(s)) return '#' + s.slice(1).split('').map((c) => c + c).join('').toUpperCase()
  return null
}

function vec2(v, fallback) {
  if (!Array.isArray(v) || v.length !== 2 || !finite(v[0]) || !finite(v[1])) return fallback
  return [round3(v[0]), round3(v[1])]
}

function vec3(v, fallback) {
  if (!Array.isArray(v) || v.length !== 3 || !v.every(finite)) return fallback
  return [round3(v[0]), round3(v[1]), round3(v[2])]
}

/**
 * 规范化 SceneSpec：补默认值、统一颜色/坐标/尺寸、丢掉空墙。
 * 不做"合法性判定"——判定在 validateSceneSpec 里，避免静默修正掩盖错误。
 */
export function normalizeSceneSpec(spec, options = {}) {
  const src = spec && typeof spec === 'object' ? spec : {}
  const cellsize = finite(options.cell) ? options.cell : finite(src.grid?.cell) ? src.grid.cell : 0.5
  const grid = src.grid && typeof src.grid === 'object'
    ? {
        cell: round3(finite(src.grid.cell) ? src.grid.cell : cellsize),
        rows: Number.isInteger(src.grid.rows) ? src.grid.rows : null,
        cols: Number.isInteger(src.grid.cols) ? src.grid.cols : null,
      }
    : null
  const bounds = {
    width: round3(finite(src.bounds?.width) ? src.bounds.width : (grid?.cols ? grid.cols * grid.cell : 0)),
    depth: round3(finite(src.bounds?.depth) ? src.bounds.depth : (grid?.rows ? grid.rows * grid.cell : 0)),
  }
  const rooms = Array.isArray(src.rooms)
    ? src.rooms.map((room, i) => ({
        id: String(room?.id ?? 'r' + (i + 1)),
        name: String(room?.name ?? '区域 ' + (i + 1)),
        color: normalizeHexColor(room?.color) || '#CCCCCC',
        cells: Array.isArray(room?.cells)
          ? room.cells
              .filter((c) => Array.isArray(c) && Number.isInteger(c[0]) && Number.isInteger(c[1]))
              .map((c) => [c[0], c[1]])
          : [],
      }))
    : []
  const walls = Array.isArray(src.walls)
    ? src.walls
        .map((w) => ({
          from: vec2(w?.from, null),
          to: vec2(w?.to, null),
          height: round3(finite(w?.height) ? w.height : DEFAULT_WALL_HEIGHT),
          thickness: round3(finite(w?.thickness) ? w.thickness : DEFAULT_WALL_THICKNESS),
          openings: Array.isArray(w?.openings)
            ? w.openings.map((o) => ({
                u: round3(finite(o?.u) ? Math.min(1, Math.max(0, o.u)) : 0.5),
                width: round3(finite(o?.width) ? o.width : 0.9),
                height: round3(finite(o?.height) ? o.height : 2.1),
                kind: String(o?.kind ?? 'door'),
              }))
            : [],
        }))
        .filter((w) => w.from && w.to)
    : []
  const objects = Array.isArray(src.objects)
    ? src.objects
        .map((o, i) => {
          // 关键：未知 kind 原样保留（交给 validateSceneSpec 报错），
          // 否则 normalize 会把拼错的 kind 静默改成 custom，校验就永远绿了。
          const kind = typeof o?.kind === 'string' && o.kind ? o.kind : 'custom'
          const def = KIND_DEFAULTS[kind] || KIND_DEFAULTS.custom
          return {
            id: String(o?.id ?? 'o' + (i + 1)),
            kind,
            pos: vec3(o?.pos, [0, 0, 0]),
            rotYDeg: round3(finite(o?.rotYDeg) ? o.rotYDeg : 0),
            size: vec3(o?.size, def.size.slice()),
            color: normalizeHexColor(o?.color) || def.color,
            asset: typeof o?.asset === 'string' && o.asset ? o.asset : null,
            tags: Array.isArray(o?.tags) ? o.tags.map(String) : [],
          }
        })
        .filter((o) => o.pos)
    : []
  const lights = Array.isArray(src.lights)
    ? src.lights.map((l, i) => ({
        id: String(l?.id ?? 'l' + (i + 1)),
        kind: LIGHT_KINDS.includes(l?.kind) ? l.kind : 'sun',
        rotDeg: vec3(l?.rotDeg, [45, 30, 0]),
        pos: vec3(l?.pos, [0, 4, 0]),
        intensity: round3(finite(l?.intensity) ? l.intensity : 3),
        color: normalizeHexColor(l?.color) || '#FFF6E0',
      }))
    : []
  const camera = {
    pos: vec3(src.camera?.pos, [0, 2.2, -4]),
    lookAt: vec3(src.camera?.lookAt, [0, 0.8, 0]),
    fov: round3(finite(src.camera?.fov) ? src.camera.fov : 50),
  }
  const env = {
    ambientColor: normalizeHexColor(src.env?.ambientColor) || '#CFE0FF',
    ambientStrength: round3(finite(src.env?.ambientStrength) ? src.env.ambientStrength : 0.35),
    background: normalizeHexColor(src.env?.background) || '#101826',
  }
  return {
    version: SCENE_SPEC_VERSION,
    name: String(src.name ?? 'scene'),
    unit: UNIT,
    bounds,
    grid,
    rooms,
    walls,
    objects,
    lights: lights.length ? lights : [{ id: 'l1', kind: 'sun', rotDeg: [45, 30, 0], pos: [0, 4, 0], intensity: 3, color: '#FFF6E0' }],
    env,
    camera,
  }
}

/**
 * 结构校验（不抛错，返回 ValidationReport 契约 §7 形态：{ version, ok, checks[] }）。
 * 只报"能不能安全进 Blender/预览"的硬结构问题，不评价美术。
 */
export function validateSceneSpec(spec) {
  const checks = []
  const add = (id, ok, detail) => checks.push({ id, ok: !!ok, ...(detail === undefined ? {} : { detail }) })
  const s = spec && typeof spec === 'object' ? spec : {}
  add('scene.version', Number(s.version) === SCENE_SPEC_VERSION, `version 必须是 ${SCENE_SPEC_VERSION}（实际 ${s.version}）`)
  add('scene.name', typeof s.name === 'string' && s.name.length > 0, 'name 必填')
  add('scene.unit', s.unit === UNIT, "unit 必须是 'm'")
  add('scene.bounds', finite(s.bounds?.width) && s.bounds.width > 0 && finite(s.bounds?.depth) && s.bounds.depth > 0,
    `bounds.width/depth 必须 > 0（实际 ${s.bounds?.width} × ${s.bounds?.depth}）`)
  add('scene.rooms', Array.isArray(s.rooms), 'rooms 必须是数组')
  if (Array.isArray(s.rooms)) {
    s.rooms.forEach((room, i) => {
      add(`scene.rooms[${i}]`, typeof room.id === 'string' && !!normalizeHexColor(room.color) && Array.isArray(room.cells) && room.cells.length > 0,
        '房间需要 id/color/cells（cells 非空）')
    })
  }
  add('scene.walls', Array.isArray(s.walls), 'walls 必须是数组')
  if (Array.isArray(s.walls)) {
    s.walls.forEach((w, i) => {
      const len = Math.hypot(w.to[0] - w.from[0], w.to[1] - w.from[1])
      add(`scene.walls[${i}]`, len > 0 && w.height > 0 && w.thickness > 0 && Array.isArray(w.openings),
        `墙 ${i}: from/to 不能重合、height/thickness > 0（长度 ${round3(len)}）`)
    })
  }
  add('scene.objects', Array.isArray(s.objects), 'objects 必须是数组')
  if (Array.isArray(s.objects)) {
    const ids = new Set()
    s.objects.forEach((o, i) => {
      const dup = ids.has(o.id)
      ids.add(o.id)
      add(`scene.objects[${i}]`,
        !dup && OBJECT_KINDS.includes(o.kind) && o.size.every((v) => finite(v) && v >= 0) && o.size[1] >= 0 && finite(o.rotYDeg) && !!normalizeHexColor(o.color),
        `物件 ${o.id}: kind 必须合法、size 非负、rotYDeg 有限、color 合法、id 不重复`)
    })
  }
  add('scene.lights', Array.isArray(s.lights) && s.lights.length > 0, '至少一盏灯')
  if (Array.isArray(s.lights)) {
    s.lights.forEach((l, i) => {
      add(`scene.lights[${i}]`, LIGHT_KINDS.includes(l.kind) && finite(l.intensity) && !!normalizeHexColor(l.color), '灯需要合法 kind/intensity/color')
    })
  }
  add('scene.camera', s.camera && s.camera.pos && s.camera.lookAt && finite(s.camera.fov),
    'camera 需要 pos/lookAt/fov')
  if (s.camera?.pos && s.camera?.lookAt) {
    const d = Math.hypot(s.camera.pos[0] - s.camera.lookAt[0], s.camera.pos[1] - s.camera.lookAt[1], s.camera.pos[2] - s.camera.lookAt[2])
    add('scene.camera.distance', d > 0.001, `相机与 lookAt 不能重合（距离 ${round3(d)}）`)
  }
  add('scene.env', s.env && !!normalizeHexColor(s.env.ambientColor) && finite(s.env.ambientStrength) && !!normalizeHexColor(s.env.background), 'env 需要 ambientColor/ambientStrength/background')
  return { version: 1, ok: checks.every((c) => c.ok), checks }
}
