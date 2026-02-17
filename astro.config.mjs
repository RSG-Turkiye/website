import { defineConfig } from 'astro/config';
import astroIcon from 'astro-icon';
import sitemap from '@astrojs/sitemap';

export default defineConfig({
  site: 'https://rsgturkey.com',
  output: 'static',
  integrations: [
    astroIcon({
      include: {
        fa: ['brands'],
        logos: ['*'],
        'simple-icons': ['*'],
      },
    }),
    sitemap(),
  ],
});
