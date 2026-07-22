// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import icon from 'astro-icon';

import react from '@astrojs/react';

// IMPORTANT: change this to your real domain before deploying.
// It is used for canonical URLs, sitemap, and Open Graph tags.
const SITE = process.env.SITE_URL || 'https://wanderatlasguides.com';

export default defineConfig({
  site: SITE,
  integrations: [sitemap(), react(), icon()],
  trailingSlash: 'ignore',
  i18n: {
    defaultLocale: 'en',
    locales: ['en', 'ko', 'ja', 'es', 'zh'],
    routing: { prefixDefaultLocale: false },
  },
  build: {
    format: 'directory',
  },
});