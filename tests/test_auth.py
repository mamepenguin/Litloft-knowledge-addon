"""Viewer identification via proxy-injected X-Lit-Viewer-Id."""
import pytest
from fastapi import HTTPException

from app.auth import get_optional_viewer_id, get_viewer_id
from tests.conftest import viewer_id_for_nickname


class TestGetOptionalViewerId:
    def test_none_returns_none(self):
        assert get_optional_viewer_id(None) is None

    def test_empty_returns_none(self):
        assert get_optional_viewer_id("") is None
        assert get_optional_viewer_id("   ") is None

    def test_overlong_rejected(self):
        assert get_optional_viewer_id("x" * 51) is None

    def test_returns_viewer_id(self):
        viewer_id = viewer_id_for_nickname("alice")
        assert get_optional_viewer_id(viewer_id) == viewer_id


class TestGetViewerId:
    def test_raises_when_missing(self):
        with pytest.raises(HTTPException) as exc:
            get_viewer_id(None)
        assert exc.value.status_code == 401

    def test_raises_when_empty(self):
        with pytest.raises(HTTPException) as exc:
            get_viewer_id("")
        assert exc.value.status_code == 401

    def test_returns_id(self):
        viewer_id = viewer_id_for_nickname("alice")
        assert get_viewer_id(viewer_id) == viewer_id
