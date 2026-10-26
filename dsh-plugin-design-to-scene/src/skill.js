// 技能注册：把 skill.md 作为运行时技能挂到 ctx.skills。
import fs from 'node:fs'

export const SKILL_NAME = 'design-to-3d-scene'

const SKILL_DESCRIPTION =
  '设计图 → 完整 3D 场景管线：解析网格平面设计图或由代理看图画 SceneSpec v1，' +
  '校验后用 scene_preview 生成俯视预览，再用 scene_build_blender 自动搭出 Blender 场景（.blend/渲染/GLB），' +
  '最后 scene_qx_plan 输出千星/渊星落地清单。适用于千星奇域 3D 场景、以及任何需要从设计图快速起场景的任务。'

/** @param {import('@deepseek-ai/cordis').Context} ctx */
export function registerSceneSkill(ctx) {
  let content
  try {
    content = fs.readFileSync(new URL('../skill.md', import.meta.url), 'utf8')
  } catch {
    content = '# design-to-3d-scene\n\n（skill.md 缺失：请重新安装插件包。）\n'
  }
  ctx.skills.register({ name: SKILL_NAME, description: SKILL_DESCRIPTION, source: 'runtime', content })
}
