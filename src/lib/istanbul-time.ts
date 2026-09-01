/**
 * Every time a member sees or sets on the compose pages is Europe/Istanbul
 * time, never the browser's local timezone.
 *
 * RSG Türkiye, its members and its recipients are all in Turkey. A member
 * travelling abroad, or one whose machine's clock is misconfigured, would
 * otherwise schedule mail for the wrong hour with no sign anything was off --
 * the `datetime-local` input just shows a bare "09:00" either way.
 *
 * This lives here, imported from a `<script>` block in both
 * `src/pages/account/mail.astro` and `src/pages/tr/account/mail.astro`
 * (mirroring `src/lib/badges.ts`, imported the same way from
 * `src/pages/members.astro`), so the two pages cannot drift apart on how a
 * schedule time is read or shown.
 *
 * The Istanbul offset is derived from `Intl` rather than hardcoded as
 * `+03:00`. Turkey has had no DST since 2016, so the offset is a constant in
 * practice today, but a constant buried in a page is exactly the thing nobody
 * finds when the rule changes again.
 */

const TIME_ZONE = 'Europe/Istanbul';

/**
 * The Istanbul UTC offset, in seconds, at the given instant. Formats the
 * instant with Intl using the target zone, reassembles the parts with
 * Date.UTC, and takes the difference from the original instant -- the offset
 * is exactly how far the zone's wall clock has drifted from UTC at that
 * moment.
 */
function istanbulOffsetSeconds(epochMs: number): number {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: TIME_ZONE,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  const parts: Record<string, string> = {};
  for (const part of formatter.formatToParts(new Date(epochMs))) {
    if (part.type !== 'literal') parts[part.type] = part.value;
  }

  // Some engines render midnight as hour "24" rather than "00" under
  // hour12: false -- normalise before handing it to Date.UTC.
  const hour = Number(parts.hour) % 24;

  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    hour,
    Number(parts.minute),
    Number(parts.second),
  );

  return Math.round((asUtc - epochMs) / 1000);
}

const pad = (n: number) => String(n).padStart(2, '0');

/**
 * An epoch (seconds) to the `YYYY-MM-DDTHH:mm` string a `datetime-local`
 * input wants, rendered in Istanbul time.
 */
export function epochToIstanbulInput(epoch: number): string {
  const epochMs = epoch * 1000;
  const offsetSeconds = istanbulOffsetSeconds(epochMs);
  const istanbul = new Date(epochMs + offsetSeconds * 1000);

  return (
    `${istanbul.getUTCFullYear()}-${pad(istanbul.getUTCMonth() + 1)}-${pad(istanbul.getUTCDate())}` +
    `T${pad(istanbul.getUTCHours())}:${pad(istanbul.getUTCMinutes())}`
  );
}

/**
 * The inverse of epochToIstanbulInput: a naive `datetime-local` string, read
 * as Istanbul time, to epoch seconds. Returns undefined for an empty or
 * unparseable value, matching the old per-page `localToEpoch`.
 *
 * The naive string carries no timezone of its own, so it is first read as if
 * it were UTC to get a first-guess instant, whose Istanbul offset is taken
 * and subtracted to correct the guess. That correction can itself land on a
 * moment with a (very rarely) different offset -- e.g. either side of a DST
 * transition were Turkey to reintroduce one -- so the offset is re-derived at
 * the corrected instant and applied a second time. Two passes converges and
 * stays correct either way; Turkey's current fixed +03:00 makes both passes
 * agree, so this is not a behaviour change today, only future-proofing.
 */
export function istanbulInputToEpoch(value: string): number | undefined {
  // Parsed by hand, rather than via `new Date(value)`, on purpose: a
  // timezone-less string like this is spec'd to be parsed by `Date` as the
  // *host's* local time, which is precisely the machine-dependent behaviour
  // this module exists to get away from (and would make this function's
  // result depend on the timezone `node --test` happens to run under).
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value);
  if (!match) return undefined;

  const [, yearStr, monthStr, dayStr, hourStr, minuteStr, secondStr] = match;
  const year = Number(yearStr);
  const month = Number(monthStr);
  const day = Number(dayStr);
  const hour = Number(hourStr);
  const minute = Number(minuteStr);
  const second = secondStr ? Number(secondStr) : 0;

  // Treating the wall-clock numbers as if they were a UTC instant gives a
  // value numerically equal to the naive string -- a first guess for the
  // epoch, off by whatever the real Istanbul/UTC offset is.
  const naiveAsUtcMs = Date.UTC(year, month - 1, day, hour, minute, second);
  if (Number.isNaN(naiveAsUtcMs)) return undefined;

  // Date.UTC silently rolls over an out-of-range field (month 13, day 32,
  // hour 25, ...) instead of failing, which would otherwise turn a malformed
  // string like "2026-13-40T25:99" into some other, unrelated valid date.
  // Reconstructing it and comparing catches that.
  const rebuilt = new Date(naiveAsUtcMs);
  if (
    rebuilt.getUTCFullYear() !== year ||
    rebuilt.getUTCMonth() !== month - 1 ||
    rebuilt.getUTCDate() !== day ||
    rebuilt.getUTCHours() !== hour ||
    rebuilt.getUTCMinutes() !== minute ||
    rebuilt.getUTCSeconds() !== second
  ) {
    return undefined;
  }

  // First pass: subtract the offset at that first guess.
  const firstPassMs = naiveAsUtcMs - istanbulOffsetSeconds(naiveAsUtcMs) * 1000;
  // Second pass: re-derive the offset at the corrected instant and apply it
  // again. Converges immediately when the offset is constant across both
  // instants (true for Istanbul today), and stays correct across a DST-style
  // jump if Turkey ever reintroduces one.
  const correctedMs = naiveAsUtcMs - istanbulOffsetSeconds(firstPassMs) * 1000;

  return Math.floor(correctedMs / 1000);
}

/** A human-readable Istanbul date-time, for the queue and history lists. */
export function formatIstanbul(epoch: number, locale: string): string {
  return new Date(epoch * 1000).toLocaleString(locale, { timeZone: TIME_ZONE });
}
