import type { Env } from '../../_lib/auth';
import { jsonResponse } from '../../_lib/auth';
import { guideGate } from '../../_lib/guide-api';
import { runGuideImport } from '../../_lib/guide-import';

/**
 * The panel's "Import now" button on the suggestion queue: the nightly Form
 * import, run at once by a Rehber approver (session + CSRF via guideGate).
 * Running it twice is harmless: the import is idempotent.
 */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const gate = await guideGate(request, env, true);
  if (!gate.ok) return gate.response;
  return jsonResponse(await runGuideImport(env, gate.now, gate.user.id));
};
