"""Site-agnostic DOM repairs applied before generic extraction.

Everything here fixes a mechanism shared by many sites, never one site's
markup. A transform earns a place only once it has been observed on more
than one host; anything narrower belongs in that site's module.

Ordering matters. This runs *after* site extractors have had their turn,
not before dispatch: ``sites/zenn`` locates ``__NEXT_DATA__`` by raw
string search, and parsing then re-serialising the whole document ahead
of it could re-escape script contents and silently push Zenn pages onto
the generic path. Running late also avoids paying a full parse for
documents a site extractor was going to claim anyway.
"""
from __future__ import annotations

from lxml import etree
from lxml import html as lhtml

# Attributes lazy-load plugins park the real URL in, most specific first.
_LAZY_ATTRS = ("data-src", "data-lazy-src", "data-original")

# Substrings that mark a stand-in image rather than real content.
_PLACEHOLDER_MARKERS = ("placeholder", "lazy_", "blank.", "spacer.")

# Attributes worth rescuing from a fallback before discarding it.
_DESCRIPTIVE_ATTRS = ("alt", "title")


def _real_url(el) -> str | None:
    """The http(s) URL a lazy-load attribute is holding, if any."""
    for attr in _LAZY_ATTRS:
        value = (el.get(attr) or "").strip()
        if value.startswith(("http://", "https://", "//")):
            return value
    return None


def _is_placeholder(src: str) -> bool:
    if not src:
        return True
    if src.startswith("data:"):
        return True
    lowered = src.lower()
    return any(marker in lowered for marker in _PLACEHOLDER_MARKERS)


def _duplicate_fallback_images(node, url: str) -> list | None:
    """The images inside ``node`` when it holds nothing but ``url``.

    ``None`` means "not a pure duplicate, keep it". Deleting a fallback
    because it is "obviously the same image" without checking is how a
    caption, a link, or a second image gets thrown away, so the bar is
    deliberately high: no text, no element other than ``<img>``, and
    every image pointing at ``url``.
    """
    if (node.text_content() or "").strip():
        return None
    images = [child for child in node.iter() if child is not node]
    if not images or any(child.tag != "img" for child in images):
        return None
    if not all((child.get("src") or "").strip() == url for child in images):
        return None
    return images


def _adopt_descriptive_attrs(el, fallback_images) -> None:
    """Move ``alt`` / ``title`` off a fallback before it is discarded.

    The lazy element frequently carries ``alt=""`` while the noscript
    twin holds the real text, because the plugin generated the former
    and the author wrote the latter. Dropping the twin without this
    would lose the only description the page had.
    """
    for attr in _DESCRIPTIVE_ATTRS:
        if (el.get(attr) or "").strip():
            continue
        for image in fallback_images:
            value = (image.get(attr) or "").strip()
            if value:
                el.set(attr, value)
                break


def _resolve_lazy_media(doc) -> None:
    """Point ``src`` at the real URL for deferred images and iframes.

    Lazy-load plugins defer both element types — cookien's recipe video
    is an ``<iframe>`` carrying only ``data-src`` — so a resolver written
    for images alone leaves every embedded video invisible.

    **The iframe repair is for site parsers, not for the generic path.**
    ``sanitize_html`` does not allow ``iframe`` and trafilatura discards
    embeds, so a resolved ``src`` never reaches generic Markdown. That is
    deliberate: turning every embed into a link generically would also
    turn every ad and tracking iframe into one, which is worse than the
    present silence. A site module that knows which embeds are content
    reads the resolved ``src`` off the tree and renders it itself.

    When an image is resolved and is immediately followed by a
    ``<noscript>`` that provably holds nothing but the same image, the
    fallback is dropped — the sanitizer would otherwise unwrap it into a
    duplicate — after any description it carries is moved onto the
    surviving element. Anything richer is kept untouched.
    """
    # Materialised before the loop: this removes ``<noscript>`` siblings
    # as it goes, and mutating the tree while a live iterator walks it
    # silently truncates the walk — every element after the first
    # removal would be skipped.
    for el in list(doc.iter("img", "iframe")):
        url = _real_url(el)
        if url is None:
            continue
        if el.tag == "img" and not _is_placeholder((el.get("src") or "").strip()):
            continue
        if el.tag == "iframe" and (el.get("src") or "").strip():
            continue

        el.set("src", url)
        # Drop the source attributes now that ``src`` carries the URL.
        # Left in place they duplicate every resolved URL in the output,
        # which downstream text extraction has no way to tell from a
        # genuine second reference.
        for attr in _LAZY_ATTRS:
            el.attrib.pop(attr, None)

        if el.tag != "img":
            continue
        sibling = el.getnext()
        if sibling is None or sibling.tag != "noscript":
            continue
        fallback_images = _duplicate_fallback_images(sibling, url)
        if fallback_images is None:
            continue

        _adopt_descriptive_attrs(el, fallback_images)
        parent = sibling.getparent()
        if parent is not None:
            el.tail = (el.tail or "") + (sibling.tail or "")
            parent.remove(sibling)


def preprocess_html(html: str) -> str:
    """Apply every generic repair, returning HTML for the generic passes.

    Fail-safe: any parse or serialisation error returns the input
    untouched. A repair that cannot run is a page rendered slightly
    worse; a repair that raises would fail the whole clip.
    """
    if not html.strip():
        return html
    try:
        doc = lhtml.fromstring(html)
        _resolve_lazy_media(doc)
        return etree.tostring(doc, encoding="unicode", method="html")
    except Exception:
        return html
