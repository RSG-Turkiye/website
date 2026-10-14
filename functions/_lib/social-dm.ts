/**
 * The DM inbox's rules, kept free of I/O so they can be tested by the clock:
 * what counts as unanswered, unread and expired, and when the digest and the
 * last call may go out. Meta lets a business answer a DM for 24 hours after
 * the person's newest message; nothing here stores what anyone wrote.
 */
export const WINDOW_SECONDS = 86400;
export const LAST_CALL_AFTER = 20 * 3600;
export const POLL_EVERY = 300;
export const REFRESH_MIN_GAP = 30;
export const MAX_THREAD_FETCHES = 10;
export const DIGEST_GAP = 3600;
export const DIGESTS_PER_DAY = 6;
export const QUIET_FROM = 23;
export const QUIET_TO = 8;
export const MAX_REPLY_BYTES = 1000;
export const DM_SCOPE = 'instagram_business_manage_messages';

/** Türkiye is UTC+3 all year (no DST since 2016), as in schedule.ts. */
const TR_OFFSET = 3 * 3600;

export interface DmThreadRow {
  id: string;
  platform: 'instagram' | 'x';
  conversation_id: string;
  peer_id: string;
  peer_username: string | null;
  last_inbound_at: number | null;
  last_outbound_at: number | null;
  read_at: number | null;
  read_by: string | null;
  digested_at: number | null;
  final_warned_at: number | null;
  updated_at: number;
}

export interface DmView {
  unanswered: boolean;
  unread: boolean;
  expired: boolean;
  closesAt: number | null;
  secondsLeft: number;
}

export function dmView(row: Pick<DmThreadRow, 'last_inbound_at' | 'last_outbound_at' | 'read_at'>, now: number): DmView {
  const inbound = row.last_inbound_at;
  if (inbound === null) return { unanswered: false, unread: false, expired: false, closesAt: null, secondsLeft: 0 };
  const closesAt = inbound + WINDOW_SECONDS;
  const expired = now >= closesAt;
  const unanswered = inbound > (row.last_outbound_at ?? 0);
  return {
    unanswered,
    unread: unanswered && !expired && (row.read_at ?? 0) < inbound,
    expired,
    closesAt,
    secondsLeft: expired ? 0 : closesAt - now,
  };
}

export const istanbulHour = (now: number) => Math.floor(((now + TR_OFFSET) % 86400) / 3600);
export const istanbulDayStart = (now: number) => now - ((now + TR_OFFSET) % 86400);
export function isQuietHour(now: number): boolean {
  const h = istanbulHour(now);
  return h >= QUIET_FROM || h < QUIET_TO;
}

const open = (r: DmThreadRow, now: number) => { const v = dmView(r, now); return v.unanswered && !v.expired; };

/** Threads that make a digest worth sending: something unanswered arrived since the last one. */
export function digestFresh(rows: DmThreadRow[], now: number): DmThreadRow[] {
  return rows.filter((r) => open(r, now) && r.last_inbound_at! > (r.digested_at ?? 0));
}

/** What a digest lists: every thread that can still be answered. */
export function digestList(rows: DmThreadRow[], now: number): DmThreadRow[] {
  return rows.filter((r) => open(r, now));
}

/** Whether one person may get a digest now, given when they got earlier ones. */
export function mayDigest(sentAts: number[], now: number): boolean {
  if (isQuietHour(now)) return false;
  if (sentAts.some((s) => now - s < DIGEST_GAP)) return false;
  const day = istanbulDayStart(now);
  return sentAts.filter((s) => s >= day).length < DIGESTS_PER_DAY;
}

/** Unanswered threads with four hours or less left, not yet warned about for this message. */
export function lastCallDue(rows: DmThreadRow[], now: number): DmThreadRow[] {
  return rows.filter((r) => open(r, now) && now - r.last_inbound_at! >= LAST_CALL_AFTER && r.final_warned_at !== r.last_inbound_at);
}
