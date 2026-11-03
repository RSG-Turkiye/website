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

/**
 * The notice an approver sends with a removal (functions/_lib/guide-removal-notice.ts):
 * Turkish then English, the person's title and name, and how to undo a false alarm.
 */
export function removalNoticeTemplate(title: string, name: string): { subject: string; text: string } {
  const who = `${title} ${name}`.trim();
  return {
    subject: 'RSG-Türkiye Lisansüstü Rehberi: kaydınız kaldırıldı / Your entry was removed',
    text: [
      `Sayın ${who},`,
      '',
      "RSG-Türkiye Lisansüstü Rehberi'nden (https://rsg-turkiye.iscbsc.org/tr/guide/) çıkarılma talebi aldık ve kaydınızı sildik. Rehberde artık yer almıyorsunuz.",
      '',
      'Bu talebi siz göndermediyseniz ya da rehberde yer almak isterseniz bu e-postayı yanıtlamanız yeterli; kaydınızı yeniden ekleriz.',
      '',
      'Saygılarımızla,',
      'RSG-Türkiye',
      '',
      '---',
      '',
      `Dear ${who},`,
      '',
      'We received a request to remove you from the RSG-Türkiye graduate guide (https://rsg-turkiye.iscbsc.org/guide/) and have deleted your entry.',
      '',
      'If you did not send this request, or would like to be listed, simply reply to this e-mail and we will add you back.',
      '',
      'Best regards,',
      'RSG-Türkiye',
    ].join('\n'),
  };
}

const FIELD = 'block mt-1 w-full px-3 py-2 lg:py-1.5 min-h-11 lg:min-h-9 rounded-xl border border-border bg-white text-sm text-navy focus:border-navy-mid';
const BTN_BASE = 'inline-flex items-center justify-center gap-1 px-4 lg:px-3 min-h-11 lg:min-h-9 rounded-xl text-sm font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy-mid';

/** The box under a removal request: address, subject and text, then "remove and send". */
export function removalNoticeForm(rowId: number, tpl: { subject: string; text: string }, l: { to: string; hint: string; subject: string; text: string; send: string; skip: string; cancel: string }): string {
  return `<form data-notice-form="${rowId}" class="flex flex-col gap-3 px-4 lg:px-3 pb-4 pt-1 border-t border-border" novalidate>
    <label class="block text-sm font-medium text-navy">${escapeHtml(l.to)}
      <input name="to" type="email" required autocomplete="off" class="${FIELD}" />
      <span class="block text-xs text-gray-500 mt-0.5">${escapeHtml(l.hint)}</span>
    </label>
    <label class="block text-sm font-medium text-navy">${escapeHtml(l.subject)}
      <input name="subject" required maxlength="200" class="${FIELD}" value="${escapeHtml(tpl.subject)}" />
    </label>
    <label class="block text-sm font-medium text-navy">${escapeHtml(l.text)}
      <textarea name="text" required maxlength="5000" rows="12" class="${FIELD} font-normal">${escapeHtml(tpl.text)}</textarea>
    </label>
    <div class="flex flex-wrap gap-2">
      <button type="submit" class="${BTN_BASE} border border-red bg-red text-white hover:bg-red/90">${escapeHtml(l.send)}</button>
      <button type="button" data-notice-skip class="${BTN_BASE} text-gray-500 hover:text-navy">${escapeHtml(l.skip)}</button>
      <button type="button" data-notice-cancel class="${BTN_BASE} text-gray-500 hover:text-navy">${escapeHtml(l.cancel)}</button>
    </div>
  </form>`;
}
