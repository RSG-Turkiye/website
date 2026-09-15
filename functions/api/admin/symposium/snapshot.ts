// Lets a signed-in organizer trigger, on demand, the same daily copy that
// archive.ts's cron path runs for an edition that has not finished yet --
// for someone who has just entered something in the CMS and does not want
// to wait for tonight's run. Gated exactly like edition.ts's PUT: this is a
// browser session, not the cron Worker's shared secret.
import type { Env } from '../../../_lib/auth';
import { getSessionUser, jsonResponse, checkCsrf, canManageSymposium } from '../../../_lib/auth';
import { snapshotEdition } from './archive';
import type { EditionCandidateRow, ArchiveResult } from './archive';

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  if (!checkCsrf(request)) return jsonResponse({ error: 'Forbidden' }, 403);
  const user = await getSessionUser(request, env);
  if (!user) return jsonResponse({ error: 'Not authenticated' }, 401);
  if (!canManageSymposium(user)) return jsonResponse({ error: 'Forbidden' }, 403);

  // Same row edition.ts's GET resolves as "the edition being prepared":
  // highest year not yet archived.
  const edition = await env.DB.prepare(
    `SELECT year, registration_url, registration_deadline, abstract_url, abstract_deadline, venue_public, city_public, archived_pr_url, archived_at
     FROM symposium_edition
     WHERE archived_at IS NULL
     ORDER BY year DESC
     LIMIT 1`
  ).first<EditionCandidateRow>();

  // No row at all: nothing has ever been saved through the CMS for any
  // edition, so there is nothing to copy. Not an error -- and not a default
  // row invented just so snapshotEdition has something to act on.
  if (!edition) {
    return jsonResponse({ ok: false, reason: 'no-overlay-content' });
  }

  const result: ArchiveResult = await snapshotEdition(edition, env);

  switch (result.status) {
    case 'snapshotted':
      return jsonResponse({ ok: true, prUrl: result.prUrl });
    case 'snapshot-no-changes':
      // The branch already matches main: this edition's content is already
      // safely in git, just not changed since the last copy. Reported under
      // its own reason, distinct from no-overlay-content -- an organizer who
      // just typed something and sees "nothing to copy" would reasonably
      // fear it vanished, when the opposite is true.
      return jsonResponse({ ok: false, reason: 'snapshot-no-changes' });
    case 'no-overlay-content':
      return jsonResponse({ ok: false, reason: 'no-overlay-content' });
    case 'snapshot-failed':
      return jsonResponse({ ok: false, reason: 'failed' });
    default:
      // Unreachable given snapshotEdition's current body, which returns only
      // the four statuses handled above. Kept anyway so a status added later
      // to ArchiveResult that snapshotEdition starts returning is not
      // silently swallowed as a success.
      return jsonResponse({ ok: false, reason: 'failed' });
  }
};
