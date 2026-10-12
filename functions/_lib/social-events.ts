/** Event mode (spec §1): a time-boxed window in which named editors' stories skip approval. */
export interface EventModeRow {
  id: string;
  name: string;
  starts_at: number;
  ends_at: number;
  editor_ids: string;
  opened_by: string;
  closed_by: string | null;
  closed_at: number | null;
  created_at: number;
}

export const MAX_EVENT_SECONDS = 7 * 86400;

function ids(json: string): string[] {
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export function eventCovers(mode: EventModeRow, userId: string, now: number): boolean {
  return mode.closed_at === null && mode.starts_at <= now && now < mode.ends_at && ids(mode.editor_ids).includes(userId);
}

export async function coveringEvent(db: D1Database, userId: string, now: number): Promise<EventModeRow | null> {
  const rows = (await db.prepare(
    'SELECT * FROM social_event_modes WHERE closed_at IS NULL AND starts_at <= ? AND ends_at > ?',
  ).bind(now, now).all<EventModeRow>()).results;
  return rows.find((m) => eventCovers(m, userId, now)) ?? null;
}
