import { getCollection } from 'astro:content';
import { buildCatalog } from '../../lib/guide-catalog';

/** /guide/catalog.json: universities, MSc programmes and related terms
 * (src/lib/guide-catalog.ts). Static, built from git. */
export async function GET() {
  const catalog = buildCatalog(
    (await getCollection('guideUniversities')).map((e) => e.data),
    (await getCollection('guideProgrammes')).map((e) => e.data),
    (await getCollection('guideTerms')).map((e) => e.data),
  );
  return new Response(JSON.stringify(catalog), { headers: { 'Content-Type': 'application/json; charset=utf-8' } });
}
