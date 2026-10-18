import { getCollection } from 'astro:content';
import { symposiumLlmsTxt, type FormLine } from '../lib/llms-txt';
import { getCurrentEdition } from '../lib/editions-content';
import { getCurrentContent, withOverlayContent } from '../lib/content';
import { ctasFor, dateFor, hasHappened, locationFor, subtitleFor, symposiumsHeld, type EditionLike } from '../lib/editions';

/** /llms.txt, rebuilt with the site (nightly at least); see src/lib/llms-txt.ts. */
export async function GET() {
  const now = new Date();
  const editions = (await getCollection('editions')).map((e) => e.data);
  const { state, entry } = await getCurrentEdition(now);
  // The CMS overlay can change dates and forms after the edition file was
  // written; the abstracts page reads them the same way.
  const current = entry ? withOverlayContent(entry.data, await getCurrentContent()) : null;

  // Where, as the pages are allowed to say it: a withheld venue stays withheld.
  const cityOf = (e: EditionLike) => {
    const place = locationFor(e, now, 'en');
    return place.kind === 'hidden' ? '' : place.city;
  };
  const fmt = (d?: Date) => d?.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Istanbul' });
  const line = (e: EditionLike) => ({ year: e.year, title: e.title, date: dateFor(e, 'en'), city: cityOf(e) });

  const body = symposiumLlmsTxt({
    held: symposiumsHeld(editions, now),
    current: current && {
      ...line(current),
      upcoming: !hasHappened(state),
      theme: subtitleFor(current, 'en') || undefined,
      forms: ctasFor(current, now).map((c): FormLine => ({ kind: c.kind, state: c.state, url: c.url, deadline: fmt(c.deadline) })),
    },
    past: editions
      .filter((e) => e.year !== current?.year && (e.startDate ? e.startDate < now : e.year < now.getFullYear()))
      .sort((a, b) => b.year - a.year)
      .map(line),
    contactEmail: 'turkey.rsg@gmail.com',
  });
  return new Response(body, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}
