from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import settings
from app.core.db import init_db
from app.routers import catalog, resources, sessions


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Enable pgvector + create tables. Alembic migrations land later in Week 3.
    init_db()
    yield


app = FastAPI(title="Zeno API", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(sessions.router)
app.include_router(catalog.router)
app.include_router(resources.router)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
