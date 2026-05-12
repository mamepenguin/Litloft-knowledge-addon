"""Unit tests for ``app.services.frontmatter.ensure_id`` (knowledge parallel).

Spec: docs/superpowers/specs/2026-05-12-markdown-link-three-forms.md §3.1 / §4 Phase A.

The knowledge addon runs in a separate container and cannot share code
with core (``.claude/rules/design-decisions.md``: parallel implementation
required, drift caught at PR review). This file mirrors the behaviour
locked in by ``backend/tests/test_frontmatter_ensure_id.py``.
"""
from __future__ import annotations

import re
from datetime import datetime, timezone

import pytest

from app.services.frontmatter import compose, ensure_id, parse


_ID_RE = re.compile(r"^\d{12,17}$")


class TestEnsureIdGenerates:
    def test_injects_timestamp_when_id_missing(self) -> None:
        now = datetime(2026, 5, 12, 14, 30, 28, tzinfo=timezone.utc)
        new_meta, new_id = ensure_id({"tags": ["a"]}, existing_id=None, now=now)
        assert new_id == "20260512143028"
        assert new_meta["id"] == "20260512143028"

    def test_generated_id_is_14_digits(self) -> None:
        now = datetime(2026, 1, 2, 3, 4, 5, tzinfo=timezone.utc)
        _, new_id = ensure_id({}, existing_id=None, now=now)
        assert _ID_RE.match(new_id)
        assert len(new_id) == 14


class TestEnsureIdPreserves:
    def test_valid_string_id_unchanged(self) -> None:
        new_meta, new_id = ensure_id(
            {"id": "20260512143028"}, existing_id=None, now=None
        )
        assert new_id == "20260512143028"
        assert new_meta["id"] == "20260512143028"

    def test_valid_int_id_normalised_to_string(self) -> None:
        new_meta, new_id = ensure_id(
            {"id": 20260512143028}, existing_id=None, now=None
        )
        assert new_id == "20260512143028"
        assert isinstance(new_meta["id"], str)

    def test_17_digit_id_preserved(self) -> None:
        _, new_id = ensure_id(
            {"id": "20260512143028123"}, existing_id=None, now=None
        )
        assert new_id == "20260512143028123"


class TestEnsureIdRejectsInvalid:
    def test_non_digit_id_overwritten_with_existing(self) -> None:
        now = datetime(2026, 5, 12, 14, 30, 28, tzinfo=timezone.utc)
        _, new_id = ensure_id(
            {"id": "abc"}, existing_id="20260101000000", now=now
        )
        assert new_id == "20260101000000"

    def test_empty_string_id_overwritten(self) -> None:
        now = datetime(2026, 5, 12, 14, 30, 28, tzinfo=timezone.utc)
        _, new_id = ensure_id({"id": ""}, existing_id=None, now=now)
        assert new_id == "20260512143028"

    def test_invalid_with_no_existing_generates_fresh(self) -> None:
        now = datetime(2026, 5, 12, 14, 30, 28, tzinfo=timezone.utc)
        _, new_id = ensure_id(
            {"id": "not-valid"}, existing_id=None, now=now
        )
        assert new_id == "20260512143028"


class TestEnsureIdReinjectsFromExisting:
    def test_missing_id_with_existing_uses_existing(self) -> None:
        new_meta, new_id = ensure_id(
            {"tags": ["a"]}, existing_id="20260101000000", now=None
        )
        assert new_id == "20260101000000"
        assert new_meta["id"] == "20260101000000"


class TestEnsureIdOrdering:
    def test_id_appears_first_in_returned_dict(self) -> None:
        now = datetime(2026, 5, 12, 14, 30, 28, tzinfo=timezone.utc)
        new_meta, _ = ensure_id(
            {"tags": ["a"], "created": "2026-05-12T14:30:28Z"},
            existing_id=None,
            now=now,
        )
        keys = list(new_meta.keys())
        assert keys[0] == "id"
        assert keys[1:] == ["tags", "created"]


class TestEnsureIdImmutability:
    def test_input_metadata_not_mutated(self) -> None:
        metadata = {"tags": ["a"]}
        original = dict(metadata)
        now = datetime(2026, 5, 12, 14, 30, 28, tzinfo=timezone.utc)
        ensure_id(metadata, existing_id=None, now=now)
        assert metadata == original
        assert "id" not in metadata

    def test_returns_new_dict_instance(self) -> None:
        metadata = {"id": "20260512143028"}
        new_meta, _ = ensure_id(metadata, existing_id=None, now=None)
        assert new_meta is not metadata


class TestComposeWithId:
    """``compose`` (existing) emits ``id`` first when present."""

    def test_roundtrip_with_id(self) -> None:
        metadata = {"id": "20260512143028", "tags": ["a"]}
        body = "# Hello\n\nbody\n"
        composed = compose(metadata, body)
        parsed = parse(composed)
        assert parsed.metadata == metadata
        assert parsed.body == body

    def test_compose_emits_id_first(self) -> None:
        metadata = {"id": "20260512143028", "tags": ["a"]}
        composed = compose(metadata, "")
        id_idx = composed.find("id:")
        tags_idx = composed.find("tags:")
        assert 0 <= id_idx < tags_idx
