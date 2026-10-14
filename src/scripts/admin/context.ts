import { useTranslations } from '../../i18n/ui';

type Lang = 'en' | 'tr';

export const lang: Lang = document.documentElement.lang === 'tr' ? 'tr' : 'en';
export const t = useTranslations(lang);

export function tf(key: Parameters<typeof t>[0], vars: Record<string, string | number>): string {
  let result: string = t(key);
  for (const [k, v] of Object.entries(vars)) {
    result = result.split(`{${k}}`).join(String(v));
  }
  return result;
}

export const dateLocale = lang === 'en' ? 'en-GB' : 'tr-TR';

export function showToast(message: string, isError = false) {
  const toast = document.getElementById('toast')!;
  toast.textContent = message;
  toast.style.background = isError ? '#dc2626' : '#0f2045';
  toast.classList.remove('hidden');
  // Errors linger; a confirmed success only needs long enough to be seen.
  setTimeout(() => toast.classList.add('hidden'), isError ? 5000 : 1600);
}

export function formatDate(ts: number) {
  // Pinned to Istanbul, like the rest of the site's admin- and
  // member-facing dates -- two timezones on one screen is worse than
  // either. Date-only, so this only matters right around midnight, but
  // it also governs the announcement and blog-submission dates rendered
  // further down this page, not just anything from the scheduled-send
  // feature.
  return new Date(ts * 1000).toLocaleDateString(dateLocale, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'Europe/Istanbul',
  });
}
