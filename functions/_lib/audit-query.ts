/** Filters shared by the log list and its export. Bad numbers are ignored, not 400s: these come from a form. */
export function auditFilters(params: URLSearchParams): { where: string; binds: (string | number)[] } {
  const clauses: string[] = [];
  const binds: (string | number)[] = [];
  const int = (v: string | null) => (v !== null && /^\d{1,12}$/.test(v) ? Number(v) : null);

  const user = params.get('user')?.trim();
  if (user) { clauses.push('u.email LIKE ?'); binds.push(`%${user}%`); }
  const action = params.get('action')?.trim();
  if (action) { clauses.push('a.action LIKE ?'); binds.push(`${action}%`); }
  const from = int(params.get('from'));
  if (from !== null) { clauses.push('a.at >= ?'); binds.push(from); }
  const to = int(params.get('to'));
  if (to !== null) { clauses.push('a.at <= ?'); binds.push(to); }
  const before = int(params.get('before'));
  if (before !== null) { clauses.push('a.seq < ?'); binds.push(before); }

  return { where: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '', binds };
}

export const AUDIT_SELECT = 'SELECT a.*, u.email AS user_email FROM audit_log a LEFT JOIN users u ON u.id = a.user_id';
