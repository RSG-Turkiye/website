import type { Env } from '../../../_lib/auth';
import { jsonResponse } from '../../../_lib/auth';
import { safeEqual } from '../../../_lib/secret';
import { runGuideImport } from '../../../_lib/guide-import';

/**
 * Called nightly by workers/symposium-cron (same secret as the audit prune).
 * The import itself is in functions/_lib/guide-import.ts; the panel's
 * "Import now" button runs the same code through /api/guide/import.
 */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  if (!safeEqual(request.headers.get('X-Archive-Secret'), env.SYMPOSIUM_ARCHIVE_SECRET)) {
    return jsonResponse({ error: 'Forbidden', code: 'forbidden' }, 403);
  }
  return jsonResponse(await runGuideImport(env, Math.floor(Date.now() / 1000), null));
};
