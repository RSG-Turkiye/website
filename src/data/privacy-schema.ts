/**
 * The privacy notice, src/content/privacy/privacy.json: one file, both
 * languages, edited in the panel (Sayfalar › Gizlilik; only an admin
 * approves it). `updated` is the day the last change was approved: the
 * server sets it at approval (functions/api/cms/drafts/[id]/approve.ts),
 * never the form. The contact address is written `{contact}` in the text
 * and filled in from PRIVACY_CONTACT (src/data/privacy.ts), so the file
 * holds no e-mail address.
 *
 * Keys are in the file's order: the CMS writes them in this order. No
 * astro:content import here, so node tests and the Functions can use it.
 */

import { z } from "astro/zod";

export const PRIVACY_PARITY_MESSAGE = "The Turkish notice must have as many paragraphs, sections and items as the English one";

const text = z.string().trim().min(1);

export const PRIVACY_EMPTY_SECTION_MESSAGE = "A section needs a paragraph or a list item";

export const privacySectionSchema = z
  .object({
    heading: text,
    /** Either list may be empty: a section is paragraphs, a list, or both, never neither. */
    paragraphs: z.array(text),
    items: z.array(text),
  })
  .refine((s) => s.paragraphs.length + s.items.length > 0, { message: PRIVACY_EMPTY_SECTION_MESSAGE, path: ["paragraphs"], params: { incomplete: true } });

export const privacyNoticeSchema = z.object({
  title: text,
  description: text,
  intro: z.array(text).min(1),
  sections: z.array(privacySectionSchema).min(1),
});

export type PrivacySection = z.infer<typeof privacySectionSchema>;
export type PrivacyNotice = z.infer<typeof privacyNoticeSchema>;

/**
 * The two languages say the same things, section for section: the same
 * number of intro paragraphs and sections, and in each section the same
 * number of paragraphs and items (plan 4, A8). A difference is work in
 * progress while a draft is saved (`incomplete`), and refused at submit.
 */
function sameShape(n: { en: PrivacyNotice; tr: PrivacyNotice }, ctx: z.RefinementCtx): void {
  const issue = (path: (string | number)[]) =>
    ctx.addIssue({ code: "custom", message: PRIVACY_PARITY_MESSAGE, path: ["tr", ...path], params: { incomplete: true } });
  const { en, tr } = n;
  if (!Array.isArray(en?.intro) || !Array.isArray(tr?.intro) || !Array.isArray(en?.sections) || !Array.isArray(tr?.sections)) return;
  if (en.intro.length !== tr.intro.length) issue(["intro"]);
  if (en.sections.length !== tr.sections.length) issue(["sections"]);
  en.sections.forEach((s, i) => {
    const t = tr.sections[i];
    if (!t) return;
    if (s.paragraphs?.length !== t.paragraphs?.length) issue(["sections", i, "paragraphs"]);
    if (s.items?.length !== t.items?.length) issue(["sections", i, "items"]);
  });
}

export const privacySchema = z
  .object({
    /** YYYY-MM-DD, Istanbul time: set by the server when a change is approved. */
    updated: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Must be a date (YYYY-MM-DD)"),
    en: privacyNoticeSchema,
    tr: privacyNoticeSchema,
  })
  .superRefine(sameShape);

export type Privacy = z.infer<typeof privacySchema>;
