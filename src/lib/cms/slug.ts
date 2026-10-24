/**
 * File names for content entries. Apart from types.ts so the admin panel can
 * show a new entry's file name without bundling the content schemas.
 */

/** A file name without extension: lower-case letters, digits and hyphens.
 * Returns the id, or throws. */
export function checkId(id: string): string {
  // The typeof first: RegExp.test coerces, so undefined would pass as "undefined".
  if (typeof id !== "string" || !/^[a-z0-9][a-z0-9-]*$/.test(id)) {
    throw new Error(`Invalid id ${JSON.stringify(id)}: use lower-case letters, digits and hyphens`);
  }
  return id;
}

const TR_ASCII: Record<string, string> = { ç: "c", ğ: "g", ı: "i", İ: "i", ö: "o", ş: "s", ü: "u" };

/** A file-name slug: Turkish letters transliterated, everything else not a
 * letter or digit collapsed to single hyphens. */
export function slugify(text: string): string {
  return text
    .replace(/[çğıİöşü]/gi, (c) => TR_ASCII[c] ?? TR_ASCII[c.toLowerCase()] ?? c)
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** A roadmap stage's file name: its number, two digits at least, then the slug (07-direction). */
export function stageId(n: number, slug: string): string {
  return checkId(`${String(n).padStart(2, "0")}-${slug}`);
}

/** The number a roadmap stage's file name starts with, or null. */
export function stageNumber(id: string): number | null {
  const m = /^(\d+)-/.exec(id);
  return m ? Number(m[1]) : null;
}

/** A new roadmap stage's number: after the highest one (A11). Numbers left
 * by a deleted stage are not reused, so the order of the others never moves. */
export function nextStageNumber(ids: readonly string[]): number {
  return Math.max(0, ...ids.map(stageNumber).filter((n): n is number => n !== null)) + 1;
}
