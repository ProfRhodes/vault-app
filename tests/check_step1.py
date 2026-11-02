"""Step 1 check: reading, search, backlinks, link resolution, escaping.

Run with the app served at http://localhost:8765/ (python -m http.server 8765
from the memory-app folder). Writes screenshots next to this file.
"""

import os
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

BASE = os.environ.get("VAULT_BASE", "http://localhost:8765/")
OUT = Path(__file__).parent
failures = []


def check(label, ok, detail=""):
    print(("PASS " if ok else "FAIL ") + label + (f"  ({detail})" if detail and not ok else ""))
    if not ok:
        failures.append(label)


def open_note(page, path):
    page.goto(BASE + "#/note/" + path.replace("/", "%2F"))
    page.wait_for_selector(".markdown")


with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={"width": 1280, "height": 800})
    page.add_init_script("localStorage.setItem('vault-welcomed', '1');")
    errors = []
    page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
    page.on("pageerror", lambda e: errors.append(str(e)))

    page.goto(BASE)
    page.wait_for_selector(".markdown")
    check("home note opens", page.locator(".markdown h1").inner_text() == "Welcome to the vault")
    check("sidebar lists all 11 notes", page.locator("#sidebar details:not(.recent) li").count() == 11, str(page.locator("#sidebar details:not(.recent) li").count()))
    groups = page.locator("#sidebar details:not(.recent) summary").all_inner_texts()
    check("groups ordered notes, memory, knowledge", [g.rstrip("0123456789").lower() for g in groups] == ["notes", "memory", "knowledge"], str(groups))
    check("resolved wikilinks on home", page.locator(".markdown a.wikilink").count() == 4, str(page.locator(".markdown a.wikilink").count()))
    check("missing wikilink shown as missing", page.locator(".markdown .wikilink.missing").inner_text() == "quiz-review-workflow")
    check("alias label used", page.locator(".markdown a.wikilink", has_text="the memory wheel plan").count() == 1)
    page.screenshot(path=str(OUT / "step1-desktop.png"))

    page.locator(".markdown a.wikilink", has_text="the memory wheel plan").click()
    for _ in range(100):
        if page.title().startswith("Plan: memory wheel view"):
            break
        page.wait_for_timeout(50)
    check("wikilink navigates", "Plan: memory wheel view" in page.title())
    check("ordered list with nested list", page.locator(".markdown ol > li > ul > li").count() == 2)
    check("code block rendered", "Math.PI" in page.locator(".markdown pre code").inner_text())

    open_note(page, "knowledge/neuroscience/forgetting-curve.md")
    backs = sorted(page.locator(".backlinks li > a").all_inner_texts())
    check("forgetting-curve has 3 backlinks", backs == ["Plan: memory wheel view", "Spreading activation", "Voice capture idea"], str(backs))
    check("external link opens in new tab", page.locator(".markdown a[href^='https://en.wikipedia.org']").get_attribute("target") == "_blank")

    open_note(page, "memory/MEMORY.md")
    check("relative .md links resolve", page.locator(".markdown a.wikilink").count() == 2)
    open_note(page, "memory/feedback_sample_rule.md")
    check("frontmatter hidden, name used as title", page.locator("#note > h1").inner_text() == "feedback_sample_rule")
    check("description shown", "made-up memory" in page.locator(".description").inner_text())
    check("type tag shown", page.locator(".tag").inner_text() == "feedback")
    check("memory backlink from index", "Memory Index" in page.locator(".backlinks").inner_text())

    open_note(page, "notes/how-this-vault-works.md")
    check("table rendered", page.locator(".markdown table tbody tr").count() == 3)
    check("blockquote rendered", page.locator(".markdown blockquote").count() == 1)
    check("inline code keeps brackets literal", page.locator(".markdown code").first.inner_text() == "[[note name]]")

    open_note(page, "notes/voice-capture-idea.md")
    check("task checkboxes", page.locator(".markdown input[type=checkbox]").count() == 2 and page.locator(".markdown input:checked").count() == 1)

    page.fill("#search", "fade")
    page.wait_for_timeout(300)
    titles = page.locator("#sidebar li a").evaluate_all("els => els.map(e => e.firstChild.textContent)")
    check("search finds notes with 'fade'", set(titles) == {"Voice capture idea", "Plan: memory wheel view", "Forgetting curve"}, str(titles))
    check("search highlights matches", page.locator("#sidebar mark").count() >= 3)
    page.fill("#search", "memory wheels")
    page.wait_for_timeout(300)
    titles = page.locator("#sidebar li a").evaluate_all("els => els.map(e => e.firstChild.textContent)")
    check("multi-word search requires every word", set(titles) == {"Plan: memory wheel view", "Giordano Bruno"}, str(titles))
    page.fill("#search", "zzzz")
    page.wait_for_timeout(300)
    check("empty search result message", "No notes match" in page.locator("#sidebar").inner_text())
    page.press("#search", "Escape")
    check("escape clears search", page.locator("#sidebar details:not(.recent) li").count() == 11)

    hostile = page.evaluate(
        """async () => {
            const md = await import('./markdown.js');
            const ctx = { wikilink: (t, l) => l, mdlink: (u, l) => l };
            return md.renderMarkdown('<img src=x onerror=alert(1)> [x](javascript:alert(1)) **<b>hi</b>**', ctx);
        }"""
    )
    check("note HTML is escaped", "<img" not in hostile and "<b>" not in hostile, hostile)
    check("javascript: links are dropped", "javascript:" not in hostile.split("&")[0] and 'href="javascript' not in hostile, hostile)

    mobile = browser.new_page(viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True)
    mobile.add_init_script("localStorage.setItem('vault-welcomed', '1');")
    mobile.goto(BASE + "#/note/notes%2Fplans%2Fmemory-wheel-view.md")
    mobile.wait_for_selector(".markdown")
    mobile.wait_for_timeout(300)
    mobile.screenshot(path=str(OUT / "step1-mobile-note.png"))
    check("sidebar hidden on phone", mobile.locator("#sidebar").bounding_box()["x"] < 0)
    mobile.click("#menu")
    mobile.wait_for_timeout(350)
    check("menu opens sidebar on phone", mobile.locator("#sidebar").bounding_box()["x"] == 0)
    mobile.screenshot(path=str(OUT / "step1-mobile-nav.png"))
    mobile.locator("#sidebar details:not(.recent) a", has_text="Giordano Bruno").click()
    mobile.wait_for_timeout(350)
    check("opening a note closes sidebar", mobile.locator("#sidebar").bounding_box()["x"] < 0)
    overflow = mobile.evaluate("document.documentElement.scrollWidth > window.innerWidth")
    check("no sideways scrolling on phone", not overflow)

    check("no console errors", not errors, "; ".join(errors))
    browser.close()

print(f"\n{'ALL PASSED' if not failures else str(len(failures)) + ' FAILED'}")
sys.exit(1 if failures else 0)
