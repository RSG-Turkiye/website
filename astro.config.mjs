import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import tailwindcss from '@tailwindcss/vite';
import { isNoindexPath } from './src/lib/noindex-routes';

export default defineConfig({
  site: 'https://rsg-turkiye.iscbsc.org',
  output: 'static',
  redirects: {
    '/learning-paths/undergrad': '/learning-paths/roadmap',
    '/learning-paths/grad':      '/learning-paths/genomics',
  },
  integrations: [
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
