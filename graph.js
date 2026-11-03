// Canvas graph of the vault with four layouts:
//   web     notes pulled together by their links
//   rings   consolidation: new notes in the hippocampus at the center,
//           older ones drifting out toward the cortex
//   wheel   Giordano Bruno's memory wheels: one wheel per top folder, every
//           note in a fixed slot, drag a wheel to turn it
//   tree    the Tree of Life: notes gathered at their sefirah, drawn in the
//           Jewish "within" orientation (Binah, Gevurah, Hod on the left)
// Every layout shares spreading activation (tap a note), forgetting-curve
// dimming, and Hebbian edges that thicken as notes are opened together.
// Dot color is the note's sefirah; a filled dot is the user's note, a hollow
// ring an AI-written one.

import { pairKey } from './state.js';
import { BY_KEY, SEFIROT, NONE_COLOR, drawGlyph } from './sefirot.js';

const DAY = 86400000;
const GROUP_ORDER = ['notes', 'memory', 'knowledge', '.claude'];
// The seven planets around each memory wheel: Sun, Moon, Mercury, Venus,
// Mars, Jupiter, Saturn, drawn as shapes.
const PLANETS = ['tiferet', 'yesod', 'hod', 'netzach', 'gevurah', 'chesed', 'binah'];
export const LAYOUTS = ['web', 'rings', 'wheel', 'tree'];

const INK = {
  ground: '#0b0a13',
  groundHi: '#15121f',
  text: '#ebe4d6',
  muted: '#aaa9b7',
  ivory: '#f1eadc',
  gold: '234, 181, 50',
  line: '170, 169, 183',
};

// Sefirah centers for the Tree view, in world units.
const TREE = {
  keter: [0, 0],
  chokhmah: [300, 170],
  binah: [-300, 170],
  chesed: [300, 520],
  gevurah: [-300, 520],
  tiferet: [0, 700],
  netzach: [300, 1000],
  hod: [-300, 1000],
  yesod: [0, 1180],
  malkhut: [0, 1480],
  none: [-330, 1480],
};
const TREE_R = 44;
// Dots shown per sefirah at the fitted zoom; zooming in shows more. The rest
// merge into a solid disc, weakest memories first.
const TREE_CAP = 40;
const TREE_PATHS = [
  ['keter', 'chokhmah'], ['keter', 'binah'], ['keter', 'tiferet'], ['chokhmah', 'binah'], ['chokhmah', 'chesed'],
  ['chokhmah', 'tiferet'], ['binah', 'gevurah'], ['binah', 'tiferet'], ['chesed', 'gevurah'], ['chesed', 'tiferet'],
  ['chesed', 'netzach'], ['gevurah', 'tiferet'], ['gevurah', 'hod'], ['tiferet', 'netzach'], ['tiferet', 'hod'],
  ['tiferet', 'yesod'], ['netzach', 'hod'], ['netzach', 'yesod'], ['netzach', 'malkhut'], ['hod', 'yesod'],
  ['hod', 'malkhut'], ['yesod', 'malkhut'],
];

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

export function sefirahColor(key) {
  const s = BY_KEY.get(key);
  return s ? s.color : NONE_COLOR;
}

// Fills a dot in its sefirah's color: Binah's black gets a light outline so it
// shows on the dark ground, and Malkhut is quartered in its four colors.
function fillDot(ctx, x, y, r, key, s) {
  const sef = BY_KEY.get(key);
  if (sef && sef.quarters) {
    sef.quarters.forEach((c, i) => {
      ctx.fillStyle = c;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.arc(x, y, r, -Math.PI / 2 + (i * Math.PI) / 2, -Math.PI / 2 + ((i + 1) * Math.PI) / 2);
      ctx.closePath();
      ctx.fill();
    });
  } else {
    ctx.fillStyle = sef ? sef.color : NONE_COLOR;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  if (sef && sef.outline) {
    ctx.lineWidth = 1 / s;
    ctx.strokeStyle = sef.outline;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.stroke();
  }
}

function ringDot(ctx, x, y, r, key, s) {
  const sef = BY_KEY.get(key);
  ctx.fillStyle = INK.ground;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = Math.max(1.4 / s, r * 0.32);
  // Binah's ring stays black with a thin light edge, so it never reads as
  // Chokhmah's grey.
  ctx.strokeStyle = sef ? (sef.outline && !sef.quarters ? sef.color : sef.outline || sef.color) : NONE_COLOR;
  ctx.beginPath();
  ctx.arc(x, y, r - ctx.lineWidth / 2, 0, Math.PI * 2);
  ctx.stroke();
  if (sef && sef.outline && !sef.quarters) {
    ctx.lineWidth = 1 / s;
    ctx.strokeStyle = sef.outline;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.stroke();
  }
}

export function orderGroups(groups) {
  const rank = (g) => (GROUP_ORDER.includes(g) ? GROUP_ORDER.indexOf(g) : GROUP_ORDER.length);
  return [...groups].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}

export class GraphView {
  constructor(canvas, { onSelect, onOpen, onAligned, onMass } = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.onSelect = onSelect || (() => {});
    this.onOpen = onOpen || (() => {});
    this.onAligned = onAligned || (() => {});
    this.onMass = onMass || (() => {});
    this.treeGroups = new Map();
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
    this.filter = null;
    this.hiddenCount = 0;
    this.bindEvents();
    new ResizeObserver(() => this.resize()).observe(canvas.parentElement);
  }

  // Builds nodes and edges from the vault and the usage state. Positions of
  // notes already on screen are kept so a rebuild does not scramble the view.
  setData(vault, state, now = Date.now()) {
    this.state = state;
    const old = this.byPath;
    const all = [...vault.notes.values()];
    const notes = (this.filter ? all.filter(this.filter) : all).sort((a, b) => a.group.localeCompare(b.group) || hash(a.path) - hash(b.path));
    this.hiddenCount = all.length - notes.length;
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
        sefirah: n.sefirah || null,
        author: n.author || 'ai',
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
    if (!LAYOUTS.includes(name)) name = 'web';
    this.layout = name;
    this.applyLayout(false);
  }

  // Tree: each note sits in a small spiral around its sefirah; notes with no
  // sefirah gather beside Malkhut.
  layoutTree() {
    const by = new Map();
    for (const n of this.nodes) {
      const k = n.sefirah && TREE[n.sefirah] ? n.sefirah : 'none';
      if (!by.has(k)) by.set(k, []);
      by.get(k).push(n);
    }
    this.treeCounts = new Map([...by].map(([k, list]) => [k, list.length]));
    this.treeGroups = new Map();
    for (const n of this.nodes) n.rank = -1;
    for (const [k, list] of by) {
      const [cx, cy] = TREE[k];
      // Strongest memories sit nearest their sefirah; the weakest are the
      // first to merge into its disc.
      list.sort((p, q) => q.strength - p.strength || q.degree - p.degree || hash(p.path) - hash(q.path));
      const start = k === 'none' ? 8 : TREE_R + 12;
      // Big sefirot pack tighter so a crowded one stays clear of its neighbors.
      const step = list.length > 120 ? 7 : 9;
      this.treeGroups.set(k, { cx, cy, start, step, list });
      list.forEach((n, i) => {
        n.rank = i;
        const r = start + step * Math.sqrt(i + 1);
        const t = i * 2.39996;
        n.tx = cx + r * Math.cos(t);
        n.ty = cy + r * Math.sin(t);
      });
    }
  }

  applyLayout(fresh) {
    if (this.layout === 'web') {
      this.alpha = fresh ? 1 : 0.3;
      if (fresh) for (let i = 0; i < 400 && this.alpha > 0.02; i++) this.tick();
      else this.refitWhenSettled = true;
      for (const n of this.nodes) {
        n.tx = n.x;
        n.ty = n.y;
      }
    } else {
      this.alpha = 0;
      if (this.layout === 'rings') this.layoutRings();
      else if (this.layout === 'tree') this.layoutTree();
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
    if (this.layout === 'tree') {
      for (const s of SEFIROT) {
        const [x, y] = TREE[s.key];
        pts.push([x - TREE_R - 20, y - TREE_R - 20], [x + TREE_R + 20, y + TREE_R + 40]);
      }
      // Room for the layout tabs above Keter and the Key and + button below Malkhut.
      pts.push([0, TREE.keter[1] - TREE_R - 150], [0, TREE.malkhut[1] + TREE_R + 170]);
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
    if (this.layout === 'tree') this.treeFit = s;
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

  // How many dots each sefirah shows at the current zoom.
  treeCap() {
    const fit = this.treeFit || this.cam.s;
    return Math.max(TREE_CAP, Math.floor(TREE_CAP * Math.pow(this.cam.s / fit, 2)));
  }

  massed(n) {
    return this.layout === 'tree' && n.rank >= this.treeCap();
  }

  // Ring of world space a sefirah's disc covers, or null when nothing is merged.
  massRing(k) {
    const g = this.treeGroups.get(k);
    const cap = this.treeCap();
    if (!g || g.list.length <= cap) return null;
    const inner = g.start + g.step * Math.sqrt(cap + 0.5);
    // At least about 24 px wide on screen, so it can always be tapped.
    const outer = Math.max(g.start + g.step * Math.sqrt(g.list.length) + 5, inner + 24 / this.cam.s);
    return { g, inner, outer, hidden: g.list.length - cap };
  }

  massAt(sx, sy) {
    if (this.layout !== 'tree') return null;
    const [x, y] = this.toWorld(sx, sy);
    for (const k of this.treeGroups.keys()) {
      const m = this.massRing(k);
      if (!m) continue;
      const d = Math.hypot(x - m.g.cx, y - m.g.cy);
      if (d >= m.inner && d <= m.outer + 4) return k;
    }
    return null;
  }

  massedNodes(k) {
    const g = this.treeGroups.get(k);
    return g ? g.list.slice(this.treeCap()) : [];
  }

  hit(sx, sy) {
    let best = null;
    let bestD = 18;
    for (const n of this.nodes) {
      if (this.massed(n)) continue;
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
      const mass = this.massAt(g.x, g.y);
      const n = mass ? null : this.hit(g.x, g.y);
      if (mass) this.onMass(mass);
      else if (!n) this.clearSelection();
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
      if (this.layout === 'web' && this.refitWhenSettled) {
        this.refitWhenSettled = false;
        this.fit(false);
        busy = true;
      }
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
    bg.addColorStop(0, INK.groundHi);
    bg.addColorStop(1, INK.ground);
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, this.w, this.h);

    ctx.setTransform(this.dpr * s, 0, 0, this.dpr * s, this.dpr * (this.w / 2 - this.cam.x * s), this.dpr * (this.h / 2 - this.cam.y * s));
    if (this.layout === 'rings') this.drawRings(ctx, s);
    if (this.layout === 'wheel') this.drawWheels(ctx, s);
    if (this.layout === 'tree') {
      this.drawTree(ctx, s);
      this.drawMasses(ctx, s);
    }

    const acts = new Map();
    for (const n of this.act.keys()) acts.set(n, this.actAt(n, t));
    const actOf = (n) => acts.get(n) || 0;

    // On the Tree the sefirot paths carry the structure, so note links stay quieter.
    const quiet = this.layout === 'tree' ? 0.45 : 1;
    for (const e of this.edges) {
      if (this.massed(e.a) || this.massed(e.b)) continue;
      const fade = Math.min(e.a.strength, e.b.strength) * quiet;
      const width = (1 + Math.log2(1 + e.w) * 1.3) / s;
      ctx.lineWidth = width;
      ctx.setLineDash(e.linked ? [] : [5 / s, 4 / s]);
      ctx.strokeStyle = e.w > 0 ? `rgba(${INK.gold}, ${0.18 + 0.3 * fade})` : `rgba(${INK.line}, ${0.1 + 0.25 * fade})`;
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
      if (this.massed(n)) continue;
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
      if (n.author === 'user') fillDot(ctx, n.x, n.y, r, n.sefirah, s);
      else ringDot(ctx, n.x, n.y, r, n.sefirah, s);
      // The sign shows inside the dot once it is big enough to read.
      if (n.sefirah && r * s >= 9) {
        const sef = BY_KEY.get(n.sefirah);
        const ink = n.author === 'user' ? (sef.outline ? sef.outline : INK.ground) : sef.outline || sef.color;
        drawGlyph(ctx, n.sefirah, n.x, n.y, r * 1.25, ink, 2.2);
      }
      ctx.globalAlpha = 1;
      if (n === this.selected || n === this.hovered) {
        ctx.lineWidth = 2 / s;
        ctx.strokeStyle = INK.ivory;
        ctx.beginPath();
        ctx.arc(n.x, n.y, r + 2 / s, 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    if (this.layout === 'tree') this.drawTreeMarks(ctx, s);
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    if (this.layout === 'wheel') this.drawPointer(ctx);
    this.drawLabels(ctx, actOf);
  }

  drawLabels(ctx, actOf) {
    const { s } = this.cam;
    const picks = [];
    const neighbors = this.selected ? new Set(this.adj.get(this.selected)) : new Set();
    for (const n of this.nodes) {
      if (this.massed(n)) continue;
      let p = 0;
      if (n === this.selected || n === this.hovered) p = 3;
      else if (neighbors.has(n)) p = 2;
      else if (actOf(n) > 0.2) p = 1.5;
      else if (n.radius * s > 7) p = 1;
      if (p) picks.push([p, n]);
    }
    picks.sort((a, b) => b[0] - a[0] || b[1].degree - a[1].degree);
    ctx.font = '14px Inter, system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    for (const [p, n] of picks.slice(0, 40)) {
      const [x, y] = this.toScreen(n.x, n.y);
      const text = n.title.length > 32 ? n.title.slice(0, 31) + '…' : n.title;
      const tx = x + n.radius * s + 6;
      ctx.globalAlpha = p >= 2 ? 1 : 0.75;
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(11, 10, 19, 0.85)';
      ctx.strokeText(text, tx, y);
      ctx.fillStyle = p >= 2 ? INK.ivory : INK.text;
      ctx.fillText(text, tx, y);
    }
    ctx.globalAlpha = 1;
  }

  drawRings(ctx, s) {
    ctx.lineWidth = 1 / s;
    const core = ctx.createRadialGradient(0, 0, 0, 0, 0, CORE);
    core.addColorStop(0, `rgba(${INK.gold}, 0.16)`);
    core.addColorStop(1, `rgba(${INK.gold}, 0.02)`);
    ctx.fillStyle = core;
    ctx.beginPath();
    ctx.arc(0, 0, CORE, 0, Math.PI * 2);
    ctx.fill();
    ctx.font = `${14 / s}px Inter, system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    RING_BANDS.forEach((band, i) => {
      const outer = CORE + i * BAND;
      ctx.strokeStyle = i === RING_BANDS.length - 1 ? `rgba(${INK.line}, 0.35)` : `rgba(${INK.line}, 0.18)`;
      ctx.beginPath();
      ctx.arc(0, 0, outer, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = `rgba(${INK.line}, 0.75)`;
      ctx.fillText(band.label, 0, -outer + 12 / s);
    });
    ctx.fillStyle = INK.text;
    ctx.font = `${14 / s}px Cinzel, serif`;
    ctx.textBaseline = 'middle';
    ctx.fillText('HIPPOCAMPUS', 0, CORE * 0.55);
    ctx.fillText('CORTEX', 0, CORE + (RING_BANDS.length - 1) * BAND + 16 / s);
    ctx.textAlign = 'left';
  }

  drawWheels(ctx, s) {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const w of this.wheels) {
      const color = INK.muted;
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
      for (let k = 0; k < 12; k++) {
        const t = (k / 12) * Math.PI * 2 - Math.PI / 2 + w.turn + Math.PI / 12;
        const r = w.outer + 9 / s;
        drawGlyph(ctx, PLANETS[k % PLANETS.length], r * Math.cos(t), r * Math.sin(t), 11 / s, color, 1.8);
      }
      ctx.globalAlpha = 1;
      ctx.font = `${12 / s}px Cinzel, serif`;
      ctx.fillStyle = INK.text;
      ctx.fillText(w.group.toUpperCase(), 0, w.inner + (w.outer - w.inner) / 2 + 0.5);
    }
    ctx.textAlign = 'left';
  }

  // Each crowded sefirah's weaker notes as one solid disc in its color.
  drawMasses(ctx, s) {
    for (const k of this.treeGroups.keys()) {
      const m = this.massRing(k);
      if (!m) continue;
      const sef = BY_KEY.get(k);
      const { cx, cy } = m.g;
      ctx.beginPath();
      ctx.arc(cx, cy, m.outer, 0, Math.PI * 2);
      ctx.arc(cx, cy, Math.max(TREE_R, m.inner - 6), 0, Math.PI * 2, true);
      const grad = ctx.createRadialGradient(cx, cy, m.inner, cx, cy, m.outer);
      const c = sef ? (sef.quarters ? sef.quarters[0] : sef.color) : NONE_COLOR;
      grad.addColorStop(0, c + '26');
      grad.addColorStop(0.35, c + '8c');
      grad.addColorStop(1, c + 'b3');
      ctx.fillStyle = grad;
      ctx.fill();
      if (sef && sef.outline) {
        ctx.lineWidth = 1.2 / s;
        ctx.strokeStyle = sef.outline;
        ctx.beginPath();
        ctx.arc(cx, cy, m.outer, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
  }

  // The 22 paths go under the notes.
  drawTree(ctx, s) {
    ctx.lineWidth = 1.5 / s;
    ctx.strokeStyle = `rgba(${INK.line}, 0.22)`;
    for (const [a, b] of TREE_PATHS) {
      ctx.beginPath();
      ctx.moveTo(TREE[a][0], TREE[a][1]);
      ctx.lineTo(TREE[b][0], TREE[b][1]);
      ctx.stroke();
    }
  }

  // The sefirot, their names and counts go over the notes, so a crowded
  // sefirah never buries its own label.
  drawTreeMarks(ctx, s) {
    const halo = (text, x, y) => {
      ctx.lineWidth = 4 / s;
      ctx.strokeStyle = 'rgba(11, 10, 19, 0.9)';
      ctx.strokeText(text, x, y);
      ctx.fillText(text, x, y);
    };
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    const counts = this.treeCounts || new Map();
    for (const sef of SEFIROT) {
      const [x, y] = TREE[sef.key];
      const ink = sef.outline || sef.color;
      ctx.fillStyle = INK.ground;
      ctx.beginPath();
      ctx.arc(x, y, TREE_R, 0, Math.PI * 2);
      ctx.fill();
      ctx.lineWidth = 2 / s;
      ctx.strokeStyle = ink;
      ctx.stroke();
      drawGlyph(ctx, sef.key, x, y, TREE_R * 1.1, ink, 1.6);
      ctx.fillStyle = INK.text;
      ctx.font = `${16 / s}px Cinzel, serif`;
      halo(sef.name.toUpperCase(), x, y + TREE_R + 8 / s);
      ctx.fillStyle = INK.muted;
      ctx.font = `${14 / s}px Inter, system-ui, sans-serif`;
      halo(`${sef.short} · ${counts.get(sef.key) || 0}`, x, y + TREE_R + 28 / s);
    }
    if (counts.get('none')) {
      const [x, y] = TREE.none;
      ctx.fillStyle = INK.muted;
      ctx.font = `${14 / s}px Inter, system-ui, sans-serif`;
      halo(`Unsorted · ${counts.get('none')}`, x, y + 60);
    }
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
  }

  drawPointer(ctx) {
    if (!this.wheels.length) return;
    const outer = this.wheels[this.wheels.length - 1].outer;
    const [cx, cy] = this.toScreen(0, 0);
    const top = cy - outer * this.cam.s;
    ctx.strokeStyle = `rgba(${INK.gold}, 0.35)`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx, cy - this.wheels[0].inner * this.cam.s);
    ctx.lineTo(cx, top - 14);
    ctx.stroke();
    ctx.fillStyle = `rgb(${INK.gold})`;
    ctx.beginPath();
    ctx.moveTo(cx - 8, top - 26);
    ctx.lineTo(cx + 8, top - 26);
    ctx.lineTo(cx, top - 12);
    ctx.closePath();
    ctx.fill();
  }
}
