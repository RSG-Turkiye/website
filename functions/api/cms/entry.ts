import type { Env } from '../../_lib/auth';
import { jsonResponse } from '../../_lib/auth';
import { cmsGate, entryPaths, fail, forbidden, githubFailed, indexUnavailable, loadCmsIndex, rightsIn } from '../../_lib/cms-api';
import { langOf } from '../../_lib/cms-drafts';
import { filesOnBase } from '../../_lib/github';
import { checkId, cmsType } from '../../../src/lib/cms/types';
import { parseJson, parseMarkdown } from '../../../src/lib/cms/serialize';

/**
 * GET ?type=&id=: a published entry as it is on main now, parsed, with each
 * file's blob sha. A webinar answers `{ en, tr }`, each with `source`, the
 * frontmatter text the draft keeps so unchanged keys are written back as
 * they were; a side the pair lacks is null. `files` is each file's text
 * (null where absent), for the approver's file diff.
 */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const gate = await cmsGate(request, env, false);
  if (!gate.ok) return gate.response;
  const params = new URL(request.url).searchParams;
  const type = cmsType(params.get('type') ?? '');
  if (!type) return fail(400, 'bad_type', 'Unknown content type');
  if (!rightsIn(gate.rights, type.group).edit) return forbidden();
  let id: string;
  try {
    id = checkId(params.get('id') as string);
  } catch {
    return fail(400, 'bad_id', 'Not a valid entry id');
  }

  const paths = entryPaths(type, id, type.format === 'json' ? null : await loadCmsIndex(request, env));
  if (paths === 'no_index') return indexUnavailable();
  if (!paths) return fail(404, 'not_found', 'No such entry');

  let files;
  try {
    files = await filesOnBase(paths, env);
  } catch (e) {
    return githubFailed(e);
  }
  if (paths.every((p) => files[p] === null)) return fail(404, 'not_found', 'No such entry');
  const base_shas = Object.fromEntries(paths.map((p) => [p, files[p]?.sha ?? null]));
  // The text itself too, for the approver's file diff ("Dosya farkı").
  const text = Object.fromEntries(paths.map((p) => [p, files[p]?.content ?? null]));

  try {
    if (type.format === 'json') return jsonResponse({ type: type.key, id, data: parseJson(type, files[paths[0]]!.content), base_shas, files: text });
    const data: Record<string, unknown> = {};
    for (const p of paths) data[langOf(type, p)] = files[p] ? parseMarkdown(type, files[p]!.content) : null;
    return jsonResponse({ type: type.key, id, data, base_shas, files: text });
  } catch (e) {
    console.error('cms: an entry on main could not be parsed', id, e);
    return fail(500, 'unreadable', 'The file on main could not be read');
  }
};
