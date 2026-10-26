// SceneSpec 校验/规范化工具（scene_spec_validate）。
//
// 输入：{ spec: 对象或 JSON 路径, out?: 规范化后写出路径 }
// 输出：
//   {
//     spec:  规范化后的 SceneSpec（颜色/坐标/尺寸统一、默认值补齐）,
//     report: ValidationReport（version:1, ok, checks:[{id,ok,detail?}]）,
//     out?:  已写出的路径（相对工作区）,
//     stats: { rooms, walls, openings, objects, lights, bounds }
//   }
import { normalizeSceneSpec, validateSceneSpec } from '../scene-spec.js'
import { loadJsonArg, displayPath, resolvePath, writeJsonFile } from '../paths.js'
import { CODES, fail } from '../errors.js'

export async function validateSceneSpecStage({ spec, out }, env) {
  const loaded = loadJsonArg(spec, env.root, 'spec')
  const normalized = normalizeSceneSpec(loaded.value)
  const report = validateSceneSpec(normalized)
  let wrote = null
  if (typeof out === 'string' && out) {
    const abs = resolvePath(out, env.root)
    if (loaded.source && resolvePath(loaded.source, env.root) === abs) {
      fail(CODES.PATH, '输出不得覆盖输入文件', { spec: loaded.source, out })
    }
    writeJsonFile(abs, normalized)
    wrote = displayPath(abs, env.root)
  }
  const openings = normalized.walls.reduce((n, w) => n + w.openings.length, 0)
  return {
    spec: normalized,
    report,
    ...(wrote ? { out: wrote } : {}),
    stats: {
      rooms: normalized.rooms.length,
      walls: normalized.walls.length,
      openings,
      objects: normalized.objects.length,
      lights: normalized.lights.length,
      bounds: [normalized.bounds.width, normalized.bounds.depth],
    },
  }
}
