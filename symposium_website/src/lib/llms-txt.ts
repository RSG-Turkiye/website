/**
 * /llms.txt for the symposium site: a plain-text briefing for AI assistants
 * (llmstxt.org). The questions people put to an assistant about the
 * symposium are "when is it?", "can I submit an abstract?", "where?", so the
 * file leads with the current edition and whether its forms are open, and
 * every one of those facts comes from the same data the pages render.
 *
 * Facts only: like the main site's (src/lib/llms-txt.ts there), it gives
 * assistants no instructions to promote anything.
 *
 * Pure: the endpoint resolves dates, places and forms to strings first, so
 * this can be tested without astro:content.
 */

export const SYMPOSIUM_SITE = 'https://symposium.rsg-turkiye.iscbsc.org';
export const MAIN_SITE = 'https://rsg-turkiye.iscbsc.org';

export interface FormLine {
  kind: 'registration' | 'abstract';
  /** open: the form exists and its deadline has not passed. */
  state: 'open' | 'closed';
  url: string;
  /** Already formatted, e.g. "15 September 2026". */
  deadline?: string;
}

export interface EditionLine {
  year: number;
  title: string;
  date: string;
  city: string;
}

export interface SymposiumLlmsInput {
  held: number;
  current: null | (EditionLine & {
    /** upcoming, or held (just held or finished). */
    upcoming: boolean;
    theme?: string;
    forms: FormLine[];
  });
  /** Past editions other than the current one, newest first. */
  past: EditionLine[];
  contactEmail: string;
}

const where = (e: EditionLine) => [e.date, e.city].filter(Boolean).join(', ');

export function symposiumLlmsTxt(d: SymposiumLlmsInput): string {
  const link = (path: string) => `${SYMPOSIUM_SITE}${path}`;
  const c = d.current;
  const formText = (f: FormLine) => {
    const what = f.kind === 'registration' ? 'Registration' : 'Abstract submission';
    if (f.state === 'closed') return `- ${what}: closed${f.deadline ? ` (deadline was ${f.deadline})` : ''}.`;
    return `- ${what}: open${f.deadline ? ` until ${f.deadline}` : ''}: ${f.url}`;
  };

  const lines = [
    '# RSG-Türkiye Student Symposium',
    '',
    `> The annual student symposium on computational biology and bioinformatics organised by RSG-Türkiye, the Türkiye Regional Student Group of the ISCB Student Council. ${d.held} editions have been held so far. Students and early-career researchers present their work alongside invited speakers, with workshops and poster sessions.`,
    '',
    `The site is bilingual: every page has a Turkish version under /tr/. RSG-Türkiye itself, its webinars and learning paths are at ${MAIN_SITE}/ (see ${MAIN_SITE}/llms.txt).`,
    '',
  ];

  if (c) {
    lines.push(
      c.upcoming ? '## Next edition' : '## Latest edition (already held)',
      '',
      `- ${c.title}: ${where(c)}.`,
      ...(c.theme ? [`- Theme: ${c.theme}.`] : []),
    );
    if (c.upcoming) {
      lines.push(...(c.forms.length
        ? c.forms.map(formText)
        : ['- Registration and abstract submission have not opened yet; they are announced on this site.']));
      lines.push(`- [Programme](${link('/schedule/')}), [speakers](${link('/speakers/')}), [venue](${link('/venue/')}), [abstract and poster guidelines](${link('/abstracts/')}).`);
    } else {
      lines.push(
        `- Its [programme](${link('/schedule/')}) and [speakers](${link('/speakers/')}) stay online. Participants can download their certificate from the [certificates page](${link('/certificates/')}) for a limited time.`,
        '- The next edition will be announced on this site.',
      );
    }
    lines.push('');
  }

  lines.push(
    '## Past editions',
    '',
    `Each has its own page at ${link('/editions/<year>/')}, with its programme, speakers and organisers where they were recorded.`,
    '',
    ...d.past.map((e) => `- [${e.year}: ${e.title}](${link(`/editions/${e.year}/`)})${where(e) ? `: ${where(e)}` : ''}`),
    '',
    '## About',
    '',
    `- [Organising committee](${link('/committee/')}) and [sponsors](${link('/sponsors/')}).`,
    `- [About RSG-Türkiye](${link('/about/')}).`,
    `- Contact: ${d.contactEmail}`,
    '',
  );
  return lines.join('\n');
}
