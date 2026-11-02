// Minimal markdown renderer for vault notes.
// All note text is HTML-escaped before any markup is added, so a note can
// never inject its own HTML or scripts.

export function escapeHtml(s) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function unescapeHtml(s) {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

// Reads the top-level "key: value" lines of a YAML frontmatter block.
// Nested keys (like metadata.type) are picked up too, first one wins.
export function splitFrontmatter(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---[ \t]*(\r?\n|$)/);
  if (!m) return { meta: {}, body: text };
  const meta = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^\s*([A-Za-z_][\w-]*):\s*(.*)$/);
    if (!kv || kv[2] === '' || kv[1] in meta) continue;
    let value = kv[2].trim();
    if (/^".*"$/.test(value)) value = value.slice(1, -1).replace(/\\"/g, '"');
    else if (/^'.*'$/.test(value)) value = value.slice(1, -1);
    meta[kv[1]] = value;
  }
  return { meta, body: text.slice(m[0].length) };
}

const LIST = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
const FENCE = /^\s*```/;
const HEADING = /^(#{1,6})\s+(.*)$/;
const RULE = /^\s*(-{3,}|\*{3,}|_{3,})\s*$/;
const QUOTE = /^\s*>/;

const isBlank = (l) => /^\s*$/.test(l);
const cells = (l) => l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());

function isTableStart(lines, i) {
  if (!lines[i].includes('|') || i + 1 >= lines.length) return false;
  const delim = cells(lines[i + 1]);
  return lines[i + 1].includes('-') && delim.every((c) => /^:?-{3,}:?$/.test(c));
}

function startsBlock(lines, i) {
  const l = lines[i];
  return FENCE.test(l) || HEADING.test(l) || RULE.test(l) || QUOTE.test(l) || LIST.test(l) || isTableStart(lines, i);
}

// ctx.wikilink(target, label) and ctx.mdlink(url, label) return the HTML for
// internal links. Both receive already-escaped text.
function inline(text, ctx) {
  let s = escapeHtml(text);
  const codes = [];
  s = s.replace(/`([^`]+)`/g, (_, c) => {
    codes.push(c);
    return `\u0000${codes.length - 1}\u0000`;
  });
  s = s.replace(/\[\[([^\]|]+?)(?:\|([^\]]+))?\]\]/g, (_, target, label) =>
    ctx.wikilink(target.trim(), (label || target).trim())
  );
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label, url) => {
    if (/^https?:\/\//i.test(url)) return `<a href="${url}" target="_blank" rel="noopener noreferrer">${label}</a>`;
    if (/\.md$/i.test(unescapeHtml(url).split('#')[0])) return ctx.mdlink(url, label);
    return label;
  });
  s = s.replace(/(^|\s)(https?:\/\/[^\s<]+)/g, '$1<a href="$2" target="_blank" rel="noopener noreferrer">$2</a>');
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^*\w])\*([^*\s][^*]*?)\*(?!\*)/g, '$1<em>$2</em>');
  s = s.replace(/\u0000(\d+)\u0000/g, (_, k) => `<code>${codes[+k]}</code>`);
  return s;
}

function listItem(text, ctx) {
  const task = text.match(/^\[( |x|X)\]\s+(.*)$/);
  if (!task) return inline(text, ctx);
  const checked = task[1] === ' ' ? '' : ' checked';
  return `<input type="checkbox" disabled${checked}> ${inline(task[2], ctx)}`;
}

function parseList(lines, i, ctx) {
  const first = lines[i].match(LIST);
  const indent = first[1].length;
  const ordered = /\d/.test(first[2]);
  const items = [];
  while (i < lines.length) {
    if (isBlank(lines[i])) {
      let j = i;
      while (j < lines.length && isBlank(lines[j])) j++;
      const next = j < lines.length && lines[j].match(LIST);
      if (next && next[1].length >= indent) {
        i = j;
        continue;
      }
      break;
    }
    const m = lines[i].match(LIST);
    if (!m || m[1].length < indent) break;
    if (m[1].length > indent && items.length) {
      const [html, next] = parseList(lines, i, ctx);
      items[items.length - 1] += html;
      i = next;
      continue;
    }
    if (/\d/.test(m[2]) !== ordered) break;
    let text = m[3];
    i++;
    while (i < lines.length && !isBlank(lines[i]) && !LIST.test(lines[i]) && /^\s+/.test(lines[i])) {
      text += ' ' + lines[i++].trim();
    }
    items.push(listItem(text, ctx));
  }
  const tag = ordered ? 'ol' : 'ul';
  return [`<${tag}>${items.map((x) => `<li>${x}</li>`).join('')}</${tag}>`, i];
}

function parseTable(lines, i, ctx) {
  const head = cells(lines[i]);
  i += 2;
  const rows = [];
  while (i < lines.length && lines[i].includes('|') && !isBlank(lines[i])) rows.push(cells(lines[i++]));
  const th = head.map((c) => `<th>${inline(c, ctx)}</th>`).join('');
  const body = rows.map((r) => `<tr>${r.map((c) => `<td>${inline(c, ctx)}</td>`).join('')}</tr>`).join('');
  return [`<div class="table-wrap"><table><thead><tr>${th}</tr></thead><tbody>${body}</tbody></table></div>`, i];
}

export function renderMarkdown(body, ctx) {
  const lines = body.replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (isBlank(line)) {
      i++;
      continue;
    }
    if (FENCE.test(line)) {
      const buf = [];
      i++;
      while (i < lines.length && !FENCE.test(lines[i])) buf.push(lines[i++]);
      i++;
      out.push(`<pre><code>${escapeHtml(buf.join('\n'))}</code></pre>`);
      continue;
    }
    const h = line.match(HEADING);
    if (h) {
      const n = h[1].length;
      out.push(`<h${n}>${inline(h[2].replace(/\s+#+\s*$/, ''), ctx)}</h${n}>`);
      i++;
      continue;
    }
    if (RULE.test(line)) {
      out.push('<hr>');
      i++;
      continue;
    }
    if (QUOTE.test(line)) {
      const buf = [];
      while (i < lines.length && QUOTE.test(lines[i])) buf.push(lines[i++].replace(/^\s*>\s?/, ''));
      out.push(`<blockquote>${renderMarkdown(buf.join('\n'), ctx)}</blockquote>`);
      continue;
    }
    if (isTableStart(lines, i)) {
      const [html, next] = parseTable(lines, i, ctx);
      out.push(html);
      i = next;
      continue;
    }
    if (LIST.test(line)) {
      const [html, next] = parseList(lines, i, ctx);
      out.push(html);
      i = next;
      continue;
    }
    const buf = [line.trim()];
    i++;
    while (i < lines.length && !isBlank(lines[i]) && !startsBlock(lines, i)) buf.push(lines[i++].trim());
    out.push(`<p>${inline(buf.join(' '), ctx)}</p>`);
  }
  return out.join('\n');
}
