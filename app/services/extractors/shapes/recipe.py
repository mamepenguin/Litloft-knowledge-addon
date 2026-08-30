"""The recipe record and its Markdown rendering.

Site parsers produce a ``Recipe``; this module turns it into Markdown.
Splitting the two means a second recipe site writes a parser only, and
every recipe clip comes out in the same shape — which matters more than
the code saved. Three sites each inventing their own ingredient
formatting is worse for search and for promotion than three parsers.

**Every heading and label comes from the page**, carried on the record
rather than hardcoded here. cookien labels its own metadata
(``<span>調理時間：</span><span>20</span><span>分</span>``) and titles its
own sections, so reading them costs nothing and keeps this module free
of any one language's vocabulary. Where a site supplies no label — the
yield and the date are bare values — the site module names them,
because knowing what language it is written in is the site module's
business, not the shape's.

Fidelity: this shape reorders. That is only sound because the sites it
serves impose a fixed structure on their authors, so the page is a
rendering of a record and re-rendering it loses nothing. A site whose
authors write freely gets the article treatment instead; see
``sites/zenn``.
"""
from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(frozen=True)
class Group:
    """A sub-heading inside the ingredients or the method.

    Recipes routinely split into "for the sauce" / "to finish". The
    grouping is part of the record, not decoration: an ingredient list
    flattened across groups tells the cook to put everything in one
    bowl.
    """

    name: str


@dataclass(frozen=True)
class Ingredient:
    name: str
    amount: str = ""


@dataclass(frozen=True)
class Note:
    """A trailing section: a tip, a storage instruction, a video."""

    heading: str
    markdown: str = ""


@dataclass(frozen=True)
class Recipe:
    title: str | None = None
    hero_url: str | None = None
    # (label, value) pairs rendered as one metadata block, in order.
    meta: tuple[tuple[str, str], ...] = ()
    description: str | None = None
    ingredients_heading: str = ""
    ingredients: tuple[Ingredient | Group, ...] = ()
    steps_heading: str = ""
    steps: tuple[str | Group, ...] = ()
    notes_heading: str = ""
    notes: tuple[Note, ...] = field(default=())


def _ingredient_line(item: Ingredient) -> str:
    return f"- {item.name} {item.amount}".rstrip()


def render(recipe: Recipe) -> str:
    """Markdown for ``recipe``. Absent parts render as nothing at all.

    Every section is conditional so a page missing its notes, or its
    hero, produces a document without an empty heading — a heading with
    nothing under it reads as a bug in the clip rather than an absence
    on the page.
    """
    blocks: list[str] = []

    if recipe.title:
        blocks.append(f"# {recipe.title}")
    if recipe.hero_url:
        blocks.append(f"![]({recipe.hero_url})")
    if recipe.meta:
        # Two trailing spaces: a hard line break, so the pairs stay on
        # their own lines instead of reflowing into one paragraph.
        blocks.append(
            "  \n".join(f"{label}: **{value}**" for label, value in recipe.meta)
        )
    if recipe.description:
        blocks.append(f"> {recipe.description}")

    if recipe.ingredients:
        if recipe.ingredients_heading:
            blocks.append(f"## {recipe.ingredients_heading}")
        run: list[str] = []
        for item in recipe.ingredients:
            if isinstance(item, Group):
                if run:
                    blocks.append("\n".join(run))
                    run = []
                blocks.append(f"**{item.name}**")
            else:
                run.append(_ingredient_line(item))
        if run:
            blocks.append("\n".join(run))

    if recipe.steps:
        if recipe.steps_heading:
            blocks.append(f"## {recipe.steps_heading}")
        # Numbering runs across groups, matching how the sources number
        # their own steps. An ordered list that resumes after a heading
        # keeps its start number in CommonMark, so the printed numbers
        # survive rendering.
        number = 0
        for step in recipe.steps:
            if isinstance(step, Group):
                blocks.append(f"**{step.name}**")
            else:
                number += 1
                blocks.append(f"{number}. {step}")

    if recipe.notes:
        if recipe.notes_heading:
            blocks.append(f"## {recipe.notes_heading}")
        for note in recipe.notes:
            blocks.append(f"### {note.heading}")
            if note.markdown:
                blocks.append(note.markdown)

    return "\n\n".join(blocks)
