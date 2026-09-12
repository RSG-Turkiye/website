import { copyFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import tailwindcss from '@tailwindcss/vite';
import { isNoindexPath } from './src/lib/noindex-routes';
import { rehypeLazyImages } from './src/plugins/rehype-lazy-images.mjs';

export default defineConfig({
  markdown: {
    rehypePlugins: [rehypeLazyImages],
  },
  site: 'https://rsg-turkiye.iscbsc.org',
  output: 'static',
  // Targets carry the trailing slash, which is the canonical form: the site is
  // built in directory format, so Cloudflare Pages 308s /x to /x/. Without it
  // these redirects chained -- a 301 into a 308 -- for every visitor and every
  // crawl.
  redirects: {
    '/learning-paths/undergrad': '/learning-paths/roadmap/',
    '/learning-paths/grad':      '/learning-paths/genomics/',
  },
  integrations: [
    // Cloudflare Pages serves the 404.html closest to the requested path, so
    // /tr/404.html covers everything under /tr/. Astro only special-cases the
    // root 404.astro into dist/404.html; the Turkish one is built like any
    // other page, at dist/tr/404/index.html, where nothing looks for it. This
    // puts a copy where Pages will find it.
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
    // Sign-in-gated pages are built like any other page, but we don't ask
    // Google to crawl them -- see src/lib/noindex-routes.ts.
    sitemap({
      filter: (page) => !isNoindexPath(new URL(page).pathname),
    }),
  ],
  vite: {
    plugins: [tailwindcss()],
  },
});
