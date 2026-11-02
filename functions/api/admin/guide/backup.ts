import type { Env } from '../../../_lib/auth';
import { jsonResponse } from '../../../_lib/auth';
import { appendAudit } from '../../../_lib/audit';
import { safeEqual } from '../../../_lib/secret';
import { backupGuide } from '../../../_lib/guide-backup';

/** Nightly (workers/symposium-cron): the guide's professors and labs to the private backup bucket, last 30 kept. */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  if (!safeEqual(request.headers.get('X-Archive-Secret'), env.SYMPOSIUM_ARCHIVE_SECRET)) {
    return jsonResponse({ error: 'Forbidden', code: 'forbidden' }, 403);
  }
  if (!env.GUIDE_BACKUPS) return jsonResponse({ error: 'GUIDE_BACKUPS is not bound', code: 'not_configured' }, 503);
  const now = Math.floor(Date.now() / 1000);
  const r = await backupGuide({ DB: env.DB, GUIDE_BACKUPS: env.GUIDE_BACKUPS }, now);
  await appendAudit(env.DB, { userId: null, action: 'guide.backup', details: { kept: r.kept, deleted: r.deleted } }, now);
  return jsonResponse(r);
};
