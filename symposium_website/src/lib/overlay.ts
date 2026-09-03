// The build-time merge of the CMS overlay onto the repo's own content.
//
// The repo is always the source of a working site; D1 is an overlay on top
// of it. `mergeOverlay` is pure and takes no astro import, so it (and
// `parseOverlay`) load under plain `node:test` -- only `fetchOverlay` is
// impure, and it is the sole place a network call happens.
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
  committee: z.array(z.object({ name: z.string() }).passthrough()),
  announcements: z.array(z.unknown()),
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
 */
export function mergeOverlay(repo: RepoContent, overlay: Overlay | null): RepoContent {
  if (!overlay) return repo;

  const merged: RepoContent = { ...repo };
  const edition = overlay.edition ?? ({} as Partial<Overlay['edition']>);

  if (edition.registrationUrl != null) merged.registrationUrl = edition.registrationUrl;
  if (edition.abstractUrl != null) merged.abstractUrl = edition.abstractUrl;
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
export async function fetchOverlay(year: number, apiBase: string): Promise<Overlay | null> {
  try {
    const res = await fetch(`${apiBase}/api/symposium`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) {
      console.error(`[overlay] ${res.status} from ${apiBase} -- building from the repo alone`);
      return null;
    }
    const json: unknown = await res.json();
    const data = parseOverlay(json);
    if (!data) {
      // parseOverlay already logged the specific mismatch.
      return null;
    }
    if (data.year !== year) {
      console.error(`[overlay] serves year ${data.year}, building ${year} -- building from the repo alone`);
      return null;
    }
    return data;
  } catch (err) {
    console.error(`[overlay] unreachable (${String(err)}) -- building from the repo alone`);
    return null;
  }
}
