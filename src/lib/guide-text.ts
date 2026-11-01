/**
 * The graduate guide's words, in both languages, shared by the pages
 * (src/components/guide) and their client script (src/scripts/guide-page.ts),
 * which receives them as JSON. Kept apart from src/i18n/ui.ts because the
 * browser needs them and ui.ts is the whole site's dictionary.
 */
import { GUIDE_FORM } from '../data/guide-form';
import { PRIVACY_CONTACT } from '../data/contact';

export type Lang = 'en' | 'tr';

export const GUIDE_TEXT = {
  en: {
    title: 'Graduate guide',
    purpose: 'This guide helps students find a supervisor in Türkiye and the MSc programme that leads to them. It lists only professional information that professors and their universities have made public.',
    searchLabel: 'Topic or name',
    searchPlaceholder: 'protein structure, single cell, sistem biyolojisi…',
    cityLabel: 'City',
    allCities: 'All cities',
    alsoSearched: 'Also searched:',
    results: '{n} professors',
    noResults: 'Nobody matches yet. Try a broader topic, or another city.',
    loading: 'Loading the guide…',
    loadFailed: 'The guide could not be loaded. Please try again later.',
    applyTo: 'Apply to',
    usually: 'usually takes applications in {months}',
    monthsUnknown: 'application months not known yet: check the announcement',
    reported: 'reported window: {from} – {to}',
    announcement: 'Announcement',
    noProgramme: 'No MSc programme found for this university yet.',
    suggest: 'Suggest a correction',
    suggestProgramme: 'Know one? Suggest it',
    profile: 'Profile',
    lab: 'Lab',
    checked: 'checked {date}',
    unverified: 'not yet confirmed on an official page',
    whichProgramme: 'Which programme this professor supervises in is not known yet; these are the university\u2019s programmes in the guide.',
    source: 'source',
    universities: 'All universities',
    universitiesTitle: 'Universities in the guide',
    programmesHeading: 'MSc programmes',
    professorsHeading: 'Professors',
    backToSearch: 'Search the guide',
    removeMe: 'Are you listed and want to be removed? Tell us and we remove you.',
    privacy: 'How we handle this information',
    programmeCount: '{n} programmes',
    noProgrammeYet: 'no programme found yet',
    pageChanged: 'This programme\u2019s announcement page changed around {date} and this entry has not been updated since. Do not rely on it; check the announcement yourself.',
  },
  tr: {
    title: 'Lisansüstü rehberi',
    purpose: 'Bu rehber, öğrencilerin Türkiye’de danışman ve o danışmana götüren yüksek lisans programını bulması için hazırlandı. Yalnızca hocaların ve üniversitelerinin herkese açık yayımladığı mesleki bilgileri içerir.',
    searchLabel: 'Konu ya da ad',
    searchPlaceholder: 'protein yapısı, tek hücre, systems biology…',
    cityLabel: 'Şehir',
    allCities: 'Tüm şehirler',
    alsoSearched: 'Şunları da aradık:',
    results: '{n} hoca',
    noResults: 'Henüz eşleşen yok. Daha geniş bir konu ya da başka bir şehir deneyin.',
    loading: 'Rehber yükleniyor…',
    loadFailed: 'Rehber yüklenemedi. Lütfen daha sonra yeniden deneyin.',
    applyTo: 'Başvuru',
    usually: 'genelde {months} aylarında başvuru alıyor',
    monthsUnknown: 'başvuru ayları henüz bilinmiyor: ilana bakın',
    reported: 'bildirilen tarihler: {from} – {to}',
    announcement: 'İlan',
    noProgramme: 'Bu üniversite için henüz yüksek lisans programı bulunamadı.',
    suggest: 'Düzeltme öner',
    suggestProgramme: 'Biliyorsanız önerin',
    profile: 'Profil',
    lab: 'Lab',
    checked: '{date} tarihinde kontrol edildi',
    unverified: 'henüz resmi bir sayfadan doğrulanmadı',
    whichProgramme: 'Bu hocanın hangi programda danışmanlık yaptığı henüz bilinmiyor; bunlar üniversitenin rehberdeki programları.',
    source: 'kaynak',
    universities: 'Tüm üniversiteler',
    universitiesTitle: 'Rehberdeki üniversiteler',
    programmesHeading: 'Yüksek lisans programları',
    professorsHeading: 'Hocalar',
    backToSearch: 'Rehberde ara',
    removeMe: 'Listede yer alıyor ve çıkmak mı istiyorsunuz? Bize yazın, çıkaralım.',
    privacy: 'Bu bilgileri nasıl kullanıyoruz',
    programmeCount: '{n} program',
    noProgrammeYet: 'henüz program bulunamadı',
    pageChanged: 'Bu programın duyuru sayfası {date} civarında değişti ve buradaki bilgiler henüz güncellenmedi. Bu bilgilere güvenmeyin; duyuruyu kendiniz kontrol edin.',
  },
} as const;

export type GuideText = (typeof GUIDE_TEXT)['en'];

export const fill = (s: string, vars: Record<string, string | number>) => s.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? ''));

/** The correction / removal link for a record: the Google Form when it exists, else an e-mail. */
export function suggestUrl(recordId: string, lang: Lang, kind: 'correction' | 'removal' = 'correction'): string {
  if (GUIDE_FORM.url) {
    const u = new URL(GUIDE_FORM.url);
    u.searchParams.set('usp', 'pp_url');
    if (GUIDE_FORM.recordField && recordId) u.searchParams.set(`entry.${GUIDE_FORM.recordField}`, recordId);
    return u.toString();
  }
  const subject = kind === 'removal'
    ? (lang === 'tr' ? 'Rehberden çıkarılma isteği' : 'Guide removal request')
    : (lang === 'tr' ? `Rehber düzeltmesi: ${recordId}` : `Guide correction: ${recordId}`);
  return `mailto:${PRIVACY_CONTACT}?subject=${encodeURIComponent(subject)}`;
}

/** Seed rows confirmed only through OpenAlex carry checkedAt 1970-01-01:
 * never "checked" on the card until someone confirms them. */
export function checkedLabel(day: string, lang: Lang): string {
  return day < '2000-01-01' ? GUIDE_TEXT[lang].unverified : fill(GUIDE_TEXT[lang].checked, { date: dayLabel(day, lang) });
}

/** The public warning on a programme whose page changed unhandled (see STALE_PAGE_DAYS). */
export function pageChangedLabel(day: string, lang: Lang): string {
  return fill(GUIDE_TEXT[lang].pageChanged, { date: dayLabel(day, lang) });
}

/** "June, December" in the page's language, from month numbers as text. */
export function monthNames(months: readonly string[], lang: Lang): string {
  const fmt = new Intl.DateTimeFormat(lang === 'tr' ? 'tr-TR' : 'en-GB', { month: 'long', timeZone: 'UTC' });
  return months.map((m) => fmt.format(new Date(Date.UTC(2026, Number(m) - 1, 15)))).join(', ');
}

export function dayLabel(day: string, lang: Lang): string {
  return new Intl.DateTimeFormat(lang === 'tr' ? 'tr-TR' : 'en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
    .format(new Date(`${day}T00:00:00Z`));
}
