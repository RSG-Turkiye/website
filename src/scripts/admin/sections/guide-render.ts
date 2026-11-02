import { escapeHtml } from '../../escape-html';

/**
 * A guide suggestion's whole text and link, for the Suggestions tab: line
 * breaks kept (a page change is a list of lines), everything escaped, and the
 * link clickable only when it is http(s). No DOM, so node tests can use it.
 */
export function suggestionBody(text: string | undefined, link: string | undefined): string {
  const body = text ? `<p class="text-sm text-gray-700 whitespace-pre-line break-words">${escapeHtml(text)}</p>` : '';
  const url = (link ?? '').trim();
  const a = !url ? '' : /^https?:\/\//i.test(url)
    ? `<a href="${escapeHtml(url)}" rel="noopener noreferrer" target="_blank" class="text-sm text-navy-mid hover:text-navy break-all">${escapeHtml(url)} ↗</a>`
    : `<p class="text-sm text-gray-500 break-all">${escapeHtml(url)}</p>`;
  return body || a ? `<div class="flex flex-col gap-1 px-4 lg:px-3 pb-3 -mt-1">${body}${a}</div>` : '';
}
