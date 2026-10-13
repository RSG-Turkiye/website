/** What every social module needs from the admin panel, set once by setupSocial. */
export interface SocialDeps {
  t: (key: string) => string;
  tf: (key: string, vars: Record<string, string | number>) => string;
  showToast: (message: string, isError?: boolean) => void;
  lang: 'en' | 'tr';
  me: { id: string; isPublisher: boolean };
}

let current: SocialDeps | null = null;

export function setDeps(d: SocialDeps): void { current = d; }
export function deps(): SocialDeps {
  if (!current) throw new Error('social panel used before setupSocial');
  return current;
}

/** Anything that changes plans or posts calls changed(); the open views reload. */
const listeners = new Set<() => void>();
export function onChange(fn: () => void): void { listeners.add(fn); }
export function changed(): void { for (const fn of listeners) fn(); }
