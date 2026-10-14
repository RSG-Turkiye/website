import { copyFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'astro/config';
import { unified } from '@astrojs/markdown-remark';
import sitemap from '@astrojs/sitemap';
import tailwindcss from '@tailwindcss/vite';
import { isNoindexPath } from './src/lib/noindex-routes';
import { rehypeLazyImages } from './src/plugins/rehype-lazy-images.mjs';

export default defineConfig({
  // Astro 7 renders Markdown with Satteri by default, which runs no rehype
  // plugins. The remark/rehype pipeline is opted back into here so the lazy
  // image plugin keeps applying to post bodies.
  markdown: {
    processor: unified({ rehypePlugins: [rehypeLazyImages] }),
  },
  site: 'https://rsg-turkiye.iscbsc.org',
  output: 'static',
  // Astro 7 defaults to 'jsx', which drops whitespace between elements that
  // sit on separate lines. Some of that whitespace is a visible space (on the
  // symposium site it ran "Symposium" into "Just held"), so the Astro 5
  // behaviour is kept here too.
  compressHTML: true,
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
