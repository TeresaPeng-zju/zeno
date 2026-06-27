#!/bin/bash
set -e

echo "=== Zeno Production Deploy ==="

# 检查 .env 是否存在
if [ ! -f .env ]; then
    echo "ERROR: .env file not found. Copy deploy/.env.example to .env and fill in values."
    exit 1
fi

# 加载环境变量
source .env

# 构建并启动
echo "1/4 Building images..."
docker compose -f docker-compose.prod.yml build

echo "2/4 Starting services..."
docker compose -f docker-compose.prod.yml up -d

echo "3/4 Running database migrations..."
docker compose -f docker-compose.prod.yml exec api alembic upgrade head

echo "4/4 Health check..."
sleep 3
curl -sf http://localhost:8000/api/health > /dev/null && echo "✓ API healthy" || echo "✗ API not responding"
curl -sf http://localhost:3000 > /dev/null && echo "✓ Web healthy" || echo "✗ Web not responding"

echo ""
echo "=== Deploy complete ==="
echo "Visit: http://localhost (or your domain)"
