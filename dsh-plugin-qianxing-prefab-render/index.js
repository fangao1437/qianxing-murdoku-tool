// dsh-plugin-qianxing-prefab-render —— 官方素材渲染（借渊星 prefab 资产）
import { registerPrefabTools } from './src/tools.js'
import { registerPrefabSkill } from './src/skill.js'

export const name = 'qianxing-prefab-render'
export const inject = ['tools', 'skills']

/**
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {{ assetsDir?: string, blenderPath?: string }} config
 */
export function apply(ctx, config) {
  registerPrefabTools(ctx, config || {})
  registerPrefabSkill(ctx)
  console.log('[qianxing-prefab-render] plugin loaded: 2 tools + skill registered')
}
