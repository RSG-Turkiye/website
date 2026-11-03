import { isValidEmail } from './mail';

/**
 * The notice an approver sends when they remove someone from the guide on
 * request: "we removed you; if this was not you, reply and we add you back".
 * The guide's Form collects no e-mail, so anyone can ask for anyone's
 * removal. Removing at once is the safe direction, and this notice is how a
 * false alarm comes back to us. A person writes the address (from the
 * professor's official page) and presses the button, so the mail leaves
 * only on a human's click (CLAUDE.md rule 5). The address and the text are
 * used once and stored nowhere: the audit row says only whether it went.
 */

/** Notices per day for the whole site; a stolen session cannot turn the button into a mailer. */
export const REMOVAL_NOTICE_DAILY = 20;

export interface RemovalNotice { to: string; subject: string; text: string }

/** A notice as sent from the panel, or null when it is not one we would send. */
export function parseRemovalNotice(v: unknown): RemovalNotice | null {
  if (!v || typeof v !== 'object') return null;
  const { to, subject, text } = v as Record<string, unknown>;
  if (typeof to !== 'string' || typeof subject !== 'string' || typeof text !== 'string') return null;
  const address = to.trim();
  if (!isValidEmail(address) || /[,;\s]/.test(address)) return null;
  if (!subject.trim() || subject.length > 200 || !text.trim() || text.length > 5000) return null;
  return { to: address, subject: subject.trim(), text };
}

export async function noticesToday(db: D1Database, now: number): Promise<number> {
  const r = await db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'guide.removal.notice' AND at > ?").bind(now - 86400).first<{ n: number }>();
  return r?.n ?? 0;
}
