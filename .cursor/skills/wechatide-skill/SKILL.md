---
name: wechatide-skill
description: >-
  微信开发者工具（wechatide）工作流入口：同步本仓库代码到本机 DevTools、编译预览、
  打开分类/首页等页面、截图验收。用户提到微信开发者工具、模拟器、编译、预览、
  真机调试、wechatide、分类页是否最新时使用。
---

# wechatide-skill（本仓库桥接）

## 重要结论（先读）

1. **官方完整 skill** 来自本机微信开发者工具内置包，路径通常为：
   `/Applications/wechatwebdevtools.app/Contents/Resources/app.asar.unpacked/wechatide-skill`
2. 本文件是**仓库级桥接 skill**，保证 Cloud / 本地 Agent 都能发现「要用 wechatide」。
3. **Cloud Agent 默认连不上你 Mac 上的开发者工具**（无 `wechatide` CLI、无本机窗口）。要让云端 Agent 直接操作模拟器，需在本机启动 Cursor **Self-hosted worker**（`agent worker start`），或在 **本机 Cursor Agent** 会话中执行本 skill。
4. 用户本机历史路径（以实际为准）：
   - 项目：`/Users/Admin1/Cursor_AI_Project/熊文-供应链异业门店商业模式`
   - 小程序目录：上述路径下的 `miniprogram/`（含 `app.json` / `project.config.json`）
   - 用户级 skill 副本：`~/.cursor/skills/wechatide-skill/`

## 何时同步官方完整 skill

在 **macOS 本机终端**（不要粘到微信开发者工具 Console）：

```bash
# 1) 确认 CLI
which wechatide || ls "/Applications/wechatwebdevtools.app/Contents/MacOS/"

# 2) 用内置包覆盖用户级 skill（推荐）
SRC="/Applications/wechatwebdevtools.app/Contents/Resources/app.asar.unpacked/wechatide-skill"
mkdir -p "$HOME/.cursor/skills/wechatide-skill"
cp -R "$SRC/." "$HOME/.cursor/skills/wechatide-skill/"

# 3) 同步到本仓库（可选，便于团队/Cloud 检出）
REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
mkdir -p "$REPO_ROOT/.cursor/skills/wechatide-skill"
cp -R "$SRC/." "$REPO_ROOT/.cursor/skills/wechatide-skill/"
```

也可用开发者工具菜单：**导出开发者工具 Skill → 导入到 Cursor**。

导入后读完整 `SKILL.md` frontmatter 的 `version`，再跑：

```bash
wechatide -c Cursor check_wechatide_status --skill-version <version>
```

需 `loginExpired: false`。若提示 `agent_behind`，重新从内置路径覆盖一次 skill。

## 本仓库：确认 DevTools 是否最新 + 强制同步

**判定标准（分类页）：**

| 现象 | 含义 |
|------|------|
| 仍见大字「异业兑换」或店卡红标「异业」 | **不是**最新代码（需 ≤ `bcc8c28` 之后的分支） |
| 顶栏仅「分类兑换」+ 积分行，店卡无「异业」角标 | 已是目标结构 |

### A. 本机拉代码（必需）

```bash
cd "/Users/Admin1/Cursor_AI_Project/熊文-供应链异业门店商业模式"
# 若该目录不是 git 根，先 cd 到含 .git 的目录

git fetch origin
git checkout cursor/cloud-agent-1793452129102-8e4r4
git pull origin cursor/cloud-agent-1793452129102-8e4r4
git log -1 --oneline
# 期望含：Harden classification page / Fix Shajing default preload 等

# 自检：cross.wxml 不应再有展示用「异业兑换」标题
grep -n "异业兑换\|store-tile__badge\|异业\"" miniprogram/pages/cross/cross.wxml || true
```

### B. 用 wechatide 刷新模拟器（本机 Agent / worker 上执行）

```bash
PROJECT="/Users/Admin1/Cursor_AI_Project/熊文-供应链异业门店商业模式"

wechatide -c Cursor open_project_window --project "$PROJECT" --window-mode fullMode
wechatide -c Cursor debug_clear_cache --project "$PROJECT"
wechatide -c Cursor simulator_open_page --project "$PROJECT" --page pages/cross/cross
wechatide -c Cursor simulator_refresh --project "$PROJECT"
wechatide -c Cursor simulator_screenshot --project "$PROJECT"
```

工具名以本机完整 skill 的 `--help` / `tools.yaml` 为准；若 `check_wechatide_status` 与文档参数不一致，以本机 skill 为准。

### C. Cloud Agent 想直接操作 DevTools

1. 本机安装并登录 Cursor CLI，执行 `agent worker start`（Self-hosted / My Machines）。
2. 云端会话才能在该 worker 上跑 `wechatide`。
3. 当前云 VM **没有** `wechatide`，也 **没有** 已连接的 self-hosted worker 时：只能改 GitHub；必须由本机 pull 后 DevTools 才会变。

## 每次改完小程序 UI 的标准收尾

1. 提交并 `git push` 到当前工作分支。
2. 若在本机 / worker：执行上面 **B**（清缓存 → 打开分类页 → 刷新 → 截图）。
3. 截图确认：无「异业兑换」大标题、无店卡「异业」角标。
4. 向用户报告：分支名、commit、截图路径；若无法调用 wechatide，明确写「仅已推 GitHub，请本机 pull」。

## 相关占位

见同目录旁的 `miniprogram` skill：提醒改用本 skill / 完整 wechatide-skill。
