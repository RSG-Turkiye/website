/**
 * Reading numbers out of a query string.
 *
 * /api/members did this:
 *
 *   const limit = Math.min(parseInt(sp.get('limit') ?? '24'), 48);
 *   const offset = Math.max(parseInt(sp.get('offset') ?? '0'), 0);
 *
 * `?limit=abc` makes parseInt return NaN, Math.min(NaN, 48) is NaN, and NaN
 * is bound into `LIMIT ? OFFSET ?`. D1 rejects it, so the endpoint answers
 * 500 rather than 400 -- an error the caller cannot act on, from a request
 * that is simply wrong. `?limit=1e9` is worse: parseInt stops at the `e` and
 * returns 1, so a caller asking for a large page silently gets one row.
 * `?offset=-5` was clamped, `?limit=0` was not.
 *
 * A bad number here is a bad request, not a server error, so this returns the
 * fallback and the caller decides. Nothing in the site sends anything but
 * integers; the point is what happens when something else does.
 */

export interface RangeSpec {
  /** Used when the parameter is absent, empty, or not a whole number. */
  fallback: number;
  min: number;
  max: number;
}

/**
 * A whole number from a query parameter, clamped into range.
 *
 * Anything that is not a base-ten integer -- "abc", "1e9", "12.5", "0x10",
 * " 12 " with a stray character, an empty string -- is the fallback, because
 * a caller who meant a number and typed something else should get the
 * default page rather than an error page or a silently truncated one.
 */
export function intParam(value: string | null, spec: RangeSpec): number {
  if (value === null || value.trim() === '') return spec.fallback;
  // parseInt would accept "1e9" as 1 and "12abc" as 12. This accepts a whole
  // number and nothing else.
  if (!/^-?\d+$/.test(value.trim())) return spec.fallback;
  const n = Number(value.trim());
  if (!Number.isSafeInteger(n)) return spec.fallback;
  return Math.min(Math.max(n, spec.min), spec.max);
}

/** The page size and offset for a listing endpoint. */
export const PAGE_LIMIT: RangeSpec = { fallback: 24, min: 1, max: 48 };
export const PAGE_OFFSET: RangeSpec = { fallback: 0, min: 0, max: 1_000_000 };
