// 由 tools/qx/graphcode/emit.mjs 从 behavior-spec 生成（target=gts，主路线 = MIT 的 genshin-ts）
// 落盘路径：本文件 → gsts compile → .gia → gsts inject → .gil
// 本工程**不写** protobuf：写入一律交给 genshin-ts 的 injector。
import { g } from 'genshin-ts/runtime/core'

g.server({
  id: 1073741845,
  name: "坠崖保护"
})
  .on("whenCharacterMovementSpdMeetsCondition", (evt, f) => {
    const 事件源实体 = evt.eventSourceEntity
    const 事件源GUID = evt.eventSourceGuid
    const 单位状态配置ID = evt.unitStatusConfigId
    const 条件 = evt.conditionComparisonType
    const 当前移动速度 = evt.currentMovementSpd
    const v_4 = f.getEntityLocationAndRotation(事件源实体)
    const v_5 = f.split3dVector(v_4.location)
    const v_6 = f.lessThanOrEqualTo(v_5.yComponent, -20)
    f.doubleBranch(v_6)
    const v_7 = f.getPlayerEntityToWhichTheCharacterBelongs(事件源实体)
    f.teleportPlayer(v_7, [10, 0.5, -15], [0, 135, 0])
  })
