#!/usr/bin/env bash
# 在 macOS 本机运行：把微信开发者工具内置 wechatide-skill 同步到用户目录与本仓库
set -euo pipefail

SRC="${WECHATIDE_SKILL_SRC:-/Applications/wechatwebdevtools.app/Contents/Resources/app.asar.unpacked/wechatide-skill}"
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
USER_DST="${HOME}/.cursor/skills/wechatide-skill"
REPO_DST="${REPO_ROOT}/.cursor/skills/wechatide-skill"

if [[ ! -d "$SRC" ]]; then
  echo "找不到内置 skill：$SRC"
  echo "请安装 Nightly 微信开发者工具，或在菜单中「导出开发者工具 Skill」。"
  exit 1
fi

mkdir -p "$USER_DST" "$REPO_DST"
rsync -a --delete "$SRC/" "$USER_DST/"
# 仓库内保留桥接说明：若内置包含 SKILL.md 则覆盖；桥接文件已同名会被官方版替换（这是期望行为）
rsync -a "$SRC/" "$REPO_DST/"

echo "已同步："
echo "  $SRC"
echo "  -> $USER_DST"
echo "  -> $REPO_DST"
if command -v wechatide >/dev/null 2>&1; then
  VER="$(grep -E '^version:' "$USER_DST/SKILL.md" 2>/dev/null | head -1 | awk '{print $2}' || true)"
  echo "可检查状态：wechatide -c Cursor check_wechatide_status --skill-version ${VER:-<version>}"
else
  echo "提示：PATH 中尚无 wechatide，可重启终端或检查开发者工具安装。"
fi
