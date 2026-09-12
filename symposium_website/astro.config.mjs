import { copyFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  site: 'https://symposium.rsg-turkiye.iscbsc.org',
  output: 'static',
  integrations: [
    sitemap(),
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
