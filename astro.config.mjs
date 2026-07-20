// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

import react from '@astrojs/react';

// IMPORTANT: change this to your real domain before deploying.
// It is used for canonical URLs, sitemap, and Open Graph tags.
const SITE = process.env.SITE_URL || 'https://example.com';

export default defineConfig({
  site: SITE,
  integrations: [sitemap(), react()],
  trailingSlash: 'ignore',
  build: {
    format: 'directory',
  },
});