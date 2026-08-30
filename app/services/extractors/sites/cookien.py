"""cookien.com (つくおき) — recipe shape.

Why this site needs a parser at all: trafilatura classifies the step
markup (``<div><span class="ins_num">１</span><p class="ins_des">…``) as
boilerplate and drops **the entire method**, leaving a recipe with no
instructions. It also keeps the affiliate tail, which is around 40% of
the body.

Why the structured data does not rescue it: the page carries
``application/ld+json`` with ``"@type":"Recipe"``, but the fields that
matter are empty frames — ``recipeIngredient: [""]``,
``recipeInstructions: [{"text": ""}]``, ``recipeYield: ""``. Only the
metadata (name, image, description, totalTime, datePublished) is real,
so ingredients and steps have to come from the DOM.

The page labels its own metadata and titles its own sections, so those
strings are read rather than written here. What the page leaves bare —
the yield and the date — this module names, because it knows the site
is Japanese. The date is labelled as published, not updated: the page
supplies only ``datePublished`` and calling that an update date would
be a claim the page never makes.
"""
from __future__ import annotations

import json
import re
from typing import Optional

from lxml import etree
from lxml import html as lhtml
from markdownify import markdownify

from app.services.extractors.base import (
    ExtractedArticle,
    enforce_size_ceiling,
    host_matches,
)
from app.services.extractors.generic import sanitize_html
from app.services.extractors.preprocess import resolve_lazy_media
from app.services.extractors.shapes.recipe import (
    Group,
    Ingredient,
    Note,
    Recipe,
    render,
)

_HOSTNAMES = frozenset({"cookien.com"})

# Labels this module supplies for what the page states without naming:
# the yield and the date always, and the duration and the two section
# headings when the layout that carries them is absent. Naming them is
# the site module's job, not the shape's — knowing the site is Japanese
# is exactly what makes this module site-specific.
_TIME_LABEL = "調理時間"
_INGREDIENTS_LABEL = "材料"
_STEPS_LABEL = "作り方"
_YIELD_LABEL = "分量"
_PUBLISHED_LABEL = "公開"

_LD_AMOUNT_SEPARATOR = "\u3000"

_ISO_DURATION = re.compile(r"^P(?:T(?:(\d+)H)?(?:(\d+)M)?)?$")

# Everything from the first of these headings on is affiliate blocks,
# related-recipe carousels, share buttons and the author profile.
_TAIL_HEADING_CLASS = "suppl_ttl"

# The heading runs the section name into the yield with no separator, so
# the opening bracket is the boundary between them.
_OPENING_BRACKETS = "（(【[ 　"


def _text(value: str) -> str:
    """Collapse runs of whitespace, non-breaking space included.

    The page uses U+00A0 inside the yield. Left as-is it survives into
    Markdown, where it looks like an ordinary space but does not match
    one in search.
    """
    return " ".join((value or "").replace("\u00a0", " ").split())


def _find_recipe(node) -> dict:
    """Depth-first search for the ``Recipe`` object in a JSON-LD value.

    A block may be the object itself, a list of objects, or an
    ``@graph`` wrapper. Matching only the first shape silently discards
    the page's structured data on the other two.
    """
    if isinstance(node, dict):
        if node.get("@type") == "Recipe":
            return node
        for value in node.values():
            found = _find_recipe(value)
            if found:
                return found
    elif isinstance(node, list):
        for item in node:
            found = _find_recipe(item)
            if found:
                return found
    return {}


def _json_ld_recipe(doc) -> dict:
    """The ``Recipe`` block, or an empty dict when absent or unparseable."""
    for script in doc.iter("script"):
        if (script.get("type") or "").strip() != "application/ld+json":
            continue
        try:
            data = json.loads(script.text_content())
        except (ValueError, TypeError):
            continue
        found = _find_recipe(data)
        if found:
            return found
    return {}


def _ld_text(value) -> str:
    """Normalised text from a JSON-LD field that may not be a string.

    Every field here is optional, and schema.org lets most of them be a
    list or an object. Calling a string method on one raises, and the
    extractor's catch-all would then throw away a page whose ingredients
    and steps parsed perfectly — a whole recipe lost to a stray value in
    a field nothing depends on.
    """
    return _text(value) if isinstance(value, str) else ""


def _first_url(value) -> str:
    """An http(s) URL out of a JSON-LD value that may be a string, list
    or object.

    ``image`` is polymorphic in schema.org. Assuming a string turns an
    ImageObject into an AttributeError, which would abandon the whole
    extraction over an optional field.

    The scheme is checked here because this URL is written straight into
    Markdown by the renderer, never passing through the bleach protocol
    allowlist that guards DOM-derived links. The page is untrusted
    fetched content, so ``javascript:`` and ``data:`` would otherwise
    reach the reader.
    """
    if isinstance(value, str):
        url = value.strip()
        return url if url.lower().startswith(("http://", "https://", "//")) else ""
    if isinstance(value, list):
        for item in value:
            url = _first_url(item)
            if url:
                return url
        return ""
    if isinstance(value, dict):
        return _first_url(value.get("url") or value.get("contentUrl") or "")
    return ""


def _iso_duration_to_text(value: str) -> str:
    """``PT20M`` → ``20分``. Empty when the duration is not understood.

    Only the shapes this site actually emits are handled; anything else
    yields nothing rather than a guess, so a metadata line never states
    a time the page did not.
    """
    match = _ISO_DURATION.match((value or "").strip())
    if match is None:
        return ""
    hours, minutes = match.group(1), match.group(2)
    parts = []
    if hours:
        parts.append(f"{hours}時間")
    if minutes:
        parts.append(f"{minutes}分")
    return "".join(parts)


def _labelled_value(node) -> Optional[tuple[str, str]]:
    """Split ``<span>調理時間：</span><span>20</span><span>分</span>``.

    The site states both halves structurally: a leading label span, then
    the value. Reading the split rather than matching the label's text
    keeps this free of the site's vocabulary — the same code works when
    the label changes.
    """
    if node is None:
        return None
    spans = node.findall(".//span")
    if len(spans) < 2:
        return None
    label = _text(spans[0].text_content() or "").rstrip(":：")
    value = _text("".join(span.text_content() or "" for span in spans[1:]))
    if not label or not value:
        return None
    return label, value


def _first(doc, xpath: str):
    found = doc.xpath(xpath)
    return found[0] if found else None


def _heading_and_yield(heading_el) -> tuple[str, str]:
    """``材料（<span>A</span>）<br><span>B</span>`` → ``("材料", "（ A ） B")``.

    The heading runs the section name straight into the yield, so the
    split is the leading text node with its opening bracket handed back
    to the yield it belongs to. Segments are joined with spaces because
    the source puts each on its own element.
    """
    if heading_el is None:
        return "", ""
    lead = _text(heading_el.text or "")
    label = lead.rstrip(_OPENING_BRACKETS)
    segments: list[str] = []
    remainder = lead[len(label):].strip()
    if remainder:
        segments.append(remainder)
    for child in heading_el:
        text = _text(child.text_content() or "")
        if text:
            segments.append(text)
        tail = _text(child.tail or "")
        if tail:
            segments.append(tail)
    return label, " ".join(segments)


def _unwrap_image_links(node) -> None:
    """Replace ``<a href="x.jpg"><img></a>`` with the image itself.

    Every image on this page links to its own full-size file, so
    markdownify would otherwise emit ``[![](img)](same-img)`` — a link
    that goes where the reader already is.
    """
    for anchor in list(node.iter("a")):
        children = [child for child in anchor if child.tag != "noscript"]
        if len(children) != 1 or children[0].tag != "img":
            continue
        if (anchor.text_content() or "").strip():
            continue
        image = children[0]
        parent = anchor.getparent()
        if parent is None:
            continue
        image.tail = (image.tail or "") + (anchor.tail or "")
        parent.replace(anchor, image)


def _linkify_embeds(node, label: str) -> None:
    """Turn a resolved ``<iframe>`` into a link the sanitizer will keep.

    The sanitizer drops ``iframe`` outright, so an embed left as-is
    disappears and its heading is left standing over nothing. This runs
    in the site module rather than in shared preprocessing because only
    the site knows the embed is content and not an ad.
    """
    for frame in list(node.iter("iframe")):
        src = (frame.get("src") or "").strip()
        parent = frame.getparent()
        if not src or parent is None:
            continue
        anchor = lhtml.Element("a")
        anchor.set("href", src)
        anchor.text = label
        anchor.tail = frame.tail or ""
        parent.replace(frame, anchor)


def _promote_image_blocks(node) -> None:
    """Give each photo its own block.

    The site groups memo photos as inline siblings inside one container,
    which markdownify renders run together on a single line. Wrapping
    every image that is not already alone in a paragraph puts one per
    line, the way the page itself displays them. Written against the
    images rather than against the wrappers, because the wrapper markup
    differs between the site's old and current layouts.
    """
    for image in list(node.iter("img")):
        parent = image.getparent()
        if parent is None or parent is node:
            continue
        if parent.tag == "p" and len(parent) == 1 and not (parent.text or "").strip():
            continue
        block = lhtml.Element("p")
        # Inline spacing between images is meaningless once each one is
        # its own block, and markdownify would render it as a stray
        # whitespace paragraph between them.
        tail = image.tail or ""
        block.tail = tail if tail.strip() else None
        image.tail = None
        parent.replace(image, block)
        block.append(image)


_BLANK_LINE = re.compile(r"\n[ \t\u3000]+\n")
_EXTRA_BLANKS = re.compile(r"\n{3,}")
# An image line directly followed by a blank line and another image.
_IMAGE_RUN = re.compile(r"(!\[[^\]]*\]\([^)]*\))\n\n(?=!\[)")


def _tidy(markdown: str) -> str:
    """Collapse the blank lines left behind by stripped wrappers.

    Current pages wrap each photo in ``<picture>`` inside a spacing
    ``<span>``. Once the sanitizer removes the wrappers, their
    indentation whitespace is all that is left between blocks, and
    markdownify renders it as a paragraph containing a space.
    """
    collapsed = _EXTRA_BLANKS.sub("\n\n", _BLANK_LINE.sub("\n\n", markdown))
    # Litloft's preview lays consecutive image lines out as columns, and
    # a blank line between them breaks that into stacked single images.
    # The gap is meaningful, so images belonging to one note stay on
    # adjacent lines.
    while True:
        joined = _IMAGE_RUN.sub(r"\1\n", collapsed)
        if joined == collapsed:
            return joined.strip()
        collapsed = joined


def _fragment_to_markdown(elements, label: str) -> str:
    """Markdown for a run of sibling elements, sanitized on the way."""
    if not elements:
        return ""
    # ``lhtml`` factory, not ``etree``: elements moved into a tree
    # created by the plain factory lose their HTML element class and
    # with it ``text_content``.
    holder = lhtml.Element("div")
    for element in elements:
        holder.append(element)
    _linkify_embeds(holder, label)
    _unwrap_image_links(holder)
    _promote_image_blocks(holder)
    fragment = etree.tostring(holder, encoding="unicode", method="html")
    return _tidy(
        markdownify(sanitize_html(fragment), heading_style="ATX", bullets="-")
    )



def _ingredients(doc) -> tuple[Ingredient | Group, ...]:
    """Ingredient rows, with the sub-headings the recipe splits them by.

    The amount lives in a trailing ``<span>``; everything before it is
    the name. Taking the name from the paragraph's own text node would
    work on older pages and return nothing on current ones, where the
    name is wrapped in a search link — a silent, partial loss that reads
    as the recipe simply having fewer ingredients.
    """
    rows: list[Ingredient | Group] = []
    for paragraph in doc.xpath('//*[@id="r_contents"]/p'):
        amount = _text(
            "".join(span.text_content() or "" for span in paragraph.findall("span"))
        )
        whole = _text(paragraph.text_content() or "")
        if not whole:
            continue
        name = _text(whole[: len(whole) - len(amount)]) if amount else whole
        if not amount and paragraph.find("strong") is not None:
            rows.append(Group(name))
            continue
        if not name:
            continue
        rows.append(Ingredient(name=name, amount=amount))
    return tuple(rows)


def _steps(doc) -> tuple[str | Group, ...]:
    """Method rows in document order, sub-headings included.

    A row carrying ``ins_des`` is a step; a row without one that holds a
    ``<strong>`` is the heading for the steps that follow. Selecting
    only ``ins_des`` would drop those headings, and with them the fact
    that the recipe has stages.
    """
    rows: list[str | Group] = []
    for row in doc.xpath('//*[@id="ins_contents"]/div'):
        description = row.xpath('.//*[contains(@class,"ins_des")]')
        if description:
            text = _text(description[0].text_content() or "")
            if text:
                rows.append(text)
            continue
        if row.find("strong") is not None:
            heading = _text(row.text_content() or "")
            if heading:
                rows.append(Group(heading))
    return tuple(rows)


def _ingredients_from_ld(ld: dict) -> tuple[Ingredient | Group, ...]:
    """Ingredients out of the structured data, for a DOM that has none.

    The site separates name from amount with an ideographic space, so an
    entry without one is a sub-heading rather than an ingredient. That
    is the separator's own presence, not a guess about the words.
    """
    rows: list[Ingredient | Group] = []
    for entry in ld.get("recipeIngredient") or []:
        if not isinstance(entry, str) or not entry.strip():
            continue
        if _LD_AMOUNT_SEPARATOR in entry:
            name, _, amount = entry.partition(_LD_AMOUNT_SEPARATOR)
            rows.append(Ingredient(name=_text(name), amount=_text(amount)))
        else:
            rows.append(Group(_text(entry)))
    return tuple(rows)


def _steps_from_ld(ld: dict) -> tuple[str | Group, ...]:
    """Steps out of the structured data, for a DOM that has none.

    Every entry becomes a step. The structured data marks its stage
    headings no differently from its instructions, and inventing a rule
    to tell them apart on a layout nobody has seen would be a guess
    dressed as a feature.
    """
    rows: list[str | Group] = []
    for entry in ld.get("recipeInstructions") or []:
        text = entry.get("text") if isinstance(entry, dict) else entry
        text = _text(text) if isinstance(text, str) else ""
        if text:
            rows.append(text)
    return tuple(rows)


def _notes(doc) -> tuple[str, tuple[Note, ...]]:
    """The memo heading and its ``<h3>``-delimited sections.

    The sections are siblings of the heading rather than children of it,
    so they are collected by walking forward from it. The walk is scoped
    to the heading's own parent, not to the article body: current pages
    wrap the memos in their own ``<section>``, and walking the body
    would find no siblings at all and silently return no memos.

    It still stops at the affiliate tail, because on older pages the
    heading's parent *is* the article body and the tail follows it
    directly.
    """
    heading = _first(doc, '//*[@id="cooking_memo"]')
    if heading is None:
        return "", ()
    container = heading.getparent()
    if container is None:
        return "", ()

    siblings: list = []
    for element in heading.itersiblings():
        if element.tag == "h2" and _TAIL_HEADING_CLASS in (element.get("class") or ""):
            break
        siblings.append(element)

    notes: list[Note] = []
    current_heading: str | None = None
    body: list = []
    for element in siblings:
        if element.tag == "h3":
            if current_heading is not None:
                notes.append(
                    Note(current_heading, _fragment_to_markdown(body, current_heading))
                )
            current_heading = _text(element.text_content() or "")
            body = []
        elif current_heading is not None:
            body.append(element)
    if current_heading is not None:
        notes.append(Note(current_heading, _fragment_to_markdown(body, current_heading)))

    return _text(heading.text_content() or ""), tuple(notes)


def _parse(html: str) -> Optional[Recipe]:
    doc = lhtml.fromstring(html)
    resolve_lazy_media(doc)

    entry = _first(doc, '//*[contains(@class,"entry-content")]')
    if entry is None:
        return None

    ld = _json_ld_recipe(doc)

    title = _ld_text(ld.get("name")) or None
    if title is None:
        heading = _first(doc, '//*[contains(@class,"entry-title")]')
        title = _text(heading.text_content() or "") or None if heading is not None else None

    ingredients_heading, yield_text = _heading_and_yield(
        _first(doc, '//*[@id="r_contents"]/h2')
    )

    meta: list[tuple[str, str]] = []
    for xpath in (
        '//*[contains(@class,"recipe_info_left")]//time',
        '//*[contains(@class,"recipe_info_right")]',
    ):
        pair = _labelled_value(_first(doc, xpath))
        if pair is not None:
            meta.append(pair)
    if not meta:
        # The metadata block is missing or restructured. The structured
        # data still carries the duration, but not a label for it, so
        # this module supplies one.
        duration = _iso_duration_to_text(_ld_text(ld.get("totalTime")))
        if duration:
            meta.append((_TIME_LABEL, duration))
    if yield_text:
        meta.append((_YIELD_LABEL, yield_text))
    published = _ld_text(ld.get("datePublished"))
    if published:
        meta.append((_PUBLISHED_LABEL, published))

    # The DOM wins when it has rows, because it marks the sub-headings
    # structurally (a <strong> with no amount, a row with no number)
    # while the structured data spells them the same as everything else.
    # The structured data is the safety net for a layout that renders
    # its rows some other way.
    ingredients = _ingredients(doc) or _ingredients_from_ld(ld)

    steps_heading_el = _first(doc, '//*[@id="ins_contents"]/h2')
    steps = _steps(doc) or _steps_from_ld(ld)

    notes_heading, notes = _notes(doc)

    return Recipe(
        title=title,
        hero_url=_first_url(ld.get("image")) or None,
        meta=tuple(meta),
        description=_ld_text(ld.get("description")) or None,
        ingredients_heading=ingredients_heading or _INGREDIENTS_LABEL,
        ingredients=ingredients,
        steps_heading=(
            _text(steps_heading_el.text_content() or "")
            if steps_heading_el is not None
            else ""
        )
        or _STEPS_LABEL,
        steps=steps,
        notes_heading=notes_heading,
        notes=notes,
    )


class CookienExtractor:
    """Reads the recipe record out of the page and re-renders it.

    Returns ``None`` when the page is not a recipe — the site also
    serves index and category pages — so the dispatcher falls through to
    the generic pipeline rather than emitting a recipe-shaped document
    with nothing in it.
    """

    def matches(self, url: str | None) -> bool:
        return host_matches(url, _HOSTNAMES)

    def extract(self, html: str, url: str) -> Optional[ExtractedArticle]:
        try:
            recipe = _parse(html)
        except Exception:
            return None
        if recipe is None or not recipe.ingredients or not recipe.steps:
            return None

        markdown = render(recipe).strip()
        if not markdown:
            return None

        enforce_size_ceiling(markdown)
        return ExtractedArticle(title=recipe.title, markdown=markdown)
