"""Pydantic request/response models for knowledge endpoints."""
from datetime import datetime

from pydantic import BaseModel, Field


class VaultCreate(BaseModel):
    label: str = Field(min_length=1, max_length=100)
    drive: str = Field(min_length=1, max_length=128)
    path: str = Field(default="", max_length=4000)


class VaultUpdate(BaseModel):
    label: str = Field(min_length=1, max_length=100)


class VaultOut(BaseModel):
    id: int
    label: str
    drive: str
    path: str
    is_active: bool
    created_at: datetime

    model_config = {"from_attributes": True}


class VaultListResponse(BaseModel):
    vaults: list[VaultOut]
    active_vault_id: int | None


class ClipCreate(BaseModel):
    url: str = Field(min_length=1, max_length=4000)
    vault_id: int


class ClipPasted(BaseModel):
    url: str = Field(min_length=1, max_length=4000)
    vault_id: int
    html: str = Field(min_length=1, max_length=5 * 1024 * 1024)


class ClipJobOut(BaseModel):
    job_id: int
    file_id: str
    status: str


class SearchHit(BaseModel):
    file_id: str
    filename: str
    title: str
    snippet: str


class SearchResponse(BaseModel):
    query: str
    vault_id: int
    results: list[SearchHit]
    truncated: bool
