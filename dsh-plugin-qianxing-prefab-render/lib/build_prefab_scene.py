# -*- coding: utf-8 -*-
"""千星 3D 场景「官方素材渲染」（借渊星官方 prefab 几何库 + 贴图）。

用法：
  blender52 -b --python build_prefab_scene.py -- \
    --spec <SceneSpec.json> --catalog <catalog.json> --assets <assetsDir> \
    --out <outDir> [--res-x 1600] [--res-y 900] [--samples 32] [--exposure -0.3]

assetsDir 结构（由插件配置/调用方准备）：
  assetsDir/catalog.json
  assetsDir/geometry/geometry-0.blend ... geometry-3.blend
  assetsDir/textures/**/*.png

产物：
  out/scene.blend、out/render-perspective.png、out/render-top.png、out/scene.spec.json
  并在 stdout 打印一行 `PREFAB_RESULT {json}`
"""
import bpy, os, math, json, time, sys, traceback
from mathutils import Vector

argv = sys.argv
if '--' in argv:
    argv = argv[argv.index('--') + 1:]
else:
    argv = []

def arg(name, default=None, cast=str):
    if name in argv:
        v = argv[argv.index(name) + 1]
        return cast(v)
    return default

SPEC_PATH = arg('--spec')
CATALOG = arg('--catalog')
ASSETS = arg('--assets')
OUT = arg('--out')
RES_X = arg('--res-x', 1600, int)
RES_Y = arg('--res-y', 900, int)
SAMPLES = arg('--samples', 32, int)
EXPOSURE = arg('--exposure', -0.3, float)

if not SPEC_PATH or not CATALOG or not ASSETS or not OUT:
    print('PREFAB_ERROR missing required args --spec/--catalog/--assets/--out', flush=True)
    sys.exit(2)

os.makedirs(OUT, exist_ok=True)
spec = json.load(open(SPEC_PATH, encoding='utf-8'))
catalog = json.load(open(CATALOG, encoding='utf-8'))
prefabs = catalog['prefabs']
GEO = os.path.join(ASSETS, 'geometry')
TEX = os.path.join(ASSETS, 'textures')
W = float(spec['bounds']['width']); D = float(spec['bounds']['depth'])

# ---------- 贴图索引 ----------
tex_index = {}
for root, dirs, files in os.walk(TEX):
    for fn in files:
        tex_index.setdefault(fn, os.path.join(root, fn))

def fix_textures():
    fixed = 0; missing = 0
    for img in bpy.data.images:
        if img.has_data:
            continue
        base = os.path.basename(img.filepath.replace('\\\\', '/').replace('\\', '/'))
        p = tex_index.get(base)
        if p:
            try:
                img.filepath = p
                img.reload()
                fixed += 1
                continue
            except Exception:
                pass
        missing += 1
    return fixed, missing

# ---------- 场景重置 ----------
for o in list(bpy.data.objects):
    bpy.data.objects.remove(o, do_unlink=True)
scene = bpy.context.scene

import bmesh
def add_box(name, center, dims, color=(0.05, 0.04, 0.07, 1), rot_z=0.0):
    mesh = bpy.data.meshes.new(name + '_mesh')
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bm.to_mesh(mesh); bm.free()
    obj = bpy.data.objects.new(name, mesh)
    scene.collection.objects.link(obj)
    obj.location = center
    obj.scale = dims
    obj.rotation_euler = (0, 0, rot_z)
    mat = bpy.data.materials.new(name + '_mat'); mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value = color
    bsdf.inputs['Roughness'].default_value = 0.7
    obj.data.materials.append(mat)
    return obj

# 地板
add_box('floor', (W / 2, D / 2, -0.03), (W, D, 0.06), (0.06, 0.045, 0.035, 1))
# 不做天花板：保留顶部开口让天光进来（避免全黑）

WALL_COLOR = (0.03, 0.02, 0.06, 1)
def wall_segments(w):
    L = math.hypot(w['to'][0] - w['from'][0], w['to'][1] - w['from'][1])
    if L < 1e-6:
        return []
    ops = sorted(w.get('openings') or [], key=lambda o: o.get('u', 0))
    segs = []; cur = 0.0
    for o in ops:
        half = (o.get('width', 0.9) / 2.0) / L
        a = max(0.0, o.get('u', 0.5) - half); b = min(1.0, o.get('u', 0.5) + half)
        if a > cur:
            segs.append((cur, a))
        cur = max(cur, b)
    if cur < 1.0:
        segs.append((cur, 1.0))
    return segs

for wi, w in enumerate(spec.get('walls') or []):
    fx, fz = float(w['from'][0]), float(w['from'][1])
    tx, tz = float(w['to'][0]), float(w['to'][1])
    length = math.hypot(tx - fx, tz - fz)
    if length < 1e-6:
        continue
    height = float(w.get('height', 2.8)); thick = float(w.get('thickness', 0.18))
    ang = math.atan2(tz - fz, tx - fx)
    for si, (t0, t1) in enumerate(wall_segments(w)):
        seg_len = (t1 - t0) * length
        if seg_len < 0.05:
            continue
        u = (t0 + t1) / 2
        cx = fx + (tx - fx) * u; cz = fz + (tz - fz) * u
        add_box('wall%d_%d' % (wi, si), (cx, cz, height / 2), (seg_len + 0.02, thick, height), WALL_COLOR, ang)

# ---------- 官方 prefab 选择 ----------
KIND_CANDIDATES = {
    'rug':    ['地毯', '地毯（2）', '地毯3', '地毯4', '地毯5'],
    'bench':  ['沙发', '沙发（2）', '沙发（3）', '木质长椅'],
    'table':  ['木质长桌', '木质方桌', '木质圆桌', '石质圆桌'],
    'desk':   ['木质书桌', '木质长桌', '木质柜台', '木质柜台2', '石质柜台'],
    'chair':  ['木质座椅', '木质座椅2', '木质座椅3', '木质长椅'],
    'shelf':  ['木质书柜', '木质书柜2', '木质书柜3', '木质书柜4', '金属书架'],
    'plant':  ['盆栽', '盆栽5', '盆栽6', '盆栽7'],
    'lamp':   ['金属吊灯', '陶制吊灯', '积木吊灯', '金属吊灯2', '木质路灯', '石质路灯'],
    'pillar': ['圆柱', '三棱柱', '五棱柱'],
    'crate':  ['木质柜台3', '木质方桌'],
    'arch':   ['含窗木墙', '木质窗户'],
    'statue': ['石质雕像', '石质圆桌'],
}
SKIP_KINDS = {'custom'}

available_files = {f'geometry-{i}.blend' for i in range(4)}
by_file = {}
for p in prefabs:
    disp = p.get('display') or {}
    f = disp.get('file')
    if f not in available_files:
        continue
    by_file.setdefault(f, {})[disp.get('root_name') or p.get('name')] = p

lib_objects = {}
for f in sorted(by_file):
    path = os.path.join(GEO, f)
    if not os.path.isfile(path):
        lib_objects[f] = []
        continue
    try:
        with bpy.data.libraries.load(path, link=False) as (src, dst):
            lib_objects[f] = list(src.objects)
    except Exception as e:
        print('LIB_ERR %s %s' % (f, str(e)[:120]), flush=True)
        lib_objects[f] = []

def bounds_of(p):
    b = ((p.get('display') or {}).get('bounds') or {})
    mn = b.get('min'); mx = b.get('max')
    if not mn or not mx:
        return None
    return [max(1e-4, abs(mx[i] - mn[i])) for i in range(3)]

def choose_prefab(kind, size):
    cands = KIND_CANDIDATES.get(kind)
    if not cands:
        return None
    best = None
    for f, names in by_file.items():
        for root_name, p in names.items():
            if not any((root_name or '').startswith(c) or (p.get('name') or '').startswith(c) for c in cands):
                continue
            obj_names = lib_objects.get(f, [])
            hit = [n for n in obj_names if n == root_name] or [n for n in obj_names if n.startswith(root_name)]
            if not hit:
                continue
            b = bounds_of(p)
            if not b:
                continue
            sw, sh, sd = float(size[0]), float(size[1]), float(size[2])
            score = abs(sw - b[0]) / max(sw, b[0]) + abs(sd - b[1]) / max(sd, b[1]) + abs(sh - b[2]) / max(sh, b[2])
            if best is None or score < best[0]:
                best = (score, f, hit[0], p, b)
    if best is None:
        return None
    return {'file': best[1], 'obj': best[2], 'prefab': best[3], 'bounds': best[4]}

placed = []
missing = []
prefab_used = {}
for o in spec.get('objects') or []:
    kind = o.get('kind')
    if kind in SKIP_KINDS:
        continue
    size = o.get('size') or [0.5, 0.5, 0.5]
    pick = choose_prefab(kind, size)
    if not pick:
        missing.append({'id': o.get('id'), 'kind': kind})
        continue
    path = os.path.join(GEO, pick['file'])
    try:
        with bpy.data.libraries.load(path, link=False) as (src, dst):
            dst.objects = [pick['obj']]
        obj = dst.objects[0]
        if obj is None:
            missing.append({'id': o.get('id'), 'kind': kind, 'why': 'append-null'})
            continue
        scene.collection.objects.link(obj)
        x, y, z = float(o['pos'][0]), float(o['pos'][1]), float(o['pos'][2])
        obj.location = (x, z, y)
        obj.rotation_euler = (0, 0, -math.radians(float(o.get('rotYDeg') or 0)))
        b = pick['bounds']
        sw, sh, sd = float(size[0]), float(size[1]), float(size[2])
        obj.scale = (
            max(0.4, min(3.0, sw / b[0])),
            max(0.4, min(3.0, sd / b[1])),
            max(0.4, min(3.0, sh / b[2])),
        )
        placed.append({'id': o.get('id'), 'kind': kind, 'prefab': pick['prefab'].get('name'), 'file': pick['file']})
        prefab_used[kind] = prefab_used.get(kind, 0) + 1
    except Exception as e:
        missing.append({'id': o.get('id'), 'kind': kind, 'why': str(e)[:160]})

fixed_t, missing_t = fix_textures()

# ---------- 相机 ----------
cam = spec.get('camera') or {}
cam_data = bpy.data.cameras.new('cam'); cam_obj = bpy.data.objects.new('cam', cam_data)
scene.collection.objects.link(cam_obj); scene.camera = cam_obj
pos = cam.get('pos', [W / 2, 1.8, D + 0.6]); look = cam.get('lookAt', [W / 2, 1.2, 0.5])
px, py, pz = float(pos[0]), float(pos[1]), float(pos[2])
pz = min(max(pz, 0.6), D - 0.5)
cam_obj.location = (px, pz, py)
target = Vector((float(look[0]), float(look[2]), float(look[1])))
cam_obj.rotation_euler = (target - cam_obj.location).to_track_quat('-Z', 'Y').to_euler()
fov = float(cam.get('fov') or 60)
cam_data.lens = 18.0 / math.tan(math.radians(fov) / 2.0)
cam_data.sensor_fit = 'HORIZONTAL'

top_data = bpy.data.cameras.new('topcam'); top_obj = bpy.data.objects.new('topcam', top_data)
scene.collection.objects.link(top_obj)
top_obj.location = (W / 2, D / 2, 9.0)
top_obj.rotation_euler = (0, 0, 0)
top_data.type = 'ORTHO'
top_data.ortho_scale = max(W, D) * 1.15

# ---------- 灯光 ----------
for i, l in enumerate(spec.get('lights') or []):
    kind = l.get('kind', 'point')
    if kind == 'sun':
        d = bpy.data.lights.new('sun%d' % i, 'SUN'); ob = bpy.data.objects.new('sun%d' % i, d)
        scene.collection.objects.link(ob)
        d.energy = float(l.get('intensity', 3)) * 1.2
        rot = l.get('rotDeg') or [50, 20, -25]
        ob.rotation_euler = tuple(math.radians(float(v)) for v in rot)
    elif kind == 'point':
        d = bpy.data.lights.new('pt%d' % i, 'POINT'); ob = bpy.data.objects.new('pt%d' % i, d)
        scene.collection.objects.link(ob)
        p = l.get('pos') or [W / 2, 2.0, D / 2]
        ob.location = (float(p[0]), float(p[2]), float(p[1]))
        d.energy = float(l.get('intensity', 100)) * 0.8
        d.shadow_soft_size = 0.25
        c = (l.get('color') or '#FFFFFF').lstrip('#')
        d.color = tuple(int(c[i:i + 2], 16) / 255.0 for i in (0, 2, 4))
    elif kind == 'area':
        d = bpy.data.lights.new('ar%d' % i, 'AREA'); ob = bpy.data.objects.new('ar%d' % i, d)
        scene.collection.objects.link(ob)
        p = l.get('pos') or [W / 2, 2.5, D / 2]
        ob.location = (float(p[0]), float(p[2]), float(p[1]))
        d.energy = float(l.get('intensity', 100)) * 4.0
        d.size = 3.0

# 顶部面光补光
for i, (fx, fy) in enumerate([(W * 0.22, D * 0.28), (W * 0.78, D * 0.28), (W * 0.5, D * 0.72)]):
    fill = bpy.data.lights.new('fill%d' % i, 'AREA'); fob = bpy.data.objects.new('fill%d' % i, fill)
    scene.collection.objects.link(fob)
    fob.location = (fx, fy, 2.65)
    fob.rotation_euler = (math.radians(180), 0, 0)
    fill.energy = 120.0
    fill.size = 4.0
    fill.color = (1.0, 0.88, 0.72)

# ---------- 世界 / 渲染 ----------
world = bpy.data.worlds.new('W'); scene.world = world; world.use_nodes = True
bg = world.node_tree.nodes.get('Background')
envc = (spec.get('env') or {}).get('background') or '#101826'
envc = envc.lstrip('#')
bg.inputs[0].default_value = tuple(int(envc[i:i + 2], 16) / 255.0 for i in (0, 2, 4)) + (1,)
bg.inputs[1].default_value = 0.35

scene.render.engine = 'CYCLES'
scene.cycles.device = 'CPU'
scene.cycles.samples = SAMPLES
scene.cycles.use_denoising = True
scene.render.resolution_x = RES_X
scene.render.resolution_y = RES_Y
scene.view_settings.view_transform = 'Standard'
scene.view_settings.exposure = EXPOSURE
scene.render.image_settings.file_format = 'PNG'

renders = []
scene.render.filepath = os.path.join(OUT, 'render-perspective.png')
t0 = time.time()
bpy.ops.render.render(write_still=True)
renders.append({'view': 'perspective', 'path': scene.render.filepath, 'bytes': os.path.getsize(scene.render.filepath), 'seconds': round(time.time() - t0, 1)})

scene.camera = top_obj
scene.render.filepath = os.path.join(OUT, 'render-top.png')
t0 = time.time()
bpy.ops.render.render(write_still=True)
renders.append({'view': 'top', 'path': scene.render.filepath, 'bytes': os.path.getsize(scene.render.filepath), 'seconds': round(time.time() - t0, 1)})

blend_path = os.path.join(OUT, 'scene.blend')
bpy.ops.wm.save_as_mainfile(filepath=blend_path)
try:
    import shutil
    shutil.copyfile(SPEC_PATH, os.path.join(OUT, 'scene.spec.json'))
except Exception:
    pass

result = {
    'ok': True,
    'blend': blend_path,
    'renders': renders,
    'placed': len(placed),
    'specObjects': len(spec.get('objects') or []),
    'missing': missing,
    'prefabKinds': prefab_used,
    'texturesFixed': fixed_t,
    'texturesMissing': missing_t,
    'resolution': [RES_X, RES_Y],
    'samples': SAMPLES,
}
print('PREFAB_RESULT ' + json.dumps(result, ensure_ascii=False), flush=True)
