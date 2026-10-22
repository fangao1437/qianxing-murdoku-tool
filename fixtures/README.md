# fixtures —— 从真实 `.gia` 解码出来的样本，与可复跑的对账基线

## 这是什么

回归测试用的**结构数据**，全部由我们的解码器从 5 份官方/社区 `.gia` 上读出来：

| 文件 | 是什么 | 怎么来的 |
| --- | --- | --- |
| `<slug>.digest.json` | 每份样本的**摘要**（图数/节点数/连线数/变量/信号/节点类型统计） | `node src/coverage.mjs --in=<样本目录>` |
| `<slug>.decode.json` | 复杂样本的**完整解码结果**（节点/引脚/连线/常量） | 同上 |
| `index.json` | 上面这些文件的索引 | 同上 |
| `<slug>.spec.json` | 从可译的图翻出来的 spec（`emit` 的输入） | `node src/roundtrip.mjs --in=<样本目录>` |
| `<slug>.emit.ts` | 用上面的 spec `emit` 出来的 TS（**逐字节对账基线**） | 同上 |
| `roundtrip.json` | 反向回编译用例表：每个 spec 的预期产物与结果 | 同上 |
| `composite-atlas.digest.json` | 复合节点大全（87 图 / 473 节点）的摘要 | `coverage.mjs` |

五个样本（二进制**不在本仓库**，在私有主仓库的 `assets/` 下）：

1. `保护玩家防止坠崖掉落自动传送.gia`（1,010 B，7 节点）
2. `常用复合节点大全v1.7(补充包同步更新中).gia`（160,021 B，87 图 / 473 节点 / 87 个复合节点定义）
3. `实时获取投射物坐标（最快每0.06s获取一次）.gia`（10,407 B）
4. `玩家掉线检测、重连检测、断网检测.gia`（19,777 B）
5. `只按空格实现二段跳.gia`（21,607 B）

## 为什么可以入库（以及为什么二进制不行）

- **二进制不行**：`.gia` 里带官方贴图/关卡/脚本内容，授权不在我们手里 ⇒ 一律不入库（`.gitignore` 也兜底）。
- **读数可以**：这些 JSON/TS 是**我们自己的解码器产出的结论**（节点 id、端口名、拓扑、常量形状、
  生成的源码）。它们不含官方美术资源，是"事实数据"。这是**工程判断，不是法律意见**；
  如果权利人另有主张，删掉 `fixtures/` 只影响回归对账，不影响工具可用。
- 这里**不放**草稿：fixture 是判据。读出来但没验证过的东西不要塞进来。

## 重算（要样本 `.gia`）

```bash
# ① 覆盖度报告 + digest/decode fixture
node src/coverage.mjs --in=<样本目录> --md=docs/official-gia-coverage.md

# ② 反向回编译 + spec/TS fixture（要 workbench 才能真编译；没有就只出 spec + TS）
node src/roundtrip.mjs --in=<样本目录> --workbench=<装了 genshin-ts 的目录>
```

`fixtures/` 里**只有** `.json` / `.ts` / `.spec.json`。同步脚本会**拒绝**任何 `.gia` / `.gil` 进来
（`tools/sync-from-master.mjs` 里有这条硬拦截）。

## 谁在用

`test/run-tests.mjs`（由上游同步）：

- 断言 fixture 自洽（slug/图数/节点数与报告一致）；
- **离线反向回编译**：`fixtures/*.spec.json` → `emit` → 与 `fixtures/*.emit.ts` **逐字节一致**；
- 断言 `roundtrip.json` 基线**不被自测覆盖**（自测只读它）。

所以 fixture 变了但测试没变，要么是抽取更完整了，要么是**判据漂了** —— 两种情况都得在提交信息里写清楚。
