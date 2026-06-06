// @ts-check
import { defineConfig } from 'astro/config';

import tailwindcss from '@tailwindcss/vite';
import sitemap from '@astrojs/sitemap';

// https://astro.build/config
export default defineConfig({
  // TODO : remplacer par le nom de domaine définitif une fois branché sur Vercel
  site: 'https://fulgurance-pro.vercel.app',
  integrations: [sitemap()],
  vite: {
    plugins: [tailwindcss()]
  }
});
