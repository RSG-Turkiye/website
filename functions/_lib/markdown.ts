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
