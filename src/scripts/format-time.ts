/** Date and time in Istanbul, for log entries and the banner, where the hour matters. */
export function formatDateTime(ts: number, lang: 'en' | 'tr'): string {
  return new Date(ts * 1000).toLocaleString(lang === 'en' ? 'en-GB' : 'tr-TR', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Istanbul',
  });
}
