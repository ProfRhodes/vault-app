# How the vault works

The vault is a shared memory for you, Claude and your local AI. Every note is a plain markdown file in your private GitHub repo. This app is a window into those files: you read and write them here, Claude reads and writes the same files on the laptop, and GitHub keeps everyone in sync.

## Getting set up

1. **Install it:** in Chrome on your phone, open the app's address, tap the menu, then **Add to Home screen**.
2. **Connect your vault:** open **Settings** from the menu and enter the owner, repo, branch and a token. Until then the app shows a made-up sample vault.
3. **The first load takes a few seconds** while every note downloads. After that, notes are kept on the device and only changes download.

The token stays on this device and is only sent to GitHub. Each device needs it entered once.

## Notes

- **Open the menu** with the button at the top left to see every note, grouped by folder.
- **Search** with the box at the top. Every word you type must appear in the note, and title matches come first.
- **Links:** write `[[note name]]` to link to another note. Gold links go to a note. Grey dashed links point to a note that does not exist yet.
- **Backlinks** at the bottom of every note list the notes that link to it, so connections work both ways.
- **Edit** with the button at the top of a note. You see the raw text, including any frontmatter at the top of memory files.
- **New note:** tap **+**. It is saved in the notes folder, named after its title.

If you leave the editor with unsaved changes, the app asks first.

## Voice notes

Tap the **gold mic**. A new voice note opens and starts listening right away. Speak naturally, and the words appear as you talk. Tap **Stop** when you are done, then **Save**.

In an open editor, **Speak** adds dictation wherever the cursor is.

Chrome asks for the microphone the first time. Speech is turned into text by Google, so it needs a connection.

## The graph

Tap the circle button at the top right. Every note is a dot, colored by its top folder. Three views, each modeled on how memory works in the brain:

### Web

Notes pulled together by their links.

**Spreading activation:** tap a note and a glow travels outward through its links, weaker with every step. That is how one memory calls up the next. Tap the same note again to open it.

### Consolidation

New memories live briefly in the **hippocampus** and are gradually moved to the **cortex** for long-term storage. Here, notes from today sit in the center, and older notes drift outward ring by ring: this week, this month, this season, long term.

### Memory wheel

After Giordano Bruno's memory wheels. Each top folder is a wheel, and every note keeps a fixed slot, so you learn where things are. **Drag a wheel to turn it.** The notes lined up under the gold pointer are listed at the top: Bruno turned his wheels to combine ideas, and those are your combination. Tap one to select it.

### On every view

- **Fading notes** are ones you have not opened in a while. This is the **forgetting curve**: memories weaken without review, and each visit makes them last longer. Faded notes are good candidates to revisit or prune.
- **Gold, thicker lines** connect notes you often open one after the other. This is **Hebbian learning**, "cells that fire together wire together". A **dashed** gold line means the app learned the connection even though no written link exists.
- **Moving around:** drag to pan, pinch or scroll to zoom. **Key** at the bottom left explains the colors.

## The memory line

At the bottom of each note: how strong the memory was before this visit, how many times you have opened it, and when you last did. Opening a note refreshes it.

## Syncing with the laptop

Notes you save here go straight to GitHub. On the laptop, bring them in from the Claude-Projects folder with:

    .\vault-git.ps1 sync

Notes come in on their own. If anything that steers agents changed (CLAUDE.md, skills or memory), sync stops and lists the changes first, so nothing rewrites Claude's instructions without you noticing. If the changes are yours, run `.\vault-git.ps1 sync -Accept`.

Usage data (what you opened, and when) saves every 10 minutes and when you leave the app, so every device shares the same memory strengths.

## Privacy and safety

- **The vault repo is private.** The app's public code holds no notes.
- **Students appear as codes** like [S07]. The key never leaves the laptop.
- **Lost a device?** On GitHub, open Settings, Developer settings, Fine-grained tokens, and delete that device's token. It stops working at once. Your notes are safe on GitHub.

## Troubleshooting

- **Still showing the sample notes:** the vault is not connected yet. Open Settings.
- **"GitHub did not answer":** the connection stalled. Close the app fully and reopen it.
- **"This note changed on another device":** someone saved it elsewhere first. Copy your text, reopen the note, and make your edit again.
- **"The token was rejected":** it expired or was deleted. Make a new one and enter it in Settings.
- **"Microphone blocked":** allow it in Chrome's site settings for this app.
- **A note from Claude is missing:** it may not be pushed from the laptop yet. Tap **Refresh** in the menu after it is.
