# Vercel Python 函数入口：把 FastAPI 的 ASGI app 暴露给 Vercel 运行时。
# Vercel 会直接服务这个 `app`，无需 uvicorn。所有路由经 vercel.json 的 rewrite 打到这里。
from app.main import app  # noqa: F401
