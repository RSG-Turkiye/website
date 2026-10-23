import type { Env } from '../../_lib/auth';
import { jsonResponse } from '../../_lib/auth';
import { cmsGate, fail, forbidden, indexUnavailable, loadCmsIndex, rightsIn } from '../../_lib/cms-api';
import { cmsType } from '../../../src/lib/cms/types';

/** GET ?type=: id and title of every published entry of the type, newest first, from the build-time index. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const gate = await cmsGate(request, env, false);
  if (!gate.ok) return gate.response;
  const type = cmsType(new URL(request.url).searchParams.get('type') ?? '');
  if (!type) return fail(400, 'bad_type', 'Unknown content type');
  if (!rightsIn(gate.rights, type.group).edit) return forbidden();
  const index = await loadCmsIndex(request, env);
  if (!index) return indexUnavailable();
  return jsonResponse({ type: type.key, entries: index[type.key] ?? [] });
};
