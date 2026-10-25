/**
 * The small Markdown subset outreach mail may use.
 *
 * The safety argument is the order of operations, not a sanitiser: every
 * character of the member's input is HTML-escaped BEFORE any pattern runs, so
 * nothing they type can become markup. The only tags in the output are ones
 * this module inserted, and the only place member input reaches an attribute
 * is an href whose value had to match an https?:// allowlist to get there.
 *
 * Deliberately no dependency and no HTML parsing -- the subset is small enough
 * that a parser would be more surface than the feature.
 */

export interface RenderedBody {
  text: string;
  html: string;
}

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
};

const MD_LINK = /\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g;
const BARE_URL = /(^|[\s(])(https?:\/\/[^\s<)]+)/g;
const BOLD = /\*\*([^*\n]+)\*\*/g;
const ITALIC = /\*([^*\n]+)\*/g;
const PLACEHOLDER = /\u0000(\d+)\u0000/g;

/**
 * Control characters have no place in mail, and NUL in particular is the
 * marker this module parks anchors behind -- stripping it means member input
 * cannot forge a placeholder.
 */
function stripControls(s: string): string {
  return s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, c => HTML_ESCAPES[c]);
}

export function renderBody(markdown: string): RenderedBody {
  const src = stripControls(markdown);
  return { text: toPlainText(src), html: toHtml(src) };
}

/** Flatten links to "label (url)" and drop emphasis markers, leaving readable prose. */
function toPlainText(src: string): string {
  return src
    .replace(MD_LINK, (_m, label: string, url: string) => label + ' (' + url + ')')
    .replace(BOLD, '$1')
    .replace(ITALIC, '$1');
}

function toHtml(src: string): string {
  let s = escapeHtml(src);

  // Anchors are built first and parked behind placeholders so the bare-URL
  // pass below cannot reach inside an href this pass just created.
  const anchors: string[] = [];
  const park = (html: string) => {
    anchors.push(html);
    return '\u0000' + (anchors.length - 1) + '\u0000';
  };

  s = s.replace(MD_LINK, (_m, label: string, url: string) =>
    park('<a href="' + url + '">' + label + '</a>'));

  s = s.replace(BARE_URL, (_m, lead: string, url: string) =>
    lead + park('<a href="' + url + '">' + url + '</a>'));

  s = s.replace(BOLD, '<strong>$1</strong>');
  s = s.replace(ITALIC, '<em>$1</em>');

  s = blocksToHtml(s);

  s = s.replace(PLACEHOLDER, (_m, i: string) => anchors[Number(i)]);

  return '<html><body>' + s + '</body></html>';
}

function blocksToHtml(s: string): string {
  const out: string[] = [];

  for (const block of s.split(/\n{2,}/)) {
    const lines = block.split('\n').filter(l => l.trim() !== '');
    if (lines.length === 0) continue;

    if (lines.every(l => l.trimStart().startsWith('- '))) {
      const items = lines.map(l => '<li>' + l.trimStart().slice(2).trim() + '</li>').join('');
      out.push('<ul>' + items + '</ul>');
    } else {
      out.push('<p>' + lines.join('<br>') + '</p>');
    }
  }

  return out.join('');
}

/**
 * Inbound mail, rendered for the conversations page.
 *
 * Not renderBody: that one applies Markdown semantics, and a correspondent did
 * not write Markdown. Their literal asterisks would silently become emphasis
 * and their leading dashes a bullet list -- a quiet misquotation of someone
 * else's words.
 *
 * Same safety argument as the rest of this module: escape every character
 * first, then insert only the tags this function produced, with hrefs that had
 * to match the https?:// allowlist to get there.
 */
export function renderPlainWithLinks(text: string): string {
  let s = escapeHtml(stripControls(text));

  const anchors: string[] = [];
  const park = (html: string) => {
    anchors.push(html);
    return '\u0000' + (anchors.length - 1) + '\u0000';
  };

  s = s.replace(BARE_URL, (_m, lead: string, url: string) =>
    lead + park('<a href="' + url + '" target="_blank" rel="noopener noreferrer">' + url + '</a>'));

  const blocks = s.split(/\n{2,}/).filter(block => block.trim() !== '');
  s = blocks.map(block => '<p>' + block.split('\n').join('<br>') + '</p>').join('');

  return s.replace(PLACEHOLDER, (_m, i: string) => anchors[Number(i)]);
}

// A slot in a template for a value someone else wrote (a plan title, a post's
// caption, a reviewer's note). Private-use characters: not controls, so
// stripControls keeps them, and no Markdown pattern above matches them.
const SLOT = /(\d+)/g;

/** Where `values[i]` goes in a template for renderTemplate. */
export const slot = (i: number): string => `${i}`;

/**
 * One line of someone else's text, made inert for mail: control and
 * private-use characters removed, whitespace runs folded to one space, and a
 * zero-width space put inside every `://`, `www.` and dot between two
 * letters or digits, so neither this module nor the reader's mail client
 * turns a URL or a bare domain into a link. The text still reads the same.
 */
export function inertText(value: string): string {
  return stripControls(value)
    .replace(/[-]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/:\/\//g, ':​//')
    .replace(/www\./gi, (m) => `${m.slice(0, 3)}​.`)
    .replace(/([\p{L}\p{N}])\.(?=[\p{L}\p{N}])/gu, '$1.​');
}

/**
 * renderBody for a template the site wrote, with others' values in slots.
 * The template's own Markdown (bold, the panel link) is rendered; each value
 * is put in afterwards as escaped, inert text (inertText), so a value of
 * "[x](https://evil.example)" or a bare URL never becomes a link or markup.
 */
export function renderTemplate(template: string, values: readonly string[]): RenderedBody {
  const src = stripControls(template);
  const fill = (s: string, escape: boolean) =>
    s.replace(SLOT, (_m, i: string) => {
      const text = inertText(values[Number(i)] ?? '');
      return escape ? escapeHtml(text) : text;
    });
  return { text: fill(toPlainText(src), false), html: fill(toHtml(src), true) };
}
