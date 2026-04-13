"""Viewer identification via hv_viewer cookie.

The addon never accepts a viewer_id from the request body or query string
— it is always derived from the authenticated cookie so that malicious
clients cannot impersonate another user's Vaults.
"""
import pytest
from fastapi import HTTPException

from app.auth import get_optional_viewer_id, get_viewer_id, nickname_to_viewer_id


class TestNicknameToViewerId:
    def test_deterministic(self):
        assert nickname_to_viewer_id("alice") == nickname_to_viewer_id("alice")

    def test_different_for_different_nicknames(self):
        assert nickname_to_viewer_id("alice") != nickname_to_viewer_id("bob")

    def test_16_char_hex(self):
        vid = nickname_to_viewer_id("alice")
        assert len(vid) == 16
        assert all(c in "0123456789abcdef" for c in vid)

    def test_trims_whitespace(self):
        assert nickname_to_viewer_id("  alice  ") == nickname_to_viewer_id("alice")


class TestGetOptionalViewerId:
    def test_none_returns_none(self):
        assert get_optional_viewer_id(None) is None

    def test_empty_returns_none(self):
        assert get_optional_viewer_id("") is None
        assert get_optional_viewer_id("   ") is None

    def test_overlong_rejected(self):
        assert get_optional_viewer_id("x" * 51) is None

    def test_returns_viewer_id(self):
        assert get_optional_viewer_id("alice") == nickname_to_viewer_id("alice")


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
        assert get_viewer_id("alice") == nickname_to_viewer_id("alice")
