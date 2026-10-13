/** What the post will look like on each platform (spec §2: live preview). */
import { captionFor } from '../../../functions/_lib/social-limits';
import type { ComposerState } from './composer';
import { deps } from './context';
import { esc } from './ui';

export type PreviewKind = 'instagram' | 'story' | 'linkedin';

function source(s: ComposerState) {
  return { caption: s.caption, captionOverrides: s.overrides, link: s.link.trim() || null };
}

/** A style attribute value: the URL is percent-encoded (no quote can survive) and quoted, then escaped for the attribute. */
export function bgImage(url: string): string {
  return esc(`background-image:url("${encodeURI(url)}")`);
}

export function renderPreview(s: ComposerState, which: PreviewKind): string {
  const { t } = deps();
  const img = s.media[0];
  const picture = (ratio: string) => img
    ? `<div class="w-full ${ratio} bg-gray-200 bg-center bg-cover" style="${bgImage(img.url)}" role="img" aria-label="${esc(img.alt)}"></div>`
    : `<div class="w-full ${ratio} bg-gray-100 flex items-center justify-center text-xs text-gray-500">${esc(t('admin.social.composer.noImage'))}</div>`;
  if (which === 'story') {
    return `<div class="w-56 mx-auto rounded-xl overflow-hidden bg-gray-800">${picture('aspect-[9/16]')}</div>
      <p class="text-xs text-gray-500 mt-2">${esc(t('admin.social.composer.storyNoCaption'))}</p>`;
  }
  if (which === 'linkedin') {
    const text = captionFor(source(s), 'linkedin');
    const link = s.link.trim();
    const body = link && text.endsWith(link)
      ? `${esc(text.slice(0, text.length - link.length))}<span class="text-[#0a66c2] font-semibold">${esc(link)}</span>`
      : esc(text);
    return `<div class="rounded-lg border border-gray-200 bg-white text-sm">
      <div class="p-3 font-semibold text-navy">ISCB-SC RSG-Türkiye</div>
      <div class="px-3 pb-2 whitespace-pre-wrap break-words">${body}</div>${picture('aspect-[1.91/1]')}</div>`;
  }
  const text = captionFor(source(s), 'instagram');
  const chars = [...text];
  const short = chars.length > 125 ? `${esc(chars.slice(0, 125).join(''))}<span class="text-gray-500">${esc(t('admin.social.composer.more'))}</span>` : esc(text);
  const dots = s.media.length > 1 ? `<div class="text-center text-xs text-gray-500 pt-1">${s.media.map((_, i) => (i === 0 ? '●' : '○')).join(' ')}</div>` : '';
  return `<div class="rounded-lg border border-gray-200 bg-white text-sm">
    <div class="p-2 font-semibold">rsgturkey</div>${picture('aspect-[4/5]')}${dots}
    <div class="p-2 whitespace-pre-wrap break-words"><strong>rsgturkey</strong> ${short}</div></div>`;
}
