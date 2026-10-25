// The privacy notice, in both languages: src/content/privacy/privacy.json
// (schema: src/data/privacy-schema.ts), edited in the panel. Each fact there
// is what the code does today: when a table, a retention job or a
// third-party call changes, change the matching line too.
// tests/privacy-page.test.ts pins the retention numbers to the constants
// that enforce them.

import data from '../content/privacy/privacy.json';
import { privacySchema, type PrivacyNotice } from './privacy-schema';

export type { PrivacyNotice, PrivacySection } from './privacy-schema';

/** Written `{contact}` in the notice's text, so the file in git holds no address. */
export const PRIVACY_CONTACT = 'turkey.rsg@gmail.com';

/** A text of the notice with `{contact}` filled in. */
export const withContact = (text: string): string => text.split('{contact}').join(PRIVACY_CONTACT);

function expanded(n: PrivacyNotice): PrivacyNotice {
  return {
    title: withContact(n.title),
    description: withContact(n.description),
    intro: n.intro.map(withContact),
    sections: n.sections.map((s) => ({ heading: withContact(s.heading), paragraphs: s.paragraphs.map(withContact), items: s.items.map(withContact) })),
  };
}

// Parsed at build time: a file the schema refuses fails the build.
const notice = privacySchema.parse(data);

/** The day the notice last changed (YYYY-MM-DD). */
export const PRIVACY_UPDATED = notice.updated;

/** Each language's notice, with the contact address filled in. */
export const PRIVACY: Record<'en' | 'tr', PrivacyNotice> = { en: expanded(notice.en), tr: expanded(notice.tr) };
