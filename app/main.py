"""FastAPI entry point for the knowledge addon.

Routers are added in subsequent phases (P3 vaults, P5 clips, P7 search).
For P2 we only expose ``/health`` so the Generic Addon Proxy and the
addon status aggregator can detect the service.
"""
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI

from app.database import init_schema

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_schema()
    logger.info("knowledge addon: schema initialized")
    yield


app = FastAPI(
    title="HomeVault Knowledge Addon",
    description="Notes and web clips — personal knowledge hub for HomeVault",
    lifespan=lifespan,
)


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}
