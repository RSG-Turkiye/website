/**
 * Certificates on the symposium site. The data lives on the main site; this
 * page asks for it from the browser (lookup) and at build time (status).
 */
export interface CertStatus { years: { year: number; count: number; expiresAt: number }[] }

export function apiBase(): string {
  return import.meta.env.PUBLIC_API_BASE ?? 'https://rsg-turkiye.iscbsc.org';
}

/** Never throws: a missing band is better than a failed build, and the page
 * itself still works without it. */
export async function fetchCertificateStatus(base: string, fetcher: typeof fetch = fetch): Promise<CertStatus> {
  try {
    const res = await fetcher(`${base}/api/certificates/status`, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`status ${res.status}`);
    const data = (await res.json()) as CertStatus;
    if (!Array.isArray(data?.years)) throw new Error('bad shape');
    return { years: data.years.filter((y) => Number.isInteger(y?.year) && y.count > 0) };
  } catch (err) {
    console.warn(`[certificates] status unavailable, no band: ${String(err).slice(0, 120)}`);
    return { years: [] };
  }
}

export function bandYear(status: CertStatus): number | null {
  return status.years.reduce<number | null>((max, y) => (max === null || y.year > max ? y.year : max), null);
}

export function formatExpiry(epochSeconds: number, lang: 'en' | 'tr'): string {
  return new Date(epochSeconds * 1000).toLocaleDateString(lang === 'tr' ? 'tr-TR' : 'en-GB', {
    day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Istanbul',
  });
}

const KIND_KEYS = {
  participation: 'cert.kind.participation',
  workshop: 'cert.kind.workshop',
  presentation: 'cert.kind.presentation',
  appreciation: 'cert.kind.appreciation',
} as const;

export function kindLabelKey(kind: string): (typeof KIND_KEYS)[keyof typeof KIND_KEYS] | null {
  return Object.hasOwn(KIND_KEYS, kind) ? KIND_KEYS[kind as keyof typeof KIND_KEYS] : null;
}
