"""Path validation tests — mirror of the core's test_safepath.py minus
the drive-resolution cases, since the addon's version is structural-only.
"""
import pytest
from fastapi import HTTPException

from app.services.safepath import validate_filename, validate_relative_path


class TestValidateRelativePath:
    def test_accepts_valid_path(self):
        assert validate_relative_path("Notes/2026/memo.md") == "Notes/2026/memo.md"

    def test_accepts_empty(self):
        assert validate_relative_path("") == ""

    def test_accepts_japanese(self):
        assert validate_relative_path("ノート/メモ.md") == "ノート/メモ.md"

    def test_rejects_traversal(self):
        with pytest.raises(HTTPException):
            validate_relative_path("../etc/passwd")

    def test_rejects_absolute(self):
        with pytest.raises(HTTPException):
            validate_relative_path("/etc/passwd")

    def test_rejects_nul(self):
        with pytest.raises(HTTPException):
            validate_relative_path("foo\x00bar")

    def test_rejects_overlong(self):
        with pytest.raises(HTTPException):
            validate_relative_path("x" * 4001)

    def test_rejects_reserved_component(self):
        with pytest.raises(HTTPException):
            validate_relative_path("Notes/CON.md")


class TestValidateFilename:
    def test_accepts_normal(self):
        validate_filename("memo.md")

    def test_rejects_empty(self):
        with pytest.raises(HTTPException):
            validate_filename("")

    def test_rejects_dot(self):
        with pytest.raises(HTTPException):
            validate_filename(".")

    def test_rejects_separator(self):
        with pytest.raises(HTTPException):
            validate_filename("a/b.md")

    def test_rejects_nul(self):
        with pytest.raises(HTTPException):
            validate_filename("a\x00.md")

    def test_rejects_reserved(self):
        with pytest.raises(HTTPException):
            validate_filename("NUL")
        with pytest.raises(HTTPException):
            validate_filename("con.md")
