/**
 * "2019'dan beri", "2012'den beri": the Turkish ablative after a year follows
 * the vowel harmony and final sound of how the number is read aloud, so the
 * suffix cannot be fixed in a translation string.
 */
const UNITS = ['', "'den", "'den", "'ten", "'ten", "'ten", "'dan", "'den", "'den", "'dan"]; // bir iki üç dört beş altı yedi sekiz dokuz
const TENS = ['', "'dan", "'den", "'dan", "'tan", "'den", "'tan", "'ten", "'den", "'dan"]; // on yirmi otuz kırk elli altmış yetmiş seksen doksan

/** The year with its ablative suffix, e.g. 2019 → "2019'dan", 2012 → "2012'den", 2000 → "2000'den" (bin). */
export function yearAblative(year: number): string {
  const units = year % 10;
  const tens = Math.floor(year / 10) % 10;
  const suffix = units ? UNITS[units] : tens ? TENS[tens] : year % 1000 === 0 ? "'den" : "'den";
  return `${year}${suffix}`;
}
