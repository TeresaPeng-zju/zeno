from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import settings
from app.core.startup_checks import validate_skill_references
from app.routers import catalog, explain, resources, sessions


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Schema is owned by Alembic now (`alembic upgrade head` on deploy / locally),
    # NOT by create_all — that's what fixed the silent schema drift. The app only
    # fails fast if any resource/requirement references a skill absent from the
    # graph (our application-layer stand-in for a skills foreign key).
    validate_skill_references()
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
app.include_router(explain.router)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
