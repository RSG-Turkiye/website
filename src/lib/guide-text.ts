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
    purpose: 'This guide helps students find a supervisor in Türkiye and the MSc or PhD programme that leads to them. It lists only professional information that professors and their universities have made public.',
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
    noProgramme: 'No graduate programme found for this university yet.',
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
    programmesHeading: 'Graduate programmes',
    professorsHeading: 'Professors',
    backToSearch: 'Search the guide',
    removeMe: 'Are you listed and want to be removed? Tell us and we remove you.',
    privacy: 'How we handle this information',
    programmeCount: '{n} programmes',
    noProgrammeYet: 'no programme found yet',
    lede: 'Find a supervisor by topic, and the MSc or PhD programme you apply to.',
    phdNote: 'PhD supervision has its own conditions; ask the professor before you apply.',
    applyNote: 'You apply to the programme, not to the professor. Universities are ordered by automatic topic matching and professors by name; neither is an assessment.',
    chipsNote: 'Topics are derived automatically from publications (OpenAlex) and can be imprecise.',
    counts: '{n} professors at {u} universities',
    withoutProgrammeHeading: 'Universities with no programme in the guide yet',
    withoutProgrammeNote: 'These professors are listed, but we have not found the graduate programme to apply to yet. If you know it, tell us.',
    beforeWriting: 'Before you write to a professor',
    beforeWritingSteps: ['Apply to the programme first: admission is decided there.', 'Read two or three of their recent papers.', 'In your e-mail, say which of their work interests you and why.'],
    mapLabel: 'Cities with a university in the guide',
    mapCaption: 'Tap a city to list its professors.',
    mapCaptionAnchors: 'Tap a city to jump to its universities.',
    mapFadedNote: 'Faded: no programme in the guide yet.',
    unverifiedTag: 'Not confirmed on an official page',
    programmeLine: 'Programme: {name}',
    moreTerms: '+{n} more',
    universityCount: '{n} universities',
    whichProgrammeShort: 'Which of these programmes each professor supervises in is not known yet.',
    statusOpen: 'Applications open, closing {date}',
    statusUpcoming: 'Applications open on {date}',
    noExactDate: 'No exact date yet',
    checkedShort: 'Checked on {date}',
    pageChanged: 'This programme\u2019s announcement page changed around {date} and this entry has not been updated since. Do not rely on it; check the announcement yourself.',
  },
  tr: {
    title: 'Lisansüstü rehberi',
    purpose: 'Bu rehber, öğrencilerin Türkiye’de danışman ve o danışmana götüren yüksek lisans ya da doktora programını bulması için hazırlandı. Yalnızca hocaların ve üniversitelerinin herkese açık yayımladığı mesleki bilgileri içerir.',
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
    noProgramme: 'Bu üniversite için henüz lisansüstü program bulunamadı.',
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
    programmesHeading: 'Lisansüstü programlar',
    professorsHeading: 'Hocalar',
    backToSearch: 'Rehberde ara',
    removeMe: 'Listede yer alıyor ve çıkmak mı istiyorsunuz? Bize yazın, çıkaralım.',
    privacy: 'Bu bilgileri nasıl kullanıyoruz',
    programmeCount: '{n} program',
    noProgrammeYet: 'henüz program bulunamadı',
    lede: 'Konuna göre danışman bul, başvuracağın yüksek lisans ya da doktora programını gör.',
    phdNote: 'Doktora danışmanlığının ayrı şartları vardır; başvurmadan önce hocaya sorun.',
    applyNote: 'Başvuru programa yapılır, hocaya değil. Üniversiteler otomatik konu eşleşmesine, hocalar ada göre sıralanır; ikisi de bir değerlendirme değildir.',
    chipsNote: 'Konular yayınlardan (OpenAlex) otomatik çıkarılır, hatalı olabilir.',
    counts: '{u} üniversitede {n} hoca',
    withoutProgrammeHeading: 'Rehberde henüz programı olmayan üniversiteler',
    withoutProgrammeNote: 'Bu hocalar listede, ama başvurulacak lisansüstü programı henüz bulamadık. Biliyorsanız bize yazın.',
    beforeWriting: 'Hocaya yazmadan önce',
    beforeWritingSteps: ['Önce programa başvurun: kabul kararı orada verilir.', 'Hocanın son iki üç yayınını okuyun.', 'E-postanızda hangi çalışmasının ilginizi çektiğini ve nedenini yazın.'],
    mapLabel: 'Rehberde üniversitesi olan şehirler',
    mapCaption: 'Bir şehre dokunun, oradaki hocalar listelensin.',
    mapCaptionAnchors: 'Bir şehre dokunun, o şehrin üniversitelerine gidin.',
    mapFadedNote: 'Soluk: rehberde henüz programı yok.',
    unverifiedTag: 'Resmi sayfadan doğrulanmadı',
    programmeLine: 'Program: {name}',
    moreTerms: '+{n} daha',
    universityCount: '{n} üniversite',
    whichProgrammeShort: 'Hocaların bu programlardan hangisinde olduğu henüz bilinmiyor.',
    statusOpen: 'Başvurular açık, son gün {date}',
    statusUpcoming: 'Başvurular {date} tarihinde açılıyor',
    noExactDate: 'Kesin tarih yok',
    checkedShort: 'Son kontrol: {date}',
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
