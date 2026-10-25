/**
 * The committees on /about and /tr/about, one JSON file per committee in
 * src/content/committees. They used to be two parallel arrays, one per
 * language; everything that differed between them (committee name and
 * description, role, education) is `{ en, tr }` now.
 *
 * These are published profiles, in git with each member's consent
 * (`consent: true`); e-mail addresses are not, and the schema refuses one.
 *
 * No astro:content import here, so node tests can use it; the loader is
 * src/lib/get-committees.ts.
 */

import { z } from "astro/zod";
import { imageUrl } from "./image-url";

type Lang = "en" | "tr";

const bilingual = z.object({ en: z.string(), tr: z.string() }).strict();
/** A text the page shows as a heading or a role: both languages written
 * (tests/content-committees.test.ts), so the panel refuses an empty one at
 * submit instead of CI after the merge. */
const said = z.string().min(1).regex(/\S/, "Write something, not only spaces");
const filled = z.object({ en: said, tr: said }).strict();

const memberSchema = z
  .object({
    name: said,
    role: filled,
    image: imageUrl,
    education: z
      .array(
        z
          .object({
            degree: bilingual,
            field: bilingual,
            institution: bilingual,
            year: z.string().optional(),
          })
          .strict(),
      )
      .optional(),
    socialMedia: z
      .array(
        z
          .object({
            platform: z.enum(["twitter", "linkedin", "facebook", "github", "instagram"]),
            url: z.string(),
          })
          .strict(),
      )
      .optional(),
    /** The member agreed to this profile being published. Required. */
    consent: z.literal(true),
  })
  .strict();

export const committeeSchema = z
  .object({
    /** Position on the page: smaller first, in steps of 10 (0, 10, 20, ...)
     * so a new committee fits between two. Two equal ones sort by name. */
    order: z.number().int().nonnegative(),
    name: filled,
    description: filled,
    members: z.array(memberSchema),
  })
  .strict();

export type CommitteeEntry = z.infer<typeof committeeSchema>;

export interface CommitteeMember {
  name: string;
  role: string;
  image: string;
  education?: {
    degree: string;
    field: string;
    institution: string;
    year?: string;
  }[];
  socialMedia?: {
    platform: 'twitter' | 'linkedin' | 'facebook' | 'github' | 'instagram';
    url: string;
  }[];
}

export interface Committee {
  name: string;
  description: string;
  members: CommitteeMember[];
}

/** By order; two committees with the same order fall back to their English
 * name, so a duplicate order (two drafts approved apart) still sorts the same
 * way every build instead of failing anything. */
export const sortCommittees = (list: CommitteeEntry[]) =>
  [...list].sort((a, b) => a.order - b.order || a.name.en.localeCompare(b.name.en, "en"));

/** The committees in one language, in the shape the cards render. */
export function committeesFor(list: CommitteeEntry[], lang: Lang): Committee[] {
  return sortCommittees(list).map((c) => ({
    name: c.name[lang],
    description: c.description[lang],
    members: c.members.map((m) => ({
      name: m.name,
      role: m.role[lang],
      image: m.image,
      ...(m.education && {
        education: m.education.map((e) => ({
          degree: e.degree[lang],
          field: e.field[lang],
          institution: e.institution[lang],
          ...(e.year && { year: e.year }),
        })),
      }),
      ...(m.socialMedia && {
        socialMedia: m.socialMedia.map((s) => ({
          platform: s.platform,
          url: s.url,
        })),
      }),
    })),
  }));
}
