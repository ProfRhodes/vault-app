"""Checks for steps 2 to 6: graph visuals, editing, voice, GitHub source, PWA.

    python tests/check_full.py

Starts dev_server.py on a throwaway copy of the sample vault, so nothing here
changes the real sample files. GitHub is simulated with request interception;
no real account or token is used. Screenshots land next to this file.
"""

import base64
import json
import math
import re
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.request
from pathlib import Path

from playwright.sync_api import sync_playwright

APP = Path(__file__).resolve().parent.parent
OUT = Path(__file__).parent
PORT = 8766
BASE = f"http://localhost:{PORT}/"
failures = []


def check(label, ok, detail=""):
    print(("PASS " if ok else "FAIL ") + label + (f"  ({detail})" if detail and not ok else ""))
    if not ok:
        failures.append(label)


def enc(path):
    return path.replace("/", "%2F")


def watch_errors(page, errors, allow=()):
    def on_console(m):
        if m.type == "error" and not any(a in m.text for a in allow):
            errors.append(m.text)

    page.on("console", on_console)
    page.on("pageerror", lambda e: errors.append(str(e)))


def wait_until(page, expr, timeout=10000):
    """Polls a JS expression. wait_for_function uses eval, which the app's CSP blocks."""
    deadline = time.time() + timeout / 1000
    while True:
        try:
            if page.evaluate(expr):
                return
        except Exception:
            pass
        if time.time() > deadline:
            raise TimeoutError(f"timed out waiting for: {expr}")
        time.sleep(0.05)


def wait_graph(page, count):
    wait_until(page, f"window.__vault.graph && window.__vault.graph.nodes.length === {count}")


def settled(page):
    wait_until(page, 
        "window.__vault.graph.nodes.every(n => Math.abs(n.x - n.tx) < 0.5 && Math.abs(n.y - n.ty) < 0.5)"
    )


def tap_node(page, path):
    x, y = page.evaluate(f"window.__vault.graph.screenOf({json.dumps(path)})")
    box = page.locator("#graph-canvas").bounding_box()
    page.mouse.click(box["x"] + x, box["y"] + y)


# ---------------------------------------------------------------- local app

def local_checks(browser, vault_dir):
    errors = []
    ctx = browser.new_context(viewport={"width": 1280, "height": 800}, service_workers="block")
    ctx.add_init_script("localStorage.setItem('vault-welcomed', '1');")
    page = ctx.new_page()
    watch_errors(page, errors)

    # Step 2: web graph, forgetting curve, spreading activation
    page.goto(BASE + "#/graph/web")
    wait_graph(page, 11)
    wait_until(page, "window.__vault.graph.alpha < 0.02")
    g = page.evaluate(
        """() => { const g = window.__vault.graph; return {
            nodes: g.nodes.map(n => ({path: n.path, x: n.x, y: n.y, strength: n.strength})),
            edges: g.edges.map(e => ({a: e.a.path, b: e.b.path, linked: e.linked, w: e.w})) }; }"""
    )
    check("graph has a node per note", len(g["nodes"]) == 11)
    finite = all(math.isfinite(n["x"]) and math.isfinite(n["y"]) for n in g["nodes"])
    mind = min(math.dist((a["x"], a["y"]), (b["x"], b["y"])) for i, a in enumerate(g["nodes"]) for b in g["nodes"][i + 1:])
    check("force layout spreads notes apart", finite and mind > 8, f"min distance {mind:.1f}")
    linked = [e for e in g["edges"] if e["linked"]]
    check("written links become edges", len(linked) >= 9, str(len(linked)))
    learned = [e for e in g["edges"] if not e["linked"]]
    check(
        "Hebbian-only pair shows as a learned edge",
        len(learned) == 1 and {learned[0]["a"], learned[0]["b"]} == {"notes/shopping/standing-desk.md", "notes/voice-capture-idea.md"} and learned[0]["w"] == 4,
        str(learned),
    )
    fc = next(e for e in g["edges"] if {e["a"], e["b"]} == {"knowledge/neuroscience/forgetting-curve.md", "knowledge/neuroscience/spreading-activation.md"})
    check("linked pair carries its Hebbian weight", fc["w"] == 3)
    st = {n["path"]: n["strength"] for n in g["nodes"]}
    check(
        "forgetting curve: stale notes are dimmer",
        st["knowledge/occult/giordano-bruno.md"] < st["knowledge/neuroscience/forgetting-curve.md"] < st["notes/welcome.md"],
        f"{st['knowledge/occult/giordano-bruno.md']:.2f} {st['knowledge/neuroscience/forgetting-curve.md']:.2f} {st['notes/welcome.md']:.2f}",
    )

    target = "knowledge/neuroscience/forgetting-curve.md"
    tap_node(page, target)
    page.wait_for_selector("#graph-card:not([hidden])")
    check("tap selects the note", page.evaluate("window.__vault.graph.selected.path") == target)
    check("info card shows the note", "Forgetting curve" in page.locator("#graph-card .card-title").inner_text())
    acts = page.evaluate(
        """() => { const g = window.__vault.graph; const out = {};
            for (const [n, a] of g.act) out[n.path] = {level: a.level, at: a.at};
            return out; }"""
    )
    start = acts[target]["at"]
    check("activation starts at full strength", abs(acts[target]["level"] - 1) < 1e-9)
    check("one hop away gets 0.62", abs(acts["knowledge/neuroscience/spreading-activation.md"]["level"] - 0.62) < 1e-9)
    check("two hops away gets 0.62 squared", abs(acts["knowledge/occult/giordano-bruno.md"]["level"] - 0.62 ** 2) < 1e-9)
    check(
        "the wave travels outward over time",
        acts["knowledge/occult/giordano-bruno.md"]["at"] - start == 460 and acts["notes/plans/memory-wheel-view.md"]["at"] - start == 230,
    )
    timing = page.evaluate(
        f"""() => {{ const g = window.__vault.graph; const n = g.byPath.get('knowledge/occult/giordano-bruno.md');
            return [g.actAt(n, {start} + 300), g.actAt(n, {start} + 700), g.actAt(n, {start} + 9000)]; }}"""
    )
    check("glow arrives, peaks, then fades", timing[0] == 0 and timing[1] > 0.2 and timing[2] < 0.01, str(timing))
    page.wait_for_timeout(450)
    page.screenshot(path=str(OUT / "graph-web.png"))
    tap_node(page, target)
    wait_until(page, "location.hash.startsWith('#/note/')")
    check("second tap opens the note", page.evaluate("decodeURIComponent(location.hash)") == "#/note/" + target)

    # Hebbian learning from real opens
    page.goto(BASE + "#/note/" + enc("notes/shopping/standing-desk.md"))
    page.wait_for_selector(".markdown")
    page.goto(BASE + "#/note/" + enc("notes/how-this-vault-works.md"))
    page.wait_for_selector(".markdown h1")
    page.goto(BASE + "#/note/" + enc("notes/shopping/standing-desk.md"))
    page.wait_for_selector(".markdown")
    w = page.evaluate("window.__vault.state.data.hebbian['notes/how-this-vault-works.md\\nnotes/shopping/standing-desk.md']")
    check("opening notes back to back wires them together once", w == 1, str(w))
    check("memory line shows on note", "Opened" in page.locator(".memory-line").inner_text() or "First visit" in page.locator(".memory-line").inner_text())

    # Step 3: consolidation rings
    page.goto(BASE + "#/graph/rings")
    wait_graph(page, 11)
    settled(page)
    radius = page.evaluate("Object.fromEntries(window.__vault.graph.nodes.map(n => [n.path, Math.hypot(n.x, n.y)]))")
    order = ["notes/welcome.md", "notes/how-this-vault-works.md", "notes/plans/memory-wheel-view.md", "knowledge/neuroscience/forgetting-curve.md", "knowledge/occult/giordano-bruno.md"]
    check("rings: older notes sit farther out", all(radius[a] < radius[b] for a, b in zip(order, order[1:])), str([round(radius[p]) for p in order]))
    check("rings: today's note is in the hippocampus core", radius["notes/welcome.md"] < 70)
    page.screenshot(path=str(OUT / "graph-rings.png"))

    # Step 3: memory wheels
    page.goto(BASE + "#/graph/wheel")
    wait_graph(page, 11)
    settled(page)
    slots = page.evaluate("Object.fromEntries(window.__vault.graph.slotMap)")
    groups = {}
    for p, s in slots.items():
        groups.setdefault(p.split("/")[0], []).append(s)
    check("wheel: every note has a unique slot in its wheel", all(len(v) == len(set(v)) for v in groups.values()) and len(slots) == 11)
    check("wheel: one aligned note per wheel at the pointer", page.locator("#graph-aligned .chip").count() == 3)
    page.screenshot(path=str(OUT / "graph-wheel.png"))
    before = page.locator("#graph-aligned .chip").first.inner_text()
    wheel = page.evaluate("(() => { const w = window.__vault.graph.wheels[0]; return {group: w.group, r: (w.inner + w.outer) / 2}; })()")
    box = page.locator("#graph-canvas").bounding_box()
    sx, sy = page.evaluate(f"window.__vault.graph.toScreen({wheel['r']}, 0)")
    ex, ey = page.evaluate(f"window.__vault.graph.toScreen(0, {wheel['r']})")
    page.mouse.move(box["x"] + sx, box["y"] + sy)
    page.mouse.down()
    page.mouse.move(box["x"] + ex, box["y"] + ey, steps=12)
    page.mouse.up()
    turn = page.evaluate(f"window.__vault.state.turn({json.dumps(wheel['group'])})")
    check("wheel: dragging turns the wheel", abs(turn - math.pi / 2) < 0.15, f"{turn:.2f}")
    after = page.locator("#graph-aligned .chip").first.inner_text() if page.locator("#graph-aligned .chip").count() else ""
    check("wheel: turning changes what sits at the pointer", after != before, f"{before} -> {after}")
    chip = page.locator("#graph-aligned .chip").last
    chip_title = chip.inner_text()
    chip.click()
    check("wheel: tapping an aligned chip selects it", page.evaluate("window.__vault.graph.selected.title") == chip_title)
    page.evaluate("window.__vault.state.flush()")
    saved = json.loads((vault_dir / ".vault" / "state.json").read_text(encoding="utf-8"))
    check("usage data saved to the vault", len(saved["palace"]) == 11 and abs(saved["turns"][wheel["group"]] - turn) < 1e-9 and saved["hebbian"].get("notes/how-this-vault-works.md\nnotes/shopping/standing-desk.md") == 1)

    # Step 4: editing
    path = "knowledge/neuroscience/forgetting-curve.md"
    page.goto(BASE + "#/note/" + enc(path))
    page.locator(".note-actions a", has_text="Edit").click()
    page.wait_for_selector("#ed-body")
    check("editor opens with the raw note", page.input_value("#ed-body").startswith("# Forgetting curve"))
    page.locator("#ed-body").press("Control+End")
    page.locator("#ed-body").type("\n\nSee also [[giordano-bruno]].")
    page.click("#ed-save")
    wait_until(page, "location.hash.startsWith('#/note/')")
    disk = (vault_dir / path).read_text(encoding="utf-8")
    check("saving writes the file", disk.rstrip().endswith("See also [[giordano-bruno]]."))
    check("saved note shows the new link", page.locator(".markdown a.wikilink", has_text="giordano-bruno").count() == 1)
    page.goto(BASE + "#/note/" + enc("knowledge/occult/giordano-bruno.md"))
    check("links rebuild after an edit", "Forgetting curve" in page.locator(".backlinks").inner_text())

    page.goto(BASE + "#/edit/" + enc("notes/welcome.md"))
    page.wait_for_selector("#ed-body")
    page.locator("#ed-body").type("unsaved")
    dialogs = []

    def dismiss(d):
        dialogs.append(d.message)
        d.dismiss()

    page.once("dialog", dismiss)
    page.evaluate("location.hash = '#/graph'")
    page.wait_for_timeout(300)
    check("unsaved changes ask before leaving", dialogs == ["Discard unsaved changes?"])
    check("staying keeps the editor", page.locator("#ed-body").count() == 1 and "unsaved" in page.input_value("#ed-body"))
    page.once("dialog", lambda d: d.accept())
    page.evaluate("location.hash = '#/note/notes%2Fwelcome.md'")
    page.wait_for_selector(".markdown h1")
    check("discarding leaves the file alone", "unsaved" not in (vault_dir / "notes/welcome.md").read_text(encoding="utf-8"))

    page.goto(BASE + "#/new")
    page.wait_for_selector("#ed-title")
    page.fill("#ed-title", "Test capture")
    page.fill("#ed-body", "Hello [[welcome]]")
    page.click("#ed-save")
    page.wait_for_selector(".markdown h1")
    created = vault_dir / "notes/test-capture.md"
    check("new note is created as a file", created.exists() and created.read_text(encoding="utf-8").startswith("# Test capture"))
    manifest = json.loads((vault_dir / "manifest.json").read_text(encoding="utf-8"))
    check("new note is added to the manifest", "notes/test-capture.md" in manifest)
    check("sidebar lists the new note", page.locator("#sidebar li").count() == 12)
    page.goto(BASE + "#/note/notes%2Fwelcome.md")
    check("new note links back", "Test capture" in page.locator(".backlinks").inner_text())
    page.goto(BASE + "#/new")
    page.wait_for_selector("#ed-title")
    page.fill("#ed-title", "Test capture")
    page.click("#ed-save")
    page.wait_for_selector(".markdown h1")
    check("same title gets a new file name", (vault_dir / "notes/test-capture-2.md").exists())

    page.goto(BASE + "#/settings")
    check("settings shows the sample vault", "Sample vault" in page.locator(".settings").inner_text())

    mobile = ctx.new_page()
    mobile.set_viewport_size({"width": 390, "height": 844})
    watch_errors(mobile, errors)
    mobile.goto(BASE + "#/graph/web")
    wait_graph(mobile, 13)
    mobile.wait_for_timeout(600)
    tap_node(mobile, "notes/plans/memory-wheel-view.md")
    mobile.wait_for_timeout(500)
    mobile.screenshot(path=str(OUT / "mobile-graph-web.png"))
    mobile.goto(BASE + "#/graph/wheel")
    mobile.wait_for_timeout(700)
    mobile.screenshot(path=str(OUT / "mobile-graph-wheel.png"))
    overflow = mobile.evaluate("document.documentElement.scrollWidth > window.innerWidth")
    check("graph fits the phone screen", not overflow)
    mobile.goto(BASE + "#/new")
    mobile.wait_for_selector("#ed-body")
    mobile.screenshot(path=str(OUT / "mobile-editor.png"))

    check("no console errors in the local app", not errors, "; ".join(errors))
    ctx.close()


# ---------------------------------------------------------------- voice

FAKE_VOICE = """
class FakeRecognition {
  start() {
    window.__voiceStarts = (window.__voiceStarts || 0) + 1;
    if (window.__spoken) return;
    window.__spoken = true;
    setTimeout(() => {
      const first = [{ transcript: 'hello from the', confidence: 0.9 }];
      first.isFinal = false;
      this.onresult && this.onresult({ resultIndex: 0, results: [first] });
      const done = [{ transcript: 'hello from the phone', confidence: 0.9 }];
      done.isFinal = true;
      this.onresult && this.onresult({ resultIndex: 0, results: [done] });
      setTimeout(() => this.onend && this.onend(), 20);
    }, 60);
  }
  stop() { setTimeout(() => this.onend && this.onend(), 0); }
}
window.SpeechRecognition = FakeRecognition;
window.webkitSpeechRecognition = FakeRecognition;
"""


def voice_checks(browser, vault_dir):
    errors = []
    ctx = browser.new_context(viewport={"width": 390, "height": 844}, service_workers="block")
    ctx.add_init_script(FAKE_VOICE)
    ctx.add_init_script("localStorage.setItem('vault-welcomed', '1');")
    page = ctx.new_page()
    watch_errors(page, errors)
    page.goto(BASE + "#/new/voice")
    page.wait_for_selector("#ed-body")
    wait_until(page, "document.getElementById('ed-body').value.includes('hello from the phone')")
    body = page.input_value("#ed-body")
    check("voice note starts listening and types what was said", body.startswith("*Captured by voice,") and body.rstrip().endswith("hello from the phone"))
    check("interim words are not typed twice", body.count("hello from the") == 1)
    check("voice note gets a dated title", page.input_value("#ed-title").startswith("Voice note "))
    page.wait_for_timeout(400)
    check("listening restarts after a pause", page.evaluate("window.__voiceStarts") >= 2)
    check("mic button shows Stop while listening", page.locator("#ed-mic").inner_text() == "Stop")
    page.click("#ed-mic")
    check("tapping Stop ends listening", page.locator("#ed-mic").inner_text() == "Speak")
    page.click("#ed-save")
    page.wait_for_selector(".markdown h1")
    saved = [p for p in (vault_dir / "notes").glob("voice-note-*.md")]
    check("voice note saved as a file", len(saved) == 1 and "hello from the phone" in saved[0].read_text(encoding="utf-8"))
    check("no console errors in voice checks", not errors, "; ".join(errors))
    ctx.close()

    ctx = browser.new_context(viewport={"width": 390, "height": 844}, service_workers="block")
    ctx.add_init_script("delete window.SpeechRecognition; delete window.webkitSpeechRecognition;")
    ctx.add_init_script("localStorage.setItem('vault-welcomed', '1');")
    page = ctx.new_page()
    page.goto(BASE + "#/new/voice")
    page.wait_for_selector("#ed-body")
    check("without speech support the keyboard mic is suggested", page.locator("#ed-mic").is_hidden() and "keyboard" in page.locator("#ed-status").inner_text())
    ctx.close()


# ---------------------------------------------------------------- GitHub source

NOTES = {
    "notes/alpha.md": "# Alpha\n\nLinks to [[b]] and [[CLAUDE]].\n",
    "memory/b.md": '---\nname: b\ndescription: "Bee memory"\n---\nBody of b, with café and ✨.\n',
    "CLAUDE.md": "# Rules\n\nBe kind.\n",
}


class FakeGitHub:
    def __init__(self):
        self.files = {p: {"text": t, "sha": f"sha-{i}"} for i, (p, t) in enumerate(NOTES.items())}
        self.files["icons/logo.png"] = {"text": None, "sha": "sha-png"}
        self.auth = set()
        self.graphql_paths = []
        self.puts = []
        self.counter = 0

    def handle(self, route):
        req = route.request
        self.auth.add(req.headers.get("authorization"))
        url = req.url.split("?")[0]
        if req.headers.get("authorization") != "Bearer tok123":
            return route.fulfill(status=401, json={"message": "Bad credentials"})
        if url.endswith("/repos/me/vault/git/trees/main"):
            tree = [{"path": p, "type": "blob", "sha": f["sha"]} for p, f in self.files.items()]
            tree.append({"path": "notes", "type": "tree", "sha": "t1"})
            return route.fulfill(json={"tree": tree, "truncated": False})
        if url.endswith("/graphql"):
            query = json.loads(req.post_data)["query"]
            data = {}
            for key, path in re.findall(r'(f\d+): object\(expression: "main:([^"]+)"\)', query):
                self.graphql_paths.append(path)
                f = self.files.get(path)
                data[key] = None if not f else {"text": f["text"], "isBinary": f["text"] is None, "isTruncated": False}
            return route.fulfill(json={"data": {"repository": data}})
        m = re.search(r"/repos/me/vault/contents/(.+)$", url)
        if m:
            path = urllib.request.unquote(m.group(1))
            if req.method == "GET":
                f = self.files.get(path)
                if not f:
                    return route.fulfill(status=404, json={"message": "Not Found"})
                return route.fulfill(json={"sha": f["sha"], "content": base64.b64encode(f["text"].encode()).decode()})
            if req.method == "PUT":
                body = json.loads(req.post_data)
                self.puts.append((path, body))
                f = self.files.get(path)
                if f and body.get("sha") != f["sha"]:
                    return route.fulfill(status=409, json={"message": "is at a different sha"})
                self.counter += 1
                sha = f"new-{self.counter}"
                self.files[path] = {"text": base64.b64decode(body["content"]).decode("utf-8"), "sha": sha}
                return route.fulfill(json={"content": {"sha": sha, "path": path}})
        return route.fulfill(status=404, json={"message": "Not Found"})


def github_checks(browser):
    errors = []
    gh = FakeGitHub()
    ctx = browser.new_context(viewport={"width": 1280, "height": 800}, service_workers="block")
    ctx.add_init_script(
        "localStorage.setItem('vault-settings', JSON.stringify({owner: 'me', repo: 'vault', branch: 'main', token: 'tok123'})); localStorage.setItem('vault-welcomed', '1');"
    )
    ctx.route("https://api.github.com/**", gh.handle)
    page = ctx.new_page()
    watch_errors(page, errors, allow=("Failed to load resource",))
    page.goto(BASE + "#/note/" + enc("notes/alpha.md"))
    page.wait_for_selector(".markdown h1")
    check("GitHub vault loads its notes", page.locator("#sidebar li").count() == 3)
    check("only markdown files are loaded", "icons/logo.png" not in gh.graphql_paths)
    check("every request carries the token", gh.auth == {"Bearer tok123"}, str(gh.auth))
    check("vault name shown", page.locator("#vault-label").inner_text() == "me/vault")
    check("links resolve in the GitHub vault", page.locator(".markdown a.wikilink").count() == 2)
    page.goto(BASE + "#/note/" + enc("memory/b.md"))
    check("accents and emoji survive loading", "café and ✨" in page.locator(".markdown").inner_text())

    page.goto(BASE + "#/edit/" + enc("memory/b.md"))
    page.wait_for_selector("#ed-body")
    page.locator("#ed-body").press("Control+End")
    page.locator("#ed-body").type("naïve ✨ edit")
    page.click("#ed-save")
    wait_until(page, "location.hash.startsWith('#/note/')")
    path, body = gh.puts[-1]
    text = base64.b64decode(body["content"]).decode("utf-8")
    check("edit is sent to GitHub for the right file", path == "memory/b.md" and body["branch"] == "main")
    check("edit sends the current sha", body.get("sha") == "sha-1")
    check("unicode survives saving", text.endswith("naïve ✨ edit"))
    check("commit message names the note", "memory/b.md" in body["message"])

    gh.files["notes/alpha.md"]["sha"] = "changed-elsewhere"
    page.goto(BASE + "#/edit/" + enc("notes/alpha.md"))
    page.wait_for_selector("#ed-body")
    page.locator("#ed-body").type("x")
    page.click("#ed-save")
    wait_until(page, "document.getElementById('ed-status').textContent.includes('another device')")
    check("a conflicting edit is refused with a clear message", page.locator("#ed-body").count() == 1)
    page.once("dialog", lambda d: d.accept())
    page.evaluate("location.hash = '#/'")
    page.wait_for_selector("#graph:not([hidden])")
    check("home opens the graph when there is no welcome note", page.locator("#graph").is_visible())

    page.evaluate("window.__vault.state.pending = true; window.__vault.state.flush()")
    wait_until(page, "window.__vault.state.saving === null && !window.__vault.state.pending")
    state_puts = [b for p, b in gh.puts if p == ".vault/state.json"]
    check("usage data saved to GitHub", len(state_puts) == 1 and "sha" not in state_puts[0] and state_puts[0]["message"] == "Update vault state")
    page.evaluate("window.__vault.state.pending = true; window.__vault.state.flush()")
    wait_until(page, "window.__vault.state.saving === null && !window.__vault.state.pending")
    state_puts = [b for p, b in gh.puts if p == ".vault/state.json"]
    check("second save updates the same file", len(state_puts) == 2 and state_puts[1].get("sha", "").startswith("new-"))

    gh.graphql_paths.clear()
    page.reload()
    page.wait_for_selector("#graph:not([hidden])")
    check("reload uses the device cache for unchanged notes", gh.graphql_paths == ["notes/alpha.md"], str(gh.graphql_paths))

    page.goto(BASE + "#/settings")
    check("settings shows the connected vault", "me/vault" in page.locator(".settings").inner_text())
    check("saved token is never shown", page.input_value("#st-token") == "" and "saved" in page.get_attribute("#st-token", "placeholder"))
    page.fill("#st-token", "bad")
    page.click("#st-save")
    wait_until(page, "document.getElementById('st-status').textContent.includes('rejected')")
    check("a bad token gets a clear message", True)
    check("no console errors in GitHub checks", not errors, "; ".join(errors))
    ctx.close()


# ---------------------------------------------------------------- help

def help_checks(browser):
    errors = []
    ctx = browser.new_context(viewport={"width": 390, "height": 844}, service_workers="block")
    page = ctx.new_page()
    watch_errors(page, errors)
    page.goto(BASE)
    page.wait_for_selector(".help h1")
    check("first open shows the guide", page.evaluate("location.hash") == "#/help" and page.locator(".welcome").count() == 1)
    sections = page.locator(".help h2").all_inner_texts()
    check("guide covers every area", all(any(w in s for s in sections) for w in ["Getting set up", "Notes", "Voice", "graph", "Syncing", "Privacy", "Troubleshooting"]), str(sections))
    check("graph views are explained", page.locator(".help h3").all_inner_texts()[:3] == ["Web", "Consolidation", "Memory wheel"])
    page.click(".welcome a")
    page.wait_for_selector(".markdown h1")
    check("start button opens the vault", page.locator(".markdown h1").inner_text() == "Welcome to the vault")
    page.reload()
    page.wait_for_selector(".markdown h1")
    check("guide does not pop up a second time", page.evaluate("location.hash") != "#/help")
    page.click("#menu")
    page.locator(".sidebar-foot a", has_text="Help").click()
    page.wait_for_selector(".help h1")
    check("Help in the menu opens the guide without the welcome", page.locator(".welcome").count() == 0)
    page.goto(BASE + "#/graph/web")
    wait_until(page, "window.__vault.graph && window.__vault.graph.nodes.length >= 11")
    page.click("#graph-legend summary")
    page.locator("#legend-body a", has_text="How to use the graph").click()
    page.wait_for_selector("#h-the-graph")
    top = page.evaluate("document.getElementById('h-the-graph').getBoundingClientRect().top")
    check("Key links straight to the graph section", 0 <= top < 200, str(top))
    check("no console errors in help checks", not errors, "; ".join(errors))
    ctx.close()


# ---------------------------------------------------------------- PWA

def pwa_checks(browser):
    errors = []
    ctx = browser.new_context(viewport={"width": 390, "height": 844})
    ctx.add_init_script("localStorage.setItem('vault-welcomed', '1');")
    page = ctx.new_page()
    watch_errors(page, errors)
    page.goto(BASE)
    page.wait_for_selector(".markdown")
    manifest = page.evaluate("fetch('manifest.webmanifest').then(r => r.json())")
    sizes = {i["sizes"] for i in manifest["icons"]}
    check("manifest is installable shape", manifest["display"] == "standalone" and {"192x192", "512x512"} <= sizes)
    icons_ok = page.evaluate("Promise.all(%s.map(i => fetch(i.src).then(r => r.ok && r.headers.get('content-type').includes('png'))))" % json.dumps(manifest["icons"]))
    check("all icons load", all(icons_ok))
    page.evaluate("navigator.serviceWorker.ready")
    page.reload()
    page.wait_for_selector(".markdown")
    wait_until(page, "navigator.serviceWorker.controller !== null")
    page.wait_for_timeout(500)
    ctx.set_offline(True)
    page.reload()
    page.wait_for_selector(".markdown h1", timeout=10000)
    check("app opens offline", page.locator(".markdown h1").inner_text() == "Welcome to the vault")
    ctx.set_offline(False)
    check("no console errors in PWA checks", not [e for e in errors if "net::ERR_INTERNET_DISCONNECTED" not in e], "; ".join(errors))
    ctx.close()


# ---------------------------------------------------------------- house rules

def text_checks():
    bad = []
    for f in APP.rglob("*"):
        if f.is_file() and f.suffix in {".js", ".css", ".html", ".md", ".py", ".json", ".webmanifest"}:
            s = f.read_text(encoding="utf-8")
            if chr(0x2014) in s or "&" + "mdash;" in s:
                bad.append(str(f.relative_to(APP)))
    check("no em dashes anywhere in the app", not bad, ", ".join(bad))


def main():
    tmp = Path(tempfile.mkdtemp(prefix="vault-test-"))
    vault_dir = tmp / "vault"
    shutil.copytree(APP / "sample-vault", vault_dir)
    server = subprocess.Popen([sys.executable, str(APP / "dev_server.py"), str(PORT), "--vault", str(vault_dir)])
    try:
        for _ in range(50):
            try:
                urllib.request.urlopen(BASE, timeout=1)
                break
            except OSError:
                time.sleep(0.1)
        with sync_playwright() as p:
            browser = p.chromium.launch()
            local_checks(browser, vault_dir)
            voice_checks(browser, vault_dir)
            github_checks(browser)
            help_checks(browser)
            pwa_checks(browser)
            browser.close()
        text_checks()
    finally:
        server.terminate()
        server.wait()
        shutil.rmtree(tmp, ignore_errors=True)
    print(f"\n{'ALL PASSED' if not failures else str(len(failures)) + ' FAILED'}")
    sys.exit(1 if failures else 0)


if __name__ == "__main__":
    main()
