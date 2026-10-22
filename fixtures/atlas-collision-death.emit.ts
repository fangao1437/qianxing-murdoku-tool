// 由 tools/qx/graphcode/emit.mjs 从 behavior-spec 生成（target=gts，主路线 = MIT 的 genshin-ts）
// 落盘路径：本文件 → gsts compile → .gia → gsts inject → .gil
// 本工程**不写** protobuf：写入一律交给 genshin-ts 的 injector。
import { g } from 'genshin-ts/runtime/core'

g.server({
  id: 1073741843,
  name: "_执行_角色碰撞死亡"
})
  .on("whenEnteringCollisionTrigger", (evt, f) => {
    const 进入者实体 = evt.enteringEntity
    const 进入者实体GUID = evt.enteringEntityGuid
    const 触发器实体 = evt.triggerEntity
    const 触发器实体GUID = evt.triggerEntityGuid
    const 触发器序号 = evt.triggerId
    f.destroyEntity(进入者实体)
  })
