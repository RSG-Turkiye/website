import type { Env } from './auth';
import { appendAudit } from './audit';
import { getGoogleToken } from './google-sa';
import { readSheetRows, importRows, pruneIntake, GUIDE_MAPPING } from './sheet-import';
import { adminEmails, notifyEach } from './social-notify';

/**
 * The guide's Form import, shared by the nightly cron (/api/admin/guide/import)
 * and the panel's "Import now" button (/api/guide/import). Reads the Form's
 * response Sheet with the service account (GOOGLE_SA_KEY, GUIDE_SHEET_ID),
 * queues new responses, prunes handled ones past their retention, and mails
 * the admins when a removal request came in (an internal notice, not outbound
 * mail). The result is kept in intake_state for the panel: ok, no_access (the
 * Sheet is not shared with the service account), not_configured, or error.
 */

const SCOPES = ['https://www.googleapis.com/auth/spreadsheets.readonly'];
const PANEL_URL = 'https://rsg-turkiye.iscbsc.org/admin/#rehber/oneriler';

export type ImportResult = 'ok' | 'no_access' | 'not_configured' | 'error';

export async function runGuideImport(env: Env, now: number, userId: string | null): Promise<{ sheet: ImportResult; added: number }> {
  let sheet: ImportResult = 'ok';
  let added = 0;
  let removals = 0;
  if (!env.GOOGLE_SA_KEY || !env.GUIDE_SHEET_ID) {
    sheet = 'not_configured';
  } else {
    try {
      const token = await getGoogleToken(env.GOOGLE_SA_KEY, SCOPES, now);
      const rows = await readSheetRows(token, env.GUIDE_SHEET_ID, 'A:E');
      ({ added, removals } = await importRows(env.DB, rows, GUIDE_MAPPING, now));
    } catch (err) {
      sheet = (err as { code?: string }).code === 'no_access' ? 'no_access' : 'error';
    }
  }
  const pruned = await pruneIntake(env.DB, now);
  await env.DB.prepare('UPDATE intake_state SET checked_at = ?, result = ?, added = ? WHERE id = 1').bind(now, sheet, added).run();
  await appendAudit(env.DB, { userId, action: 'guide.import', details: { sheet, added, removals, pruned } }, now);
  if (removals > 0) {
    await notifyEach(env, await adminEmails(env.DB), {
      subject: 'Rehber: çıkarılma isteği / Guide: removal request',
      text: `Rehberden çıkarılmak isteyen ${removals} istek geldi. Panelde inceleyin:\n${PANEL_URL}\n\n`
        + `${removals} new removal request(s) in the graduate guide. Review them in the panel:\n${PANEL_URL}\n`,
    }).catch(() => 0);
  }
  return { sheet, added };
}
