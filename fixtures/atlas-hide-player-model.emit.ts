// 由 tools/qx/graphcode/emit.mjs 从 behavior-spec 生成（target=gts，主路线 = MIT 的 genshin-ts）
// 落盘路径：本文件 → gsts compile → .gia → gsts inject → .gil
// 本工程**不写** protobuf：写入一律交给 genshin-ts 的 injector。
import { g } from 'genshin-ts/runtime/core'

g.server({
  id: 1073741827,
  name: "_执行_隐藏玩家模型"
})
  .on("whenEntityIsCreated", (evt, f) => {
    const 事件源实体 = evt.eventSourceEntity
    const 事件源GUID = evt.eventSourceGuid
    f.activateDisableModelDisplay(事件源实体, false)
  })
