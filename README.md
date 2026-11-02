# Vault app (name pending)

Shared memory for you, Claude and the local AI. Plain HTML, CSS and JavaScript with no build step and nothing to install. Notes live in a private GitHub repo; this app reads and writes them.

## Run it locally

    python dev_server.py

Then open http://localhost:8765/. It shows the made-up sample vault and saves edits into `sample-vault/`.

## Test it

    python tests/check_full.py      # graph, editing, voice, GitHub (simulated), offline
    python tests/check_step1.py     # reading, search, backlinks (needs a server on 8765)

`check_full.py` works on a throwaway copy of the sample vault and simulates GitHub, so it never touches real files or a real account. Screenshots land in `tests/`.

## Files

| File | Job |
|---|---|
| `app.js` | Views and routing: notes, graph, editor, settings |
| `vault.js` | Loads notes, resolves `[[links]]` and backlinks, search, writes |
| `github.js` | Reads and writes the vault repo through the GitHub API, caches by sha |
| `state.js` | Usage data for the visuals, synced to `.vault/state.json` in the vault |
| `graph.js` | Canvas graph: web, consolidation rings, memory wheels |
| `voice.js` | Speech to text in the editor |
| `markdown.js` | Markdown renderer that escapes all note text first |
| `sw.js`, `manifest.webmanifest`, `icons/` | Installable app and offline support |

## The five visuals

1. Spreading activation: tap a note and the glow travels through its links, 0.62 weaker per hop.
2. Forgetting curve: brightness is e^(-days / S), where S doubles roughly with each review.
3. Hebbian links: notes opened back to back within 10 minutes get a stronger, gold edge.
4. Consolidation: new notes in the hippocampus at the center, older ones out toward the cortex.
5. Memory wheels: one wheel per top folder, fixed slots, drag to turn; notes under the pointer combine.

## Deploying (not done yet)

1. Push this folder to a public repo. It holds only code and made-up sample notes.
2. Turn on GitHub Pages for that repo.
3. Open the Pages URL in Chrome on Android, then Add to Home screen.
4. In Settings, enter the private vault repo and a fine-grained token with Contents read and write on that repo only.

The vault repo's `.gitignore` whitelist needs `!/.vault/` so usage data syncs.
