// UI for the vault: sidebar, search, note view with backlinks, graph,
// editor with voice notes, and settings for connecting the GitHub vault.

import { Vault, LocalSource } from './vault.js';
import { GitHubSource } from './github.js';
import { VaultState } from './state.js';
import { GraphView, groupColor, orderGroups } from './graph.js';
import { Dictation, voiceSupported } from './voice.js';
import { renderMarkdown, escapeHtml, unescapeHtml } from './markdown.js';

const HOME = 'notes/welcome.md';
const SETTINGS_KEY = 'vault-settings';
const LAYOUT_KEY = 'vault-layout';
const DAY = 86400000;

const LAYOUT_HINTS = {
  web: 'Notes pulled together by their links. Tap a note to watch activation spread from it.',
  rings: 'Consolidation. New notes sit in the hippocampus at the center and drift out toward the cortex as they age.',
  wheel: 'Memory wheels, after Giordano Bruno. Every note keeps its slot. Drag a wheel to turn it; notes under the pointer combine.',
};

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
      return `<details open><summary>${escapeHtml(name)}<span class="count">${notes.length}</span></summary><ul>${items}</ul></details>`;
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
  $('sidebar-list').innerHTML = query ? renderResults(query) : renderTree();
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
  const crumbs = note.folder ? escapeHtml(note.folder.split('/').join(' / ')) : 'root';
  const tag = note.meta.type ? `<span class="tag">${escapeHtml(note.meta.type)}</span>` : '';
  const title = note.hasH1 ? '' : `<h1>${escapeHtml(note.title)}</h1>`;
  const desc = note.meta.description ? `<p class="description">${escapeHtml(note.meta.description)}</p>` : '';
  const actions =
    `<div class="note-actions"><a class="btn ghost" href="#/edit/${encodeURIComponent(path)}">Edit</a>` +
    `<a class="btn ghost" href="#/graph?focus=${encodeURIComponent(path)}">Show in graph</a></div>`;
  $('note').innerHTML =
    `<div class="note-head"><div class="crumbs">${crumbs}${tag}</div>${actions}</div>${title}${desc}` +
    `<article class="markdown">${renderMarkdown(note.body, linkCtx(path))}</article>` +
    `<p class="memory-line">${escapeHtml(line)}</p>` +
    renderBacklinks(note);
  $('note').scrollTop = 0;
  document.title = `${note.title} | Vault`;
  renderSidebar();
}

// ---------- graph view ----------

function renderLegend(layout) {
  const groups = orderGroups(new Set([...vault.notes.values()].map((n) => n.group)));
  $('legend-body').innerHTML =
    `<p class="legend-hint">${escapeHtml(LAYOUT_HINTS[layout])}</p><ul>` +
    groups.map((g) => `<li><span class="dot" data-group="${escapeHtml(g)}"></span>${escapeHtml(g)}</li>`).join('') +
    '<li><span class="swatch dim"></span>Dim: fading from memory (forgetting curve)</li>' +
    '<li><span class="swatch gold"></span>Gold, thicker: opened together often (Hebbian)</li>' +
    '<li><span class="swatch dashed"></span>Dashed: learned link with no written link</li></ul>';
  for (const dot of $('legend-body').querySelectorAll('.dot')) dot.style.background = groupColor(dot.dataset.group);
}

function showCard(node) {
  const card = $('graph-card');
  if (!node) {
    card.hidden = true;
    return;
  }
  const info = state.info(node.path);
  const note = vault.notes.get(node.path);
  card.innerHTML =
    `<div class="card-title"><span class="dot"></span>${escapeHtml(node.title)}</div>` +
    `<div class="card-meta">${escapeHtml(node.group)} &middot; strength ${pct(node.strength)} &middot; ` +
    `${plural(note.links.length + note.backlinks.length, 'link')} &middot; opened ${ago(info.lastOpened)}</div>` +
    `<div class="card-actions"><a class="btn primary" href="${noteHref(node.path)}">Open</a>` +
    `<button class="btn ghost" type="button" data-close>Close</button></div>` +
    '<p class="card-hint">Tap the note again to open it.</p>';
  card.querySelector('.dot').style.background = groupColor(node.group);
  card.querySelector('[data-close]').addEventListener('click', () => graph.clearSelection());
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
    chip.style.borderColor = groupColor(vault.notes.get(chip.dataset.path).group);
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
    });
  }
  const chosen = ['web', 'rings', 'wheel'].includes(layout) ? layout : localStorage.getItem(LAYOUT_KEY) || 'web';
  localStorage.setItem(LAYOUT_KEY, chosen);
  graph.show();
  graph.layout = chosen;
  graph.setData(vault, state);
  for (const seg of document.querySelectorAll('.graph-tools .seg')) seg.classList.toggle('active', seg.dataset.layout === chosen);
  renderLegend(chosen);
  showAligned(chosen === 'wheel' ? graph.aligned() : []);
  if (focus && graph.byPath.has(focus)) graph.select(focus, { center: true });
  else showCard(graph.selected);
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
      <div class="crumbs">${heading}</div>
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
  document.title = `${note ? 'Edit' : 'New note'} | Vault`;
  if (voice || !note) ta.setSelectionRange(ta.value.length, ta.value.length);
  if (voice && voiceSupported) {
    ta.focus();
    dictation.start();
  } else if (note) ta.focus();
  else title.focus();
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
      path = await vault.create(title, $('ed-body').value);
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
  if (!loaded) return;
  if (segs[0] === 'note') return showNote(decode(segs[1] || '') || HOME);
  if (segs[0] === 'graph') return showGraph(segs[1], params.get('focus'));
  if (segs[0] === 'edit') return showEditor({ path: decode(segs[1] || '') });
  if (segs[0] === 'new') return showEditor({ voice: segs[1] === 'voice' });
  return showHome();
}

async function refresh() {
  $('refresh').disabled = true;
  try {
    await vault.load();
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
  loaded = true;
  state.seen([...vault.notes.keys()]);
  renderSidebar();
  route();
}

start();
