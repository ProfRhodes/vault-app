// Reads and writes the vault in a private GitHub repo.
// The token stays in this browser's storage and is only ever sent to
// api.github.com. Note text is cached on the device by blob sha, so a reload
// only downloads notes that changed since the last visit.

const API = 'https://api.github.com';
const BATCH = 50;
const TIMEOUT_MS = 30000;

class GitHubError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
    this.conflict = status === 409 || status === 422;
  }
}

function toBase64(text) {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

function fromBase64(b64) {
  const bin = atob(b64.replace(/\s/g, ''));
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

// Tiny IndexedDB cache: blob sha -> note text. Any failure just means no cache.
const cache = {
  db: null,
  open() {
    if (this.db) return this.db;
    this.db = new Promise((resolve) => {
      setTimeout(() => resolve(null), 3000);
      try {
        const req = indexedDB.open('vault-cache', 1);
        req.onupgradeneeded = () => req.result.createObjectStore('blobs');
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
        req.onblocked = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
    return this.db;
  },
  async getMany(keys) {
    const db = await this.open();
    if (!db) return keys.map(() => undefined);
    return new Promise((resolve) => {
      const out = new Array(keys.length);
      const tx = db.transaction('blobs', 'readonly');
      const store = tx.objectStore('blobs');
      keys.forEach((k, i) => {
        const req = store.get(k);
        req.onsuccess = () => (out[i] = req.result);
      });
      tx.oncomplete = () => resolve(out);
      tx.onerror = () => resolve(keys.map(() => undefined));
    });
  },
  async putMany(entries) {
    const db = await this.open();
    if (!db || !entries.length) return;
    await new Promise((resolve) => {
      const tx = db.transaction('blobs', 'readwrite');
      const store = tx.objectStore('blobs');
      for (const [k, v] of entries) store.put(v, k);
      tx.oncomplete = resolve;
      tx.onerror = resolve;
    });
  },
};

export class GitHubSource {
  constructor({ owner, repo, branch = 'main', token }) {
    this.owner = owner;
    this.repo = repo;
    this.branch = branch || 'main';
    this.token = token;
    this.shas = new Map();
    this.label = `${owner}/${repo}`;
    this.remote = true;
  }

  async api(path, { method = 'GET', body, accept = 'application/vnd.github+json' } = {}) {
    let r;
    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(), TIMEOUT_MS);
    try {
      r = await fetch(API + path, {
        method,
        headers: {
          Authorization: `Bearer ${this.token}`,
          Accept: accept,
          'X-GitHub-Api-Version': '2022-11-28',
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        cache: 'no-store',
        signal: timeout.signal,
      });
    } catch {
      throw new GitHubError(
        timeout.signal.aborted
          ? `GitHub did not answer within ${TIMEOUT_MS / 1000} seconds. Check your connection and reopen the app.`
          : 'Could not reach GitHub. Check your connection.',
        0
      );
    } finally {
      clearTimeout(timer);
    }
    if (!r.ok) {
      let detail = '';
      try {
        detail = (await r.json()).message || '';
      } catch {
        // no JSON body
      }
      const hint =
        r.status === 401 ? 'The token was rejected. Check it in Settings.'
        : r.status === 403 ? 'The token is not allowed to do that. It needs Contents read and write on this repo.'
        : r.status === 404 ? 'Repo or file not found. Check the owner, repo and branch in Settings.'
        : r.status === 409 || r.status === 422 ? 'This note changed on another device. Reload, then make your edit again.'
        : `GitHub said ${r.status}.`;
      throw new GitHubError(detail ? `${hint} (${detail})` : hint, r.status);
    }
    return r.status === 204 ? null : r.json();
  }

  contentsPath(path) {
    const parts = path.split('/').map(encodeURIComponent).join('/');
    return `/repos/${encodeURIComponent(this.owner)}/${encodeURIComponent(this.repo)}/contents/${parts}`;
  }

  async list() {
    const tree = await this.api(
      `/repos/${encodeURIComponent(this.owner)}/${encodeURIComponent(this.repo)}/git/trees/${encodeURIComponent(this.branch)}?recursive=1`
    );
    this.shas = new Map(tree.tree.filter((e) => e.type === 'blob').map((e) => [e.path, e.sha]));
    this.truncated = Boolean(tree.truncated);
    return [...this.shas.keys()];
  }

  // Fetches many notes at once: cached ones come from the device, the rest
  // arrive 50 per GraphQL request.
  async readMany(paths, onProgress = () => {}) {
    const shas = paths.map((p) => this.shas.get(p));
    const cached = await cache.getMany(shas.map((s) => s || ''));
    const out = cached.map((t, i) => (shas[i] && typeof t === 'string' ? t : undefined));
    const todo = paths.map((p, i) => i).filter((i) => out[i] === undefined);
    const fresh = [];
    for (let start = 0; start < todo.length; start += BATCH) {
      onProgress(start, todo.length);
      const batch = todo.slice(start, start + BATCH);
      const fields = batch
        .map((i, k) => `f${k}: object(expression: ${JSON.stringify(`${this.branch}:${paths[i]}`)}) { ... on Blob { text isBinary isTruncated } }`)
        .join('\n');
      const query = `query($owner: String!, $name: String!) { repository(owner: $owner, name: $name) { ${fields} } }`;
      const res = await this.api('/graphql', { method: 'POST', body: { query, variables: { owner: this.owner, name: this.repo } } });
      if (res.errors && !res.data) throw new GitHubError(`GitHub could not load notes (${res.errors[0].message})`, 0);
      const repo = (res.data && res.data.repository) || {};
      for (let k = 0; k < batch.length; k++) {
        const i = batch[k];
        const blob = repo[`f${k}`];
        let text = blob && !blob.isBinary && !blob.isTruncated ? blob.text : null;
        if (text === null && blob && !blob.isBinary) text = await this.readFresh(paths[i]);
        if (typeof text === 'string') {
          out[i] = text;
          if (shas[i]) fresh.push([shas[i], text]);
        }
      }
    }
    if (todo.length) onProgress(todo.length, todo.length);
    await cache.putMany(fresh);
    return out;
  }

  // Whether the last listing included this file, so missing files cost no request.
  has(path) {
    return Boolean(this.shas && this.shas.has(path));
  }

  async read(path) {
    const [text] = await this.readMany([path]);
    if (typeof text !== 'string') throw new GitHubError(`Could not read ${path}`, 404);
    return text;
  }

  // Reads one file straight from GitHub, skipping the cache, and records its
  // current sha so the next write lands on top of it.
  async readFresh(path) {
    const res = await this.api(`${this.contentsPath(path)}?ref=${encodeURIComponent(this.branch)}`);
    this.shas.set(path, res.sha);
    return fromBase64(res.content || '');
  }

  async write(path, text, message) {
    const body = { message: message || `Update ${path}`, content: toBase64(text), branch: this.branch };
    const sha = this.shas.get(path);
    if (sha) body.sha = sha;
    const res = await this.api(this.contentsPath(path), { method: 'PUT', body });
    const newSha = res && res.content && res.content.sha;
    if (newSha) {
      this.shas.set(path, newSha);
      await cache.putMany([[newSha, text]]);
    }
  }
}
