// 技能注册：官方素材渲染（渊星 prefab）
import fs from 'node:fs'

export const SKILL_NAME = 'qianxing-prefab-render'

const SKILL_DESCRIPTION =
  '千星 3D 场景「官方素材渲染」（借渊星官方 prefab 几何库+贴图）：SceneSpec → 自动选官方 prefab → 摆位 → Blender 5.2 渲染出 .blend/PNG。' +
  '只能渲染/预览，云端不能导出 GIA（需 Windows host bridge + 渊星权益）。用户要「用官方素材/渊星素材渲染」时使用。'

/** @param {import('@deepseek-ai/cordis').Context} ctx */
export function registerPrefabSkill(ctx) {
  let content
  try {
    content = fs.readFileSync(new URL('../skill.md', import.meta.url), 'utf8')
  } catch {
    content = '# qianxing-prefab-render\n\n（skill.md 缺失：请重新安装插件包。）\n'
  }
  ctx.skills.register({
    name: SKILL_NAME,
    description: SKILL_DESCRIPTION,
    source: 'runtime',
    content,
  })
}
