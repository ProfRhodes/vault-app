"""Local dev server for the vault app.

Serves the app folder and accepts PUT writes to notes under /sample-vault/,
so editing can be tested before the GitHub source is connected.

    python dev_server.py                 # serves ./sample-vault on port 8765
    python dev_server.py 8766 --vault D  # serves folder D as the vault instead

Binds to 127.0.0.1 only. Writes are limited to .md files and the state file
inside the vault folder.
"""

import argparse
import http.server
import json
from pathlib import Path
from urllib.parse import unquote, urlsplit

ROOT = Path(__file__).resolve().parent
PREFIX = "/sample-vault/"
STATE = ".vault/state.json"
MAX_BYTES = 2_000_000


def make_handler(vault: Path):
    class Handler(http.server.SimpleHTTPRequestHandler):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, directory=str(ROOT), **kwargs)

        def end_headers(self):
            self.send_header("Cache-Control", "no-store")
            super().end_headers()

        def translate_path(self, path):
            clean = unquote(urlsplit(path).path)
            if clean.startswith(PREFIX):
                target = self.vault_target(clean[len(PREFIX):])
                return str(target) if target else str(vault / "__missing__")
            return super().translate_path(path)

        def vault_target(self, rel):
            target = (vault / rel).resolve()
            if target != vault and vault not in target.parents:
                return None
            return target

        def do_PUT(self):
            clean = unquote(urlsplit(self.path).path)
            if not clean.startswith(PREFIX):
                return self.send_error(403, "Writes are only allowed inside the vault")
            rel = clean[len(PREFIX):]
            target = self.vault_target(rel)
            if target is None or not (rel.endswith(".md") or rel == STATE):
                return self.send_error(403, "Only notes and the state file can be written")
            length = int(self.headers.get("Content-Length", 0))
            if length > MAX_BYTES:
                return self.send_error(413, "Note too large")
            data = self.rfile.read(length)
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(data)
            if rel.endswith(".md"):
                self.add_to_manifest(rel)
            self.send_response(204)
            self.end_headers()

        def add_to_manifest(self, rel):
            manifest = vault / "manifest.json"
            paths = json.loads(manifest.read_text(encoding="utf-8")) if manifest.exists() else []
            if rel not in paths:
                paths.append(rel)
                manifest.write_text(json.dumps(paths, indent=2) + "\n", encoding="utf-8")

        def log_message(self, fmt, *args):
            pass

    return Handler


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("port", nargs="?", type=int, default=8765)
    parser.add_argument("--vault", default=str(ROOT / "sample-vault"))
    args = parser.parse_args()
    vault = Path(args.vault).resolve()
    server = http.server.ThreadingHTTPServer(("127.0.0.1", args.port), make_handler(vault))
    print(f"Serving {ROOT} with vault {vault} at http://localhost:{args.port}/")
    server.serve_forever()


if __name__ == "__main__":
    main()
