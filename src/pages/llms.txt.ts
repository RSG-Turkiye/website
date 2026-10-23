import { getCollection } from 'astro:content';
import { llmsTxt } from '../lib/llms-txt';
import { symposiumCount, symposiumEditions } from '../lib/home-stats';
import { FOUNDED_YEAR } from '../data/events';
import { committeesEn } from '../data/committees';
import { PRIVACY_CONTACT } from '../data/privacy';
import { workshopUrl } from '../data/workshops';
import { getWorkshops } from '../lib/get-workshops';

/** /llms.txt, built from the content; see src/lib/llms-txt.ts for what it is for. */
export async function GET() {
  const webinars = await getCollection('webinars', (e) => e.id.startsWith('en/') && !e.data.draft);
  const domains = (await getCollection('lpDomains', (e) => e.id.startsWith('en/')))
    .sort((a, b) => a.data.order - b.data.order)
    .map((e) => ({ slug: e.id.slice(3), name: e.data.name, tagline: e.data.tagline }));
  const body = llmsTxt({
    foundedYear: FOUNDED_YEAR,
    symposiums: symposiumCount(symposiumEditions(), new Date()),
    webinars: webinars.length,
    domains,
    // Who sits on them changes every term; what they do is what a reader needs.
    committees: committeesEn.map((c) => ({ name: c.name, description: c.description })),
    workshops: (await getWorkshops()).map((w) => ({ year: w.year, title: w.title, topics: w.topics, url: workshopUrl(w) })),
    contactEmail: PRIVACY_CONTACT,
  });
  return new Response(body, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}
