// The public overlay endpoint: one unauthenticated GET the symposium build
// reads once. Deliberately no auth, no CSRF -- this publishes content that
// is public by definition. Its job is to be honest and simple: publish what
// the CMS knows, and never be the reason a build breaks. When there is no
// edition row at all, that's an ordinary state (year: null, empty lists),
// not a 404 -- a 404 would be indistinguishable from a broken deployment.
import type { Env } from '../_lib/auth';
import { jsonResponse } from '../_lib/auth';
import { rowsToOverlay } from '../_lib/symposium';
import type {
  EditionRow,
  SpeakerRow,
  SessionRow,
  CommitteeRow,
  AnnouncementRow,
} from '../_lib/symposium';

export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  const now = Math.floor(Date.now() / 1000);

  // The upcoming edition: highest year, not yet archived. Task 8 stamps
  // archived_pr_url once an edition is folded into the repo, which is what
  // retires it from this endpoint.
  const edition = await env.DB.prepare(
    `SELECT year, registration_url, registration_deadline, abstract_url, abstract_deadline, venue_public, city_public
     FROM symposium_edition
     WHERE archived_pr_url IS NULL
     ORDER BY year DESC
     LIMIT 1`
  ).first<EditionRow>();

  if (!edition) {
    const overlay = rowsToOverlay(
      {
        year: 0,
        registration_url: '',
        registration_deadline: null,
        abstract_url: '',
        abstract_deadline: null,
        venue_public: null,
        city_public: null,
      },
      [],
      [],
      [],
      [],
    );
    return jsonResponse({ ...overlay, year: null });
  }

  const [speakers, sessions, committee, announcements] = await Promise.all([
    env.DB.prepare(
      `SELECT id, slug, year, name, position, company, bio, photo, linkedin, sort
       FROM symposium_speakers WHERE year = ? ORDER BY sort, id`
    ).bind(edition.year).all<SpeakerRow>(),
    env.DB.prepare(
      `SELECT id, year, title, type, time, end_time, description, speaker_slugs, sort
       FROM symposium_sessions WHERE year = ? ORDER BY sort, id`
    ).bind(edition.year).all<SessionRow>(),
    env.DB.prepare(
      `SELECT id, year, name, role, role_tr, affiliation, photo, linkedin, sort
       FROM symposium_committee WHERE year = ? ORDER BY sort, id`
    ).bind(edition.year).all<CommitteeRow>(),
    env.DB.prepare(
      `SELECT id, title, description, button_text, button_url, show_as_popup, expires_at
       FROM announcements
       WHERE site = 'symposium' AND expires_at > ?
       ORDER BY created_at DESC`
    ).bind(now).all<AnnouncementRow>(),
  ]);

  return jsonResponse(
    rowsToOverlay(
      edition,
      speakers.results,
      sessions.results,
      committee.results,
      announcements.results,
    )
  );
};
