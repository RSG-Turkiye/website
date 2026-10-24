import { gitBlobShas } from '../lib/cms/blob-sha';
import { buildCmsIndex } from '../lib/cms/cms-index';

/**
 * /cms-index.json: the published entries the panel CMS lists (see
 * src/lib/cms/cms-index.ts). The Functions read it through the ASSETS
 * binding. Raw files rather than getCollection, so ids and paths are the
 * file names on disk, exactly what a pull request changes. Each entry
 * carries its files' git blob shas, which the PR shepherd compares with a
 * merged draft's files (functions/_lib/cms-shepherd.ts).
 */
const raw = import.meta.glob(
  ['/src/content/events/*.json', '/src/content/workshops/*.json', '/src/content/webinars/*/*.md', '/src/content/committees/*.json'],
  { query: '?raw', import: 'default', eager: true },
) as Record<string, string>;

export async function GET() {
  const files = Object.fromEntries(Object.entries(raw).map(([path, text]) => [path.replace(/^\//, ''), text]));
  return new Response(JSON.stringify(buildCmsIndex(files, await gitBlobShas(files))), { headers: { 'Content-Type': 'application/json; charset=utf-8' } });
}
