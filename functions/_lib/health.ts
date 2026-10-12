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
  if (input.lastRunAt === null || input.now - input.lastRunAt > SCHEDULER_STALE_SECONDS) {
    issues.push({ kind: 'scheduler', lastRunAt: input.lastRunAt });
  }
  return issues;
}
