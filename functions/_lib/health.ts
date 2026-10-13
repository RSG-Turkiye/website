import { PLATFORMS, connectionStatus, type ConnectionRow, type Platform } from './connections';

/** The mail cron ticks every minute and writes dispatch_runs every tick, held or not. */
export const SCHEDULER_STALE_SECONDS = 10 * 60;

export type HealthIssue =
  | { kind: 'connection'; platform: Platform; status: 'expiring' | 'broken'; expiresAt: number | null; lastError: string | null }
  | { kind: 'scheduler'; lastRunAt: number | null };

export function healthIssues(input: {
  connections: ConnectionRow[];
  legacyGmail: boolean;
  lastRunAt: number | null;
  /** undefined = not measured (before migration 8e); null = never ran. */
  lastSocialRunAt: number | null | undefined;
  now: number;
}): HealthIssue[] {
  const issues: HealthIssue[] = [];
  for (const platform of PLATFORMS) {
    const row = input.connections.find((c) => c.platform === platform) ?? null;
    const status = connectionStatus(row, input.now, platform === 'gmail' && input.legacyGmail);
    if (status === 'broken' || status === 'expiring') {
      issues.push({
        kind: 'connection', platform, status,
        expiresAt: row?.refresh_expires_at ?? row?.expires_at ?? null,
        lastError: row?.last_error ?? null,
      });
    }
  }
  const runs = input.lastSocialRunAt === undefined ? [input.lastRunAt] : [input.lastRunAt, input.lastSocialRunAt];
  const stale = runs.some((t) => t === null || input.now - t > SCHEDULER_STALE_SECONDS);
  if (stale) {
    const seen = runs.filter((t): t is number => t !== null);
    issues.push({ kind: 'scheduler', lastRunAt: seen.length ? Math.min(...seen) : null });
  }
  return issues;
}
