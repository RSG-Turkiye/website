import { useTranslations } from '../../i18n/ui';
import { toast } from './ui-kit';

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
  toast(message, isError);
}

export function formatDate(ts: number) {
  // Pinned to Istanbul, like the rest of the site's admin- and
  // member-facing dates -- two timezones on one screen is worse than
  // either. Date-only, so this only matters right around midnight, but
  // it also governs the announcement dates rendered
  // further down this page, not just anything from the scheduled-send
  // feature.
  return new Date(ts * 1000).toLocaleDateString(dateLocale, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'Europe/Istanbul',
  });
}
