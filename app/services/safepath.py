"""Mirror of the core's safepath helper, minus drive resolution.

The core validates drive+rel_path against the authoritative drives.json;
knowledge doesn't have drives.json, so this is a structural check only
(no traversal, no NUL, no symlinks, no reserved names, no absolute paths,
length limits). The drive+path actually resolving to a safe location is
verified by the core whenever knowledge calls
``POST /api/drives/{drive}/files`` or ``PUT /content`` — we don't need
to re-implement that check here. This helper is used to reject obviously
bad inputs before we bother calling the core.
"""
from fastapi import HTTPException

_MAX_PATH_LENGTH = 4000
_MAX_FILENAME_LENGTH = 255

_WINDOWS_RESERVED_NAMES = frozenset({
    "CON", "PRN", "AUX", "NUL",
    "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9",
    "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
})


def _has_forbidden_chars(value: str) -> bool:
    for ch in value:
        if ch == "\x00" or ord(ch) < 0x20:
            return True
    return False


def _is_reserved_name(name: str) -> bool:
    if not name:
        return False
    stem = name.split(".", 1)[0].upper()
    return stem in _WINDOWS_RESERVED_NAMES


def validate_filename(name: str) -> None:
    if not name:
        raise HTTPException(status_code=400, detail="Filename is empty")
    if name in (".", ".."):
        raise HTTPException(status_code=400, detail="Invalid filename")
    if "/" in name or "\\" in name:
        raise HTTPException(status_code=400, detail="Filename cannot contain path separators")
    if _has_forbidden_chars(name):
        raise HTTPException(status_code=400, detail="Filename contains forbidden characters")
    if len(name) > _MAX_FILENAME_LENGTH:
        raise HTTPException(status_code=400, detail="Filename too long")
    if _is_reserved_name(name):
        raise HTTPException(status_code=400, detail="Filename uses a reserved name")


def validate_relative_path(rel_path: str) -> str:
    """Structural validation of a drive-relative path.

    Does not touch the filesystem — returns the input unchanged if valid,
    or raises HTTPException(400). The core performs the authoritative
    check when it receives the path.
    """
    if rel_path is None:
        raise HTTPException(status_code=400, detail="Path is required")
    if len(rel_path) > _MAX_PATH_LENGTH:
        raise HTTPException(status_code=400, detail="Path too long")
    if _has_forbidden_chars(rel_path):
        raise HTTPException(status_code=400, detail="Path contains forbidden characters")
    if rel_path.startswith("/") or rel_path.startswith("\\"):
        raise HTTPException(status_code=400, detail="Absolute paths not allowed")

    parts = [p for p in rel_path.replace("\\", "/").split("/") if p and p != "."]
    for part in parts:
        if part == "..":
            raise HTTPException(status_code=400, detail="Parent directory traversal not allowed")
        validate_filename(part)

    return rel_path
