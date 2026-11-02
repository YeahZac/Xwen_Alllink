---
name: miniprogram
description: >-
  本仓库微信小程序任务入口。用户提到微信开发者工具、小程序预览/编译/真机调试、
  project.config.json、云托管/云开发、模拟器自动化时使用。实际能力委托 wechatide-skill。
---

# miniprogram

本占位 skill 已对齐微信开发者工具工作流。

**请改用并阅读**：`.cursor/skills/wechatide-skill/SKILL.md`

若本机已从开发者工具导出完整包，优先使用：

- `~/.cursor/skills/wechatide-skill/SKILL.md`
- 或内置：`/Applications/wechatwebdevtools.app/Contents/Resources/app.asar.unpacked/wechatide-skill`

## 本仓库约定

- 小程序源码目录：`miniprogram/`
- AppID：`wx0a5179e12939d28e`（见 `miniprogram/project.config.json`）
- 工作分支（当前云端改动）：`cursor/cloud-agent-1793452129102-8e4r4`
- 分类页验收：无「异业兑换」大标题、无店卡「异业」红标；列表含可兑门店（异业+地摊）

改完 UI 必须走 wechatide-skill 的「标准收尾」：push →（本机/worker）清缓存编译 → 打开 `pages/cross/cross` 截图确认。
