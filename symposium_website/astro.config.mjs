import { copyFileSync, existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import tailwindcss from '@tailwindcss/vite';

/**
 * How many sessions /schedule/ actually rendered, read off the built page.
 *
 * The page covers the current edition only, so between one symposium and the
 * next it is a heading and "will be announced soon". Listing that in the
 * sitemap is asking a crawler to fetch a page with nothing on it, which is
 * how 233 URLs ended up as "Discovered - currently not indexed".
 *
 * It has to be read from the output rather than from the content directory:
 * the programme can arrive through the CMS overlay, which this file cannot
 * see and which src/content/sessions/ would not know about. The page states
 * its own count in `data-sessions`, and this believes it.
 */
let renderedSessions = 0;

export default defineConfig({
  site: 'https://symposium.rsg-turkiye.iscbsc.org',
  output: 'static',
  integrations: [
    // Declared before sitemap() so its astro:build:done runs first and the
    // filter below has a number to work with.
    {
      name: 'schedule-probe',
      hooks: {
        'astro:build:done': ({ dir }) => {
          const built = `${fileURLToPath(dir)}schedule/index.html`;
          const html = existsSync(built) ? readFileSync(built, 'utf8') : '';
          const match = html.match(/data-sessions="(\d+)"/);
          if (!match) {
            throw new Error(
              'schedule/index.html has no data-sessions attribute; the sitemap ' +
                'filter cannot tell whether the page is empty. Restore it.',
            );
          }
          renderedSessions = Number(match[1]);
        },
      },
    },
    sitemap({
      filter: (page) => renderedSessions > 0 || !/\/schedule\/$/.test(page),
    }),
    // Cloudflare Pages serves the 404.html closest to the requested path, so
    // /tr/404.html covers everything under /tr/. Astro only special-cases the
    // root 404.astro into dist/404.html; the Turkish one builds like any other
    // page, at dist/tr/404/index.html, where nothing looks for it.
    {
      name: 'localised-404',
      hooks: {
        'astro:build:done': ({ dir }) => {
          const root = fileURLToPath(dir);
          const built = `${root}tr/404/index.html`;
          if (!existsSync(built)) {
            throw new Error('tr/404 did not build; /tr/* would fall back to the English 404');
          }
          copyFileSync(built, `${root}tr/404.html`);
        },
      },
    },
  ],
  vite: {
    plugins: [tailwindcss()],
  },
});
