// Usage data behind the neuroscience visuals:
//   when each note was first seen and last opened  (forgetting curve, rings)
//   how often two notes are opened back to back    (Hebbian links)
//   each note's fixed slot on the memory wheels     (memory palace)
// Every change is kept on this device right away and written to
// .vault/state.json in the vault on a delay, so all devices share it.

export const STATE_PATH = '.vault/state.json';

const DAY = 86400000;
const REVIEW_GAP = 30 * 60000; // opens closer together than this count as one review
const HEBB_WINDOW = 10 * 60000; // notes opened within this window "fire together"
const HEBB_RECENT = 2; // only the last two notes opened pair with a new one
const LOCAL_KEY = 'vault-state:';

export const pairKey = (a, b) => (a < b ? `${a}\n${b}` : `${b}\n${a}`);

const empty = () => ({ version: 1, notes: {}, hebbian: {}, palace: {}, turns: {} });

export class VaultState {
  constructor(source, scope, { saveDelay = 2000 } = {}) {
    this.source = source;
    this.scope = scope;
    this.saveDelay = saveDelay;
    this.data = empty();
    this.recent = [];
    this.bumped = new Map();
    this.timer = null;
    this.pending = false;
    this.saving = null;
    this.lastError = null;
  }

  async load() {
    this.data = empty();
    const remote = await this.readRemote();
    if (remote) this.merge(remote);
    try {
      const local = JSON.parse(localStorage.getItem(LOCAL_KEY + this.scope));
      if (local) this.merge(local);
    } catch {
      // unreadable local copy; the remote one still loaded
    }
  }

  async readRemote() {
    try {
      const text = this.source.readFresh ? await this.source.readFresh(STATE_PATH) : await this.source.read(STATE_PATH);
      return JSON.parse(text);
    } catch {
      return null;
    }
  }

  // Combines another copy of the state into this one without losing anything:
  // earliest first-seen, latest open, highest counts.
  merge(other) {
    const d = this.data;
    for (const [path, n] of Object.entries(other.notes || {})) {
      const mine = d.notes[path] || (d.notes[path] = {});
      if (n.firstSeen && (!mine.firstSeen || n.firstSeen < mine.firstSeen)) mine.firstSeen = n.firstSeen;
      if (n.lastOpened && (!mine.lastOpened || n.lastOpened > mine.lastOpened)) mine.lastOpened = n.lastOpened;
      if ((n.opens || 0) > (mine.opens || 0)) mine.opens = n.opens;
    }
    for (const [key, w] of Object.entries(other.hebbian || {})) {
      if (w > (d.hebbian[key] || 0)) d.hebbian[key] = w;
    }
    for (const [path, slot] of Object.entries(other.palace || {})) {
      if (!(path in d.palace)) d.palace[path] = slot;
    }
    Object.assign(d.turns, other.turns || {});
  }

  // Records notes the app has not seen before, so their age starts counting.
  seen(paths, now = Date.now()) {
    let added = false;
    for (const path of paths) {
      if (!this.data.notes[path]) {
        this.data.notes[path] = { firstSeen: now };
        added = true;
      } else if (!this.data.notes[path].firstSeen) {
        this.data.notes[path].firstSeen = now;
        added = true;
      }
    }
    if (added) this.changed();
  }

  recordOpen(path, now = Date.now()) {
    const n = this.data.notes[path] || (this.data.notes[path] = { firstSeen: now });
    if (!n.lastOpened || now - n.lastOpened > REVIEW_GAP) n.opens = (n.opens || 0) + 1;
    n.lastOpened = now;
    this.recent = this.recent.filter((r) => now - r.t <= HEBB_WINDOW && r.path !== path).slice(-HEBB_RECENT);
    for (const r of this.recent) {
      const key = pairKey(path, r.path);
      if (now - (this.bumped.get(key) || 0) > REVIEW_GAP) {
        this.data.hebbian[key] = (this.data.hebbian[key] || 0) + 1;
        this.bumped.set(key, now);
      }
    }
    this.recent.push({ path, t: now });
    this.changed();
  }

  info(path) {
    return this.data.notes[path] || {};
  }

  // Ebbinghaus retention: e^(-t/S), where t is days since the note was last
  // opened (or written, if never opened) and S grows with every review.
  strength(path, born, now = Date.now()) {
    const n = this.data.notes[path] || {};
    const last = n.lastOpened || born || n.firstSeen || now;
    const reviews = Math.max(1, n.opens || 0);
    const stability = Math.min(365, 2 * Math.pow(1.9, reviews - 1));
    return Math.exp(-Math.max(0, now - last) / DAY / stability);
  }

  // Gives every note a fixed slot on its wheel. Existing slots never move;
  // new notes take the lowest free slot in their group.
  slots(groups) {
    const result = new Map();
    let changed = false;
    for (const paths of groups.values()) {
      const used = new Set();
      const sorted = [...paths].sort();
      const unplaced = [];
      for (const path of sorted) {
        const slot = this.data.palace[path];
        if (Number.isInteger(slot) && !used.has(slot)) {
          used.add(slot);
          result.set(path, slot);
        } else {
          unplaced.push(path);
        }
      }
      let next = 0;
      for (const path of unplaced) {
        while (used.has(next)) next++;
        used.add(next);
        result.set(path, next);
        this.data.palace[path] = next;
        changed = true;
      }
    }
    if (changed) this.changed();
    return result;
  }

  turn(group) {
    return this.data.turns[group] || 0;
  }

  setTurn(group, radians) {
    this.data.turns[group] = radians;
    this.changed();
  }

  changed() {
    try {
      localStorage.setItem(LOCAL_KEY + this.scope, JSON.stringify(this.data));
    } catch {
      // storage full or blocked; the vault copy still gets saved
    }
    this.pending = true;
    if (!this.timer) this.timer = setTimeout(() => this.flush(), this.saveDelay);
  }

  // Writes the state to the vault now. On a conflict (another device saved
  // first) it reads that copy, merges, and tries once more.
  async flush() {
    clearTimeout(this.timer);
    this.timer = null;
    if (!this.pending) return this.saving;
    if (this.saving) await this.saving;
    this.pending = false;
    this.saving = (async () => {
      try {
        await this.source.write(STATE_PATH, JSON.stringify(this.data), 'Update vault state');
        this.lastError = null;
      } catch (err) {
        if (err.conflict) {
          const remote = await this.readRemote();
          if (remote) this.merge(remote);
          try {
            await this.source.write(STATE_PATH, JSON.stringify(this.data), 'Update vault state');
            this.lastError = null;
            return;
          } catch (retryErr) {
            err = retryErr;
          }
        }
        this.lastError = err;
        this.pending = true;
      }
    })();
    await this.saving;
    this.saving = null;
  }
}
