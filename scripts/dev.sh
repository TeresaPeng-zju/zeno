#!/usr/bin/env bash
# 一键启动全栈：数据库 + 后端(:8000) + 前端(:3000)。Ctrl-C 一起关闭。
# 首次运行若未安装依赖，会自动先跑 scripts/setup.sh。
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$PWD"

# 0) 首次未安装 → 自动 setup
if [ ! -d apps/api/.venv ] || [ ! -d apps/web/node_modules ]; then
  echo "▶ 检测到未安装依赖，先执行一次性安装…"
  bash scripts/setup.sh
fi

# 1) 数据库（有 Docker 用 Docker，否则用本地 / Homebrew Postgres）
echo "▶ 启动数据库…"
if command -v docker >/dev/null 2>&1; then
  docker compose up -d db
elif command -v brew >/dev/null 2>&1 && brew services list 2>/dev/null | grep -q postgresql; then
  PG=$(brew services list | awk '/postgresql/{print $1; exit}')
  echo "  未发现 Docker，启动本地 Homebrew Postgres ($PG)…"
  brew services start "$PG" >/dev/null 2>&1 || true
else
  echo "  未发现 Docker，假设本地 Postgres 已在运行（见 apps/api/.env）。"
fi

# 1.5) 释放上次没退干净、占着 8000/3000 的旧进程，避免 "Address already in use"
for port in 8000 3000; do
  pids=$(lsof -ti "tcp:$port" 2>/dev/null || true)
  if [ -n "$pids" ]; then
    echo "  端口 $port 被占用，清理旧进程…"
    # shellcheck disable=SC2086
    kill -9 $pids 2>/dev/null || true
  fi
done

# 2) 后端（后台）
echo "▶ 启动后端 http://localhost:8000 …"
cd "$ROOT/apps/api"
# shellcheck disable=SC1091
source .venv/bin/activate
alembic upgrade head >/dev/null 2>&1 || true
uvicorn app.main:app --reload --port 8000 &
API_PID=$!
cd "$ROOT"

# 退出时清理后端
cleanup() { echo; echo "▶ 关闭服务…"; kill "$API_PID" 2>/dev/null || true; exit 0; }
trap cleanup INT TERM

# 3) 前端（前台；退出后连带关掉后端）
echo "▶ 启动前端 http://localhost:3000 …"
cd "$ROOT/apps/web"
pnpm dev || true
cleanup
