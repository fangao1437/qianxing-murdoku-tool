# 本机安装状态（严格版预设）

本文件记录**只在本机生效**的安装方式，不随上游仓库分发。

## 现在有两个预设

| 预设 | 来源 | 内容 |
|---|---|---|
| 千星 2D+Lua 游戏制作（原版）`wonderland-lua-builder` | `dsh-plugin-beyond-simulator` 插件包内置 | **已恢复为出厂原样**（与 `.agent-presets` 基线逐字节一致） |
| 千星 2D+Lua 游戏制作（严格版）`wonderland-lua-strict` | 本机 profile patch + 独立 bundle 目录 | 本目录 `skills/` 的优化版：platform-facts、每步退出证据、E15–E23、工具语义修正 |

两者并存，互不覆盖；选哪个由新建任务时的「Agent 预设」决定。已有任务不会自动切换。

## 严格版装在哪里

1. **声明**：`%USERPROFILE%\.dsh\profiles\desktop\cordis.patch.yml` 中由标记 `# >>> wonderland-lua-strict preset` 与 `# <<< wonderland-lua-strict preset` 包围的区块。
   该层在**所有 bundle 之后**应用，所以插件升级不会覆盖它；插入行 id 为 `preset-wonderland-lua-strict`。
2. **技能内容**：`C:\Users\18182\AppData\Local\dsh-plugins\dsh-preset-wonderland-lua-builder\skills\`（ASCII 路径）。
   区块里的 `customSkillDirs` 是指向该目录的**字面绝对路径**，不依赖运行时表达式。

> 为什么不直接改插件包：插件包内的预设会在 `dsh plugin` 升级时被覆盖；而且运行中的 Harness 只在启动时读取 bundle 补丁，改了也未必立刻可见——这正是之前"看起来仍是原配置"的原因。另外 `~/.dsh/.agent-presets/` 这个旧目录**当前 DSH 不读取**，改它没有效果。

## 更新严格版内容

```powershell
cd "D:\新建文件夹\miHoYo Launcher\wonderland-lua-builder"

# 1) 改 skills/、README、evals 等源文件后，重建 bundle（含自检：YAML、声明形状、技能是否随包）
node tools/build-bundle.mjs --out "C:\Users\18182\AppData\Local\dsh-plugins\dsh-preset-wonderland-lua-builder"

# 2) 把声明写入/更新到 profile patch（幂等：按标记替换，写前备份，写后校验 YAML 与技能路径）
node tools/install-profile-preset.mjs `
  --profile-patch "$env:USERPROFILE\.dsh\profiles\desktop\cordis.patch.yml" `
  --bundle "C:\Users\18182\AppData\Local\dsh-plugins\dsh-preset-wonderland-lua-builder"
```

之后**重启 Harness**（bundle 补丁在启动时读取），再新建任务选择「千星 2D+Lua 游戏制作（严格版）」。
想确认声明已被加载：`cordis_inspect_query`（host / Config / listConfigs，`name = @deepseek-ai/dsh-agent-preset`）应能看到 `preset-wonderland-lua-strict`。

## 卸载严格版

```powershell
node tools/install-profile-preset.mjs `
  --profile-patch "$env:USERPROFILE\.dsh\profiles\desktop\cordis.patch.yml" --remove
```

再删除 `C:\Users\18182\AppData\Local\dsh-plugins\dsh-preset-wonderland-lua-builder` 即可。
profile patch 的备份为同目录下 `cordis.patch.yml.bak-<时间戳>`。

## 原版预设的备份

`…\node_modules\dsh-plugin-beyond-simulator\dsh-plugin\` 下：

- `cordis.patch.yml.bak-20261013-013017`（原始 18292 字节）
- `presets\wonderland-lua-builder.bak-20261013-013027`（原始 13 个文件）

需要时把它们拷回同名文件/目录即可，等价于恢复出厂设置。

## 与上游（第三方仓库）的关系

`1475505/miliastra-beyond-simulator` 是**模拟器作者的仓库**，不属于本项目，无法直接推送。所以本机安装刻意走「绕路」：
**profile patch 里的一条声明 + 一个独立 bundle 目录**，与上游插件包完全解耦——上游怎么升级都不影响它，也不需要改 `node_modules`。

想把这些改进反馈给作者时，走 fork + PR：

1. 用 `fangao1437` 打开 https://github.com/1475505/miliastra-beyond-simulator/fork ，点 **Create fork**。
2. 告诉我一声，我把已验证的提交推到 fork 的分支并给出 PR 链接（本机凭据对自己的 fork 有写权限）：
   ```powershell
   cd "D:\新建文件夹\miHoYo Launcher\_push-wonderland-preset"
   git remote add fork https://github.com/fangao1437/miliastra-beyond-simulator.git
   git push fork master:preset/precise-2d-lua-workflow
   ```
3. 在 GitHub 上从这个分支向 `1475505:master` 开 Pull Request。

本地提交 `6f801b0`（含可移植补丁 `..\_push-pending\wonderland-lua-builder-preset.patch`，已在全新 clone 上验证 `git am` 后可复现整棵树）一直保留，随时可用；不 fork 也不影响本机使用。
