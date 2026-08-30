"""cookien.com recipe extraction.

The golden file is not a recording of whatever the parser happens to
emit. It was checked line by line against the hand-built reference clip
(`main` drive, fileId VcY8nbMknm3U) with that reference's two known
defects corrected: memo 2 had lost its bullet list, and the recipe video
was a heading with nothing under it.

The fixture is the real page pruned to what the parser reads — one
representative recipe with three ingredients, two steps, a note with an
image, a note with a bullet list, a note with an embedded video, and
enough of the affiliate tail to prove the cut-off.
"""
from __future__ import annotations

from pathlib import Path

from app.services.extractor import extract_article
from app.services.extractors.sites.cookien import CookienExtractor

_FIXTURES = Path(__file__).parent / "fixtures"
_URL = "https://cookien.com/recipe/6508/"


def _page() -> str:
    return (_FIXTURES / "cookien_recipe.html").read_text(encoding="utf-8")


def _golden() -> str:
    return (_FIXTURES / "cookien_recipe.md").read_text(encoding="utf-8").strip()


def test_recipe_matches_golden():
    art = extract_article(_page(), _URL)
    assert art.markdown.strip() == _golden()


def test_title_comes_from_structured_data():
    art = extract_article(_page(), _URL)
    assert art.title == "ヤンニョムチキン（韓国風ピリ辛から揚げ）"


def test_method_survives():
    # The whole reason this site needs a parser: trafilatura reads the
    # step markup as boilerplate and drops every instruction.
    art = extract_article(_page(), _URL)
    assert "## 作り方" in art.markdown
    assert "1. 鶏肉は室温に戻します" in art.markdown


def test_ingredient_name_and_amount_are_separated():
    art = extract_article(_page(), _URL)
    assert "- 鶏もも肉 約４００ｇ" in art.markdown


def test_metadata_labels_come_from_the_page():
    art = extract_article(_page(), _URL)
    assert "調理時間: **20分**" in art.markdown
    assert "冷蔵保存: **5日**" in art.markdown


def test_date_is_labelled_as_published_not_updated():
    # The page supplies only datePublished. Calling it an update date
    # would be a claim the page never makes.
    art = extract_article(_page(), _URL)
    assert "公開: **2018-7-14**" in art.markdown
    assert "更新" not in art.markdown


def test_note_bullet_list_is_kept():
    # The defect in the reference clip. Guard it explicitly: a
    # template-driven reconstruction is exactly the thing that swallows
    # a list nobody wrote a rule for.
    art = extract_article(_page(), _URL)
    assert "- 直径２６ｃｍのフライパンに大さじ４ほどの油をひいています。" in art.markdown


def test_embedded_video_becomes_a_link():
    art = extract_article(_page(), _URL)
    assert "[レシピ動画](https://www.youtube.com/embed/-nQ5GvVwSX8" in art.markdown


def test_image_links_are_unwrapped():
    # Each image links to its own full-size file; a link to where the
    # reader already is only adds noise.
    art = extract_article(_page(), _URL)
    assert "[![" not in art.markdown


def test_affiliate_tail_is_dropped():
    art = extract_article(_page(), _URL)
    assert "制作者が選ぶおすすめレシピ" not in art.markdown
    assert "affiliate paragraph" not in art.markdown


def test_no_source_url_in_the_body():
    # The pipeline records it in frontmatter under the key `url`.
    art = extract_article(_page(), _URL)
    assert "出典" not in art.markdown


def test_non_recipe_page_falls_through_to_generic():
    # The site also serves index and category pages. Emitting a
    # recipe-shaped document with no ingredients would be worse than
    # letting the generic pipeline have it.
    page = """
    <!doctype html><html><head><title>Category</title></head>
    <body><div class="entry-content">
      <h1 class="entry-title">肉のおかず</h1>
      <p>A listing page carrying enough prose to clear the minimum body
         size gate, but no ingredient or instruction markup at all.</p>
      <p>A second paragraph so the generic extractor keeps it.</p>
    </div></body></html>
    """
    art = extract_article(page, "https://cookien.com/category/meat/")
    assert "## 材料" not in art.markdown
    assert "肉のおかず" in art.markdown


def test_broken_markup_does_not_raise_and_degrades_to_generic():
    # Standing in for the site changing its DOM.
    mutilated = _page().replace('id="r_contents"', 'id="renamed"').replace(
        'id="ins_contents"', 'id="also_renamed"'
    )
    art = extract_article(mutilated, _URL)
    assert "## 作り方" not in art.markdown
    assert art.markdown  # generic still produced something


# ---------------------------------------------------------------------------
# The layout the site serves today
# ---------------------------------------------------------------------------
#
# cookien runs two layouts side by side. Older posts use the markup the
# tests above cover; posts from 2026 use `page_recipe.new_recipe_format`,
# which moves the memo sections inside their own <section>, wraps
# ingredient names in search links, groups ingredients and steps under
# sub-headings, drops the recipe_info block entirely, and serves photos
# through <picture>. A parser written against either layout alone
# silently produces a partial recipe on the other.

_NEW_URL = "https://cookien.com/recipe/50561/"


def _new_page() -> str:
    return (_FIXTURES / "cookien_recipe_new_format.html").read_text(encoding="utf-8")


def _new_golden() -> str:
    return (_FIXTURES / "cookien_recipe_new_format.md").read_text(
        encoding="utf-8"
    ).strip()


def test_new_format_matches_golden():
    art = extract_article(_new_page(), _NEW_URL)
    assert art.markdown.strip() == _new_golden()


def test_new_format_ingredient_names_inside_links_survive():
    # The name is wrapped in a search link, so reading the paragraph's
    # own text node returns nothing. The loss is partial and silent: the
    # recipe just appears to have fewer ingredients.
    art = extract_article(_new_page(), _NEW_URL)
    assert "- 豚こま切れ肉 300g" in art.markdown
    assert "- なす 4本（320g）" in art.markdown


def test_new_format_keeps_ingredient_groups():
    art = extract_article(_new_page(), _NEW_URL)
    assert "**＜具材＞**" in art.markdown
    assert "**＜みそだれ＞**" in art.markdown


def test_new_format_keeps_step_groups_and_numbering():
    art = extract_article(_new_page(), _NEW_URL)
    assert "**＜下ごしらえ＞（メモ1）**" in art.markdown
    assert "**＜炒める＞（メモ2）**" in art.markdown
    # Numbering runs across groups, as the page numbers its own steps.
    assert "3. フライパンに油" in art.markdown


def test_new_format_memos_are_found_inside_their_section():
    # The memos are no longer siblings of the article body, so a walk
    # anchored to the body finds none of them at all.
    art = extract_article(_new_page(), _NEW_URL)
    assert "### メモ1: 下ごしらえのポイント" in art.markdown
    assert "### メモ2: 炒めるときのポイント" in art.markdown


def test_new_format_metadata_falls_back_to_structured_data():
    # The recipe_info block is gone; the duration only survives in the
    # JSON-LD, which has no label for it.
    art = extract_article(_new_page(), _NEW_URL)
    assert "調理時間: **20分**" in art.markdown
    assert "分量: **（ 保存容器大1個分 ） 食べきりの場合 3～4人分**" in art.markdown


def test_new_format_drops_the_tail_section():
    art = extract_article(_new_page(), _NEW_URL)
    assert "補足" not in art.markdown


def test_photos_in_one_note_stay_on_adjacent_lines():
    # Litloft's preview lays consecutive image lines out as columns. A
    # blank line between them is not cosmetic: it breaks the row into
    # stacked single images.
    art = extract_article(_new_page(), _NEW_URL)
    assert "nasu-buta-miso_1.jpg)\n![" in art.markdown
    assert "nasu-buta-miso_1.jpg)\n\n![" not in art.markdown


def test_three_photos_in_one_note_form_a_single_run():
    art = extract_article(_page(), _URL)
    run = "\n".join(
        f"![](https://cookien.com/wp-content/uploads/2018/06/yangnyeom-chicken_{n}.jpg)"
        for n in (1, 2)
    )
    assert run in art.markdown


def test_structured_data_covers_a_dom_without_rows():
    # Safety net for a layout that renders its rows some other way: the
    # DOM containers are gone, but the JSON-LD still carries the recipe.
    page = _new_page().replace('id="r_contents"', 'id="gone"').replace(
        'id="ins_contents"', 'id="also-gone"'
    )
    art = extract_article(page, _NEW_URL)
    assert "- 豚こま切れ肉 300g" in art.markdown
    assert "## 作り方" in art.markdown
    assert "◎はボウルAでよく混ぜ合わせます。" in art.markdown
    # The separator that splits name from amount also marks the
    # ingredient sub-headings, which carry none.
    assert "**＜具材＞**" in art.markdown
    # Steps have no such marker, so every entry becomes a numbered step
    # rather than guessing which ones are stage headings.
    assert "1. ＜下ごしらえ＞" in art.markdown


# ---------------------------------------------------------------------------
# JSON-LD shapes
# ---------------------------------------------------------------------------


def test_recipe_is_found_inside_a_json_ld_array():
    page = _page().replace(
        '<script type="application/ld+json">{', '<script type="application/ld+json">[{'
    )
    page = page.replace("}</script>", "}]</script>")
    art = extract_article(page, _URL)
    assert art.title == "ヤンニョムチキン（韓国風ピリ辛から揚げ）"


def test_object_valued_image_does_not_abandon_the_recipe():
    # `image` is polymorphic in schema.org. Treating it as a string
    # raises, and the catch-all would throw away a perfectly good recipe
    # over an optional field.
    page = _page().replace(
        '"image":"https://cookien.com/wp-content/uploads/2018/06/yangnyeom-chicken.jpg"',
        '"image":{"@type":"ImageObject",'
        '"url":"https://cookien.com/wp-content/uploads/2018/06/yangnyeom-chicken.jpg"}',
    )
    assert '"@type":"ImageObject"' in page  # the edit really landed
    art = extract_article(page, _URL)
    assert "## 作り方" in art.markdown
    assert "![](https://cookien.com/wp-content/uploads/2018/06/yangnyeom-chicken.jpg)" in art.markdown


def test_unsafe_hero_url_is_dropped_not_rendered():
    # The hero goes straight into Markdown without passing through the
    # bleach protocol allowlist that guards DOM-derived links, and the
    # page is untrusted fetched content.
    page = _page().replace(
        '"image":"https://cookien.com/wp-content/uploads/2018/06/yangnyeom-chicken.jpg"',
        '"image":"javascript:alert(1)"',
    )
    assert '"image":"javascript:alert(1)"' in page  # the edit really landed
    art = extract_article(page, _URL)
    assert "javascript:" not in art.markdown
    assert "## 作り方" in art.markdown  # the rest of the recipe survives


def test_non_string_metadata_does_not_abandon_the_recipe():
    # Losing a whole recipe to a stray value in an optional field would
    # send the page to the generic path, which drops the method.
    page = _page().replace('"datePublished":"2018-7-14"', '"datePublished":["2018-7-14"]')
    assert '"datePublished":["2018-7-14"]' in page  # the edit really landed
    art = extract_article(page, _URL)
    assert "## 作り方" in art.markdown
    assert "公開" not in art.markdown


def test_matches_host_and_subdomains_only():
    extractor = CookienExtractor()
    assert extractor.matches("https://cookien.com/recipe/1/")
    assert extractor.matches("https://www.cookien.com/recipe/1/")
    assert not extractor.matches("https://cookien.com.evil.example/recipe/1/")
    assert not extractor.matches("https://example.com/recipe/1/")
    assert not extractor.matches(None)
