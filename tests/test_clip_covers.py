"""SPEC-ADDON-140: clip covers and sites, read from each clip's start."""
from __future__ import annotations

import httpx
import pytest

from app.internal_client import InternalAPIError
from tests.conftest import FakeInternalClient


class CoversFake(FakeInternalClient):
    accessible_ids: list[str] = []
    drive_of: dict[str, str] = {}
    mime_of: dict[str, str] = {}
    type_of: dict[str, str] = {}
    gone: set[str] = set()
    contents: dict[str, str] = {}
    content_failures: dict[str, Exception] = {}
    filter_failure: Exception | None = None
    bulk_failures: list[Exception | None] = []
    bulk_calls: list[list[str]] = []

    async def filter_file_ids(self, file_ids):
        if CoversFake.filter_failure is not None:
            raise CoversFake.filter_failure
        return [i for i in file_ids if i in CoversFake.accessible_ids]

    async def fetch_bulk_files(self, file_ids):
        n = len(CoversFake.bulk_calls)
        CoversFake.bulk_calls.append(list(file_ids))
        if n < len(CoversFake.bulk_failures) and CoversFake.bulk_failures[n]:
            raise CoversFake.bulk_failures[n]
        return {
            "files": [
                {
                    "id": i,
                    "drive": CoversFake.drive_of.get(i, "test-drive"),
                    "mime_type": CoversFake.mime_of.get(i, "text/markdown"),
                    "file_type": CoversFake.type_of.get(i, "text"),
                }
                for i in file_ids
                if i not in CoversFake.gone
            ],
            "not_found": [],
        }

    async def get_file_opening(self, file_id: str, max_bytes: int) -> str:
        failure = CoversFake.content_failures.get(file_id)
        if failure is not None:
            raise failure
        return CoversFake.contents.get(file_id, "")[:max_bytes]


@pytest.fixture()
def fake(monkeypatch):
    import app.routers.clip_covers as router

    CoversFake.accessible_ids = []
    CoversFake.drive_of = {}
    CoversFake.mime_of = {}
    CoversFake.type_of = {}
    CoversFake.gone = set()
    CoversFake.contents = {}
    CoversFake.content_failures = {}
    CoversFake.filter_failure = None
    CoversFake.bulk_failures = []
    CoversFake.bulk_calls = []
    monkeypatch.setattr(router, "InternalClient", CoversFake)
    return CoversFake


def post(client, ids, viewer_cookie, drive="test-drive"):
    headers = dict(viewer_cookie)
    if drive is not None:
        headers["X-Lit-Drive"] = drive
    return client.post("/clip-covers", json={"file_ids": ids}, headers=headers)


def one(client, fake, viewer_cookie, text, images=None):
    """Answer for a single clip ``c`` whose start is ``text``."""
    fake.accessible_ids = ["c", *(images or {})]
    fake.contents = {"c": text}
    for image_id, kind in (images or {}).items():
        fake.type_of[image_id] = kind
    res = post(client, ["c"], viewer_cookie)
    assert res.status_code == 200
    return res.json()["covers"]["c"]


def cover(image_id=None, image_url=None, site=None):
    return {"image_id": image_id, "image_url": image_url, "site": site}


FM = "---\ntitle: T\nurl: https://www.Recipes.example:8080/a\n---\n"

# SPEC-ADDON-140 items 14 and I7: (name, start of file, loft images, answer)
TABLE = [
    ("loft image", "# T\n\n![pic](loft://img1)\n", {"img1": "image"}, cover("img1")),
    (
        "http image",
        "![x](https://cdn.example/p.jpg)",
        None,
        cover(image_url="https://cdn.example/p.jpg"),
    ),
    (
        "title form",
        '![x](https://cdn.example/p.jpg "A title")',
        None,
        cover(image_url="https://cdn.example/p.jpg"),
    ),
    ("html img ignored", '<img src="https://cdn.example/p.jpg">\n', None, cover()),
    (
        "image before link, first image wins",
        "![a](https://one.example/1.png) ![b](https://two.example/2.png)\n"
        "[read](https://blog.example/post)\n",
        None,
        cover(image_url="https://one.example/1.png", site="blog.example"),
    ),
    (
        "frontmatter url wins over a body link",
        FM + "[x](https://other.example/)\n",
        None,
        cover(site="recipes.example"),
    ),
    (
        "image url is not a site",
        "![x](https://cdn.example/p.jpg)\n",
        None,
        cover(image_url="https://cdn.example/p.jpg"),
    ),
    ("link target", "see [x](https://WWW.Blog.Example:81/p)", None, cover(site="blog.example")),
    ("autolink", "<https://auto.example/x>", None, cover(site="auto.example")),
    ("bare url", "read at https://bare.example/x.", None, cover(site="bare.example")),
    ("idn kept as written", "https://例え.jp/a", None, cover(site="例え.jp")),
    ("frontmatter url not http", "---\nurl: ftp://x.example\n---\nbody", None, cover()),
    ("none", "# Just text\n\nNo links.", None, cover()),
    (
        "relative image target is no cover",
        "![x](images/p.png)",
        None,
        cover(),
    ),
]


@pytest.mark.parametrize(
    "text,images,expected", [t[1:] for t in TABLE], ids=[t[0] for t in TABLE]
)
def test_spec_addon_140_cover_and_site(
    client, knowledge_db, fake, viewer_cookie, text, images, expected
):
    assert one(client, fake, viewer_cookie, text, images) == expected


@pytest.mark.parametrize(
    "kind,drive,gone",
    [
        ("not an image", "test-drive", False),
        ("image of another drive", "other", False),
        ("trashed or missing", "test-drive", True),
    ],
)
def test_spec_addon_140_a_loft_image_that_is_not_an_active_image_here_is_null(
    client, knowledge_db, fake, viewer_cookie, kind, drive, gone
):
    fake.drive_of["img1"] = drive
    if gone:
        fake.gone = {"img1"}
    images = {"img1": "text" if kind == "not an image" else "image"}
    got = one(client, fake, viewer_cookie, "![p](loft://img1)\nhttps://s.example/", images)
    assert got == cover(site="s.example")


def test_spec_addon_140_second_bulk_failure_nulls_image_id_only(
    client, knowledge_db, fake, viewer_cookie
):
    fake.bulk_failures = [None, InternalAPIError(500, "x")]
    got = one(
        client, fake, viewer_cookie, "![p](loft://img1)\nhttps://s.example/", {"img1": "image"}
    )
    assert got == cover(site="s.example")


def test_spec_addon_140_loft_ids_are_checked_with_one_extra_call(
    client, knowledge_db, fake, viewer_cookie
):
    fake.accessible_ids = ["a", "b", "img1"]
    fake.contents = {"a": "![p](loft://img1)", "b": "![p](loft://img1)"}
    fake.type_of["img1"] = "image"
    res = post(client, ["a", "b"], viewer_cookie)
    assert res.json()["covers"]["a"]["image_id"] == "img1"
    assert fake.bulk_calls == [["a", "b"], ["img1"]]


def test_spec_addon_140_i6_only_active_text_files_of_the_drive_are_answered(
    client, knowledge_db, fake, viewer_cookie
):
    fake.accessible_ids = ["ok", "other", "pdf", "gone"]
    fake.drive_of["other"] = "elsewhere"
    fake.mime_of["pdf"] = "application/pdf"
    fake.gone = {"gone"}
    fake.contents = {i: "https://s.example/" for i in ["ok", "other", "pdf", "gone", "hidden"]}
    res = post(client, ["ok", "other", "pdf", "gone", "hidden"], viewer_cookie)
    assert res.status_code == 200
    assert res.json()["covers"] == {"ok": cover(site="s.example")}


def test_spec_addon_140_an_unreadable_start_is_all_null_and_spares_the_others(
    client, knowledge_db, fake, viewer_cookie
):
    fake.accessible_ids = ["a", "b"]
    fake.content_failures = {"a": httpx.ReadTimeout("slow")}
    fake.contents = {"b": "https://s.example/"}
    res = post(client, ["a", "b"], viewer_cookie)
    assert res.json()["covers"] == {"a": cover(), "b": cover(site="s.example")}


def test_spec_addon_140_more_than_60_ids_is_422(client, knowledge_db, fake, viewer_cookie):
    assert post(client, [f"i{n}" for n in range(61)], viewer_cookie).status_code == 422
    assert post(client, [f"i{n}" for n in range(60)], viewer_cookie).status_code == 200


def test_spec_addon_140_without_a_drive_is_400(client, knowledge_db, fake, viewer_cookie):
    assert post(client, ["a"], viewer_cookie, drive=None).status_code == 400


@pytest.mark.parametrize("which", ["filter", "bulk"])
def test_spec_addon_140_a_failing_filter_or_first_bulk_is_502(
    client, knowledge_db, fake, viewer_cookie, which
):
    fake.accessible_ids = ["a"]
    if which == "filter":
        fake.filter_failure = InternalAPIError(500, "x")
    else:
        fake.bulk_failures = [InternalAPIError(500, "x")]
    assert post(client, ["a"], viewer_cookie).status_code == 502
