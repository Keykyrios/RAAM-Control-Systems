from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.core.config import settings
from app.core.database import Base, engine
from app.models import entities  # noqa: F401 ensures all models are registered
from app.api.routes import router


@asynccontextmanager
async def lifespan(_: FastAPI):
    # Schema bootstrap is convenient for local development. Production should use Alembic migrations.
    Base.metadata.create_all(bind=engine)
    yield


app = FastAPI(title=settings.app_name, version="0.1.0", description="Auditable spare-parts inventory control reference implementation", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=settings.cors_origin_list, allow_credentials=True,
                   allow_methods=["GET", "POST", "PATCH", "DELETE"], allow_headers=["*"])
app.include_router(router)


@app.get("/")
def root() -> dict:
    return {"name": settings.app_name, "docs": "/docs", "api": "/api/v1", "demo_mode": settings.demo_mode}
