// Called once by the panel after a batch upload or a delete-all, so the
// symposium home page band appears or goes without one rebuild per file.
import type { Env } from '../../../_lib/auth';
import { jsonResponse } from '../../../_lib/auth';
import { triggerRebuild } from '../../../_lib/symposium';
import { organiser } from '../certificates';

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const user = await organiser(request, env, true);
  if (user instanceof Response) return user;
  return jsonResponse({ ok: true, rebuild: await triggerRebuild(env) });
};
