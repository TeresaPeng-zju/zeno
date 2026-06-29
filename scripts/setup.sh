#!/usr/bin/env bash
# 一次性安装：后端 venv + 依赖、前端依赖、数据库建表、灌种子资源。
# 前置：已装 docker、python3、node、pnpm。
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$PWD"

echo "▶ [1/5] 后端 venv + 依赖…"
cd "$ROOT/apps/api"
[ -d .venv ] || python3 -m venv .venv
# shellcheck disable=SC1091
source .venv/bin/activate
pip install -q --upgrade pip
pip install -q -e .
[ -f .env ] || { cp .env.example .env; echo "  已从 .env.example 生成 .env"; }

echo "▶ [2/5] 启动数据库…"
cd "$ROOT"
if command -v docker >/dev/null 2>&1; then
  echo "  使用 Docker 启动 Postgres…"
  docker compose up -d db
elif command -v brew >/dev/null 2>&1 && brew services list 2>/dev/null | grep -q postgresql; then
  PG=$(brew services list | awk '/postgresql/{print $1; exit}')
  echo "  未发现 Docker，启动本地 Homebrew Postgres ($PG)…"
  brew services start "$PG" >/dev/null 2>&1 || true
else
  echo "  未发现 Docker，假设本地 Postgres 已在运行（见 apps/api/.env 的 DATABASE_URL）。"
fi

echo "▶ [3/5] 等待数据库就绪…"
for _ in $(seq 1 30); do
  if command -v pg_isready >/dev/null 2>&1; then
    pg_isready -h localhost -p 5432 >/dev/null 2>&1 && break
  else
    (exec 3<>/dev/tcp/localhost/5432) 2>/dev/null && { exec 3>&- 3<&-; break; }
  fi
  sleep 1
done

echo "▶ [4/5] 建表 (alembic) + 灌种子资源…"
cd "$ROOT/apps/api"
alembic upgrade head
python - <<'PY'
from app.core.db import SessionLocal
from app.services import resource_service
from app.data.seed_resources import SEED_RESOURCES
db = SessionLocal()
for item in SEED_RESOURCES:
    resource_service.upsert_resource(db, **item)
db.commit()
print(f"  已灌入 {len(SEED_RESOURCES)} 条种子资源")
db.close()
PY

echo "▶ [5/5] 前端依赖 (pnpm)…"
cd "$ROOT/apps/web"
pnpm install

echo ""
echo "✅ 安装完成。下次直接运行：npm run dev  （或 bash scripts/dev.sh）"
