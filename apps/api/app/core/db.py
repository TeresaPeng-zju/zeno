from collections.abc import Iterator

from sqlalchemy import create_engine, text
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.core.config import settings

# SQLite (Week 1 local dev) needs check_same_thread=False because FastAPI runs
# sync endpoints across a threadpool. Postgres ignores this and uses pool_pre_ping.
_connect_args = (
    {"check_same_thread": False} if settings.database_url.startswith("sqlite") else {}
)

engine = create_engine(
    settings.database_url, pool_pre_ping=True, future=True, connect_args=_connect_args
)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)


class Base(DeclarativeBase):
    pass


def init_db() -> None:
    """Create the schema directly from the ORM models.

    NOTE: production/dev schema is managed by Alembic (`alembic upgrade head`);
    the app no longer calls this on startup. It is kept ONLY as a convenience
    for tests and throwaway local bootstrap (e.g. the pg_only curation test),
    where spinning up a one-shot schema is simpler than running migrations.

    The `vector` extension MUST exist before `create_all`, because the
    ``resources`` table declares a ``Vector`` column.
    """
    import app.models  # noqa: F401  (register models on Base.metadata)

    if settings.database_url.startswith("postgresql"):
        with engine.begin() as conn:
            conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))

    Base.metadata.create_all(bind=engine)


def get_db() -> Iterator[Session]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
