// Loads a vault of markdown notes from a source, resolves links between them,
// answers search queries and writes notes back. A source needs list(),
// read(path) and write(path, text, message); readMany(paths) is optional.

import { splitFrontmatter } from './markdown.js';

// Reads a local folder served over http. manifest.json lists the note paths
// because a browser cannot list a directory on its own. Writes only work with
// dev_server.py; on a static host the sample vault is read only.
export class LocalSource {
  constructor(base) {
    this.base = base.endsWith('/') ? base : base + '/';
    this.label = 'Sample vault';
  }

  url(path) {
    return this.base + path.split('/').map(encodeURIComponent).join('/');
  }

  async list() {
    const r = await fetch(this.base + 'manifest.json', { cache: 'no-store' });
    if (!r.ok) throw new Error(`Could not read ${this.base}manifest.json (${r.status})`);
    return r.json();
  }

  async read(path) {
    const r = await fetch(this.url(path), { cache: 'no-store' });
    if (!r.ok) throw new Error(`Could not read ${path} (${r.status})`);
    return r.text();
  }

  async write(path, text) {
    let r;
    try {
      r = await fetch(this.url(path), { method: 'PUT', body: text, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
    } catch {
      throw new Error('Could not reach the vault to save.');
    }
    if (!r.ok) throw new Error('The sample vault is read only here. Connect your own vault in Settings to save notes.');
  }
}

const WIKILINK = /\[\[([^\]|]+?)(?:\|[^\]]+)?\]\]/g;
const MDLINK = /\[[^\]]+\]\(([^)\s]+?\.md)(?:#[^)\s]*)?\)/gi;

const stripMd = (p) => p.replace(/\.md$/i, '');
// Link keys ignore case and treat -, _ and spaces alike, since memory files
// are named with underscores but often linked with hyphens.
const linkKey = (s) => s.toLowerCase().replace(/[-_\s]+/g, '-');
const dirOf = (p) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');

export const topGroup = (path) => (path.includes('/') ? path.split('/')[0] : 'root');

function joinPath(dir, rel) {
  const parts = (dir ? dir.split('/') : []).concat(rel.split('/'));
  const out = [];
  for (const part of parts) {
    if (part === '' || part === '.') continue;
    if (part === '..') out.pop();
    else out.push(part);
  }
  return out.join('/');
}

export function slugify(title) {
  return (
    title
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || 'note'
  );
}

function makeNote(path, text) {
  const { meta, body } = splitFrontmatter(text);
  const h1 = body.match(/^#\s+(.+)$/m);
  const base = stripMd(path.split('/').pop());
  const title = (h1 && h1[1].trim()) || meta.name || base;
  const stamp = Date.parse(meta.created || meta.modified || '');
  return {
    path,
    base,
    meta,
    raw: text,
    body,
    title,
    folder: dirOf(path),
    group: topGroup(path),
    hasH1: Boolean(h1),
    dated: Number.isNaN(stamp) ? null : stamp,
    lower: (title + '\n' + body).toLowerCase(),
    links: [],
    missing: [],
    backlinks: [],
  };
}

export class Vault {
  constructor(source) {
    this.source = source;
    this.notes = new Map();
    this.keys = new Map();
  }

  // onStep(message) reports progress, so a slow first load on a phone shows
  // what it is doing instead of looking frozen.
  async load(onStep = () => {}) {
    onStep('Listing notes...');
    const paths = (await this.source.list()).filter((p) => /\.md$/i.test(p) && !p.startsWith('.vault/'));
    const texts = this.source.readMany
      ? await this.source.readMany(paths, (done, total) => onStep(`Downloading notes: ${done} of ${total}`))
      : await Promise.all(paths.map((p) => this.source.read(p)));
    this.notes.clear();
    paths.forEach((p, k) => {
      if (typeof texts[k] === 'string') this.notes.set(p, makeNote(p, texts[k]));
    });
    this.rebuild();
  }

  rebuild() {
    this.indexKeys();
    this.buildLinks();
  }

  async write(path, text, message) {
    const isNew = !this.notes.has(path);
    await this.source.write(path, text, message || `${isNew ? 'Add' : 'Update'} ${path} from the vault app`);
    this.notes.set(path, makeNote(path, text));
    this.rebuild();
    return path;
  }

  freePath(folder, title) {
    const slug = slugify(title);
    let path = `${folder}/${slug}.md`;
    for (let n = 2; this.notes.has(path); n++) path = `${folder}/${slug}-${n}.md`;
    return path;
  }

  async create(title, body, folder = 'notes') {
    const path = this.freePath(folder, title);
    const text = `# ${title.trim()}\n\n${body.trim()}\n`;
    return this.write(path, text);
  }

  indexKeys() {
    this.keys.clear();
    const add = (key, path) => {
      if (!key) return;
      const k = linkKey(key);
      if (!this.keys.has(k)) this.keys.set(k, []);
      if (!this.keys.get(k).includes(path)) this.keys.get(k).push(path);
    };
    for (const note of this.notes.values()) {
      add(note.base, note.path);
      add(note.meta.name, note.path);
      add(note.title, note.path);
    }
  }

  // Resolves a [[wikilink]] target to a note path, or null if no note matches.
  // When several notes share a name, the one in the linking note's folder wins.
  resolve(target, fromPath = '') {
    const t = linkKey(stripMd(target.split('#')[0].trim()));
    if (!t) return null;
    if (t.includes('/')) {
      for (const p of this.notes.keys()) {
        const s = linkKey(stripMd(p));
        if (s === t || s.endsWith('/' + t)) return p;
      }
      return null;
    }
    const hits = this.keys.get(t);
    if (!hits) return null;
    const here = dirOf(fromPath);
    return hits.find((p) => dirOf(p) === here) || hits[0];
  }

  // Resolves a relative markdown link like (feedback_x.md) to a note path.
  resolveRelative(url, fromPath = '') {
    let rel = url.split('#')[0];
    try {
      rel = decodeURIComponent(rel);
    } catch {
      // keep the raw text if it is not valid percent-encoding
    }
    const path = joinPath(dirOf(fromPath), rel);
    return this.notes.has(path) ? path : null;
  }

  buildLinks() {
    for (const note of this.notes.values()) {
      note.links = [];
      note.missing = [];
      note.backlinks = [];
    }
    for (const note of this.notes.values()) {
      for (const line of note.body.split(/\r?\n/)) {
        const found = [];
        for (const m of line.matchAll(WIKILINK)) found.push([m[1], this.resolve(m[1], note.path)]);
        for (const m of line.matchAll(MDLINK)) {
          if (!/^https?:/i.test(m[1])) found.push([m[1], this.resolveRelative(m[1], note.path)]);
        }
        for (const [target, path] of found) {
          if (!path) {
            if (!note.missing.includes(target)) note.missing.push(target);
            continue;
          }
          if (path === note.path) continue;
          if (!note.links.includes(path)) note.links.push(path);
          const dest = this.notes.get(path);
          if (!dest.backlinks.some((b) => b.from === note.path)) {
            dest.backlinks.push({ from: note.path, context: line.trim() });
          }
        }
      }
    }
  }

  // Every query word must appear in the note. Title hits rank first, then
  // how often the words appear.
  search(query, limit = 50) {
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (!terms.length) return [];
    const results = [];
    for (const note of this.notes.values()) {
      if (!terms.every((t) => note.lower.includes(t))) continue;
      const titleLower = note.title.toLowerCase();
      let score = 0;
      for (const t of terms) {
        if (titleLower.includes(t)) score += 20;
        score += note.lower.split(t).length - 1;
      }
      results.push({ note, score, snippet: snippetFor(note.body, terms) });
    }
    results.sort((a, b) => b.score - a.score || a.note.title.localeCompare(b.note.title));
    return results.slice(0, limit);
  }
}

function snippetFor(body, terms) {
  const flat = body.replace(/\s+/g, ' ').trim();
  const lower = flat.toLowerCase();
  let pos = -1;
  for (const t of terms) {
    const p = lower.indexOf(t);
    if (p !== -1 && (pos === -1 || p < pos)) pos = p;
  }
  if (pos === -1) return flat.slice(0, 140);
  const start = Math.max(0, pos - 50);
  const end = Math.min(flat.length, pos + 110);
  return (start > 0 ? '...' : '') + flat.slice(start, end) + (end < flat.length ? '...' : '');
}
