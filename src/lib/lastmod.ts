import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';

/**
 * When each page last actually changed, for the sitemap's <lastmod>.
 *
 * The sitemaps carried 324 URLs and no lastmod at all, which throws away the
 * one freshness signal a sitemap can give: a crawler has no way to tell the
 * thirty pages written this week from the ones untouched since 2019.
 *
 * The date comes from git -- the commit that last touched the file behind the
 * URL. Not the build time, which would mark all 324 as changed on every
 * deploy; not the content's own `date` field, which is when a webinar was
 * *given* and would announce a page written yesterday as eleven years old.
 * Google discounts lastmod it finds unreliable, so a wrong one is worse than
 * none.
 *
 * If git history is unavailable -- a shallow clone, an export, a tarball --
 * the map is empty or partial and those URLs simply get no lastmod. That is
 * the safe direction to fail in: a missing lastmod is ignored, an invented
 * one is a lie that costs the whole signal.
 */

/** file path (repo-relative) -> ISO date of the commit that last touched it. */
function gitDates(): Map<string, string> {
  const dates = new Map<string, string>();
  let log: string;
  try {
    log = execFileSync(
      'git',
      ['log', '--pretty=format:%cI', '--name-only', '--no-merges', '--date-order'],
      { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] },
    );
  } catch {
    return dates; // no git, or no history: every URL goes without a lastmod
  }

  let current = '';
  for (const line of log.split('\n')) {
    if (line === '') continue;
    if (/^\d{4}-\d{2}-\d{2}T/.test(line)) {
      current = line;
      continue;
    }
    // --date-order walks newest first, so the first time a path appears is
    // the last commit that touched it.
    if (current && !dates.has(line)) dates.set(line, current);
  }
  return dates;
}

/**
 * The file a URL is built from.
 *
 * Content pages map to their markdown; everything else to the .astro route.
 * Returns null when nothing obvious matches, and the URL goes without a date
 * rather than borrowing one from a file that does not build it.
 */
function sourceFor(pathname: string): string | null {
  const clean = pathname.replace(/^\/|\/$/g, '');
  const parts = clean === '' ? [] : clean.split('/');
  const tr = parts[0] === 'tr';
  const lang = tr ? 'tr' : 'en';
  const rest = tr ? parts.slice(1) : parts;

  // /blog/<slug>/ and /webinars/<slug>/ come from a content collection.
  if (rest.length === 2 && (rest[0] === 'blog' || rest[0] === 'webinars')) {
    const file = `src/content/${rest[0]}/${lang}/${rest[1]}.md`;
    return existsSync(file) ? file : null;
  }

  // /learning-paths/<domain>/ is a dynamic route whose content lives in a
  // collection file, the same as a blog post.
  if (rest.length === 2 && rest[0] === 'learning-paths') {
    const file = `src/content/lp-domains/${lang}/${rest[1]}.md`;
    if (existsSync(file)) return file;
  }

  // /tags/<tag>/ deliberately gets nothing. The page is a list of posts, so
  // its honest last-changed is the newest post carrying that tag -- not the
  // template, which is the only file here. Rather than date it by a file that
  // is not what changes, it goes without: a missing lastmod is ignored, a
  // misleading one discredits the rest.
  if (rest.length === 2 && rest[0] === 'tags') return null;

  // Everything else is a route file. Try the directory form first, since most
  // of the site's pages are index.astro inside a folder.
  const base = tr ? `src/pages/tr/${rest.join('/')}` : `src/pages/${rest.join('/')}`;
  const candidates = rest.length === 0
    ? [tr ? 'src/pages/tr/index.astro' : 'src/pages/index.astro']
    : [`${base}.astro`, `${base}/index.astro`];
  return candidates.find((c) => existsSync(c)) ?? null;
}

/**
 * Where this project sits inside the repository, e.g. "symposium_website/".
 *
 * `git log --name-only` prints paths from the repository root, while
 * `sourceFor` returns them relative to the project. When the two are the same
 * directory that difference is invisible; when the project is a subdirectory
 * every lookup misses, and the sitemap quietly loses its dates. Measured: 5
 * of 43 URLs kept a lastmod before this.
 */
function repoPrefix(): string {
  try {
    return execFileSync('git', ['rev-parse', '--show-prefix'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return '';
  }
}

const dates = gitDates();
const prefix = repoPrefix();
const cache = new Map<string, string | undefined>();

/** ISO date this URL's source last changed, or undefined when unknown. */
export function lastmodFor(url: string): string | undefined {
  if (cache.has(url)) return cache.get(url);
  let out: string | undefined;
  try {
    const file = sourceFor(new URL(url).pathname);
    out = file ? dates.get(prefix + file) : undefined;
  } catch {
    out = undefined;
  }
  cache.set(url, out);
  return out;
}

/** Exposed for the tests: how much of the map git actually gave us. */
export const gitHistoryAvailable = dates.size > 0;
export { sourceFor as __sourceFor };
