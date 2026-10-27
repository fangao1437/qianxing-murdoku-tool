// 技能注册：3D 场景摆位主线。
import fs from 'node:fs'

export const SKILL_NAME = 'qianxing-3d-placement'

const SKILL_DESCRIPTION =
  '千星 3D 场景「摆位」主线（绕开 Blender/GIA/渊星）：读 .gil 场景实体 → 按设计图/坐标表离线改写位置、旋转、缩放 → 写副本 + 重读校验。' +
  '当用户要在 3D 场景里移动/旋转/缩放已摆好的元件、按设计图调摆位、或验证 3D 存档坐标时使用；' +
  '对应工具 scene3d_list_entities / scene3d_apply_placement。'

/** @param {import('@deepseek-ai/cordis').Context} ctx */
export function registerPlacementSkill(ctx) {
  let content
  try {
    content = fs.readFileSync(new URL('../skill.md', import.meta.url), 'utf8')
  } catch {
    content = '# qianxing-3d-placement\n\n（skill.md 缺失：请重新安装插件包。）\n'
  }
  ctx.skills.register({
    name: SKILL_NAME,
    description: SKILL_DESCRIPTION,
    source: 'runtime',
    content,
  })
}
