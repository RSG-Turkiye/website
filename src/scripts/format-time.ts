/** Date and time in Istanbul, for log entries and the banner, where the hour matters. */
export function formatDateTime(ts: number, lang: 'en' | 'tr'): string {
  return new Date(ts * 1000).toLocaleString(lang === 'en' ? 'en-GB' : 'tr-TR', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Istanbul',
  });
}

/** The day alone, in UTC: for an end date given as a day (the Buffer key's), where Istanbul's hour would only add noise. */
export function formatDay(ts: number, lang: 'en' | 'tr'): string {
  return new Date(ts * 1000).toLocaleDateString(lang === 'en' ? 'en-GB' : 'tr-TR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
}
