// dsh-plugin-qianxing-3d-placement —— 千星 3D 场景「摆位」主线（Host-only bundle）
//
// 主线（绕开 Blender / GIA / 渊星）：
//   用户在编辑器摆好占位元件 → 导出 .gil → 本插件读场景实体（#5→#6→#11 变换）
//   → 按坐标表离线改写位置/旋转/缩放 → 写副本 + 重读校验 → 把新档发回导入。
//
// 工具：scene3d_list_entities / scene3d_apply_placement
import { registerPlacementTools } from './src/tools.js'
import { registerPlacementSkill } from './src/skill.js'

export const name = 'qianxing-3d-placement'
export const inject = ['tools', 'skills']

/**
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {{ outdir?: string } | undefined} config
 */
export function apply(ctx, config) {
  const normalized = {
    outdir: typeof config?.outdir === 'string' ? config.outdir : '',
  }
  registerPlacementTools(ctx, normalized)
  registerPlacementSkill(ctx)
  console.log('[qianxing-3d-placement] plugin loaded: 2 tools + skill registered')
}
