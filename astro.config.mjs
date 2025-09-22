import { defineConfig } from 'astro/config';
import astroIcon from 'astro-icon';
import node from '@astrojs/node';

export default defineConfig({
  integrations: [
    astroIcon({
      include: {
        fa: ['brands'], // Include the "brands" subset of Font Awesome
        logos: ['*'],   // Include all icons from the "logos" set
        'simple-icons': ['*'], // Include all icons from the "simple-icons" set
      },
    }),
  ],
  output: 'server', // API endpoint'ler için gerekli
  adapter: node({
    mode: 'standalone'
  }),
});