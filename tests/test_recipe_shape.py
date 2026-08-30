"""The recipe shape's rendering, independent of any site.

These pin the properties a second recipe site will rely on: a partial
record renders without empty headings, and every label is whatever the
record carries rather than something the shape decided.
"""
from __future__ import annotations

from app.services.extractors.shapes.recipe import Ingredient, Note, Recipe, render


def test_full_record_sections_are_ordered():
    md = render(
        Recipe(
            title="Title",
            hero_url="https://example.com/a.jpg",
            meta=(("Time", "20 min"),),
            description="A description.",
            ingredients_heading="Ingredients",
            ingredients=(Ingredient("Flour", "200 g"),),
            steps_heading="Method",
            steps=("Mix.", "Bake."),
            notes_heading="Notes",
            notes=(Note("Storage", "Keeps for five days."),),
        )
    )
    order = [
        "# Title",
        "![](https://example.com/a.jpg)",
        "Time: **20 min**",
        "> A description.",
        "## Ingredients",
        "- Flour 200 g",
        "## Method",
        "1. Mix.",
        "2. Bake.",
        "## Notes",
        "### Storage",
        "Keeps for five days.",
    ]
    positions = [md.index(fragment) for fragment in order]
    assert positions == sorted(positions)


def test_absent_sections_leave_no_empty_headings():
    md = render(Recipe(title="Bare"))
    assert md == "# Bare"


def test_headings_are_not_emitted_without_content():
    md = render(Recipe(title="T", ingredients_heading="Ingredients"))
    assert "Ingredients" not in md


def test_note_without_body_keeps_its_heading():
    # A section the page titled but left empty is a fact about the page.
    md = render(Recipe(notes_heading="Notes", notes=(Note("Video"),)))
    assert "### Video" in md


def test_ingredient_without_amount_has_no_trailing_space():
    md = render(Recipe(ingredients=(Ingredient("Salt"),)))
    assert "- Salt\n" in md + "\n"
    assert "- Salt " not in md


def test_metadata_pairs_are_hard_wrapped():
    # Without the two-space break the pairs reflow into one paragraph.
    md = render(Recipe(meta=(("A", "1"), ("B", "2"))))
    assert md == "A: **1**  \nB: **2**"


def test_labels_are_never_supplied_by_the_shape():
    # A non-Japanese recipe site must render entirely in its own words.
    md = render(
        Recipe(
            meta=(("Cooking time", "20 min"),),
            ingredients_heading="What you need",
            ingredients=(Ingredient("Salt", "1 tsp"),),
            steps_heading="How to make it",
            steps=("Stir.",),
        )
    )
    assert all(ord(ch) < 0x3000 for ch in md)
