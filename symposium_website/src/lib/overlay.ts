// The build-time merge of the CMS overlay onto the repo's own content.
//
// The repo is the source of a working site and D1 is an overlay on top of it,
// which is true exactly as far as the repo has content. For an edition whose
// speakers, schedule and links live only in the CMS -- 2026, as this is
// written -- "fall back to the repo" means "publish an empty programme", so
// `fetchOverlay` distinguishes a CMS with nothing in it from a CMS we could
// not reach, and `repoCanStandAlone` says which of the two the caller can
// afford. See `loadCurrentContent` for what it does with the answer.
//
// `mergeOverlay` is pure and takes no astro import, so it (and `parseOverlay`
// and `repoCanStandAlone`) load under plain `node:test` -- only `fetchOverlay`
// is impure, and it is the sole place a network call happens.
//
// `z` comes from `astro/zod`, not the `astro:schema` virtual specifier that
// `src/content.config.ts` uses. `astro:schema` is a Vite-only alias (resolved
// by Astro's dev/build pipeline to this same module) and does not exist
// outside a Vite build, so importing it here would break the plain
// `node --test` run this module must support. `astro/zod` is the real file
// that alias points at, so the zod instance is identical either way.
import { z } from 'astro/zod';
import type { Speaker, Session, CommitteeMember } from './content';

const TIMEOUT_MS = 5000;

/**
 * What a page needs to render the upcoming edition. The repo fills it from
 * the content collections; the overlay may replace parts of it. Note the
 * absence of `venue` and `venueCity`: they are read from the edition
 * markdown by `locationFor`, and the overlay is not allowed to introduce
 * them.
 */
export interface RepoContent {
  registrationUrl: string;
  abstractUrl: string;
  registrationDeadline?: Date;
  abstractDeadline?: Date;
  venuePublic: boolean;
  cityPublic: boolean;
  speakers: Speaker[];
  sessions: Session[];
  committee: CommitteeMember[];
  /** From the CMS only: the repo has no announcements of its own. */
  announcements: Announcement[];
}

/** A note from the organisers, shown above the fold until it expires. */
export interface Announcement {
  id: string;
  title: string;
  description: string;
  buttonText: string;
  buttonUrl: string;
}

// Mirrors the shape `functions/_lib/symposium.ts` (Task 3) serves. The two
// projects share no module, so this is a deliberate copy, not a shortcut --
// see the schema below for why the copy alone is not trusted.
const OverlaySchema = z.object({
  year: z.number().nullable(),
  edition: z.object({
    registrationUrl: z.string(),
    registrationDeadline: z.number().nullable(),
    abstractUrl: z.string(),
    abstractDeadline: z.number().nullable(),
    venuePublic: z.boolean().nullable(),
    cityPublic: z.boolean().nullable(),
  }),
  speakers: z.array(z.object({ slug: z.string(), name: z.string() }).passthrough()),
  sessions: z.array(z.object({ slug: z.string(), title: z.string(), order: z.number() }).passthrough()),
  committee: z.array(z.object({
    name: z.string(),
    // Both shapes, on purpose. This schema is a network boundary between two
    // things that are NOT deployed together: the main site's Functions serve
    // this payload, and the symposium site's build consumes it, each on its
    // own Pages project. During the window between the two deploys the build
    // sees the *previous* payload shape -- and because the repo has no
    // committee of its own, a rejected payload makes the build refuse to
    // publish rather than quietly emptying the page. Strictness here turns
    // every payload change into a broken deploy.
    //
    // So a bare string, the first version of this field, is read as a team
    // named in English only -- which is what it meant.
    teams: z.array(
      z.union([
        z.string().transform((en) => ({ en, tr: "" })),
        z.object({ en: z.string().default(""), tr: z.string().default("") }),
      ]),
    ).default([]),
  }).passthrough()),
  // Was z.array(z.unknown()): the payload carried announcements, the schema
  // let them through, and nothing on this site did anything with them. A
  // shape, so a renamed field on the server is caught here rather than
  // rendering a blank card.
  announcements: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      description: z.string(),
      button_text: z.string(),
      button_url: z.string(),
      expires_at: z.number(),
    }).passthrough(),
  ),
});

export type Overlay = z.infer<typeof OverlaySchema>;

/**
 * The only way an overlay payload becomes an `Overlay`.
 *
 * A copied TypeScript type enforces nothing across an HTTP boundary: rename
 * a field on the server and it arrives as `undefined`, silently emptying a
 * list. Validating against this schema means a shape mismatch is refused
 * outright -- `null`, logged -- instead of being half-trusted into a build.
 * `.passthrough()` on the list members means the server can *add* fields
 * without breaking a site that has not redeployed; only a rename or a type
 * change counts as drift.
 */
export function parseOverlay(data: unknown): Overlay | null {
  const result = OverlaySchema.safeParse(data);
  if (!result.success) {
    console.error(`[overlay] payload shape mismatch -- ${result.error.message} -- building from the repo alone`);
    return null;
  }
  return result.data;
}

/**
 * Applies the overlay to the repo's content.
 *
 * Absent or empty means "no opinion": a missing or `null` edition field, or
 * an empty list, leaves the repo's value standing. Only a non-empty list or
 * an explicit `true`/`false` flag overrides. This is what keeps a bad
 * deploy or a half-run migration from silently erasing a published
 * programme -- removing every speaker is an act for a pull request, not an
 * empty API response.
 *
 * Never reads `venue` or `venueCity` from the overlay, even if a payload
 * carried them: those come from the edition markdown only.
 *
 * `registrationUrl`/`abstractUrl` are treated as "absent means no opinion"
 * on an empty string, not just on `null`/`undefined`. The D1 columns behind
 * them are `TEXT NOT NULL DEFAULT ''` -- the server can never send `null`
 * for these two, only `''` -- so a row that exists purely to carry, say, a
 * `venuePublic` flip would otherwise have its two empty strings overwrite
 * whatever real links the repo markdown holds, deleting a published link
 * with no admin intent behind it. The two deadlines stay on a strict
 * `!= null` check: those columns are genuinely nullable, so `null` there is
 * a real, intentional signal.
 */
export function mergeOverlay(repo: RepoContent, overlay: Overlay | null): RepoContent {
  if (!overlay) return repo;

  const merged: RepoContent = { ...repo };
  const edition = overlay.edition ?? ({} as Partial<Overlay['edition']>);

  if (edition.registrationUrl) merged.registrationUrl = edition.registrationUrl;
  if (edition.abstractUrl) merged.abstractUrl = edition.abstractUrl;
  if (edition.registrationDeadline != null) merged.registrationDeadline = new Date(edition.registrationDeadline * 1000);
  if (edition.abstractDeadline != null) merged.abstractDeadline = new Date(edition.abstractDeadline * 1000);
  if (edition.venuePublic != null) merged.venuePublic = edition.venuePublic;
  if (edition.cityPublic != null) merged.cityPublic = edition.cityPublic;

  if (overlay.speakers && overlay.speakers.length > 0) {
    merged.speakers = overlay.speakers as unknown as Speaker[];
  }
  if (overlay.sessions && overlay.sessions.length > 0) {
    merged.sessions = overlay.sessions as unknown as Session[];
  }
  if (overlay.committee && overlay.committee.length > 0) {
    merged.committee = overlay.committee as unknown as CommitteeMember[];
  }

  // Assigned rather than merged-if-non-empty, unlike the three lists above.
  // Those exist in the repo and an empty overlay means "no opinion"; these
  // exist only in the CMS, so an empty list is the answer, not a silence.
  // Deleting an announcement has to make it disappear.
  merged.announcements = (overlay.announcements ?? []).map((a) => ({
    id: a.id,
    title: a.title,
    description: a.description,
    buttonText: a.button_text,
    buttonUrl: a.button_url,
  }));

  return merged;
}

/**
 * Fetches the overlay for `year` from `apiBase`.
 *
 * Returns null on any failure: an unreachable API, a non-2xx response, a
 * payload that doesn't parse as the expected shape, or an overlay serving a
 * different year than the one being built. A symposium site that fails to
 * build because an API blinked is worse than one that is a few hours out of
 * date, and a build that quietly succeeds with no data would delete the
 * programme -- so every failure here is loud in the log and never thrown.
 */
/**
 * Why a build has no overlay, which is three different situations that used
 * to be one `null`.
 *
 * The distinction matters because the right response differs. "The CMS has no
 * row for this edition yet" is the ordinary state of a symposium that has not
 * been programmed, and the site should build and say so. "We could not reach
 * the CMS, or could not trust what it said" is a fault, and if the repo alone
 * cannot fill the page, building anyway publishes an empty programme over a
 * live one -- Cloudflare Pages keeps the last successful deploy, so failing
 * loudly preserves what is published and succeeding quietly destroys it.
 */
export type OverlayResult =
  | { kind: "ok"; overlay: Overlay }
  | { kind: "empty"; reason: string }
  | { kind: "unavailable"; reason: string };

export async function fetchOverlay(year: number, apiBase: string): Promise<OverlayResult> {
  try {
    const res = await fetch(`${apiBase}/api/symposium`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) {
      return { kind: "unavailable", reason: `${res.status} from ${apiBase}` };
    }
    const json: unknown = await res.json();
    const data = parseOverlay(json);
    if (!data) {
      // We asked and got an answer we cannot read. That is a fault on the
      // server, not an empty CMS, and parseOverlay has logged the specifics.
      return { kind: "unavailable", reason: "payload shape mismatch" };
    }
    if (data.year === null) {
      return { kind: "empty", reason: "no edition row in the CMS yet" };
    }
    if (data.year !== year) {
      return { kind: "empty", reason: `CMS serves year ${data.year}, building ${year}` };
    }
    return { kind: "ok", overlay: data };
  } catch (err) {
    return { kind: "unavailable", reason: `unreachable (${String(err)})` };
  }
}

/**
 * Whether the repo alone can render a usable page for this edition.
 *
 * Anything at all counts: one speaker, one session, one committee member, or
 * a registration or abstract link. With none of them the page says only that
 * everything will be announced soon, which is the right thing to publish when
 * it is true and the wrong thing to publish over a programme that is already
 * live.
 */
export function repoCanStandAlone(repo: RepoContent): boolean {
  return (
    repo.speakers.length > 0 ||
    repo.sessions.length > 0 ||
    repo.committee.length > 0 ||
    repo.registrationUrl.trim() !== "" ||
    repo.abstractUrl.trim() !== ""
  );
}
