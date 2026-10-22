# 推送到 GitHub —— 已完成（记录 + 以后怎么推）

## 现状：**已推送成功**

| 项 | 值 |
| --- | --- |
| 远端 | <https://github.com/fangao1437/qianxing-murdoku-tool> |
| 分支 | `main`（已设 upstream：`origin/main`） |
| 远端 HEAD | `36dc601fedb18d16fa55007e331b241c789f6274` |
| 本地 HEAD | `36dc601fedb18d16fa55007e331b241c789f6274`（**一致**） |
| 历史 | `e2de3b4` 初版 → `36dc601` 恢复被空 `--in` 覆盖的 fixtures 索引 |
| 推送方式 | `git push -u origin main`，**一次成功**，没有 `--force`、没有改写历史 |

复核命令（两条 sha 一致才算真的推上去了）：

```powershell
cd "D:\新建文件夹\miHoYo Launcher\qianxing-murdoku-tool"
git ls-remote --heads origin      # refs/heads/main → 36dc601…
git rev-parse HEAD                # 36dc601…
```

## 背景：为什么之前是"待用户建仓"

第一次尝试打包时，GitHub API 对 `fangao1437/qianxing-murdoku-tool` 返回 **404**（仓库尚未创建）。
按流程只试一次、不重试；仓库建好后（public、空仓）再推，一次成功。
**教训**：404 可能是"仓库不存在"，也可能是"快照/权限口径"问题 —— 下结论前要复核一次
`git ls-remote`，别把一次 404 当成"永远推不上去"。

## 以后怎么推

```powershell
cd "D:\新建文件夹\miHoYo Launcher\qianxing-murdoku-tool"

# 1) 先同步上游工具链并确认测试全绿（别把红的推上去）
node tools/sync-from-master.mjs --from="<主仓库>\qianxing-murdoku\tools\qx\graphcode"
node test/run-tests.mjs            # 必须 通过 186，失败 0

# 2) 提交（身份已配好：fangao1437 <18182991366@163.com>）
git add -A
git commit -m "<改了什么 + 为什么 + 测试结果>"

# 3) 推送
git push            # 已设 upstream，不用再带 -u
```

凭据：GitHub 用户名 `fangao1437` + **个人访问令牌（PAT）**（GitHub 已不支持账号密码）。
凭据由 Git Credential Manager 接管；本机已存过，所以上面的 push 是静默成功的。

## 规矩（别破坏）

- **不要 `--force` / `--mirror` / 改写历史**：这是公开仓库，强推会把别人的 clone 弄坏。
- 若远端出现 `[rejected] (fetch first)`：`git pull --rebase origin main` 再推，**不要** force。
- 推送前**必须**跑测试；`fixtures/` 被改过时尤其要看 `fixtures/README.md` 的"重复算命令"一节
  （`coverage.mjs` 用空 `--in` 会清空 `fixtures/index.json`，这条真的踩过）。
- 素材边界：`.gil` / `.gia` / 图片**永不入库**（`.gitignore` + 同步脚本双重拦截）。
