#!/bin/bash
# Zeno 一键启动前后端

ROOT="$(cd "$(dirname "$0")" && pwd)"

# 杀掉旧进程
lsof -ti:3000 | xargs kill -9 2>/dev/null
lsof -ti:8000 | xargs kill -9 2>/dev/null

echo "🚀 启动后端 (localhost:8000)..."
cd "$ROOT/apps/api"
source .venv/bin/activate
uvicorn app.main:app --port 8000 --reload &
API_PID=$!

echo "🚀 启动前端 (localhost:3000)..."
cd "$ROOT/apps/web"
npm run dev &
WEB_PID=$!

echo ""
echo "✓ 后端 PID: $API_PID → http://localhost:8000"
echo "✓ 前端 PID: $WEB_PID → http://localhost:3000"
echo ""
echo "按 Ctrl+C 停止所有服务"

trap "kill $API_PID $WEB_PID 2>/dev/null; exit" SIGINT SIGTERM
wait
