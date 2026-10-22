# 推送到 GitHub —— 用户需要做的那一步

## 现状

本地仓库已经建好、提交完成，`origin` 已经指向：

```
https://github.com/fangao1437/qianxing-murdoku-tool.git
```

但**远端仓库还不存在**（GitHub API 对 `fangao1437/qianxing-murdoku-tool` 返回 **404**：
仓库未创建，或者是私有而我们没有凭据）。所以 `git push` 必然失败 ——
**本地提交不受影响，一个字节都没丢**。

## 你要做的（二选一）

### 方案 A：在 GitHub 网页上建空仓库（推荐）

1. 打开 <https://github.com/new>
2. **Repository name** 填：`qianxing-murdoku-tool`
3. **不要**勾 "Add a README file" / "Add .gitignore" / "Choose a license"
   —— 勾了远端会先有一个提交，`push` 时会因为历史不同被拒（那时就得 `git pull --rebase`，多一步）。
4. 可见性：公开或私有都可以（本仓库没有敏感内容；但**素材/存档本来就不在里面**，见 `THIRD_PARTY.md`）。
5. 建完回来跑下面那条命令。

### 方案 B：用 `gh` CLI 建

```bash
gh repo create fangao1437/qianxing-murdoku-tool --private --source=. --remote=origin --push
```

（`--public` 换成公开。这条会一步完成建仓 + 推送；若你已经按本仓库准备好的历史提交过，
用 `--push` 会把当前分支推上去。）

## 然后：一条推送命令

```powershell
cd "D:\新建文件夹\miHoYo Launcher\qianxing-murdoku-tool"
git push -u origin main
```

需要的凭据：GitHub 用户名 `fangao1437` + **个人访问令牌（PAT，classic 勾 `repo` 或 fine-grained 给该仓库 Contents: write）**，
不要用账号密码（GitHub 已经不支持）。凭据由 Git Credential Manager 弹窗接管。

## 推送成功的判据

```powershell
git ls-remote --heads origin      # 应打印 refs/heads/main 与一个 sha
git log --oneline -1              # 本地 HEAD 的 sha 应与上面一致
```

两条 sha 一致 = 真的推上去了。**不要**只看 "Everything up-to-date" 之类的输出。

## 如果 push 报错

| 错误 | 含义 | 处理 |
| --- | --- | --- |
| `Repository not found` / `404` | 远端没建，或凭据没有该仓库权限（私有） | 回到方案 A/B 建仓；或确认 PAT 的仓库范围 |
| `Authentication failed` | 凭据过期/没权限 | `git credential-manager` 清一次再推 |
| `! [rejected] main -> main (fetch first)` | 远端已有提交（建仓时勾了 README/license） | `git pull --rebase origin main` 再 `git push -u origin main`。**不要** `--force` |
| `src refspec main does not match any` | 还没提交 | 先提交（本仓库已提交过，正常不会遇到） |

**无论如何都不要用 `--force` / `--mirror`** —— 这是个新仓库，没有需要强推的东西。

## 这次为什么没有替你重试

远端不存在是**确定性失败**（不是网络抖动），重试只会刷屏。按流程只试一次，
然后把"建仓 + 一条命令"交给你 —— 这也是唯一需要人工授权的一步（建 GitHub 仓库、给凭据）。
