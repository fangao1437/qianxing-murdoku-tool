// dsh-plugin-design-to-scene —— 设计图 → 完整 3D 场景（Host-only bundle）
//
// 补充对象：「千星奇域 UGC 工具」（渊星工具箱里的 Blender 插件：在 Blender 里手工建场景、
// 配灯光环境、导入导出 GIA）。本插件补的是它没有的那段自动化：
//   设计图 → SceneSpec v1 → 预览图 → Blender 场景（.blend/渲染/GLB）→ 千星落地清单。
//
// 工具：scene_parse_plan / scene_spec_validate / scene_preview / scene_build_blender / scene_qx_plan
import { registerSceneTools } from './src/tools.js'
import { registerSceneSkill } from './src/skill.js'

export const name = 'design-to-scene'
export const inject = ['tools', 'skills']

/**
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {{ workspaceRoot?: string, blenderPath?: string } | undefined} config
 */
export function apply(ctx, config) {
  const normalized = {
    workspaceRoot: typeof config?.workspaceRoot === 'string' ? config.workspaceRoot : '',
    blenderPath: typeof config?.blenderPath === 'string' ? config.blenderPath : '',
  }
  registerSceneTools(ctx, normalized)
  registerSceneSkill(ctx)
}
