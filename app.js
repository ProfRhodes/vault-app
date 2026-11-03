// UI for the vault: sidebar, search, note view with backlinks, graph,
// editor with voice notes, and settings for connecting the GitHub vault.

import { Vault, LocalSource } from './vault.js';
import { GitHubSource } from './github.js';
import { VaultState } from './state.js';
import { GraphView, sefirahColor, orderGroups, LAYOUTS } from './graph.js';
import { Dictation, voiceSupported } from './voice.js';
import { renderMarkdown, escapeHtml, unescapeHtml } from './markdown.js';
import { SEFIROT, BY_KEY, SEFIROT_PATH, glyphSvg, readSephira, writeSephira, sephiraValue } from './sefirot.js';

const HOME = 'notes/welcome.md';
const SETTINGS_KEY = 'vault-settings';
const LAYOUT_KEY = 'vault-layout';
const DAY = 86400000;

const LAYOUT_HINTS = {
  web: 'Notes pulled together by their links. Tap a note to watch activation spread from it.',
  rings: 'Consolidation. New notes sit in the hippocampus at the center and drift out toward the cortex as they age.',
  wheel: 'Memory wheels, after Giordano Bruno. Every note keeps its slot. Drag a wheel to turn it; notes under the pointer combine.',
  tree: 'The Tree of Life. Each note gathers at its sefirah. Binah, Gevurah and Hod are on your left, as in the Zohar.',
};

// ---------- what the graph hides ----------
// Saved on each device. Claude's memory and the skills start hidden.

const HIDE_KEY = 'vault-hidden';
const HIDE_DEFAULT = ['folder:memory', 'folder:.claude'];

function hiddenSet() {
  try {
    const saved = JSON.parse(localStorage.getItem(HIDE_KEY));
    return new Set(Array.isArray(saved) ? saved : HIDE_DEFAULT);
  } catch {
    return new Set(HIDE_DEFAULT);
  }
}

function setHidden(key, hide) {
  const set = hiddenSet();
  if (hide) set.add(key);
  else set.delete(key);
  try {
    localStorage.setItem(HIDE_KEY, JSON.stringify([...set]));
  } catch {
    // storage blocked; the choice lasts until the page reloads
  }
  hiddenNow = set;
}

let hiddenNow = hiddenSet();

const isHidden = (note) =>
  hiddenNow.has('sef:' + (note.sefirah || 'none')) || hiddenNow.has('author:' + note.author) || hiddenNow.has('folder:' + note.group);

const $ = (id) => document.getElementById(id);

function loadSettings() {
  try {
    return JSON.parse(localStorage.getItem(SETTINGS_KEY)) || null;
  } catch {
    return null;
  }
}

const settings = loadSettings();
const source = settings && settings.owner && settings.repo && settings.token ? new GitHubSource(settings) : new LocalSource('sample-vault/');
const vault = new Vault(source);
const state = new VaultState(source, source.remote ? source.label : 'sample', { saveDelay: source.remote ? 10 * 60000 : 2000 });

let graph = null;
let current = null;
let editor = null;
let ignoreHash = false;
let loaded = false;

// Handle for tests and debugging in the browser console.
window.__vault = {
  vault,
  state,
  get graph() {
    return graph;
  },
};

const noteHref = (path) => '#/note/' + encodeURIComponent(path);
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const pct = (x) => `${Math.round(x * 100)}%`;

function ago(ms) {
  if (!ms) return 'never';
  const d = (Date.now() - ms) / DAY;
  if (d < 1 / 24) return 'just now';
  if (d < 1) return `${plural(Math.round(d * 24), 'hour')} ago`;
  if (d < 2) return 'yesterday';
  if (d < 60) return `${Math.round(d)} days ago`;
  return `${plural(Math.round(d / 30), 'month')} ago`;
}

function stamp(date) {
  const p = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())} ${p(date.getHours())}:${p(date.getMinutes())}`;
}

function linkCtx(fromPath) {
  const link = (path, label) =>
    path
      ? `<a class="wikilink" href="${noteHref(path)}">${label}</a>`
      : `<span class="wikilink missing" title="No note with this name yet">${label}</span>`;
  return {
    wikilink: (target, label) => link(vault.resolve(unescapeHtml(target), fromPath), label),
    mdlink: (url, label) => link(vault.resolveRelative(unescapeHtml(url), fromPath), label),
  };
}

// Plain text version of a markdown line, for backlink context.
function plainLine(line) {
  return line
    .replace(/^\s*([-*+]|\d+[.)])\s+(\[[ xX]\]\s+)?/, '')
    .replace(/^#+\s+/, '')
    .replace(/\[\[([^\]|]+?)\|([^\]]+)\]\]/g, '$2')
    .replace(/\[\[([^\]]+)\]\]/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[*`]/g, '');
}

function highlight(text, terms) {
  let html = escapeHtml(text);
  for (const t of terms) {
    const pattern = escapeHtml(t).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    html = html.replace(new RegExp(`(${pattern})`, 'gi'), '<mark>$1</mark>');
  }
  return html;
}

// ---------- sidebar ----------

function noteItem(note, extra = '') {
  const active = note.path === current ? ' class="active"' : '';
  return `<li><a href="${noteHref(note.path)}"${active}>${escapeHtml(note.title)}${extra}</a></li>`;
}

const RECENT_COUNT = 8;
const OPEN_KEY = 'vault-open-sections';

// Menu sections start closed except Recent, and remember what you open, since
// the menu redraws every time a note opens.
function openSections() {
  try {
    return new Set(JSON.parse(localStorage.getItem(OPEN_KEY)) || ['recent']);
  } catch {
    return new Set(['recent']);
  }
}

function rememberSection(name, open) {
  const set = openSections();
  if (open) set.add(name);
  else set.delete(name);
  try {
    localStorage.setItem(OPEN_KEY, JSON.stringify([...set]));
  } catch {
    // storage blocked; sections just reset on redraw
  }
}

const openAttr = (name) => (openSections().has(name) ? ' open' : '');

// Notes opened or saved most recently on any device, newest first.
function renderRecent() {
  const recent = [...vault.notes.values()]
    .map((note) => ({ note, at: state.info(note.path).lastOpened || 0 }))
    .filter((r) => r.at)
    .sort((a, b) => b.at - a.at)
    .slice(0, RECENT_COUNT);
  if (!recent.length) return '';
  const items = recent.map(({ note, at }) => noteItem(note, `<span class="sub">${escapeHtml(ago(at))}</span>`)).join('');
  return `<details class="recent" data-section="recent"${openAttr('recent')}><summary>Recent<span class="count">${recent.length}</span></summary><ul>${items}</ul></details>`;
}

function renderTree() {
  const groups = new Map();
  for (const note of vault.notes.values()) {
    if (!groups.has(note.group)) groups.set(note.group, []);
    groups.get(note.group).push(note);
  }
  return orderGroups(groups.keys())
    .map((name) => {
      const notes = groups.get(name).sort((a, b) => a.folder.localeCompare(b.folder) || a.title.localeCompare(b.title));
      const items = notes
        .map((n) => {
          const sub = n.folder.split('/').slice(1).join(' / ');
          return noteItem(n, sub ? `<span class="sub">${escapeHtml(sub)}</span>` : '');
        })
        .join('');
      return `<details data-section="${escapeHtml(name)}"${openAttr(name)}><summary>${escapeHtml(name)}<span class="count">${notes.length}</span></summary><ul>${items}</ul></details>`;
    })
    .join('');
}

function renderResults(query) {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  const results = vault.search(query);
  if (!results.length) return `<p class="results-head">No notes match "${escapeHtml(query)}".</p>`;
  const items = results
    .map(({ note, snippet }) =>
      noteItem(note, `<span class="sub">${escapeHtml(note.path)}</span><span class="snippet">${highlight(snippet, terms)}</span>`)
    )
    .join('');
  return `<p class="results-head">${plural(results.length, 'note')}</p><ul>${items}</ul>`;
}

function renderSidebar() {
  const query = $('search').value.trim();
  $('sidebar-list').innerHTML = query ? renderResults(query) : renderRecent() + renderTree();
}

function setNav(open) {
  document.body.classList.toggle('nav-open', open);
  $('menu').setAttribute('aria-expanded', String(open));
}

function setView(name) {
  document.body.dataset.view = name;
  $('note').hidden = name === 'graph';
  $('graph').hidden = name !== 'graph';
  if (graph && name !== 'graph') graph.hide();
  setNav(false);
}

// ---------- note view ----------

function renderBacklinks(note) {
  const n = note.backlinks.length;
  const head = `<h2>Backlinks<span class="count">${n}</span></h2>`;
  if (!n) return `<section class="backlinks">${head}<p class="empty">No notes link here yet.</p></section>`;
  const items = note.backlinks
    .map(({ from, context }) => {
      const src = vault.notes.get(from);
      return `<li><a href="${noteHref(from)}">${escapeHtml(src.title)}</a><span class="snippet">${escapeHtml(plainLine(context))}</span></li>`;
    })
    .join('');
  return `<section class="backlinks">${head}<ul>${items}</ul></section>`;
}

function memoryLine(note) {
  const info = state.info(note.path);
  if (!info.lastOpened) return 'First visit to this note.';
  const before = state.strength(note.path, note.dated);
  return `Memory strength was ${pct(before)} before this visit. Opened ${plural(info.opens || 1, 'time')}, last ${ago(info.lastOpened)}.`;
}

function showNote(path) {
  setView('note');
  const note = vault.notes.get(path);
  if (!note) {
    $('note').innerHTML = `<p class="empty">No note at ${escapeHtml(path)}.</p>`;
    return;
  }
  current = path;
  const line = memoryLine(note);
  state.recordOpen(path);
  const folderText = note.folder ? escapeHtml(note.folder.split('/').join(' / ')) : 'root';
  const sef = BY_KEY.get(note.sefirah);
  const second = BY_KEY.get(note.second);
  const ink = sef ? sef.outline || sef.color : '';
  const sefLabel = sef
    ? `<span class="sef-label">${glyphSvg(sef.key, 16, ink, 2)}${escapeHtml(sef.name)} &middot; ${escapeHtml(sef.short)}` +
      `${second ? ` &middot; ${escapeHtml(second.name)}` : ''}</span>`
    : '';
  const crumbs = sefLabel + `<span class="folder">${folderText}</span>`;
  const sign = sef ? `<div class="note-sign" aria-hidden="true">${glyphSvg(sef.key, 112, ink, 1.1)}</div>` : '';
  const tag = note.meta.type ? `<span class="tag">${escapeHtml(note.meta.type)}</span>` : '';
  const title = note.hasH1 ? '' : `<h1>${escapeHtml(note.title)}</h1>`;
  const desc = note.meta.description ? `<p class="description">${escapeHtml(note.meta.description)}</p>` : '';
  const actions =
    `<div class="note-actions"><a class="btn ghost" href="#/edit/${encodeURIComponent(path)}">Edit</a>` +
    `<a class="btn ghost" href="#/graph?focus=${encodeURIComponent(path)}">Show in graph</a></div>`;
  $('note').innerHTML =
    sign +
    `<div class="note-head"><div class="crumbs">${crumbs}${tag}</div>${actions}</div>${title}${desc}` +
    `<article class="markdown">${renderMarkdown(note.body, linkCtx(path))}</article>` +
    `<p class="memory-line">${escapeHtml(line)}</p>` +
    renderBacklinks(note);
  $('note').scrollTop = 0;
  placeSign();
  document.title = `${note.title} | Vault`;
  renderSidebar();
}

// The sign sits behind the title and never reaches the first line of text:
// it is sized to the space between the top of the title and what follows it.
function placeSign() {
  const box = $('note');
  const sign = box.querySelector('.note-sign');
  const h1 = box.querySelector('h1');
  if (!sign || !h1) return;
  const next = h1.nextElementSibling || box.querySelector('.markdown');
  const top = Math.max(0, h1.offsetTop - 24);
  const limit = (next && next.offsetTop > h1.offsetTop ? next.offsetTop : h1.offsetTop + h1.offsetHeight + 24) - 8;
  const size = Math.min(112, limit - top);
  if (size < 48) {
    sign.hidden = true;
    return;
  }
  sign.style.top = `${top}px`;
  sign.style.width = sign.style.height = `${size}px`;
  const svg = sign.querySelector('svg');
  svg.setAttribute('width', size);
  svg.setAttribute('height', size);
}

// ---------- graph view ----------

const CHECK =
  '<svg class="check" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="4" fill="none" stroke="currentColor" stroke-width="1.6"/>' +
  '<path class="tick" d="M7 12.5l3.5 3.5L17 8.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

function toggleRow(key, icon, label, count) {
  const shown = !hiddenNow.has(key);
  return (
    `<li><button type="button" class="toggle" data-hide="${escapeHtml(key)}" aria-pressed="${shown}">` +
    `${CHECK}<span class="t-icon">${icon}</span><span class="t-label">${label}</span><span class="t-count">${count}</span></button></li>`
  );
}

function renderLegend(layout) {
  const notes = [...vault.notes.values()];
  const count = (pred) => notes.filter(pred).length;
  const sefRows = SEFIROT.map((s) =>
    toggleRow(`sef:${s.key}`, glyphSvg(s.key, 20, s.outline || s.color, 2), `${escapeHtml(s.name)} <span class="sub-inline">${escapeHtml(s.short)}</span>`, count((n) => n.sefirah === s.key))
  );
  const unsorted = count((n) => !n.sefirah);
  if (unsorted) sefRows.push(toggleRow('sef:none', '<span class="dot none"></span>', 'Unsorted', unsorted));
  const groupRows = [
    ['folder:memory', "Claude's memory", count((n) => n.group === 'memory')],
    ['folder:.claude', 'Skills', count((n) => n.group === '.claude')],
  ]
    .filter(([, , c]) => c)
    .map(([key, label, c]) => toggleRow(key, '', label, c));
  const hidden = graph ? graph.hiddenCount : 0;
  $('legend-body').innerHTML =
    `<p class="legend-hint">${escapeHtml(LAYOUT_HINTS[layout])}</p>` +
    `<p class="hidden-count">${hidden ? `${plural(hidden, 'note')} hidden. Search and links still find them.` : 'Nothing hidden.'}</p>` +
    `<h3>Show</h3><ul class="show-list">${sefRows.join('')}</ul>` +
    '<ul class="show-list">' +
    toggleRow('author:user', '<span class="dot filled"></span>', 'Written by me', count((n) => n.author === 'user')) +
    toggleRow('author:ai', '<span class="dot ring"></span>', 'Written by AI', count((n) => n.author === 'ai')) +
    groupRows.join('') +
    '</ul><h3>Lines</h3><ul>' +
    '<li><span class="swatch dim"></span>Dim: fading from memory (forgetting curve)</li>' +
    '<li><span class="swatch gold"></span>Gold, thicker: opened together often (Hebbian)</li>' +
    '<li><span class="swatch dashed"></span>Dashed: learned link with no written link</li></ul>' +
    '<p class="legend-hint"><a href="#/help/the-graph">How to use the graph</a></p>';
  for (const btn of $('legend-body').querySelectorAll('.toggle')) {
    btn.addEventListener('click', () => {
      const key = btn.dataset.hide;
      setHidden(key, btn.getAttribute('aria-pressed') === 'true');
      graph.setData(vault, state);
      renderLegend(graph.layout);
      const again = [...$('legend-body').querySelectorAll('.toggle')].find((b) => b.dataset.hide === key);
      if (again) again.focus();
      showCard(graph.selected);
      showAligned(graph.layout === 'wheel' ? graph.aligned() : []);
    });
  }
}

function showCard(node) {
  const card = $('graph-card');
  if (!node) {
    card.hidden = true;
    return;
  }
  const info = state.info(node.path);
  const note = vault.notes.get(node.path);
  const sef = BY_KEY.get(node.sefirah);
  const icon = sef ? glyphSvg(sef.key, 24, sef.outline || sef.color, 2) : '<span class="dot none"></span>';
  const where = sef ? `${sef.name} &middot; ${escapeHtml(sef.short)}` : 'Unsorted';
  const who = node.author === 'user' ? 'yours' : 'AI-written';
  card.innerHTML =
    `<div class="card-title">${icon}${escapeHtml(node.title)}</div>` +
    `<div class="card-meta">${where} &middot; ${who} &middot; strength ${pct(node.strength)} &middot; ` +
    `${plural(note.links.length + note.backlinks.length, 'link')} &middot; opened ${ago(info.lastOpened)}</div>` +
    `<div class="card-actions"><a class="btn primary" href="${noteHref(node.path)}">Open</a>` +
    `<button class="btn ghost" type="button" data-close>Close</button></div>` +
    '<p class="card-hint">Tap the note again to open it.</p>';
  card.querySelector('[data-close]').addEventListener('click', () => graph.clearSelection());
  card.hidden = false;
}

// Tapping a sefirah's disc on the Tree lists the notes merged into it,
// strongest first.
function showMass(key) {
  const card = $('graph-card');
  const sef = BY_KEY.get(key);
  const nodes = graph.massedNodes(key);
  const icon = sef ? glyphSvg(sef.key, 24, sef.outline || sef.color, 2) : '<span class="dot none"></span>';
  const name = sef ? `${sef.name} &middot; ${escapeHtml(sef.short)}` : 'Unsorted';
  card.innerHTML =
    `<div class="card-title">${icon}${name}</div>` +
    `<div class="card-meta">${plural(nodes.length, 'more note')} merged into the disc. Zoom in to see them as dots.</div>` +
    `<ul class="mass-list">${nodes.map((n) => `<li><a href="${noteHref(n.path)}">${escapeHtml(n.title)}</a></li>`).join('')}</ul>` +
    '<div class="card-actions"><button class="btn ghost" type="button" data-close>Close</button></div>';
  card.querySelector('[data-close]').addEventListener('click', () => (card.hidden = true));
  card.hidden = false;
}

function showAligned(list) {
  const box = $('graph-aligned');
  if (!graph || graph.layout !== 'wheel' || !list.length) {
    box.hidden = true;
    return;
  }
  box.innerHTML =
    '<span class="aligned-head">At the pointer</span>' +
    list.map((a) => `<button type="button" class="chip" data-path="${escapeHtml(a.path)}">${escapeHtml(a.title)}</button>`).join('');
  for (const chip of box.querySelectorAll('.chip')) {
    chip.style.borderColor = sefirahColor(vault.notes.get(chip.dataset.path).sefirah);
    chip.addEventListener('click', () => graph.select(chip.dataset.path));
  }
  box.hidden = false;
}

function showGraph(layout, focus) {
  setView('graph');
  if (!graph) {
    graph = new GraphView($('graph-canvas'), {
      onSelect: showCard,
      onOpen: (path) => (location.hash = noteHref(path)),
      onAligned: showAligned,
      onMass: showMass,
    });
    graph.filter = (n) => !isHidden(n);
  }
  const saved = localStorage.getItem(LAYOUT_KEY);
  const chosen = LAYOUTS.includes(layout) ? layout : LAYOUTS.includes(saved) ? saved : 'web';
  localStorage.setItem(LAYOUT_KEY, chosen);
  graph.show();
  graph.layout = chosen;
  graph.setData(vault, state);
  for (const seg of document.querySelectorAll('.graph-tools .seg')) seg.classList.toggle('active', seg.dataset.layout === chosen);
  renderLegend(chosen);
  showAligned(chosen === 'wheel' ? graph.aligned() : []);
  if (focus && graph.byPath.has(focus)) graph.select(focus, { center: true });
  else if (focus && vault.notes.has(focus)) {
    const card = $('graph-card');
    card.innerHTML =
      `<div class="card-title">${escapeHtml(vault.notes.get(focus).title)}</div>` +
      '<p class="card-meta">This note is hidden on the graph. Open Key and turn its group back on under Show.</p>' +
      '<div class="card-actions"><button class="btn ghost" type="button" data-close>Close</button></div>';
    card.querySelector('[data-close]').addEventListener('click', () => (card.hidden = true));
    card.hidden = false;
  } else showCard(graph.selected);
  document.title = 'Graph | Vault';
}

// ---------- editor ----------

function showEditor({ path = null, voice = false }) {
  if (path && !vault.notes.has(path)) return showNote(path);
  setView('editor');
  const note = path ? vault.notes.get(path) : null;
  const now = stamp(new Date());
  const heading = note ? `Editing ${escapeHtml(path)}` : voice ? 'New voice note' : 'New note';
  $('note').innerHTML = `
    <div class="editor">
      <div class="ed-head"><div class="crumbs">${heading}</div><button id="ed-sef" class="btn" type="button" aria-haspopup="dialog">Sefirah</button></div>
      ${note ? '' : '<input id="ed-title" class="ed-title" type="text" placeholder="Title" autocomplete="off" aria-label="Title">'}
      <textarea id="ed-body" class="ed-body" spellcheck="true" aria-label="Note text" placeholder="Write here, or tap Speak. Link notes with [[note name]]."></textarea>
      <div class="ed-bar">
        <button id="ed-mic" class="btn mic" type="button">Speak</button>
        <span id="ed-status" class="ed-status" role="status"></span>
        <a id="ed-cancel" class="btn ghost" href="${note ? noteHref(path) : '#/'}">Cancel</a>
        <button id="ed-save" class="btn primary" type="button">Save</button>
      </div>
    </div>`;
  const ta = $('ed-body');
  const title = $('ed-title');
  const mic = $('ed-mic');
  if (note) ta.value = note.raw;
  else if (voice) {
    title.value = `Voice note ${now}`;
    ta.value = `*Captured by voice, ${now}*\n\n`;
  }
  const dictation = new Dictation(ta, (msg, on) => {
    $('ed-status').textContent = msg;
    mic.classList.toggle('on', on);
    mic.textContent = on ? 'Stop' : 'Speak';
  });
  editor = { path, dirty: false, dictation, hash: location.hash };
  const markDirty = () => editor && (editor.dirty = true);
  ta.addEventListener('input', markDirty);
  if (title) title.addEventListener('input', markDirty);
  if (!voiceSupported) {
    mic.hidden = true;
    $('ed-status').textContent = 'For voice, use the mic on your keyboard.';
  } else {
    mic.addEventListener('click', () => (dictation.listening ? dictation.stop() : dictation.start()));
  }
  $('ed-save').addEventListener('click', saveEditor);
  wireSuggestions(ta, path, markDirty);
  wireSefirahPicker(ta, Boolean(note), markDirty);
  document.title = `${note ? 'Edit' : 'New note'} | Vault`;
  if (voice || !note) ta.setSelectionRange(ta.value.length, ta.value.length);
  if (voice && voiceSupported) {
    ta.focus();
    dictation.start();
  } else if (note) ta.focus();
  else title.focus();
}

// ---------- sefirah picker ----------
// Writes the note's sephira line. An existing note's line changes in the text
// right away, where you can see it; a new note gets it when saved.

function wireSefirahPicker(ta, existing, markDirty) {
  const button = $('ed-sef');
  let [main, second] = existing ? readSephira(ta.value) : [null, null];
  editor.sefirah = () => [main, second];

  const label = () => {
    const s = BY_KEY.get(main);
    button.innerHTML = s ? `${glyphSvg(s.key, 20, s.outline || s.color, 2)}${escapeHtml(s.name)}` : 'Sefirah';
  };
  label();

  const sheet = document.createElement('div');
  sheet.className = 'sef-sheet';
  sheet.id = 'ed-sef-sheet';
  sheet.setAttribute('role', 'dialog');
  sheet.setAttribute('aria-label', 'Choose a sefirah');
  sheet.hidden = true;
  button.closest('.editor').append(sheet);

  const row = (group, key, picked) => {
    const s = BY_KEY.get(key);
    const icon = s ? glyphSvg(s.key, 24, s.outline || s.color, 2) : '<span class="t-icon"></span>';
    const text = s ? `<span class="sug-title">${escapeHtml(s.name)}</span><span class="sub">${escapeHtml(s.short)}</span>` : '<span class="sug-title">None</span>';
    return `<button type="button" class="sug" role="radio" aria-checked="${picked}" data-group="${group}" data-key="${key || ''}">${icon}<span class="sug-text">${text}</span></button>`;
  };

  const draw = () => {
    const list = (group, current, skip) =>
      [null, ...SEFIROT.map((s) => s.key)].filter((k) => !k || k !== skip).map((k) => row(group, k, (current || null) === k)).join('');
    sheet.innerHTML =
      '<div class="sheet-head"><h2>Sefirah</h2><button type="button" class="btn primary" data-done>Done</button></div>' +
      `<div role="radiogroup" aria-label="Main sefirah">${list('main', main, null)}</div>` +
      (main ? `<h3>Second, optional</h3><div role="radiogroup" aria-label="Second sefirah">${list('second', second, main)}</div>` : '');
    for (const b of sheet.querySelectorAll('.sug')) {
      b.addEventListener('click', () => {
        const key = b.dataset.key || null;
        if (b.dataset.group === 'main') {
          main = key;
          if (!main || second === main) second = null;
        } else second = key;
        if (existing) ta.value = writeSephira(ta.value, main, second);
        markDirty();
        label();
        draw();
        const again = sheet.querySelector(`.sug[data-group="${b.dataset.group}"][data-key="${b.dataset.key}"]`);
        if (again) again.focus();
      });
    }
    sheet.querySelector('[data-done]').addEventListener('click', () => {
      sheet.hidden = true;
      button.focus();
    });
  };

  button.addEventListener('click', () => {
    draw();
    sheet.hidden = false;
    const picked = sheet.querySelector('.sug[aria-checked="true"]');
    (picked || sheet.querySelector('.sug')).focus();
  });
  sheet.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      sheet.hidden = true;
      button.focus();
    }
  });
}

// ---------- link suggestions ----------
// Typing [[ opens up to four notes above the keyboard, recent ones first.
// Picking one writes its file name, which is how the vault links notes.

const OPEN_LINK = /\[\[([^\]\n]*)$/;

function linkSuggestions(query) {
  const q = query.trim().toLowerCase();
  const scored = [];
  for (const n of vault.notes.values()) {
    const title = n.title.toLowerCase();
    const base = n.base.toLowerCase();
    if (q && !title.includes(q) && !base.includes(q)) continue;
    const prefix = q && (title.startsWith(q) || base.startsWith(q)) ? 1 : 0;
    scored.push({ n, prefix, at: state.info(n.path).lastOpened || 0 });
  }
  scored.sort((a, b) => b.prefix - a.prefix || b.at - a.at || a.n.title.localeCompare(b.n.title));
  return scored.slice(0, 4).map((s) => s.n);
}

// The file name links the note, unless another note shares it; then the path does.
// A new note has no path yet; it will be saved in notes/, so links resolve from there.
function linkTarget(note, fromPath) {
  return vault.resolve(note.base, fromPath || 'notes/new.md') === note.path ? note.base : note.path.replace(/\.md$/i, '');
}

function wireSuggestions(ta, fromPath, markDirty) {
  const box = document.createElement('div');
  box.className = 'suggest';
  box.id = 'ed-suggest';
  box.setAttribute('role', 'listbox');
  box.setAttribute('aria-label', 'Link to a note');
  box.hidden = true;
  ta.after(box);
  let items = [];
  let active = 0;

  const place = () => {
    const vv = window.visualViewport;
    const visibleBottom = vv ? vv.offsetTop + vv.height : window.innerHeight;
    const r = ta.getBoundingClientRect();
    box.style.left = `${Math.max(8, r.left)}px`;
    box.style.width = `${Math.min(r.width, window.innerWidth - 16)}px`;
    // Below the top bar, so it never sits on the line being typed near the keyboard.
    const visibleTop = (vv ? vv.offsetTop : 0) + 64;
    box.style.top = `${Math.min(Math.max(visibleTop, r.top), visibleBottom - box.offsetHeight - 8)}px`;
  };

  const close = () => {
    box.hidden = true;
    items = [];
  };

  const pick = (note) => {
    const pos = ta.selectionStart;
    const before = ta.value.slice(0, pos);
    const m = before.match(OPEN_LINK);
    if (!m) return close();
    const start = pos - m[1].length;
    let after = ta.value.slice(pos);
    if (after.startsWith(']]')) after = after.slice(2);
    const target = linkTarget(note, fromPath);
    ta.value = ta.value.slice(0, start) + target + ']]' + after;
    const caret = start + target.length + 2;
    ta.setSelectionRange(caret, caret);
    markDirty();
    close();
    ta.focus();
  };

  const draw = () => {
    box.innerHTML = items
      .map((n, i) => {
        const sef = BY_KEY.get(n.sefirah);
        const icon = sef ? glyphSvg(sef.key, 20, sef.outline || sef.color, 2) : '<span class="dot none"></span>';
        return (
          `<button type="button" role="option" class="sug${i === active ? ' active' : ''}" aria-selected="${i === active}" data-i="${i}">` +
          `${icon}<span class="sug-text"><span class="sug-title">${escapeHtml(n.title)}</span>` +
          `<span class="sub">${escapeHtml(n.folder || 'root')}</span></span></button>`
        );
      })
      .join('');
    for (const b of box.querySelectorAll('.sug')) {
      b.addEventListener('pointerdown', (e) => e.preventDefault());
      b.addEventListener('click', () => pick(items[Number(b.dataset.i)]));
    }
  };

  const update = () => {
    const m = ta.value.slice(0, ta.selectionStart).match(OPEN_LINK);
    if (!m || ta.selectionStart !== ta.selectionEnd) return close();
    items = linkSuggestions(m[1]);
    if (!items.length) return close();
    active = Math.min(active, items.length - 1);
    draw();
    box.hidden = false;
    place();
  };

  ta.addEventListener('input', () => {
    active = 0;
    update();
  });
  ta.addEventListener('click', update);
  ta.addEventListener('keyup', (e) => {
    if (['ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown'].includes(e.key)) update();
  });
  ta.addEventListener('keydown', (e) => {
    if (box.hidden) return;
    // The caret may have left the [[ since the list opened; then keys act normally.
    if (!OPEN_LINK.test(ta.value.slice(0, ta.selectionStart))) {
      close();
      return;
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      active = (active + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length;
      draw();
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      pick(items[active]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      close();
    }
  });
  ta.addEventListener('blur', () => setTimeout(close, 150));
  if (window.visualViewport) {
    const onViewport = () => box.isConnected && !box.hidden && place();
    window.visualViewport.addEventListener('resize', onViewport);
    window.visualViewport.addEventListener('scroll', onViewport);
  }
}

async function saveEditor() {
  const ed = editor;
  if (!ed) return;
  const button = $('ed-save');
  button.disabled = true;
  ed.dictation.stop();
  $('ed-status').textContent = 'Saving...';
  try {
    let path;
    if (ed.path) {
      path = await vault.write(ed.path, $('ed-body').value);
    } else {
      const title = $('ed-title').value.trim() || `Note ${stamp(new Date())}`;
      const [main, second] = ed.sefirah ? ed.sefirah() : [null, null];
      const front = main ? `---\nsephira: ${sephiraValue(main, second)}\n---\n\n` : '';
      path = await vault.create(title, $('ed-body').value, 'notes', front);
      state.seen([path]);
    }
    ed.dirty = false;
    location.hash = noteHref(path);
  } catch (err) {
    $('ed-status').textContent = err.message;
    button.disabled = false;
  }
}

// ---------- settings ----------

function showSettings() {
  setView('settings');
  const s = settings || {};
  const saved = state.lastError ? `Last save failed: ${state.lastError.message}` : state.pending ? 'Changes waiting to save.' : 'All changes saved.';
  $('note').innerHTML = `
    <div class="settings">
      <h1>Settings</h1>
      <p>Showing: <strong>${escapeHtml(source.label)}</strong></p>
      <h2>Your vault on GitHub</h2>
      <label>Owner<input id="st-owner" type="text" autocomplete="off" placeholder="your GitHub username"></label>
      <label>Repo<input id="st-repo" type="text" autocomplete="off" placeholder="the private vault repo"></label>
      <label>Branch<input id="st-branch" type="text" autocomplete="off" placeholder="main"></label>
      <label>Token<input id="st-token" type="password" autocomplete="off"></label>
      <div class="st-actions">
        <button id="st-save" class="btn primary" type="button">Save and connect</button>
        <button id="st-sample" class="btn ghost" type="button">Use the sample vault</button>
      </div>
      <p id="st-status" class="ed-status" role="status"></p>
      <h2>Making the token</h2>
      <ol>
        <li>On GitHub: Settings, Developer settings, Fine-grained tokens, Generate new token.</li>
        <li>Repository access: Only select repositories, then pick the vault repo.</li>
        <li>Permissions: Contents, Read and write. Nothing else.</li>
        <li>Paste it here. It stays in this browser on this device and is only sent to GitHub.</li>
      </ol>
      <h2>Usage data</h2>
      <p>Memory strength, opened-together counts and wheel positions sync through <code>.vault/state.json</code> in the vault. ${escapeHtml(saved)}</p>
      <button id="st-flush" class="btn ghost" type="button">Save usage data now</button>
    </div>`;
  $('st-owner').value = s.owner || '';
  $('st-repo').value = s.repo || '';
  $('st-branch').value = s.branch || 'main';
  $('st-token').placeholder = s.token ? 'saved on this device (leave blank to keep)' : 'paste the fine-grained token';
  $('st-save').addEventListener('click', async () => {
    const next = {
      owner: $('st-owner').value.trim(),
      repo: $('st-repo').value.trim(),
      branch: $('st-branch').value.trim() || 'main',
      token: $('st-token').value.trim() || s.token || '',
    };
    if (!next.owner || !next.repo || !next.token) {
      $('st-status').textContent = 'Owner, repo and token are all needed.';
      return;
    }
    $('st-status').textContent = 'Checking...';
    try {
      const paths = await new GitHubSource(next).list();
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
      $('st-status').textContent = `Connected. Found ${plural(paths.filter((p) => p.endsWith('.md')).length, 'note')}. Reloading...`;
      await state.flush();
      location.hash = '#/';
      location.reload();
    } catch (err) {
      $('st-status').textContent = err.message;
    }
  });
  $('st-sample').addEventListener('click', () => {
    localStorage.removeItem(SETTINGS_KEY);
    location.hash = '#/';
    location.reload();
  });
  $('st-flush').addEventListener('click', async () => {
    state.pending = true;
    await state.flush();
    $('st-status').textContent = state.lastError ? `Save failed: ${state.lastError.message}` : 'Saved.';
  });
  document.title = 'Settings | Vault';
}

// ---------- help ----------

const WELCOMED_KEY = 'vault-welcomed';
let helpText = null;

async function showHelp(section) {
  setView('help');
  const firstRun = !localStorage.getItem(WELCOMED_KEY);
  localStorage.setItem(WELCOMED_KEY, '1');
  if (helpText === null) {
    $('note').innerHTML = '<p class="empty">Loading the guide...</p>';
    try {
      const r = await fetch('help.md');
      if (!r.ok) throw new Error(String(r.status));
      helpText = await r.text();
    } catch {
      $('note').innerHTML = '<p class="error">The guide could not load. Check your connection and try again.</p>';
      return;
    }
  }
  const plain = { wikilink: (t, label) => label, mdlink: (u, label) => label };
  const welcome = firstRun
    ? '<div class="welcome"><p><strong>Welcome.</strong> Here is a quick guide to how the vault works. You can come back to it any time from Help in the menu.</p>' +
      '<a class="btn primary" href="#/">Start using the vault</a></div>'
    : '';
  $('note').innerHTML = `${welcome}<article class="markdown help">${renderMarkdown(helpText, plain)}</article>`;
  const target = section && document.getElementById('h-' + section);
  if (target) target.scrollIntoView();
  else $('note').scrollTop = 0;
  document.title = 'Help | Vault';
}

// ---------- routing ----------

function decode(s) {
  try {
    return decodeURIComponent(s);
  } catch {
    return null;
  }
}

function showHome() {
  if (vault.notes.has(HOME)) showNote(HOME);
  else showGraph();
}

function route() {
  if (ignoreHash) {
    ignoreHash = false;
    return;
  }
  if (editor && editor.dirty && location.hash !== editor.hash) {
    if (!confirm('Discard unsaved changes?')) {
      ignoreHash = true;
      location.hash = editor.hash;
      return;
    }
  }
  if (editor) {
    editor.dictation.stop();
    editor = null;
  }
  const raw = location.hash.slice(1) || '/';
  const [pathPart, query] = raw.split('?');
  const segs = pathPart.split('/').filter(Boolean);
  const params = new URLSearchParams(query || '');
  if (segs[0] === 'settings') return showSettings();
  if (segs[0] === 'help') return showHelp(segs[1]);
  if (!loaded) return;
  if (segs[0] === 'note') return showNote(decode(segs[1] || '') || HOME);
  if (segs[0] === 'graph') return showGraph(segs[1], params.get('focus'));
  if (segs[0] === 'edit') return showEditor({ path: decode(segs[1] || '') });
  if (segs[0] === 'new') return showEditor({ voice: segs[1] === 'voice' });
  return showHome();
}

// Reads the vault's .vault/sefirot.json; without one, the built-in folder lists apply.
async function loadSefirot() {
  try {
    if (!source.has || source.has(SEFIROT_PATH)) vault.setSefirotConfig(JSON.parse(await source.read(SEFIROT_PATH)));
  } catch {
    // missing or unreadable; keep the built-in lists
  }
}

async function refresh() {
  $('refresh').disabled = true;
  try {
    await vault.load();
    await loadSefirot();
    state.seen([...vault.notes.keys()]);
    renderSidebar();
    if (!editor) route();
  } catch (err) {
    alert(err.message);
  } finally {
    $('refresh').disabled = false;
  }
}

function wireEvents() {
  let timer = null;
  $('search').addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      renderSidebar();
      if ($('search').value.trim()) setNav(true);
    }, 120);
  });
  $('search').addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      $('search').value = '';
      renderSidebar();
      $('search').blur();
    }
  });
  document.addEventListener('keydown', (e) => {
    const typing = ['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName);
    if (e.key === '/' && !typing) {
      e.preventDefault();
      $('search').focus();
    }
  });
  $('menu').addEventListener('click', () => setNav(!document.body.classList.contains('nav-open')));
  $('scrim').addEventListener('click', () => setNav(false));
  $('refresh').addEventListener('click', refresh);
  // toggle does not bubble, so listen in the capture phase.
  $('sidebar-list').addEventListener(
    'toggle',
    (e) => {
      const name = e.target.dataset && e.target.dataset.section;
      if (name) rememberSection(name, e.target.open);
    },
    true
  );
  window.addEventListener('hashchange', route);
  window.addEventListener('beforeunload', (e) => {
    if (editor && editor.dirty) e.preventDefault();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') state.flush();
  });
}

function registerWorker() {
  const secure = location.protocol === 'https:' || ['localhost', '127.0.0.1'].includes(location.hostname);
  if ('serviceWorker' in navigator && secure) navigator.serviceWorker.register('sw.js').catch(() => {});
}

async function start() {
  wireEvents();
  registerWorker();
  $('vault-label').textContent = source.label;
  const step = (msg) => ($('note').innerHTML = `<p class="empty">${escapeHtml(msg)}</p>`);
  try {
    await Promise.all([vault.load(step), state.load()]);
  } catch (err) {
    $('note').innerHTML =
      `<p class="error">${escapeHtml(err.message)}</p>` +
      (source.remote ? '<p><a href="#/settings">Check Settings</a></p>' : '<p class="empty">The app has to be served over http, not opened as a file.</p>');
    if (location.hash.startsWith('#/settings')) route();
    return;
  }
  await loadSefirot();
  loaded = true;
  state.seen([...vault.notes.keys()]);
  renderSidebar();
  // First open on this device: show the guide once, as a short tutorial.
  if (!localStorage.getItem(WELCOMED_KEY) && ['', '#', '#/'].includes(location.hash)) location.hash = '#/help';
  else route();
}

start();
