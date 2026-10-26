// S3 Blender 场景脚本生成：SceneSpec v1 → bpy(Python) 源码（纯函数、确定性）
//
// 设计原则：
//   · 生成的 build_scene.py 只依赖 bpy / mathutils / math / json / sys，Blender 4.x（EEVEE）可用；
//   · 场景数据全部在运行时从 `--spec` 指向的 SceneSpec JSON 读取，脚本里不写死任何场景尺寸；
//   · 同一 spec + 同一 opts 逐字节一致（无时间戳 / 随机数 / 环境依赖），便于回归与 diff；
//   · 坐标映射：SceneSpec (x 右 / y 上 / z 前) → Blender (x, y=z, z=y)；
//   · 门洞切墙：沿墙长方向切成「左段 + 门顶过梁 + 右段」，door 不封面板（保留门洞/门框形态）。
//
// 渲染口径（都来自 spec，不写死）：
//   · world 环境光 = env.ambientColor × env.ambientStrength；相机可见背景 = env.background
//     （film_transparent + 合成器 Alpha Over 铺底，两者互不干扰）；
//   · top = 正交俯视，关阴影 + 垂直翻转成设计图坐标（x 右 / z 下），方便和设计图 / S2 预览并排对照；
//   · perspective = spec.camera（pos/lookAt/fov→相机），相机在房间外时对挡视线的墙段做 cutaway
//     （只影响渲染可见性，渲染后立刻恢复，.blend 里墙是完整的）。
//
// 生成脚本的用法：
//   blender -b -P build_scene.py -- --spec <SceneSpec.json> --out <输出目录>
// 产物：
//   <out>/scene.blend  <out>/render-<view>.png  <out>/scene.glb
//   stdout 末尾打印一行 `SCENE_REPORT {json}`（供 JS 侧解析对象/墙/地板计数与产物路径）
import { KIND_DEFAULTS } from '../scene-spec.js'

/** 支持的渲染视角（与阶段契约一致）。 */
export const SCENE_VIEWS = Object.freeze(['top', 'perspective'])
export const DEFAULT_RENDER_WIDTH = 1280
export const DEFAULT_RENDER_HEIGHT = 720
export const DEFAULT_RENDER_SAMPLES = 32

/**
 * 清理/归一化视角列表：只保留已知视角、去重、保持顺序；空则回退到默认两个。
 * @param {unknown} input
 * @returns {string[]}
 */
export function sanitizeViews(input) {
  const list = Array.isArray(input) ? input : []
  const out = []
  for (const item of list) {
    if (typeof item !== 'string') continue
    const view = item.trim().toLowerCase()
    if (!SCENE_VIEWS.includes(view)) continue
    if (!out.includes(view)) out.push(view)
  }
  return out.length > 0 ? out : SCENE_VIEWS.slice()
}

function positiveInt(value, fallback) {
  return Number.isInteger(value) && value > 0 ? value : fallback
}

/** 单行化 + 截断（只用于生成脚本的注释头部）。 */
function commentSafe(value, maxLength = 80) {
  return String(value ?? '')
    .replace(/[\r\n\u2028\u2029]+/g, ' ')
    .slice(0, maxLength)
}

/**
 * 生成 Blender 构建脚本（Python 源码字符串）。
 * @param {object} spec 已 normalize 的 SceneSpec v1
 * @param {{views?: string[], render?: boolean, exportGlb?: boolean, width?: number, height?: number, samples?: number}} [opts]
 * @returns {string} Python 源码（UTF-8、LF 换行、确定性）
 */
export function emitBlenderScript(spec, opts = {}) {
  const scene = spec && typeof spec === 'object' ? spec : {}
  const views = sanitizeViews(opts.views)
  const render = opts.render !== false
  const exportGlb = opts.exportGlb !== false
  const width = positiveInt(opts.width, DEFAULT_RENDER_WIDTH)
  const height = positiveInt(opts.height, DEFAULT_RENDER_HEIGHT)
  const samples = positiveInt(opts.samples, DEFAULT_RENDER_SAMPLES)

  // kind → 基础形状（SceneSpec 契约里 KIND_DEFAULTS.shape；规范化后的 object 不带 shape 字段，
  // 所以在这里把契约的形状表编进脚本，运行时按 kind 查表）。
  const kindShape = {}
  for (const kind of Object.keys(KIND_DEFAULTS)) kindShape[kind] = KIND_DEFAULTS[kind].shape

  const roomCount = Array.isArray(scene.rooms) ? scene.rooms.length : 0
  const wallCount = Array.isArray(scene.walls) ? scene.walls.length : 0
  const objectCount = Array.isArray(scene.objects) ? scene.objects.length : 0
  const lightCount = Array.isArray(scene.lights) ? scene.lights.length : 0
  const sceneName = commentSafe(scene.name || 'scene')

  return `# -*- coding: utf-8 -*-
# =============================================================================
# dsh-plugin-design-to-scene · S3 Blender 场景搭建脚本（自动生成，请勿手改）
# 场景: ${sceneName}
# 规模: ${roomCount} 房间 / ${wallCount} 墙 / ${objectCount} 物件 / ${lightCount} 灯
# 用法: blender -b -P build_scene.py -- --spec <SceneSpec.json> --out <输出目录>
# 产物: <out>/scene.blend  <out>/render-<view>.png  <out>/scene.glb
# 坐标: SceneSpec (x 右 / y 上 / z 前) → Blender (x, y=z, z=y)
# 说明: 场景数据全部运行时从 --spec 读取；同一 SceneSpec 生成的脚本逐字节一致。
# =============================================================================
import bpy
import sys
import json
import math
from mathutils import Vector

# ---------- 生成参数（由插件写入；不含时间戳/随机数，保证脚本确定性） ----------
DEFAULT_VIEWS = ${JSON.stringify(views)}
RENDER_ENABLED = ${render ? 'True' : 'False'}
GLB_ENABLED = ${exportGlb ? 'True' : 'False'}
RES_WIDTH = ${width}
RES_HEIGHT = ${height}
RENDER_SAMPLES = ${samples}
PREFERRED_ENGINE = "BLENDER_EEVEE_NEXT"
FALLBACK_ENGINE = "BLENDER_WORKBENCH"
WALL_COLOR = "#E8E2D6"
FLOOR_THICKNESS = 0.06
CELL_FALLBACK = 0.5
# kind → 基础形状（来自 SceneSpec 契约的 KIND_DEFAULTS；规格里可覆盖 size/color，形状按 kind）
KIND_SHAPE = ${JSON.stringify(kindShape)}

# ---------- 运行时状态（main 初始化；辅助函数共用，避免全局参数满天飞） ----------
SPEC = {}
SCENE = None
CELL = CELL_FALLBACK
OUT_DIR = ""
MATERIALS = {}
# 墙段记录（cutaway 用）：每段墙的平面几何 + 竖直范围 + 物体引用
WALL_SEGMENTS = []
# 合成器节点引用（背景色 + top 视角翻转）
COMPOSITOR = {}


# ------------------------------ 命令行与路径 ------------------------------
def parse_args():
    """从 \`--\` 之后解析 --spec / --out；Blender 自身参数与脚本参数用 \`--\` 分隔。"""
    argv = list(sys.argv)
    if "--" in argv:
        argv = argv[argv.index("--") + 1:]
    else:
        argv = []
    spec_path = ""
    out_dir = ""
    i = 0
    while i < len(argv):
        token = argv[i]
        value = argv[i + 1] if i + 1 < len(argv) else ""
        if token == "--spec" and value:
            spec_path = value
            i += 2
        elif token == "--out" and value:
            out_dir = value
            i += 2
        else:
            i += 1
    if not spec_path or not out_dir:
        raise SystemExit("E_ARGS: need --spec <SceneSpec.json> --out <dir>")
    return spec_path, out_dir


def load_spec(path):
    with open(path, "r", encoding="utf-8") as handle:
        return json.load(handle)


def join_path(base, name):
    """拼路径统一用 /（Windows 下 Blender 也接受），这样不必 import os。"""
    base = str(base).strip()
    while base.endswith("/"):
        base = base[:-1]
    return base + "/" + str(name)


def plan_to_blender(point):
    """SceneSpec 坐标 (x 右 / y 上 / z 前) → Blender 坐标 (x, y=z, z=y)。"""
    return (float(point[0]), float(point[2]), float(point[1]))


# ------------------------------ 颜色 / 材质 ------------------------------
def srgb_to_linear(channel):
    """sRGB → 线性（Blender 的 base_color / 世界色都按线性存，直接塞 sRGB 会发灰发亮）。"""
    if channel <= 0.04045:
        return channel / 12.92
    return ((channel + 0.055) / 1.055) ** 2.4


def hex_to_linear(hex_color):
    """'#RRGGBB' → (r, g, b, 1.0) 线性 RGBA；非法色回退中性灰。"""
    text = str(hex_color).strip().lstrip("#")
    if len(text) == 8:
        text = text[2:]
    if len(text) != 6:
        text = "CCCCCC"
    try:
        channels = [int(text[i * 2:i * 2 + 2], 16) / 255.0 for i in range(3)]
    except ValueError:
        channels = [0.8, 0.8, 0.8]
    return (
        srgb_to_linear(channels[0]),
        srgb_to_linear(channels[1]),
        srgb_to_linear(channels[2]),
        1.0,
    )


def get_material(name, hex_color, roughness=0.65, metallic=0.0):
    """按名字缓存材质：Principled BSDF，Base Color = 颜色（线性）。"""
    existing = MATERIALS.get(name)
    if existing is not None:
        return existing
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    rgba = hex_to_linear(hex_color)
    try:
        mat.diffuse_color = rgba  # Workbench 兜底渲染时也能看到正确颜色
    except Exception:
        pass
    bsdf = None
    for node in mat.node_tree.nodes:
        if node.type == "BSDF_PRINCIPLED":
            bsdf = node
            break
    if bsdf is not None:
        try:
            bsdf.inputs["Base Color"].default_value = rgba
        except Exception:
            pass
        if "Roughness" in bsdf.inputs:
            bsdf.inputs["Roughness"].default_value = float(roughness)
        if "Metallic" in bsdf.inputs:
            bsdf.inputs["Metallic"].default_value = float(metallic)
    MATERIALS[name] = mat
    return mat


# ------------------------------ 清场 ------------------------------
def reset_scene():
    """清空默认场景（headless 下默认有 Cube/Camera/Light），保证每次结果一致。"""
    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj, do_unlink=True)
    for collection in list(bpy.data.collections):
        try:
            bpy.data.collections.remove(collection)
        except Exception:
            pass
    for mesh in list(bpy.data.meshes):
        if mesh.users == 0:
            bpy.data.meshes.remove(mesh)
    for mat in list(bpy.data.materials):
        if mat.users == 0:
            bpy.data.materials.remove(mat)
    for light in list(bpy.data.lights):
        if light.users == 0:
            bpy.data.lights.remove(light)
    for camera in list(bpy.data.cameras):
        if camera.users == 0:
            bpy.data.cameras.remove(camera)
    return bpy.context.scene


# ------------------------------ 基础网格（手写 pydata，避免依赖 ops 上下文） ------------------------------
def make_box_mesh(name, sx, sy, sz):
    """轴对齐立方体网格：以原点为中心，尺寸 (sx, sy, sz)。"""
    hx = max(float(sx), 0.0005) * 0.5
    hy = max(float(sy), 0.0005) * 0.5
    hz = max(float(sz), 0.0005) * 0.5
    verts = [
        (-hx, -hy, -hz), (hx, -hy, -hz), (hx, hy, -hz), (-hx, hy, -hz),
        (-hx, -hy, hz), (hx, -hy, hz), (hx, hy, hz), (-hx, hy, hz),
    ]
    faces = [
        (0, 3, 2, 1),
        (4, 5, 6, 7),
        (0, 1, 5, 4),
        (1, 2, 6, 5),
        (2, 3, 7, 6),
        (3, 0, 4, 7),
    ]
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(verts, [], faces)
    mesh.update()
    return mesh


def make_cylinder_mesh(name, sx, sy, sz, segments=32):
    """圆柱网格：轴沿 Blender Z（spec 的「高」），sx/sy = 两向直径，sz = 高。"""
    rx = max(float(sx), 0.0005) * 0.5
    ry = max(float(sy), 0.0005) * 0.5
    hz = max(float(sz), 0.0005) * 0.5
    verts = []
    for z in (-hz, hz):
        for i in range(segments):
            angle = 2.0 * math.pi * i / segments
            verts.append((math.cos(angle) * rx, math.sin(angle) * ry, z))
    faces = []
    for i in range(segments):
        j = (i + 1) % segments
        faces.append((i, j, segments + j, segments + i))
    bottom_center = len(verts)
    verts.append((0.0, 0.0, -hz))
    top_center = len(verts)
    verts.append((0.0, 0.0, hz))
    for i in range(segments):
        j = (i + 1) % segments
        faces.append((bottom_center, j, i))
        faces.append((top_center, segments + i, segments + j))
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(verts, [], faces)
    mesh.update()
    return mesh


def make_plane_mesh(name, sx, sy):
    """水平平面网格（地毯等）：尺寸 sx × sy，位于本地 z=0。"""
    hx = max(float(sx), 0.0005) * 0.5
    hy = max(float(sy), 0.0005) * 0.5
    verts = [(-hx, -hy, 0.0), (hx, -hy, 0.0), (hx, hy, 0.0), (-hx, hy, 0.0)]
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(verts, [], [(0, 1, 2, 3)])
    mesh.update()
    return mesh


def new_object(name, mesh, location, rotation_z, mat):
    """把网格挂成物体、赋予材质并链接到场景集合。"""
    obj = bpy.data.objects.new(name, mesh)
    obj.location = (float(location[0]), float(location[1]), float(location[2]))
    obj.rotation_mode = "XYZ"
    obj.rotation_euler = (0.0, 0.0, float(rotation_z))
    if mat is not None:
        obj.data.materials.append(mat)
    SCENE.collection.objects.link(obj)
    return obj


# ------------------------------ 地板（按 room cells 合并矩形） ------------------------------
def merge_cells_into_rects(cells):
    """把同一房间的 [row, col] 格子合并成不重叠矩形（行优先贪心：先向右、再向下扩展）。

    返回 [(row0, col0, row1, col1), ...]（含端点、1 基格号），顺序确定（按格子排序后贪心）。
    """
    cell_set = set()
    for cell in cells:
        if isinstance(cell, (list, tuple)) and len(cell) >= 2:
            try:
                cell_set.add((int(cell[0]), int(cell[1])))
            except (TypeError, ValueError):
                continue
    used = set()
    rects = []
    for key in sorted(cell_set):
        row, col = key
        if key in used:
            continue
        col_end = col
        while (row, col_end + 1) in cell_set and (row, col_end + 1) not in used:
            col_end += 1
        row_end = row
        while True:
            next_row = row_end + 1
            full_run = True
            for cc in range(col, col_end + 1):
                if (next_row, cc) not in cell_set or (next_row, cc) in used:
                    full_run = False
                    break
            if not full_run:
                break
            row_end = next_row
        for rr in range(row, row_end + 1):
            for cc in range(col, col_end + 1):
                used.add((rr, cc))
        rects.append((row, col, row_end, col_end))
    return rects


def build_floors():
    """每个房间的地板按 cells 合并成矩形薄板（材质 = room.color）。返回地板块数。

    cells 是 1 基格号 [row, col]（DESIGN-FORMAT 约定：左上角原点、x 向右、z 向下），
    格子 (r, c) 覆盖平面 x∈[(c-1)*CELL, c*CELL]、z∈[(r-1)*CELL, r*CELL]。
    """
    floors = 0
    for room_index, room in enumerate(SPEC.get("rooms") or []):
        if not isinstance(room, dict):
            continue
        room_id = str(room.get("id") or ("r" + str(room_index + 1)))
        room_color = str(room.get("color") or "#CCCCCC")
        mat = get_material("mat-floor-" + room_id, room_color, roughness=0.85)
        for rect_index, rect in enumerate(merge_cells_into_rects(room.get("cells") or [])):
            row0, col0, row1, col1 = rect
            x0 = (col0 - 1) * CELL
            x1 = col1 * CELL
            z0 = (row0 - 1) * CELL
            z1 = row1 * CELL
            width = x1 - x0
            depth = z1 - z0
            if width <= 0.0 or depth <= 0.0:
                continue
            mesh = make_box_mesh("mesh-floor-" + room_id + "-" + str(rect_index), width, depth, FLOOR_THICKNESS)
            name = "floor-" + room_id + "-" + str(rect_index)
            # 薄板沉到 z=0 以下，顶面正好是地面高度
            new_object(
                name,
                mesh,
                ((x0 + x1) * 0.5, (z0 + z1) * 0.5, -FLOOR_THICKNESS * 0.5),
                0.0,
                mat,
            )
            floors += 1
    return floors


# ------------------------------ 墙（openings 切段 + 门顶过梁） ------------------------------
def build_walls():
    """按 spec.walls 建墙；openings 沿墙长方向切成多段，门洞上方只留过梁（不封门板）。

    返回 { walls, segments, openings }：walls = spec 里的墙数（逻辑墙），
    segments = 实际生成的墙体块数，openings = 切出的门洞数。
    """
    wall_material = get_material("mat-wall", WALL_COLOR, roughness=0.8)
    wall_count = 0
    segment_count = 0
    opening_count = 0
    for wall_index, wall in enumerate(SPEC.get("walls") or []):
        if not isinstance(wall, dict):
            continue
        start = wall.get("from")
        end = wall.get("to")
        if not isinstance(start, (list, tuple)) or len(start) < 2:
            continue
        if not isinstance(end, (list, tuple)) or len(end) < 2:
            continue
        fx = float(start[0])
        fz = float(start[1])
        tx = float(end[0])
        tz = float(end[1])
        dx = tx - fx
        dz = tz - fz
        length = math.hypot(dx, dz)
        height = float(wall.get("height") or 2.8)
        thickness = float(wall.get("thickness") or 0.15)
        if length <= 1e-6 or height <= 0.0 or thickness <= 0.0:
            continue
        wall_count += 1
        angle = math.atan2(dz, dx)

        # 1) 先算所有门洞在墙长方向上的区间
        openings = []
        for opening in wall.get("openings") or []:
            if not isinstance(opening, dict):
                continue
            opening_width = float(opening.get("width") or 0.9)
            opening_height = float(opening.get("height") or 2.1)
            position = float(opening.get("u") or 0.5)
            if opening_width <= 0.0:
                continue
            position = max(0.0, min(1.0, position))
            opening_height = max(0.0, min(opening_height, height))
            center = position * length
            left = max(0.0, center - opening_width * 0.5)
            right = min(length, center + opening_width * 0.5)
            if right - left <= 1e-6:
                continue
            openings.append((left, right, opening_height, str(opening.get("kind") or "door")))
        openings.sort(key=lambda item: (item[0], item[1]))
        opening_count += len(openings)

        # 2) 生成墙段：洞口左侧实墙 → 洞顶过梁 → 洞口右侧实墙
        segments = []
        cursor = 0.0
        for left, right, opening_height, _kind in openings:
            if left > cursor + 1e-6:
                segments.append((cursor, left, 0.0, height))
            if height - opening_height > 1e-6:
                segments.append((left, right, opening_height, height))
            cursor = max(cursor, right)
        if cursor < length - 1e-6:
            segments.append((cursor, length, 0.0, height))

        for seg_index, segment in enumerate(segments):
            seg_start, seg_end, seg_bottom, seg_top = segment
            seg_length = seg_end - seg_start
            seg_height = seg_top - seg_bottom
            if seg_length <= 1e-5 or seg_height <= 1e-5:
                continue
            along = (seg_start + seg_end) * 0.5
            center_x = fx + math.cos(angle) * along
            center_z = fz + math.sin(angle) * along
            mesh = make_box_mesh(
                "mesh-wall-" + str(wall_index) + "-" + str(seg_index),
                seg_length,
                thickness,
                seg_height,
            )
            name = "wall-" + str(wall_index) + "-" + str(seg_index)
            obj = new_object(name, mesh, (center_x, center_z, (seg_bottom + seg_top) * 0.5), angle, wall_material)
            # 记录墙段几何，供透视渲染的 cutaway 判断挡视线
            WALL_SEGMENTS.append({
                "angle": angle,
                "bottom": seg_bottom,
                "cx": center_x,
                "cz": center_z,
                "length": seg_length,
                "obj": obj,
                "thickness": thickness,
                "top": seg_top,
            })
            segment_count += 1
    return {"walls": wall_count, "segments": segment_count, "openings": opening_count}


# ------------------------------ 透视渲染的 cutaway（相机在房间外时） ------------------------------
def cutaway_blocking_walls(camera_obj, look_at):
    """临时隐藏「挡在相机 → lookAt 视线之间」的墙段，让相机在房间外的透视渲染也能看到室内。

    判定（平面 2D + 视线高度，都是确定性计算）：
      · 相机到 lookAt 的连线是否穿过该墙段的中心线（含厚度容差；擦墙视线单独处理）；
      · 穿过的位置处视线高度是否低于墙段顶、且不低于墙段底（门洞过梁下方不算挡）。
    只影响渲染可见性，渲染完会立刻恢复；.blend 里墙仍是完整的。
    """
    hidden = []
    camera_location = camera_obj.location
    camera_xy = (camera_location.x, camera_location.y)
    target_xy = (float(look_at[0]), float(look_at[1]))
    camera_z = camera_location.z
    target_z = float(look_at[2])
    for record in WALL_SEGMENTS:
        center_x = record["cx"]
        center_z = record["cz"]
        angle = record["angle"]
        ux = math.cos(angle)
        uy = math.sin(angle)
        vx = -math.sin(angle)
        vy = math.cos(angle)
        half_length = record["length"] * 0.5
        half_thickness = record["thickness"] * 0.5
        camera_u = (camera_xy[0] - center_x) * ux + (camera_xy[1] - center_z) * uy
        camera_v = (camera_xy[0] - center_x) * vx + (camera_xy[1] - center_z) * vy
        target_u = (target_xy[0] - center_x) * ux + (target_xy[1] - center_z) * uy
        target_v = (target_xy[0] - center_x) * vx + (target_xy[1] - center_z) * vy
        hit = False
        hit_t = 0.0
        if abs(target_v - camera_v) > 1e-9:
            # 视线穿过墙段中心线（v=0）的位置参数
            hit_t = (0.0 - camera_v) / (target_v - camera_v)
            if 0.0 < hit_t < 1.0:
                u_at = camera_u + (target_u - camera_u) * hit_t
                if -half_length - half_thickness <= u_at <= half_length + half_thickness:
                    hit = True
        elif abs(camera_v) <= half_thickness + 1e-6:
            # 相机与目标都贴着墙平面（擦墙视线）：视线沿墙长方向与墙段重叠就算挡
            if not (max(camera_u, target_u) < -half_length or min(camera_u, target_u) > half_length):
                hit = True
                hit_t = 0.5
        if not hit:
            continue
        ray_z = camera_z + (target_z - camera_z) * hit_t
        if ray_z >= record["top"] - 1e-4:
            continue  # 视线从墙顶越过
        if ray_z < record["bottom"]:
            continue  # 视线从墙段下方（门洞）穿过
        record["obj"].hide_render = True
        hidden.append(record["obj"])
    return hidden


def restore_hidden(objects):
    """恢复 cutaway 临时隐藏的墙段（渲染结果已落盘，可见性必须还原，保证 .blend 完整）。"""
    for obj in objects:
        try:
            obj.hide_render = False
        except Exception:
            pass


# ------------------------------ 家具/物件 ------------------------------
def build_objects():
    """按 spec.objects 建 box / cylinder / plane；位置 = (x, z→Blender y, y+高/2)，绕 Blender Z 轴转 rotYDeg。"""
    created = 0
    for object_index, item in enumerate(SPEC.get("objects") or []):
        if not isinstance(item, dict):
            continue
        pos = item.get("pos")
        size = item.get("size")
        if not isinstance(pos, (list, tuple)) or len(pos) < 3:
            continue
        if not isinstance(size, (list, tuple)) or len(size) < 3:
            continue
        kind = str(item.get("kind") or "custom")
        shape = KIND_SHAPE.get(kind, "box")
        width = max(float(size[0]), 0.0005)
        depth = max(float(size[2]), 0.0005)
        height = max(float(size[1]), 0.0005)
        rot_deg = float(item.get("rotYDeg") or 0.0)
        color = str(item.get("color") or "#CCCCCC")
        object_id = str(item.get("id") or ("o" + str(object_index + 1)))
        name = "obj-" + object_id
        mat = get_material("mat-" + name, color, roughness=0.6)
        location = (float(pos[0]), float(pos[2]), float(pos[1]) + height * 0.5)
        if shape == "cylinder":
            mesh = make_cylinder_mesh("mesh-" + name, width, depth, height, 32)
        elif shape == "plane":
            mesh = make_plane_mesh("mesh-" + name, width, depth)
        else:
            mesh = make_box_mesh("mesh-" + name, width, depth, height)
        new_object(name, mesh, location, math.radians(rot_deg), mat)
        created += 1
    return created


# ------------------------------ 灯光 ------------------------------
def build_lights():
    """sun = 方向光（rotDeg 欧拉角）；point = 点光（位置 + 功率）；area = 面光。"""
    created = 0
    for light_index, item in enumerate(SPEC.get("lights") or []):
        if not isinstance(item, dict):
            continue
        kind = str(item.get("kind") or "sun")
        pos = item.get("pos") or [0.0, 4.0, 0.0]
        rot = item.get("rotDeg") or [0.0, 0.0, 0.0]
        if not isinstance(pos, (list, tuple)) or len(pos) < 3:
            pos = [0.0, 4.0, 0.0]
        if not isinstance(rot, (list, tuple)) or len(rot) < 3:
            rot = [0.0, 0.0, 0.0]
        intensity = float(item.get("intensity") or 0.0)
        color = hex_to_linear(str(item.get("color") or "#FFF6E0"))
        name = "light-" + str(item.get("id") or ("l" + str(light_index + 1)))
        blender_type = "SUN"
        if kind == "point":
            blender_type = "POINT"
        elif kind == "area":
            blender_type = "AREA"
        data = bpy.data.lights.new(name, type=blender_type)
        data.energy = max(intensity, 0.0)
        data.color = (color[0], color[1], color[2])
        if blender_type == "SUN":
            try:
                data.angle = math.radians(3.0)
            except Exception:
                pass
        elif blender_type == "AREA":
            data.size = 2.0
        obj = bpy.data.objects.new(name, data)
        obj.location = plan_to_blender(pos)
        obj.rotation_mode = "XYZ"
        obj.rotation_euler = (math.radians(float(rot[0])), math.radians(float(rot[1])), math.radians(float(rot[2])))
        SCENE.collection.objects.link(obj)
        created += 1
    return created


# ------------------------------ 相机 ------------------------------
def make_camera(name):
    data = bpy.data.cameras.new(name)
    data.sensor_width = 36.0
    data.sensor_fit = "HORIZONTAL"
    obj = bpy.data.objects.new(name, data)
    SCENE.collection.objects.link(obj)
    return obj


def aim_object(obj, position, look_at):
    """把物体放到 position 并朝向 look_at（相机用 -Z 为前向、Y 为上）。"""
    obj.location = (float(position[0]), float(position[1]), float(position[2]))
    direction = Vector((float(look_at[0]) - float(position[0]), float(look_at[1]) - float(position[1]), float(look_at[2]) - float(position[2])))
    if direction.length > 1e-6:
        obj.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()


def lens_from_fov(fov_deg):
    """水平 fov（度）→ 35mm 等效焦距（sensor 36mm，单边 18mm）。"""
    fov = float(fov_deg)
    if fov <= 1.0 or fov >= 179.0:
        fov = 50.0
    return 18.0 / math.tan(math.radians(fov) * 0.5)


def build_main_camera():
    """spec.camera：pos/lookAt/fov → Blender 相机（sensor 36、水平 fov）。"""
    camera = SPEC.get("camera") or {}
    pos = camera.get("pos") or [0.0, 2.2, -4.0]
    look_at = camera.get("lookAt") or [0.0, 0.8, 0.0]
    fov = float(camera.get("fov") or 50.0)
    obj = make_camera("Camera")
    obj.data.lens = lens_from_fov(fov)
    obj.data.clip_start = 0.05
    obj.data.clip_end = 500.0
    aim_object(obj, plan_to_blender(pos), plan_to_blender(look_at))
    return obj


def build_top_camera():
    """正交俯视相机：按 bounds 自动取景（1280×720 横向画幅，留 8% 边距）。"""
    bounds = SPEC.get("bounds") or {}
    width = float(bounds.get("width") or 8.0)
    depth = float(bounds.get("depth") or 6.0)
    if width <= 0.0:
        width = 8.0
    if depth <= 0.0:
        depth = 6.0
    aspect = float(RES_WIDTH) / float(RES_HEIGHT)
    ortho_scale = max(width, depth * aspect) * 1.08
    if ortho_scale <= 0.1:
        ortho_scale = 6.0
    obj = make_camera("Camera_Top")
    obj.data.type = "ORTHO"
    obj.data.ortho_scale = ortho_scale
    # 俯视：相机在场景正上方，rotation 归零 = 沿 -Z 看下去（+Y 在画面上方）
    obj.location = (width * 0.5, depth * 0.5, max(width, depth) * 2.0 + 5.0)
    obj.rotation_mode = "XYZ"
    obj.rotation_euler = (0.0, 0.0, 0.0)
    return obj


# ------------------------------ 世界 / 渲染设置 ------------------------------
def setup_world():
    """world 环境光 = env.ambientColor × env.ambientStrength（EEVEE 里 world 提供漫反射环境光）；
    相机可见的背景色 = env.background：开 film_transparent + 合成器铺底，两者互不干扰。"""
    env = SPEC.get("env") or {}
    world = SCENE.world
    if world is None:
        world = bpy.data.worlds.new("World")
        SCENE.world = world
    world.use_nodes = True
    background_node = None
    for node in world.node_tree.nodes:
        if node.type == "BACKGROUND":
            background_node = node
            break
    if background_node is None:
        background_node = world.node_tree.nodes.new("ShaderNodeBackground")
    ambient_strength = float(env.get("ambientStrength") or 0.0)
    background_node.inputs[0].default_value = hex_to_linear(str(env.get("ambientColor") or "#CFE0FF"))
    background_node.inputs[1].default_value = max(0.0, min(ambient_strength, 5.0))
    composite_ready = False
    try:
        setup_background_composite(str(env.get("background") or "#101826"))
        composite_ready = True
    except Exception as exc:
        print("SCENE_WARN background compositor setup failed: " + str(exc))
    if composite_ready:
        SCENE.render.film_transparent = True
    else:
        # 兜底：不做透明背景时，world 至少给一个可见的深色底
        background_node.inputs[0].default_value = hex_to_linear(str(env.get("background") or "#101826"))
        background_node.inputs[1].default_value = 1.0


def setup_background_composite(background_hex):
    """合成器：Render Layers（透明背景）→ Flip（仅 top 用）→ Alpha Over(env.background) → Composite。"""
    scene = SCENE
    scene.use_nodes = True
    tree = scene.node_tree
    tree.nodes.clear()
    COMPOSITOR.clear()
    layers = tree.nodes.new("CompositorNodeRLayers")
    color = tree.nodes.new("CompositorNodeRGB")
    color.outputs[0].default_value = hex_to_linear(background_hex)
    flip = tree.nodes.new("CompositorNodeFlip")
    try:
        # 垂直翻转：Blender 俯视默认 +Y 向上（= 设计图的 z 正向朝上），
        # 翻一下才和设计图 / S2 预览一致（x 向右、z 向下），方便并排对照。
        if "Flip Y" in flip.inputs:
            flip.inputs["Flip Y"].default_value = True
        else:
            flip.axis = "Y"
    except Exception:
        pass
    try:
        flip.mute = True  # 默认不翻转；渲染 top 视角时再打开
    except Exception:
        pass
    over = tree.nodes.new("CompositorNodeAlphaOver")
    try:
        over.inputs[0].default_value = 1.0
    except Exception:
        pass
    composite = tree.nodes.new("CompositorNodeComposite")
    tree.links.new(layers.outputs[0], flip.inputs[0])
    tree.links.new(flip.outputs[0], over.inputs[2])
    tree.links.new(color.outputs[0], over.inputs[1])
    tree.links.new(over.outputs[0], composite.inputs[0])
    COMPOSITOR["ready"] = True
    COMPOSITOR["flip"] = flip


def set_background_flip(enabled):
    """top 视角：垂直翻转成设计图约定（x 右 / z 下）；其它视角保持相机原始画面。"""
    flip = COMPOSITOR.get("flip")
    if flip is None:
        return
    try:
        flip.mute = not bool(enabled)
    except Exception:
        pass


def set_light_shadows(enabled):
    """top 视角关阴影：正交俯视用于和设计图对照，墙影会把房间色块压暗、边界变模糊。"""
    for light in bpy.data.lights:
        try:
            light.use_shadow = bool(enabled)
        except Exception:
            pass


def setup_render():
    """EEVEE + 1280×720 + PNG；引擎不可用时退回旧枚举 / Workbench（保证 headless 也能出图）。"""
    render = SCENE.render
    render.resolution_x = RES_WIDTH
    render.resolution_y = RES_HEIGHT
    render.resolution_percentage = 100
    render.image_settings.file_format = "PNG"
    render.image_settings.color_mode = "RGB"
    try:
        render.image_settings.color_depth = "8"
    except Exception:
        pass
    try:
        render.image_settings.compression = 15
    except Exception:
        pass
    try:
        SCENE.view_settings.view_transform = "Standard"
    except Exception:
        pass
    try:
        SCENE.view_settings.look = "None"
    except Exception:
        pass
    engine_ok = False
    for engine in (PREFERRED_ENGINE, "BLENDER_EEVEE"):
        try:
            render.engine = engine
            engine_ok = True
            break
        except Exception:
            continue
    if not engine_ok:
        render.engine = FALLBACK_ENGINE
    try:
        SCENE.eevee.taa_render_samples = RENDER_SAMPLES
    except Exception:
        pass


# ------------------------------ 渲染 ------------------------------
def render_views(top_camera, main_camera, look_at):
    """渲染 views：top = 正交俯视相机，perspective = spec.camera；返回 [{view, path}]。

    perspective 会先做 cutaway（临时隐藏挡视线的墙段），渲染完立刻恢复。
    """
    renders = []
    for view in DEFAULT_VIEWS:
        if view == "top":
            camera = top_camera
        elif view == "perspective":
            camera = main_camera
        else:
            continue
        if camera is None:
            continue
        SCENE.camera = camera
        path = join_path(OUT_DIR, "render-" + view + ".png")
        SCENE.render.filepath = path
        hidden = []
        if view == "top":
            # 平面视角：翻转成设计图坐标（x 右 / z 下）+ 关阴影，读起来像设计图
            set_background_flip(True)
            set_light_shadows(False)
        elif view == "perspective":
            try:
                hidden = cutaway_blocking_walls(camera, look_at)
            except Exception as exc:
                print("SCENE_WARN cutaway failed for perspective: " + str(exc))
        rendered = False
        try:
            bpy.ops.render.render(write_still=True)
            rendered = True
        except Exception as exc:
            print("SCENE_WARN render failed for " + view + ": " + str(exc))
        if not rendered:
            # 兜底：Workbench 一定能出图（颜色来自材质 diffuse_color），避免整轮失败
            try:
                SCENE.render.engine = FALLBACK_ENGINE
                bpy.ops.render.render(write_still=True)
                rendered = True
                print("SCENE_WARN render " + view + " used " + FALLBACK_ENGINE)
            except Exception as exc:
                print("SCENE_ERROR render retry failed for " + view + ": " + str(exc))
        # 渲染完立刻还原可见性/阴影/翻转，保证 .blend 里场景是完整且默认的
        set_background_flip(False)
        set_light_shadows(True)
        restore_hidden(hidden)
        if rendered:
            renders.append({"view": view, "path": path})
    return renders


# ------------------------------ 主流程 ------------------------------
def main():
    global SPEC, SCENE, CELL, OUT_DIR, MATERIALS
    spec_path, out_dir = parse_args()
    SPEC = load_spec(spec_path)
    OUT_DIR = out_dir
    SCENE = reset_scene()
    MATERIALS = {}
    WALL_SEGMENTS.clear()
    grid = SPEC.get("grid") or {}
    cell = grid.get("cell")
    if not isinstance(cell, (int, float)) or cell <= 0:
        # 没有 grid.cell 时，用 bounds + 房间最大的 cells 行/列号反推格宽（避免地板与墙/家具脱节）
        max_row = 0
        max_col = 0
        for room in SPEC.get("rooms") or []:
            if not isinstance(room, dict):
                continue
            for grid_cell in room.get("cells") or []:
                if isinstance(grid_cell, (list, tuple)) and len(grid_cell) >= 2:
                    try:
                        max_row = max(max_row, int(grid_cell[0]))
                        max_col = max(max_col, int(grid_cell[1]))
                    except (TypeError, ValueError):
                        continue
        bounds = SPEC.get("bounds") or {}
        bounds_width = float(bounds.get("width") or 0.0)
        bounds_depth = float(bounds.get("depth") or 0.0)
        if max_row > 0 and max_col > 0 and bounds_width > 0.0 and bounds_depth > 0.0:
            cell = min(bounds_width / float(max_col), bounds_depth / float(max_row))
    if isinstance(cell, (int, float)) and cell > 0:
        CELL = float(cell)
    else:
        CELL = CELL_FALLBACK

    setup_world()
    setup_render()

    floors = build_floors()
    wall_stats = build_walls()
    objects = build_objects()
    lights = build_lights()
    main_camera = build_main_camera()
    top_camera = build_top_camera()
    camera_spec = SPEC.get("camera") or {}
    look_at = plan_to_blender(camera_spec.get("lookAt") or [0.0, 0.8, 0.0])

    SCENE.camera = main_camera
    renders = []
    if RENDER_ENABLED:
        renders = render_views(top_camera, main_camera, look_at)
    # 保存 .blend 时切回相机视角，用户打开文件即是好看的透视构图
    SCENE.camera = main_camera

    blend_path = join_path(OUT_DIR, "scene.blend")
    bpy.ops.wm.save_as_mainfile(filepath=blend_path)

    glb_path = ""
    if GLB_ENABLED:
        candidate = join_path(OUT_DIR, "scene.glb")
        try:
            bpy.ops.export_scene.gltf(filepath=candidate, export_format="GLB")
            glb_path = candidate
        except Exception as exc:
            print("SCENE_ERROR glb export failed: " + str(exc))

    report = {
        "blend": blend_path,
        "engine": SCENE.render.engine,
        "floors": floors,
        "glb": glb_path,
        "lights": lights,
        "objects": objects,
        "openings": wall_stats["openings"],
        "renders": renders,
        "wallSegments": wall_stats["segments"],
        "walls": wall_stats["walls"],
    }
    # 只输出一行、纯 ASCII（json.dumps 默认 ensure_ascii=True），避免 Windows 控制台编码问题
    print("SCENE_REPORT " + json.dumps(report, sort_keys=True))


if __name__ == "__main__":
    main()
`
}
