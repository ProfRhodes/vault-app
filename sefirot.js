// The ten sefirot as the vault's categories. Meanings follow Jewish Kabbalah;
// colors (the Golden Dawn Queen scale, set for a dark screen) and signs follow
// the Golden Dawn. Sources: knowledge/kabbalah/sefirot-correspondences.md in
// the vault. Decisions: STYLE_BIBLE.md.
//
// Each note gets one sefirah: a "sephira:" line in its frontmatter wins
// ("sephira: hod" or "sephira: hod, tiferet" for a second), otherwise its
// folder decides. .vault/sefirot.json in the vault can replace the folder
// lists, and tells AI agents how to tag the notes they write.

export const SEFIROT_PATH = '.vault/sefirot.json';

// Paths are drawn in a 24 x 24 box with round strokes, never as text
// characters, because Android turns the planet characters into emoji.
const CIRCLE = (cx, cy, r) => `M${cx + r} ${cy}a${r} ${r} 0 1 1 ${-2 * r} 0a${r} ${r} 0 1 1 ${2 * r} 0`;
const spokes = () => {
  let d = '';
  for (let k = 0; k < 12; k++) {
    const t = (k / 12) * Math.PI * 2;
    const p = (r) => `${(12 + r * Math.cos(t)).toFixed(2)} ${(12 + r * Math.sin(t)).toFixed(2)}`;
    d += `M${p(5)}L${p(9)}`;
  }
  return d;
};

export const SEFIROT = [
  {
    key: 'keter', name: 'Keter', short: 'purpose and goals', sign: 'the first swirlings',
    meaning: 'Crown. Purpose, goals, the big why behind a project or a life.',
    color: '#eeedf5', folders: ['notes/purpose'],
    glyph: 'M12 12a1.5 1.5 0 0 1 3 0a3 3 0 0 1-6 0a4.5 4.5 0 0 1 9 0a6 6 0 0 1-12 0a7.5 7.5 0 0 1 15 0',
  },
  {
    key: 'chokhmah', name: 'Chokhmah', short: 'raw ideas', sign: 'the zodiac',
    meaning: 'Wisdom. Sparks: raw ideas and first flashes, before they have a form.',
    color: '#b1b0b7', folders: ['notes/ideas'],
    glyph: CIRCLE(12, 12, 9) + CIRCLE(12, 12, 5) + spokes(),
  },
  {
    key: 'binah', name: 'Binah', short: 'research and plans', sign: 'Saturn',
    meaning: 'Understanding. Study turned into structure: research, distilled sources, plans, budgets.',
    color: '#1a1a1f', outline: '#a4a4ab', folders: ['knowledge/board-knowledge', 'knowledge/kabbalah', 'notes/plans'],
    glyph: 'M8 3v15M5 6h6M8 11c2-3 8-3 8 1c0 3-4 4-3 7c0.5 1.5 2 2 3 1.5',
  },
  {
    key: 'chesed', name: 'Chesed', short: 'wealth and giving', sign: 'Jupiter',
    meaning: 'Kindness. Giving and wealth: income, generosity, charity, hospitality.',
    color: '#4693f1', folders: ['notes/money'],
    glyph: 'M5 7c0-3 6-3.5 6 0c0 3-4 6-6 9h14M16 4v17',
  },
  {
    key: 'gevurah', name: 'Gevurah', short: 'strength and rules', sign: 'Mars',
    meaning: 'Strength. Discipline and rules: exercise, security, the rulings given to Claude.',
    color: '#e6443d', folders: ['notes/exercise', '.claude/skills', 'CLAUDE.md', 'AGENTS.md'],
    glyph: CIRCLE(10, 14, 5.5) + 'M14 10L20 4M14.5 4H20v5.5',
  },
  {
    key: 'tiferet', name: 'Tiferet', short: 'teaching and self', sign: 'the Sun',
    meaning: 'Beauty. Teaching (giving knowledge) and the self: lessons, reflection.',
    color: '#f0c630', folders: ['knowledge/education', 'notes/teaching'],
    glyph: CIRCLE(12, 12, 8.5) + CIRCLE(12, 12, 1.2),
  },
  {
    key: 'netzach', name: 'Netzach', short: 'art and play', sign: 'Venus',
    meaning: 'Victory. Art and play: content, design, games, Instagram.',
    color: '#2bbb71', folders: ['knowledge/design', 'knowledge/game-dev', 'knowledge/content', 'roblox-game'],
    glyph: CIRCLE(12, 8.5, 5.5) + 'M12 14v8M8.5 18.5h7',
  },
  {
    key: 'hod', name: 'Hod', short: 'learning and code', sign: 'Mercury',
    meaning: 'Splendour. Learning (receiving knowledge), science, code.',
    color: '#f28f29', folders: ['knowledge/technology-research', 'notes/learning'],
    glyph: 'M8 2.5a4 4 0 0 0 8 0' + CIRCLE(12, 10.5, 4.5) + 'M12 15v7M9 18.5h6',
  },
  {
    key: 'yesod', name: 'Yesod', short: 'dreams and memory', sign: 'the Moon',
    meaning: 'Foundation. Dreams, imagination and memory, including the memory files Claude keeps.',
    color: '#a064db', folders: ['memory', 'notes/dreams'],
    glyph: 'M10 3a9 9 0 1 1 0 18a12 12 0 0 0 0-18z',
  },
  {
    key: 'malkhut', name: 'Malkhut', short: 'speech and daily life', sign: 'the four elements',
    meaning: 'Kingship. Speech and daily life: public speaking, bills, errands, the physical world.',
    color: '#c1bb6d', quarters: ['#c1bb6d', '#74814a', '#a15d3e', '#1a1a1f'], outline: '#a4a4ab',
    folders: ['notes/speaking', 'notes/life'],
    glyph: CIRCLE(12, 12, 9) + 'M12 3v18M3 12h18',
  },
];

export const BY_KEY = new Map(SEFIROT.map((s) => [s.key, s]));
export const NONE_COLOR = '#636269';

// Other common spellings people and agents may write in a sephira: line.
const ALIASES = {
  kether: 'keter', chokmah: 'chokhmah', hokhmah: 'chokhmah', chochmah: 'chokhmah', hesed: 'chesed',
  geburah: 'gevurah', gevurah: 'gevurah', tiphareth: 'tiferet', tipheret: 'tiferet', tiferes: 'tiferet',
  netzah: 'netzach', malkuth: 'malkhut', malchut: 'malkhut', malkut: 'malkhut',
};

// Reads the first word only, so "Hod (learning)" still means Hod.
export const sefirahKey = (word) => {
  const first = String(word || '').trim().toLowerCase().match(/[a-z']+/);
  const w = first ? first[0].replace(/'/g, '') : '';
  if (BY_KEY.has(w)) return w;
  return ALIASES[w] || null;
};

// What gets written to .vault/sefirot.json, so agents on every machine know
// the categories and how to tag what they write.
export function defaultConfig() {
  return {
    version: 1,
    instructions:
      'Every note in this vault belongs to one of the ten sefirot below, chosen by meaning. ' +
      'When you write or edit a note, add frontmatter lines "sephira: <key>" (optionally a second after a comma, ' +
      'for example "sephira: hod, tiferet") and "author: ai". Notes without a sephira line fall back to the folders listed here.',
    sefirot: SEFIROT.map(({ key, name, meaning, folders }) => ({ key, name, meaning, folders })),
  };
}

// Folder lists from the vault's own file replace the built-in ones.
export function folderMap(config) {
  const map = [];
  const list = config && Array.isArray(config.sefirot) ? config.sefirot : defaultConfig().sefirot;
  for (const s of list) {
    const key = sefirahKey(s.key);
    if (!key || !Array.isArray(s.folders)) continue;
    for (const f of s.folders) if (typeof f === 'string' && f) map.push([f.replace(/\/+$/, ''), key]);
  }
  // Longest prefix first, so notes/plans beats notes.
  return map.sort((a, b) => b[0].length - a[0].length);
}

const USER_FOLDERS = ['notes', 'roblox-game'];
// Any of these words anywhere in an author line means an AI wrote it
// ("Claude Code", "claude-code", "gpt-4", "codex").
const AI_WORDS = /\b(ai|claude|agent|bot|assistant|gpt|codex|llm|gemini|copilot|jarvis)/;

export function classify(note, folders) {
  const words = String(note.meta.sephira || note.meta.sefirah || '')
    .split(/[,;/]+/)
    .map(sefirahKey)
    .filter(Boolean);
  let sefirah = words[0] || null;
  const second = words.find((w) => w !== sefirah) || null;
  if (!sefirah) {
    const hit = folders.find(([f]) => note.path === f || note.path.startsWith(f + '/'));
    sefirah = hit ? hit[1] : null;
  }
  const said = String(note.meta.author || '').trim().toLowerCase();
  let author;
  if (said) author = AI_WORDS.test(said) ? 'ai' : 'user';
  else author = USER_FOLDERS.some((f) => note.path.startsWith(f + '/')) ? 'user' : 'ai';
  return { sefirah, second, author };
}

const FRONT = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(\r?\n|$)/;
const SEPH_LINE = /^\s*(sephira|sefirah)\s*:/i;

export const sephiraValue = (main, second) => (main ? (second && second !== main ? `${main}, ${second}` : main) : '');

// The note's sephira line as [main, second], read from its raw text.
export function readSephira(text) {
  const m = String(text).match(FRONT);
  if (!m) return [null, null];
  const line = m[1].split(/\r?\n/).find((l) => SEPH_LINE.test(l));
  if (!line) return [null, null];
  const words = line.replace(SEPH_LINE, '').split(/[,;/]+/).map(sefirahKey).filter(Boolean);
  return [words[0] || null, words.find((w) => w !== words[0]) || null];
}

// Sets, replaces or removes the sephira line in a note's frontmatter, adding
// the frontmatter block when the note has none.
export function writeSephira(text, main, second) {
  const value = sephiraValue(main, second);
  const m = String(text).match(FRONT);
  if (!m) return value ? `---\nsephira: ${value}\n---\n\n${text}` : text;
  const lines = m[1].split(/\r?\n/);
  const at = lines.findIndex((l) => SEPH_LINE.test(l));
  if (value && at >= 0) lines[at] = `sephira: ${value}`;
  else if (value) lines.push(`sephira: ${value}`);
  else if (at >= 0) lines.splice(at, 1);
  const rest = text.slice(m[0].length);
  if (!lines.some((l) => l.trim())) return rest.replace(/^\r?\n/, '');
  return `---\n${lines.join('\n')}\n---${m[2] || '\n'}${rest}`;
}

export function glyphSvg(key, size = 24, color = 'currentColor', width = 1.6) {
  const s = BY_KEY.get(key);
  if (!s) return '';
  return (
    `<svg class="glyph" viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true">` +
    `<path d="${s.glyph}" fill="none" stroke="${color}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"/></svg>`
  );
}

const PATHS = new Map();
// Draws a sign centered at (x, y), size units across, in canvas units.
export function drawGlyph(ctx, key, x, y, size, color, width = 1.6) {
  const s = BY_KEY.get(key);
  if (!s) return;
  if (!PATHS.has(key)) PATHS.set(key, new Path2D(s.glyph));
  ctx.save();
  ctx.translate(x - size / 2, y - size / 2);
  ctx.scale(size / 24, size / 24);
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = color;
  ctx.stroke(PATHS.get(key));
  ctx.restore();
}
