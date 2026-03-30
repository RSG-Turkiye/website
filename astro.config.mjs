import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  site: 'https://rsgturkey.com',
  output: 'static',
  redirects: {
    '/learning-paths/undergrad': '/learning-paths/roadmap',
    '/learning-paths/grad':      '/learning-paths/genomics',
  },
  integrations: [
    sitemap(),
  ],
  vite: {
    plugins: [tailwindcss()],
  },
});
