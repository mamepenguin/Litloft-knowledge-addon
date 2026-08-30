"""Generic lazy-load repairs.

These cover the mechanism, not any one site: `a3-lazy-load` (WordPress)
is the observed case, but the shape — a placeholder in ``src``, the real
URL in ``data-src``, and a ``<noscript>`` twin — is shared across
lazy-load plugins.
"""
from __future__ import annotations

from app.services.extractor import extract_article
from app.services.extractors.preprocess import preprocess_html

_REAL = "https://example.com/uploads/photo.jpg"
_PLACEHOLDER = "//example.com/plugins/a3-lazy-load/assets/images/lazy_placeholder.gif"


def _src_of(html: str, tag: str) -> str | None:
    """The ``src`` of the first ``tag`` — asserting on the attribute
    rather than on a substring of the serialised document, so a URL
    lingering in an unrelated attribute cannot pass or fail a test by
    accident."""
    from lxml import html as lhtml

    return lhtml.fromstring(html).find(f".//{tag}").get("src")


def test_placeholder_src_replaced_by_data_src():
    out = preprocess_html(
        f'<div><img class="lazy" src="{_PLACEHOLDER}" data-src="{_REAL}"></div>'
    )
    assert _REAL in out
    assert "lazy_placeholder" not in out


def test_missing_src_filled_from_data_src():
    out = preprocess_html(f'<div><img data-src="{_REAL}"></div>')
    assert _REAL in out


def test_data_uri_src_is_treated_as_placeholder():
    tiny_gif = "data:image/gif;base64,R0lGODlhAQABAAAAACw="
    out = preprocess_html(
        f'<div><img src="{tiny_gif}" data-src="{_REAL}"></div>'
    )
    assert _REAL in out


def test_alternative_lazy_attributes_are_read():
    for attr in ("data-lazy-src", "data-original"):
        out = preprocess_html(f'<div><img {attr}="{_REAL}"></div>')
        assert _REAL in out, attr


def test_real_src_is_left_alone():
    other = "https://example.com/uploads/other.jpg"
    out = preprocess_html(f'<div><img src="{_REAL}" data-src="{other}"></div>')
    assert _src_of(out, "img") == _REAL


def test_iframe_without_src_is_resolved():
    # The consumer is a site parser walking the tree, not the generic
    # path: sanitize_html forbids <iframe> and trafilatura discards
    # embeds, so this src deliberately never reaches generic Markdown.
    embed = "https://www.youtube.com/embed/abc123?rel=0"
    out = preprocess_html(f'<div><iframe data-src="{embed}"></iframe></div>')
    assert _src_of(out, "iframe") == embed


def test_generic_extraction_still_drops_embeds():
    # Pins the decision above: resolving an iframe must not start
    # smuggling ad and tracker embeds into every clipped article.
    page = """
    <!doctype html><html><head><title>Embed Post</title></head>
    <body><article>
      <h1>Embedded</h1>
      <p>A paragraph long enough to clear the minimum body size gate so
         the generic extractor keeps this article rather than discarding
         it as boilerplate content.</p>
      <iframe data-src="https://ads.example/banner"></iframe>
      <p>Another paragraph so the body carries real weight.</p>
    </article></body></html>
    """
    art = extract_article(page, "https://example.com/post/2")
    assert "ads.example" not in art.markdown


def test_description_is_rescued_from_the_discarded_fallback():
    out = preprocess_html(
        f'<div><img src="{_PLACEHOLDER}" data-src="{_REAL}" alt="">'
        f'<noscript><img src="{_REAL}" alt="A bowl of soup"></noscript></div>'
    )
    from lxml import html as lhtml

    img = lhtml.fromstring(out).find(".//img")
    assert img.get("alt") == "A bowl of soup"
    assert "noscript" not in out.lower()


def test_existing_description_is_not_overwritten():
    out = preprocess_html(
        f'<div><img src="{_PLACEHOLDER}" data-src="{_REAL}" alt="Author caption">'
        f'<noscript><img src="{_REAL}" alt="Generated"></noscript></div>'
    )
    from lxml import html as lhtml

    assert lhtml.fromstring(out).find(".//img").get("alt") == "Author caption"


def test_iframe_with_src_is_left_alone():
    kept = "https://player.example/one"
    out = preprocess_html(
        f'<div><iframe src="{kept}" data-src="https://player.example/two"></iframe></div>'
    )
    assert _src_of(out, "iframe") == kept


def test_noscript_twin_is_dropped_after_resolving():
    out = preprocess_html(
        f'<div><img src="{_PLACEHOLDER}" data-src="{_REAL}">'
        f'<noscript><img src="{_REAL}"></noscript></div>'
    )
    assert out.count(_REAL) == 1
    assert "noscript" not in out.lower()


def test_every_image_after_a_removed_noscript_is_still_resolved():
    # Removing a <noscript> mid-walk must not truncate the walk. A page
    # with one lazy image cannot catch this; real pages carry dozens.
    urls = [f"https://example.com/uploads/p{n}.jpg" for n in range(4)]
    body = "".join(
        f'<img src="{_PLACEHOLDER}" data-src="{u}">'
        f"<noscript><img src=\"{u}\"></noscript>"
        for u in urls
    )
    out = preprocess_html(f"<div>{body}</div>")
    from lxml import html as lhtml

    srcs = [img.get("src") for img in lhtml.fromstring(out).iter("img")]
    assert srcs == urls
    assert "lazy_placeholder" not in out


def test_noscript_with_caption_is_kept():
    # A fallback carrying text is the only copy of that text.
    out = preprocess_html(
        f'<div><img src="{_PLACEHOLDER}" data-src="{_REAL}">'
        f'<noscript><img src="{_REAL}">Photo by someone</noscript></div>'
    )
    assert "Photo by someone" in out


def test_noscript_wrapping_a_link_is_kept():
    out = preprocess_html(
        f'<div><img src="{_PLACEHOLDER}" data-src="{_REAL}">'
        f'<noscript><a href="https://example.com/full"><img src="{_REAL}"></a></noscript></div>'
    )
    assert "example.com/full" in out


def test_noscript_holding_a_different_image_is_kept():
    other = "https://example.com/uploads/other.jpg"
    out = preprocess_html(
        f'<div><img src="{_PLACEHOLDER}" data-src="{_REAL}">'
        f'<noscript><img src="{other}"></noscript></div>'
    )
    assert other in out


def test_iframe_fallback_is_never_dropped():
    # For an embed the <noscript> is usually the only extractable trace.
    embed = "https://www.youtube.com/embed/abc123"
    out = preprocess_html(
        f'<div><iframe data-src="{embed}"></iframe>'
        '<noscript><a href="https://www.youtube.com/watch?v=abc123">Watch</a></noscript></div>'
    )
    assert "watch?v=abc123" in out
    assert "Watch" in out


def test_noscript_elsewhere_is_kept():
    # Only the twin that directly follows a resolved image is dropped.
    out = preprocess_html(
        '<div><p>text</p><noscript>Enable JavaScript to continue.</noscript></div>'
    )
    assert "Enable JavaScript" in out


def test_empty_and_malformed_input_is_returned_untouched():
    assert preprocess_html("") == ""
    assert preprocess_html("   ") == "   "


def test_extract_article_does_not_emit_placeholder_images():
    page = f"""
    <!doctype html>
    <html><head><title>Lazy Post</title></head>
    <body><article>
      <h1>Lazy loading</h1>
      <p>A paragraph long enough to clear the minimum body size gate so
         the generic extractor keeps this article instead of discarding
         it as boilerplate.</p>
      <img class="lazy lazy-hidden" src="{_PLACEHOLDER}" data-src="{_REAL}" alt="photo">
      <noscript><img src="{_REAL}" alt="photo"></noscript>
      <p>Another paragraph so the body carries real weight.</p>
    </article></body></html>
    """
    art = extract_article(page, "https://example.com/post/1")
    assert "lazy_placeholder" not in art.markdown
