"""SPEC-ADDON-140: a clip's cover and site, read from the start of the clip."""
from __future__ import annotations

import importlib

import httpx
import pytest

from app.internal_client import InternalAPIError
from tests.conftest import FakeInternalClient

NULLS = {"image_id": None, "image_url": None, "site": None}


class CoversFake(FakeInternalClient):
    accessible_ids: list[str] = []
    # Files the core answers as active: id -> (drive, mime_type, file_type).
    files: dict[str, tuple[str, str, str]] = {}
    contents: dict[str, str] = {}
    content_failures: dict[str, Exception] = {}
    filter_failure: Exception | None = None
    # A bulk call that asks for any of these ids raises.
    bulk_failure_for: set[str] = set()
    filtered: list[list[str]] = []
    bulk_asked: list[list[str]] = []
    fetched: list[tuple[str, int]] = []

    async def filter_file_ids(self, file_ids):
        CoversFake.filtered.append(list(file_ids))
        if CoversFake.filter_failure is not None:
            raise CoversFake.filter_failure
        return [i for i in file_ids if i in CoversFake.accessible_ids]

    async def fetch_bulk_files(self, file_ids):
        CoversFake.bulk_asked.append(list(file_ids))
        if CoversFake.bulk_failure_for & set(file_ids):
            raise InternalAPIError(503, "core is down")
        found = [i for i in file_ids if i in CoversFake.files]
        return {
            "files": [
                {
                    "id": i,
                    "drive": CoversFake.files[i][0],
                    "mime_type": CoversFake.files[i][1],
                    "file_type": CoversFake.files[i][2],
                }
                for i in found
            ],
            "not_found": [i for i in file_ids if i not in CoversFake.files],
        }

    async def get_file_opening(self, file_id: str, max_bytes: int) -> str:
        CoversFake.fetched.append((file_id, max_bytes))
        failure = CoversFake.content_failures.get(file_id)
        if failure is not None:
            raise failure
        return CoversFake.contents.get(file_id, "").encode("utf-8")[:max_bytes].decode(
            "utf-8", errors="replace"
        )


@pytest.fixture()
def fake_covers(monkeypatch):
    CoversFake.accessible_ids = []
    CoversFake.files = {}
    CoversFake.contents = {}
    CoversFake.content_failures = {}
    CoversFake.filter_failure = None
    CoversFake.bulk_failure_for = set()
    CoversFake.filtered = []
    CoversFake.bulk_asked = []
    CoversFake.fetched = []
    try:
        router = importlib.import_module("app.routers.clip_covers")
    except ModuleNotFoundError:
        # Without the router the route answers 404, which is the failure to see.
        router = None
    if router is not None:
        monkeypatch.setattr(router, "InternalClient", CoversFake)
    return CoversFake


def clip(file_id: str, content: str, drive: str = "test-drive", mime: str = "text/markdown"):
    CoversFake.accessible_ids.append(file_id)
    CoversFake.files[file_id] = (drive, mime, "document")
    CoversFake.contents[file_id] = content


def image(file_id: str, drive: str = "test-drive", file_type: str = "image"):
    CoversFake.accessible_ids.append(file_id)
    CoversFake.files[file_id] = (drive, "image/jpeg" if file_type == "image" else "video/mp4", file_type)


def post(client, ids, viewer_cookie, drive="test-drive"):
    headers = dict(viewer_cookie)
    if drive is not None:
        headers["X-Lit-Drive"] = drive
    return client.post("/clip-covers", json={"file_ids": ids}, headers=headers)


def covers_of(client, ids, viewer_cookie):
    res = post(client, ids, viewer_cookie)
    assert res.status_code == 200, res.text
    return res.json()["covers"]


# ------------------------------------------------------------ the cover and the site


@pytest.mark.parametrize(
    ("content", "expected"),
    [
        pytest.param(
            "---\nurl: https://www.Cooking.Example:8443/curry\n---\n\n![Curry](https://img.example/c.jpg)\n",
            {"image_id": None, "image_url": "https://img.example/c.jpg", "site": "cooking.example"},
            id="frontmatter url and an http image",
        ),
        pytest.param(
            '![Curry](https://img.example/c.jpg "The curry")\n',
            {"image_id": None, "image_url": "https://img.example/c.jpg", "site": None},
            id="an image with a title, and its target is not the site",
        ),
        pytest.param(
            "Intro.\n\n![one](https://img.example/1.jpg)\n\n![two](https://img.example/2.jpg)\n",
            {"image_id": None, "image_url": "https://img.example/1.jpg", "site": None},
            id="the first image is the cover",
        ),
        pytest.param(
            "![rel](images/c.jpg)\n\n![abs](https://img.example/2.jpg)\n",
            {"image_id": None, "image_url": None, "site": None},
            id="a first image that is neither loft nor http gives no cover",
        ),
        pytest.param(
            '<img src="/media/c.jpg">\n\nNo markdown image.\n',
            NULLS,
            id="html img is not read as a cover",
        ),
        pytest.param(
            '---\ncover: "![x](https://fm.example/a.jpg)"\nsource: https://fm.example/page\n---\n\nPlain text.\n',
            NULLS,
            id="nothing inside the frontmatter but url counts",
        ),
        pytest.param(
            "---\nurl: ftp://files.example/r\n---\n\nFrom [the source](https://Recipes.Example/r).\n",
            {"image_id": None, "image_url": None, "site": "recipes.example"},
            id="a frontmatter url that is not http falls through to the body",
        ),
        pytest.param(
            "---\nurl: https://first.example/a\n---\n\nSee [b](https://second.example/b).\n",
            {"image_id": None, "image_url": None, "site": "first.example"},
            id="the frontmatter url wins over the body",
        ),
        pytest.param(
            "![c](https://img.example/c.jpg)\n\nSee <https://www.Auto.example:80/x>.\n",
            {"image_id": None, "image_url": "https://img.example/c.jpg", "site": "auto.example"},
            id="an autolink after an image",
        ),
        pytest.param(
            "Recipe from https://WWW.bare.example/r?x=1 today.\n",
            {"image_id": None, "image_url": None, "site": "bare.example"},
            id="a bare url",
        ),
        pytest.param(
            "Seen at [here](https://例え.jp/レシピ).\n",
            {"image_id": None, "image_url": None, "site": "例え.jp"},
            id="an IDN host is kept as written",
        ),
        pytest.param(
            '<img src="https://img.example/c.jpg">\n\nFrom [here](https://site.example/r).\n',
            {"image_id": None, "image_url": None, "site": "site.example"},
            id="an html img src is an image target, never the site",
        ),
        pytest.param(
            '<img src="https://img.example/c.jpg">\n',
            NULLS,
            id="an html img src alone gives no site",
        ),
        pytest.param(
            "Just words, and a [relative](notes/a.md) link.\n",
            NULLS,
            id="no http url and no image",
        ),
        pytest.param(
            "x" * 5000 + "\n\n![late](https://img.example/late.jpg) [s](https://late.example/)\n",
            NULLS,
            id="what lies past the first 4096 bytes is not seen",
        ),
    ],
)
def test_the_cover_and_site_come_from_the_start_of_the_clip(
    client, knowledge_db, fake_covers, viewer_cookie, content, expected
):
    clip("c1", content)

    assert covers_of(client, ["c1"], viewer_cookie) == {"c1": expected}


def test_a_loft_cover_is_kept_only_when_it_is_an_active_image_of_the_same_drive(
    client, knowledge_db, fake_covers, viewer_cookie
):
    image("img-ok")
    image("img-other", drive="other-drive")
    image("img-video", file_type="video")
    clip("ok", "![a](loft://img-ok)\n")
    clip("other", "![a](loft://img-other)\n")
    clip("video", "![a](loft://img-video)\n")
    clip("gone", "![a](loft://img-gone)\n")

    covers = covers_of(client, ["ok", "other", "video", "gone"], viewer_cookie)

    assert covers == {
        "ok": {"image_id": "img-ok", "image_url": None, "site": None},
        "other": NULLS,
        "video": NULLS,
        "gone": NULLS,
    }


def test_when_the_loft_check_fails_no_image_id_is_answered_and_the_rest_stands(
    client, knowledge_db, fake_covers, viewer_cookie
):
    image("img")
    clip("loft", "![a](loft://img)\n\n[s](https://site.example/)\n")
    clip("http", "![a](https://img.example/a.jpg)\n")
    CoversFake.bulk_failure_for = {"img"}

    covers = covers_of(client, ["loft", "http"], viewer_cookie)

    assert covers == {
        "loft": {"image_id": None, "image_url": None, "site": "site.example"},
        "http": {"image_id": None, "image_url": "https://img.example/a.jpg", "site": None},
    }


# ---------------------------------------------------------------- which files


def test_only_files_the_caller_can_read_are_fetched_or_answered(
    client, knowledge_db, fake_covers, viewer_cookie
):
    clip("mine", "[s](https://mine.example/)")
    CoversFake.files["locked"] = ("test-drive", "text/markdown", "document")
    CoversFake.contents["locked"] = "[s](https://secret.example/)"

    covers = covers_of(client, ["mine", "locked"], viewer_cookie)

    assert covers == {"mine": {"image_id": None, "image_url": None, "site": "mine.example"}}
    assert CoversFake.filtered[0] == ["mine", "locked"]
    assert [i for i, _ in CoversFake.fetched] == ["mine"]


@pytest.mark.parametrize(
    ("arrange", "label"),
    [
        (lambda: clip("x", "[s](https://x.example/)", drive="other-drive"), "of another drive"),
        (lambda: clip("x", "[s](https://x.example/)", mime="video/mp4"), "not text"),
        (lambda: (clip("x", "[s](https://x.example/)"), CoversFake.files.pop("x")), "not active"),
    ],
)
def test_a_file_that_is_not_an_active_text_file_of_the_drive_is_absent_and_not_read(
    client, knowledge_db, fake_covers, viewer_cookie, arrange, label
):
    clip("kept", "plain")
    arrange()

    covers = covers_of(client, ["kept", "x"], viewer_cookie)

    assert covers == {"kept": NULLS}, label
    assert [i for i, _ in CoversFake.fetched] == ["kept"]


def test_each_kept_file_is_read_through_its_first_4096_bytes(
    client, knowledge_db, fake_covers, viewer_cookie
):
    clip("a", "plain")
    clip("b", "plain")

    covers_of(client, ["a", "b"], viewer_cookie)

    assert sorted(CoversFake.fetched) == [("a", 4096), ("b", 4096)]


@pytest.mark.parametrize(
    "failure",
    [InternalAPIError(404, "gone"), httpx.ReadTimeout("slow")],
    ids=["an error", "a timeout"],
)
def test_a_file_whose_start_cannot_be_read_is_answered_with_nulls(
    client, knowledge_db, fake_covers, viewer_cookie, failure
):
    clip("bad", "![a](https://img.example/a.jpg)")
    clip("good", "![a](https://img.example/g.jpg)")
    CoversFake.content_failures = {"bad": failure}

    covers = covers_of(client, ["bad", "good"], viewer_cookie)

    assert covers == {
        "bad": NULLS,
        "good": {"image_id": None, "image_url": "https://img.example/g.jpg", "site": None},
    }


def test_a_percent_encoded_drive_name_is_the_drive_it_names(
    client, knowledge_db, fake_covers, viewer_cookie
):
    clip("a", "[s](https://a.example/)", drive="仕事")

    res = post(client, ["a"], viewer_cookie, drive="%E4%BB%95%E4%BA%8B")

    assert res.status_code == 200
    assert res.json()["covers"] == {"a": {"image_id": None, "image_url": None, "site": "a.example"}}


# --------------------------------------------------------------------- errors


def test_sixty_ids_are_answered(client, knowledge_db, fake_covers, viewer_cookie):
    ids = [f"f{i}" for i in range(60)]
    for i in ids:
        clip(i, "plain")

    assert len(covers_of(client, ids, viewer_cookie)) == 60


def test_no_ids_are_answered_with_no_covers(client, knowledge_db, fake_covers, viewer_cookie):
    res = post(client, [], viewer_cookie)

    assert res.status_code == 200
    assert res.json() == {"covers": {}}
    assert CoversFake.fetched == []


def test_more_than_sixty_ids_are_refused(client, knowledge_db, fake_covers, viewer_cookie):
    ids = [f"f{i}" for i in range(61)]
    for i in ids:
        clip(i, "plain")

    res = post(client, ids, viewer_cookie)

    assert res.status_code == 422
    assert CoversFake.fetched == []


def test_without_a_drive_it_answers_400(client, knowledge_db, fake_covers, viewer_cookie):
    clip("a", "plain")

    res = post(client, ["a"], viewer_cookie, drive=None)

    assert res.status_code == 400
    assert CoversFake.fetched == []


def test_when_the_access_filter_fails_it_answers_502_and_reads_nothing(
    client, knowledge_db, fake_covers, viewer_cookie
):
    clip("a", "plain")
    CoversFake.filter_failure = InternalAPIError(503, "core is down")

    res = post(client, ["a"], viewer_cookie)

    assert res.status_code == 502
    assert CoversFake.fetched == []


def test_when_the_file_lookup_fails_it_answers_502_and_reads_nothing(
    client, knowledge_db, fake_covers, viewer_cookie
):
    clip("a", "plain")
    CoversFake.bulk_failure_for = {"a"}

    res = post(client, ["a"], viewer_cookie)

    assert res.status_code == 502
    assert CoversFake.fetched == []
