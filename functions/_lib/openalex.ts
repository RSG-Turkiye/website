import { PRIVACY_CONTACT } from '../../src/data/contact';

/**
 * A professor's research topics from OpenAlex (api.openalex.org), the free
 * scholarly index: the author's topics by how many of their works carry
 * each, top 15. `mailto` puts the requests in OpenAlex's polite pool; it is
 * the organisation's public address, never a person's.
 */
export async function fetchAuthorTopics(openalexId: string): Promise<string[]> {
  const url = new URL(`https://api.openalex.org/authors/${encodeURIComponent(openalexId)}`);
  url.searchParams.set('mailto', PRIVACY_CONTACT);
  url.searchParams.set('select', 'topics');
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`openalex: ${res.status}`);
  const body = (await res.json()) as { topics?: { display_name?: string; count?: number }[] };
  return (body.topics ?? [])
    .filter((t) => typeof t.display_name === 'string' && t.display_name.trim())
    .sort((a, b) => Number(b.count ?? 0) - Number(a.count ?? 0))
    .slice(0, 15)
    .map((t) => t.display_name!.trim());
}
