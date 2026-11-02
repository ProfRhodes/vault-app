// Canvas graph of the vault with three layouts:
//   web     notes pulled together by their links
//   rings   consolidation: new notes in the hippocampus at the center,
//           older ones drifting out toward the cortex
//   wheel   Giordano Bruno's memory wheels: one wheel per top folder, every
//           note in a fixed slot, drag a wheel to turn it
// Every layout shares spreading activation (tap a note), forgetting-curve
// dimming, and Hebbian edges that thicken as notes are opened together.

import { pairKey } from './state.js';

const DAY = 86400000;
const COLORS = { notes: '#e0b84f', memory: '#a78bfa', knowledge: '#5eead4', '.claude': '#f472b6', root: '#9a92b0' };
const EXTRA = ['#fb923c', '#60a5fa', '#a3e635', '#f87171'];
const GROUP_ORDER = ['notes', 'memory', 'knowledge', '.claude'];
const GLYPHS = ['☉', '☽', '☿', '♀', '♂', '♃', '♄'];

const RING_BANDS = [
  { days: 1, label: 'Today' },
  { days: 7, label: 'This week' },
  { days: 30, label: 'This month' },
  { days: 90, label: 'This season' },
  { days: Infinity, label: 'Long term' },
];
const CORE = 70;
const BAND = 95;

const ACT_DECAY = 0.62;
const ACT_HOPS = 4;
const ACT_STEP = 230;
const ACT_RISE = 160;
const ACT_FADE = 1500;

function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967296;
}

const angleDiff = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));

export function groupColor(group) {
  if (COLORS[group]) return COLORS[group];
  return EXTRA[Math.floor(hash(group) * EXTRA.length)];
}

export function orderGroups(groups) {
  const rank = (g) => (GROUP_ORDER.includes(g) ? GROUP_ORDER.indexOf(g) : GROUP_ORDER.length);
  return [...groups].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}

export class GraphView {
  constructor(canvas, { onSelect, onOpen, onAligned } = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.onSelect = onSelect || (() => {});
    this.onOpen = onOpen || (() => {});
    this.onAligned = onAligned || (() => {});
    this.nodes = [];
    this.byPath = new Map();
    this.edges = [];
    this.adj = new Map();
    this.layout = 'web';
    this.cam = { x: 0, y: 0, s: 1 };
    this.camTarget = null;
    this.alpha = 0;
    this.act = new Map();
    this.actUntil = 0;
    this.selected = null;
    this.hovered = null;
    this.pointers = new Map();
    this.gesture = null;
    this.wheels = [];
    this.running = false;
    this.visible = false;
    this.w = 0;
    this.h = 0;
    this.bindEvents();
    new ResizeObserver(() => this.resize()).observe(canvas.parentElement);
  }

  // Builds nodes and edges from the vault and the usage state. Positions of
  // notes already on screen are kept so a rebuild does not scramble the view.
  setData(vault, state, now = Date.now()) {
    this.state = state;
    const old = this.byPath;
    const notes = [...vault.notes.values()].sort((a, b) => a.group.localeCompare(b.group) || hash(a.path) - hash(b.path));
    this.nodes = notes.map((n, i) => {
      const prev = old.get(n.path);
      const info = state.info(n.path);
      const born = n.dated || info.firstSeen || now;
      const r = 12 * Math.sqrt(i + 1);
      const t = i * 2.39996;
      return {
        path: n.path,
        title: n.title,
        group: n.group,
        folder: n.folder,
        degree: 0,
        born,
        age: Math.max(0, now - born) / DAY,
        strength: state.strength(n.path, n.dated, now),
        x: prev ? prev.x : r * Math.cos(t),
        y: prev ? prev.y : r * Math.sin(t),
        vx: 0,
        vy: 0,
        tx: 0,
        ty: 0,
        radius: 4,
      };
    });
    this.byPath = new Map(this.nodes.map((n) => [n.path, n]));
    const edges = new Map();
    for (const note of notes) {
      for (const target of note.links) {
        if (!this.byPath.has(target)) continue;
        const key = pairKey(note.path, target);
        if (!edges.has(key)) edges.set(key, { a: this.byPath.get(note.path), b: this.byPath.get(target), linked: true, w: 0 });
      }
    }
    for (const [key, w] of Object.entries(state.data.hebbian)) {
      const [pa, pb] = key.split('\n');
      if (!this.byPath.has(pa) || !this.byPath.has(pb)) continue;
      if (edges.has(key)) edges.get(key).w = w;
      else if (w >= 2) edges.set(key, { a: this.byPath.get(pa), b: this.byPath.get(pb), linked: false, w });
    }
    this.edges = [...edges.values()];
    this.adj = new Map(this.nodes.map((n) => [n, []]));
    for (const e of this.edges) {
      this.adj.get(e.a).push(e.b);
      this.adj.get(e.b).push(e.a);
      if (e.linked) {
        e.a.degree++;
        e.b.degree++;
      }
    }
    for (const n of this.nodes) n.radius = 3.5 + 1.7 * Math.sqrt(n.degree);
    if (this.selected) this.selected = this.byPath.get(this.selected.path) || null;
    const groups = new Map();
    for (const n of this.nodes) {
      if (!groups.has(n.group)) groups.set(n.group, []);
      groups.get(n.group).push(n.path);
    }
    this.slotMap = state.slots(groups);
    this.groups = orderGroups(groups.keys());
    this.applyLayout(old.size === 0);
  }

  setLayout(name) {
    if (!['web', 'rings', 'wheel'].includes(name)) name = 'web';
    this.layout = name;
    this.applyLayout(false);
  }

  applyLayout(fresh) {
    if (this.layout === 'web') {
      this.alpha = fresh ? 1 : 0.3;
      if (fresh) for (let i = 0; i < 400 && this.alpha > 0.02; i++) this.tick();
      for (const n of this.nodes) {
        n.tx = n.x;
        n.ty = n.y;
      }
    } else {
      this.alpha = 0;
      if (this.layout === 'rings') this.layoutRings();
      else this.layoutWheel();
      if (fresh) for (const n of this.nodes) {
        n.x = n.tx;
        n.y = n.ty;
      }
    }
    this.fit(fresh);
    this.kick();
    if (this.layout === 'wheel') this.onAligned(this.aligned());
  }

  // One step of the force layout: nearby notes push apart, links pull
  // together, and a weak pull keeps everything near the middle.
  tick() {
    const a = this.alpha;
    if (a < 0.02) return false;
    const cell = 90;
    const grid = new Map();
    for (const n of this.nodes) {
      const key = `${Math.floor(n.x / cell)},${Math.floor(n.y / cell)}`;
      if (!grid.has(key)) grid.set(key, []);
      grid.get(key).push(n);
    }
    for (const n of this.nodes) {
      const cx = Math.floor(n.x / cell);
      const cy = Math.floor(n.y / cell);
      for (let gx = cx - 1; gx <= cx + 1; gx++) {
        for (let gy = cy - 1; gy <= cy + 1; gy++) {
          const bucket = grid.get(`${gx},${gy}`);
          if (!bucket) continue;
          for (const m of bucket) {
            if (m === n) continue;
            let dx = n.x - m.x;
            let dy = n.y - m.y;
            let d2 = dx * dx + dy * dy;
            if (d2 > cell * cell) continue;
            if (d2 < 0.01) {
              dx = hash(n.path) - 0.5;
              dy = hash(m.path) - 0.5;
              d2 = 0.5;
            }
            // Round reach with a smooth falloff to zero at the cell size, so
            // the grid used for speed does not leave its shape in the layout.
            const f = ((1100 * a) / Math.max(d2, 30)) * (1 - d2 / (cell * cell));
            n.vx += dx * f * 0.5;
            n.vy += dy * f * 0.5;
          }
        }
      }
    }
    for (const e of this.edges) {
      const dx = e.b.x - e.a.x;
      const dy = e.b.y - e.a.y;
      const d = Math.sqrt(dx * dx + dy * dy) || 1;
      const k = e.linked ? 0.05 + 0.01 * Math.min(e.w, 5) : 0.015 * Math.min(e.w, 5);
      const f = ((d - 60) * k * a) / d;
      e.a.vx += dx * f;
      e.a.vy += dy * f;
      e.b.vx -= dx * f;
      e.b.vy -= dy * f;
    }
    // Notes in the same folder drift toward each other, so unlinked notes
    // gather into clusters by topic instead of an even grid.
    const centers = new Map();
    for (const n of this.nodes) {
      const c = centers.get(n.folder) || { x: 0, y: 0, k: 0 };
      c.x += n.x;
      c.y += n.y;
      c.k++;
      centers.set(n.folder, c);
    }
    for (const n of this.nodes) {
      const c = centers.get(n.folder);
      if (c.k < 2) continue;
      const pull = n.degree ? 0.01 : 0.06;
      n.vx += (c.x / c.k - n.x) * pull * a;
      n.vy += (c.y / c.k - n.y) * pull * a;
    }
    for (const n of this.nodes) {
      n.vx -= n.x * 0.006 * a;
      n.vy -= n.y * 0.006 * a;
      n.vx *= 0.8;
      n.vy *= 0.8;
      const speed = Math.hypot(n.vx, n.vy);
      if (speed > 25) {
        n.vx *= 25 / speed;
        n.vy *= 25 / speed;
      }
      n.x += n.vx;
      n.y += n.vy;
    }
    this.alpha *= 0.985;
    return true;
  }

  bandOf(age) {
    return RING_BANDS.findIndex((b) => age < b.days);
  }

  // Rings: radius grows with the note's age, center is "today".
  layoutRings() {
    const bands = RING_BANDS.map(() => []);
    for (const n of this.nodes) bands[this.bandOf(n.age)].push(n);
    bands.forEach((list, i) => {
      list.sort((p, q) => hash(p.path) - hash(q.path));
      const lo = i === 0 ? 0 : RING_BANDS[i - 1].days;
      const hi = RING_BANDS[i].days;
      list.forEach((n, k) => {
        const frac = hi === Infinity ? Math.min(1, Math.log10(Math.max(1, n.age / lo))) : (n.age - lo) / (hi - lo);
        const r = i === 0 ? 8 + (CORE - 18) * frac : CORE + (i - 1) * BAND + 14 + (BAND - 28) * frac;
        const t = (k / Math.max(1, list.length)) * Math.PI * 2 + i * 0.7;
        n.tx = r * Math.cos(t);
        n.ty = r * Math.sin(t);
      });
    });
  }

  // Wheel: each group is a ring of fixed slots, turned by its saved angle.
  layoutWheel() {
    this.wheels = [];
    let inner = 60;
    for (const group of this.groups) {
      const members = this.nodes.filter((n) => n.group === group);
      const maxSlot = Math.max(0, ...members.map((n) => this.slotMap.get(n.path) || 0)) + 1;
      // Small wheels use 12 segments, one note per segment. Big ones pack
      // notes 18 px apart and add tracks outward.
      const capacity = Math.max(12, Math.floor((2 * Math.PI * (inner + 16)) / 18));
      const perTrack = Math.min(capacity, Math.max(12, maxSlot));
      const tracks = Math.ceil(maxSlot / perTrack);
      const wheel = { group, inner, outer: inner + 32 + (tracks - 1) * 16, perTrack, turn: this.state.turn(group) };
      for (const n of members) {
        const slot = this.slotMap.get(n.path) || 0;
        const track = Math.floor(slot / perTrack);
        const r = inner + 16 + track * 16;
        const t = ((slot % perTrack) / perTrack) * Math.PI * 2 - Math.PI / 2 + wheel.turn;
        n.tx = r * Math.cos(t);
        n.ty = r * Math.sin(t);
        n.angle = t;
      }
      this.wheels.push(wheel);
      inner = wheel.outer + 28;
    }
  }

  // The note on each wheel sitting closest to the pointer at the top.
  aligned() {
    const out = [];
    for (const wheel of this.wheels) {
      let best = null;
      let bestD = Math.PI / wheel.perTrack + 0.0001;
      for (const n of this.nodes) {
        if (n.group !== wheel.group) continue;
        const d = Math.abs(angleDiff(n.angle, -Math.PI / 2));
        if (d < bestD) {
          bestD = d;
          best = n;
        }
      }
      if (best) out.push({ group: wheel.group, path: best.path, title: best.title });
    }
    return out;
  }

  // Spreading activation: the tapped note lights fully, and the glow travels
  // outward through links, weaker with every hop.
  activate(path, now = performance.now()) {
    const start = this.byPath.get(path);
    if (!start) return;
    this.act = new Map([[start, { level: 1, at: now }]]);
    let frontier = [start];
    for (let hop = 1; hop <= ACT_HOPS && frontier.length; hop++) {
      const next = [];
      for (const n of frontier) {
        for (const m of this.adj.get(n)) {
          if (this.act.has(m)) continue;
          this.act.set(m, { level: Math.pow(ACT_DECAY, hop), at: now + hop * ACT_STEP });
          next.push(m);
        }
      }
      frontier = next;
    }
    this.actUntil = now + ACT_HOPS * ACT_STEP + ACT_RISE + ACT_FADE * 4;
    this.selected = start;
    this.kick();
  }

  actAt(n, t) {
    const a = this.act.get(n);
    if (!a) return 0;
    const dt = t - a.at;
    if (dt < 0) return 0;
    const rise = Math.min(1, dt / ACT_RISE);
    const fade = Math.exp(-Math.max(0, dt - ACT_RISE) / ACT_FADE);
    return a.level * rise * fade;
  }

  select(path, { center = false } = {}) {
    const n = this.byPath.get(path);
    if (!n) return;
    this.activate(path);
    if (center) this.camTarget = { x: n.tx, y: n.ty, s: Math.max(this.cam.s, 1.2) };
    this.onSelect(n);
  }

  clearSelection() {
    this.selected = null;
    this.act = new Map();
    this.onSelect(null);
    this.kick();
  }

  resize() {
    const parent = this.canvas.parentElement;
    const dpr = window.devicePixelRatio || 1;
    this.w = parent.clientWidth;
    this.h = parent.clientHeight;
    this.canvas.width = Math.round(this.w * dpr);
    this.canvas.height = Math.round(this.h * dpr);
    this.dpr = dpr;
    this.kick();
  }

  fit(instant) {
    if (!this.nodes.length || !this.w) return;
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    const pts = this.layout === 'web' ? this.nodes.map((n) => [n.x, n.y]) : this.nodes.map((n) => [n.tx, n.ty]);
    if (this.layout === 'wheel' && this.wheels.length) {
      const r = this.wheels[this.wheels.length - 1].outer + 30;
      pts.push([-r, -r - 70], [r, r]);
    }
    if (this.layout === 'rings') {
      const r = CORE + (RING_BANDS.length - 1) * BAND;
      pts.push([-r, -r], [r, r + 30]);
    }
    for (const [x, y] of pts) {
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
    const pad = 40;
    const s = Math.min(4, Math.max(0.05, Math.min(this.w / (maxX - minX + pad * 2), this.h / (maxY - minY + pad * 2))));
    const target = { x: (minX + maxX) / 2, y: (minY + maxY) / 2, s };
    if (instant || !this.fitted) this.cam = target;
    else this.camTarget = target;
    this.fitted = true;
  }

  toScreen(x, y) {
    return [(x - this.cam.x) * this.cam.s + this.w / 2, (y - this.cam.y) * this.cam.s + this.h / 2];
  }

  toWorld(sx, sy) {
    return [(sx - this.w / 2) / this.cam.s + this.cam.x, (sy - this.h / 2) / this.cam.s + this.cam.y];
  }

  screenOf(path) {
    const n = this.byPath.get(path);
    return n ? this.toScreen(n.x, n.y) : null;
  }

  hit(sx, sy) {
    let best = null;
    let bestD = 18;
    for (const n of this.nodes) {
      const [x, y] = this.toScreen(n.x, n.y);
      const d = Math.hypot(x - sx, y - sy) - n.radius * this.cam.s;
      if (d < bestD) {
        bestD = d;
        best = n;
      }
    }
    return best;
  }

  wheelAt(sx, sy) {
    if (this.layout !== 'wheel') return null;
    const [x, y] = this.toWorld(sx, sy);
    const d = Math.hypot(x, y);
    return this.wheels.find((w) => d >= w.inner - 4 && d <= w.outer + 8) || null;
  }

  bindEvents() {
    const c = this.canvas;
    const pos = (e) => {
      const r = c.getBoundingClientRect();
      return [e.clientX - r.left, e.clientY - r.top];
    };
    c.addEventListener('pointerdown', (e) => {
      c.setPointerCapture(e.pointerId);
      const [x, y] = pos(e);
      this.pointers.set(e.pointerId, { x, y });
      if (this.pointers.size === 1) {
        this.gesture = { kind: 'press', x, y, lastX: x, lastY: y, wheel: this.wheelAt(x, y), moved: false };
      } else if (this.pointers.size === 2) {
        const [p, q] = [...this.pointers.values()];
        this.gesture = { kind: 'pinch', dist: Math.hypot(p.x - q.x, p.y - q.y), s: this.cam.s, mid: [(p.x + q.x) / 2, (p.y + q.y) / 2] };
      }
      this.camTarget = null;
    });
    c.addEventListener('pointermove', (e) => {
      const [x, y] = pos(e);
      if (!this.pointers.has(e.pointerId)) {
        if (e.pointerType === 'mouse') {
          const h = this.hit(x, y);
          if (h !== this.hovered) {
            this.hovered = h;
            c.style.cursor = h ? 'pointer' : this.wheelAt(x, y) ? 'grab' : 'default';
            this.kick();
          }
        }
        return;
      }
      this.pointers.set(e.pointerId, { x, y });
      const g = this.gesture;
      if (!g) return;
      if (g.kind === 'pinch' && this.pointers.size === 2) {
        const [p, q] = [...this.pointers.values()];
        const dist = Math.hypot(p.x - q.x, p.y - q.y);
        this.zoomAt(g.mid[0], g.mid[1], (g.s * dist) / g.dist / this.cam.s);
        return;
      }
      if (g.kind !== 'press') return;
      if (!g.moved && Math.hypot(x - g.x, y - g.y) > 6) g.moved = true;
      if (!g.moved) return;
      if (g.wheel) {
        const [ax, ay] = this.toWorld(g.lastX, g.lastY);
        const [bx, by] = this.toWorld(x, y);
        const delta = angleDiff(Math.atan2(by, bx), Math.atan2(ay, ax));
        g.wheel.turn += delta;
        this.state.data.turns[g.wheel.group] = g.wheel.turn;
        this.layoutWheel();
        for (const n of this.nodes) {
          if (n.group !== g.wheel.group) continue;
          n.x = n.tx;
          n.y = n.ty;
        }
      } else {
        this.cam.x -= (x - g.lastX) / this.cam.s;
        this.cam.y -= (y - g.lastY) / this.cam.s;
      }
      g.lastX = x;
      g.lastY = y;
      this.kick();
    });
    const end = (e) => {
      if (!this.pointers.has(e.pointerId)) return;
      this.pointers.delete(e.pointerId);
      const g = this.gesture;
      if (this.pointers.size > 0) {
        if (g && g.kind === 'pinch') this.gesture = null;
        return;
      }
      this.gesture = null;
      if (!g || g.kind !== 'press' || e.type === 'pointercancel') return;
      if (g.moved) {
        if (g.wheel) {
          this.state.setTurn(g.wheel.group, g.wheel.turn);
          this.onAligned(this.aligned());
        }
        return;
      }
      const n = this.hit(g.x, g.y);
      if (!n) this.clearSelection();
      else if (this.selected === n) this.onOpen(n.path);
      else this.select(n.path);
    };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', end);
    c.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        const [x, y] = pos(e);
        this.camTarget = null;
        this.zoomAt(x, y, Math.exp(-e.deltaY * 0.0015));
      },
      { passive: false }
    );
  }

  zoomAt(sx, sy, factor) {
    const [wx, wy] = this.toWorld(sx, sy);
    this.cam.s = Math.min(6, Math.max(0.05, this.cam.s * factor));
    const [nx, ny] = this.toWorld(sx, sy);
    this.cam.x += wx - nx;
    this.cam.y += wy - ny;
    this.kick();
  }

  show() {
    this.visible = true;
    this.resize();
    if (!this.fitted) this.fit(true);
    this.kick();
  }

  hide() {
    this.visible = false;
  }

  kick() {
    if (this.running || !this.visible) return;
    this.running = true;
    requestAnimationFrame((t) => this.frame(t));
  }

  frame(t) {
    if (!this.visible) {
      this.running = false;
      return;
    }
    let busy = false;
    if (this.layout === 'web' && this.alpha >= 0.02) {
      this.tick();
      this.tick();
      for (const n of this.nodes) {
        n.tx = n.x;
        n.ty = n.y;
      }
      busy = true;
    } else {
      for (const n of this.nodes) {
        const dx = n.tx - n.x;
        const dy = n.ty - n.y;
        if (Math.abs(dx) > 0.3 || Math.abs(dy) > 0.3) {
          n.x += dx * 0.14;
          n.y += dy * 0.14;
          busy = true;
        } else {
          n.x = n.tx;
          n.y = n.ty;
        }
      }
    }
    if (this.camTarget) {
      const c = this.cam;
      const g = this.camTarget;
      c.x += (g.x - c.x) * 0.15;
      c.y += (g.y - c.y) * 0.15;
      c.s += (g.s - c.s) * 0.15;
      if (Math.abs(g.s - c.s) < 0.002 && Math.hypot(g.x - c.x, g.y - c.y) < 0.5) this.camTarget = null;
      busy = true;
    }
    if (t < this.actUntil) busy = true;
    if (this.pointers.size) busy = true;
    this.draw(t);
    if (busy) requestAnimationFrame((tt) => this.frame(tt));
    else this.running = false;
  }

  draw(t) {
    const ctx = this.ctx;
    const { s } = this.cam;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.w, this.h);
    const bg = ctx.createRadialGradient(this.w / 2, this.h / 2, 0, this.w / 2, this.h / 2, Math.max(this.w, this.h) * 0.7);
    bg.addColorStop(0, '#171226');
    bg.addColorStop(1, '#0b0912');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, this.w, this.h);

    ctx.setTransform(this.dpr * s, 0, 0, this.dpr * s, this.dpr * (this.w / 2 - this.cam.x * s), this.dpr * (this.h / 2 - this.cam.y * s));
    if (this.layout === 'rings') this.drawRings(ctx, s);
    if (this.layout === 'wheel') this.drawWheels(ctx, s);

    const acts = new Map();
    for (const n of this.act.keys()) acts.set(n, this.actAt(n, t));
    const actOf = (n) => acts.get(n) || 0;

    for (const e of this.edges) {
      const fade = Math.min(e.a.strength, e.b.strength);
      const width = (1 + Math.log2(1 + e.w) * 1.3) / s;
      ctx.lineWidth = width;
      ctx.setLineDash(e.linked ? [] : [5 / s, 4 / s]);
      ctx.strokeStyle = e.w > 0 ? `rgba(224, 184, 79, ${0.18 + 0.3 * fade})` : `rgba(167, 139, 250, ${0.1 + 0.25 * fade})`;
      ctx.beginPath();
      ctx.moveTo(e.a.x, e.a.y);
      ctx.lineTo(e.b.x, e.b.y);
      ctx.stroke();
      const glow = Math.min(actOf(e.a), actOf(e.b));
      if (glow > 0.02) {
        ctx.lineWidth = width + 2.5 / s;
        ctx.strokeStyle = `rgba(255, 236, 170, ${glow * 0.8})`;
        ctx.stroke();
      }
    }
    ctx.setLineDash([]);

    for (const n of this.nodes) {
      const a = actOf(n);
      const r = Math.max(n.radius, 2.2 / s);
      if (a > 0.02) {
        ctx.globalAlpha = a * 0.45;
        ctx.fillStyle = '#ffe9a8';
        ctx.beginPath();
        ctx.arc(n.x, n.y, r + (6 + 16 * a) / s, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 0.22 + 0.78 * n.strength;
      ctx.fillStyle = groupColor(n.group);
      ctx.beginPath();
      ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      if (n === this.selected || n === this.hovered) {
        ctx.lineWidth = 2 / s;
        ctx.strokeStyle = '#ffffff';
        ctx.stroke();
      }
    }

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    if (this.layout === 'wheel') this.drawPointer(ctx);
    this.drawLabels(ctx, actOf);
  }

  drawLabels(ctx, actOf) {
    const { s } = this.cam;
    const picks = [];
    const neighbors = this.selected ? new Set(this.adj.get(this.selected)) : new Set();
    for (const n of this.nodes) {
      let p = 0;
      if (n === this.selected || n === this.hovered) p = 3;
      else if (neighbors.has(n)) p = 2;
      else if (actOf(n) > 0.2) p = 1.5;
      else if (n.radius * s > 7) p = 1;
      if (p) picks.push([p, n]);
    }
    picks.sort((a, b) => b[0] - a[0] || b[1].degree - a[1].degree);
    ctx.font = '12px system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    for (const [p, n] of picks.slice(0, 40)) {
      const [x, y] = this.toScreen(n.x, n.y);
      const text = n.title.length > 32 ? n.title.slice(0, 31) + '…' : n.title;
      const tx = x + n.radius * s + 6;
      ctx.globalAlpha = p >= 2 ? 1 : 0.75;
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(11, 9, 18, 0.85)';
      ctx.strokeText(text, tx, y);
      ctx.fillStyle = p >= 2 ? '#ffffff' : '#d8d0ea';
      ctx.fillText(text, tx, y);
    }
    ctx.globalAlpha = 1;
  }

  drawRings(ctx, s) {
    ctx.lineWidth = 1 / s;
    const core = ctx.createRadialGradient(0, 0, 0, 0, 0, CORE);
    core.addColorStop(0, 'rgba(224, 184, 79, 0.16)');
    core.addColorStop(1, 'rgba(224, 184, 79, 0.02)');
    ctx.fillStyle = core;
    ctx.beginPath();
    ctx.arc(0, 0, CORE, 0, Math.PI * 2);
    ctx.fill();
    ctx.font = `${12 / s}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    RING_BANDS.forEach((band, i) => {
      const outer = CORE + i * BAND;
      ctx.strokeStyle = i === RING_BANDS.length - 1 ? 'rgba(167, 139, 250, 0.35)' : 'rgba(167, 139, 250, 0.18)';
      ctx.beginPath();
      ctx.arc(0, 0, outer, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = 'rgba(216, 208, 234, 0.55)';
      ctx.fillText(band.label, 0, -outer + 12 / s);
    });
    ctx.fillStyle = 'rgba(224, 184, 79, 0.8)';
    ctx.font = `600 ${11 / s}px system-ui, sans-serif`;
    ctx.textBaseline = 'middle';
    ctx.fillText('HIPPOCAMPUS', 0, CORE * 0.55);
    ctx.fillText('CORTEX', 0, CORE + (RING_BANDS.length - 1) * BAND + 16 / s);
    ctx.textAlign = 'left';
  }

  drawWheels(ctx, s) {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const w of this.wheels) {
      const color = groupColor(w.group);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.025)';
      ctx.beginPath();
      ctx.arc(0, 0, w.outer, 0, Math.PI * 2);
      ctx.arc(0, 0, w.inner, 0, Math.PI * 2, true);
      ctx.fill();
      ctx.lineWidth = 1 / s;
      ctx.strokeStyle = color;
      ctx.globalAlpha = 0.45;
      for (const r of [w.inner, w.outer]) {
        ctx.beginPath();
        ctx.arc(0, 0, r, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.globalAlpha = 0.25;
      for (let k = 0; k < 12; k++) {
        const t = (k / 12) * Math.PI * 2 - Math.PI / 2 + w.turn + Math.PI / 12;
        ctx.beginPath();
        ctx.moveTo(w.inner * Math.cos(t), w.inner * Math.sin(t));
        ctx.lineTo(w.outer * Math.cos(t), w.outer * Math.sin(t));
        ctx.stroke();
      }
      ctx.globalAlpha = 0.7;
      ctx.fillStyle = color;
      ctx.font = `${11 / s}px serif`;
      for (let k = 0; k < 12; k++) {
        const t = (k / 12) * Math.PI * 2 - Math.PI / 2 + w.turn + Math.PI / 12;
        const r = w.outer + 9 / s;
        ctx.fillText(GLYPHS[k % GLYPHS.length], r * Math.cos(t), r * Math.sin(t));
      }
      ctx.globalAlpha = 1;
      ctx.font = `600 ${10 / s}px system-ui, sans-serif`;
      ctx.fillStyle = color;
      ctx.fillText(w.group.toUpperCase(), 0, w.inner + (w.outer - w.inner) / 2 + 0.5);
    }
    ctx.textAlign = 'left';
  }

  drawPointer(ctx) {
    if (!this.wheels.length) return;
    const outer = this.wheels[this.wheels.length - 1].outer;
    const [cx, cy] = this.toScreen(0, 0);
    const top = cy - outer * this.cam.s;
    ctx.strokeStyle = 'rgba(224, 184, 79, 0.35)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx, cy - this.wheels[0].inner * this.cam.s);
    ctx.lineTo(cx, top - 14);
    ctx.stroke();
    ctx.fillStyle = '#e0b84f';
    ctx.beginPath();
    ctx.moveTo(cx - 8, top - 26);
    ctx.lineTo(cx + 8, top - 26);
    ctx.lineTo(cx, top - 12);
    ctx.closePath();
    ctx.fill();
  }
}
