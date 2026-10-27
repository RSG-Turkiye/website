import { z } from "astro/zod";
import { ROLES } from "../../functions/_lib/roles";

/**
 * The frontmatter of a role guide in the admin panel's Help section.
 * Guides are Markdown, one per language and slug:
 *   src/content/help/tr/<slug>.md
 *   src/content/help/en/<slug>.md
 * `roles` lists the role keys (functions/_lib/roles.ts) the guide is for, or
 * "all" for everyone; the panel shows a person the guides of the roles they
 * hold. That is for relevance, not security: the text is public in the repo.
 * `tests/help-guides.test.ts` checks the keys are real and every role is
 * covered.
 *
 * Here rather than in src/content.config.ts so node scripts can use it
 * without astro:content.
 */
const roleKeys = ROLES.map((r) => r.key) as [string, ...string[]];

export const helpSchema = z.object({
  title: z.string(),
  /** Role keys the guide is for, or "all". */
  roles: z.array(z.enum([...roleKeys, "all"])).min(1),
  /** Position in the Help list; the connect guide comes first. */
  order: z.number(),
});
