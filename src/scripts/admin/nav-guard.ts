/**
 * Navigation veto. A section with unsaved work registers a guard; the shell
 * asks every guard before it shows a new route, so a vetoed move shows
 * nothing, loads nothing and records no view.
 */
type Guard = (from: string, to: string) => boolean;
const guards = new Set<Guard>();

export function registerNavigationGuard(guard: Guard): () => void {
  guards.add(guard);
  return () => { guards.delete(guard); };
}

export function navigationAllowed(from: string, to: string): boolean {
  if (from === to) return true;
  let allowed = true;
  for (const g of guards) if (!g(from, to)) allowed = false;
  return allowed;
}
