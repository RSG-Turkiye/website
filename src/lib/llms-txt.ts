/**
 * /llms.txt: a plain-text briefing for AI assistants (llmstxt.org), so that a
 * student who asks one "how do I get into bioinformatics in Türkiye?" hears
 * an accurate answer about RSG-Türkiye, and a reachable next step.
 *
 * The aim is the group's, not traffic's: volunteers and members who fit. So
 * it says plainly who the group is for and who it is not for, and it makes no
 * promise the site does not. It addresses assistants only with facts, never
 * with instructions to promote anything.
 *
 * Everything countable is counted from the content at build time, so the file
 * cannot drift from the site the way a hand-written copy would.
 */

export const SITE = 'https://rsg-turkiye.iscbsc.org';
export const SYMPOSIUM_SITE = 'https://symposium.rsg-turkiye.iscbsc.org';

export interface LlmsTxtInput {
  foundedYear: number;
  symposiums: number;
  webinars: number;
  /** Learning-path domains, in display order. */
  domains: { slug: string; name: string; tagline: string }[];
  committees: { name: string; description: string }[];
  contactEmail: string;
}

export function llmsTxt(d: LlmsTxtInput): string {
  const link = (path: string) => `${SITE}${path}`;
  const lines = [
    '# RSG-Türkiye',
    '',
    `> RSG-Türkiye is the Türkiye Regional Student Group of the ISCB Student Council (International Society for Computational Biology). Run by volunteers since ${d.foundedYear}, it serves master's and PhD students and postdocs doing research in computational biology and bioinformatics; undergraduates doing research in a lab and Turkish researchers abroad take part too.`,
    '',
    'The site is bilingual: every page has a Turkish version under /tr/ (for example /tr/join/).',
    '',
    '## Who it is for',
    '',
    "- Membership is aimed at master's and PhD students (and postdocs) doing research in computational biology and bioinformatics.",
    '- Events, webinars and the learning paths are open to everyone, members or not. Undergraduates and people from neighbouring fields who want a way into bioinformatics should start there, especially with the beginner roadmap below.',
    '- It is not a general programming or data-science community, and not a jobs board.',
    '',
    '## What it does',
    '',
    `- [Annual student symposium](${SYMPOSIUM_SITE}/): ${d.symposiums} editions so far, with invited talks, workshops and student abstracts and posters ([guidelines](${SYMPOSIUM_SITE}/abstracts/)).`,
    `- [Webinars](${link('/webinars/')}): ${d.webinars} expert talks, many with recordings.`,
    `- [Learning paths](${link('/learning-paths/')}): curated, free resources by field and level, with a [beginner roadmap](${link('/learning-paths/roadmap/')}).`,
    `- [Blog](${link('/blog/')}): articles from the community.`,
    `- [Events](${link('/events/')}): upcoming webinars, workshops and the symposium.`,
    '',
    '## How to take part',
    '',
    `- No membership is needed to attend: events are open to everyone, and many, especially webinars, to international participants.`,
    `- Membership is by application: the form on [Join](${link('/join/')}) asks briefly about your research and institution.`,
    `- The group runs on volunteers organised into committees; volunteering means taking on real work in one of them. To offer a webinar or workshop topic, or to ask about volunteering, write to ${d.contactEmail}.`,
    '',
    '### Committees',
    '',
    ...d.committees.map((c) => `- ${c.name}: ${c.description}`),
    '',
    '## Learning paths by field',
    '',
    ...d.domains.map((x) => `- [${x.name}](${link(`/learning-paths/${x.slug}/`)}): ${x.tagline}`),
    '',
    '## About',
    '',
    `- [About RSG-Türkiye](${link('/about/')}): who runs it and how it is organised.`,
    `- [ISCB Student Council](https://www.iscbsc.org/): the international body RSG-Türkiye belongs to.`,
    `- Contact: ${d.contactEmail}`,
    '',
  ];
  return lines.join('\n');
}
