// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

import preact from '@astrojs/preact';

// https://astro.build/config
export default defineConfig({
  site: 'https://deep-dive.avetavos.com',
  base: '/supabase',
  output: 'static',
  integrations: [starlight({
      title: 'Supabase — From Zero to Hero',
      head: [
        { tag: 'script', attrs: { type: 'module', src: '/supabase/enhance.js' } },
        { tag: 'link', attrs: { rel: 'manifest', href: '/supabase/manifest.webmanifest' } },
        { tag: 'link', attrs: { rel: 'apple-touch-icon', href: '/supabase/apple-touch-icon.png' } },
        { tag: 'link', attrs: { rel: 'icon', type: 'image/png', sizes: '192x192', href: '/supabase/icon-192.png' } },
        { tag: 'meta', attrs: { name: 'theme-color', content: '#3ECF8E' } },
        { tag: 'meta', attrs: { name: 'mobile-web-app-capable', content: 'yes' } },
        { tag: 'meta', attrs: { name: 'apple-mobile-web-app-capable', content: 'yes' } },
        { tag: 'meta', attrs: { name: 'apple-mobile-web-app-status-bar-style', content: 'black-translucent' } },
        { tag: 'meta', attrs: { name: 'apple-mobile-web-app-title', content: "Supabase — From Zero to Hero" } },
        { tag: 'script', content: "if('serviceWorker' in navigator){window.addEventListener('load',function(){navigator.serviceWorker.register('/supabase/sw.js',{scope:'/supabase/'}).catch(function(){})})}" },
      ],
      defaultLocale: 'en',
      locales: {
        en: { label: 'English', lang: 'en' },
        th: { label: 'ไทย', lang: 'th' },
      },
      customCss: ['./src/styles/custom.css'],
      social: [{ icon: 'github', label: 'GitHub', href: 'https://github.com/avetavos/supabase-deep-dive' }],
      sidebar: [
        { label: 'Foundations', items: [{ autogenerate: { directory: 'foundations' } }] },
        { label: 'Auto-Generated API', items: [{ autogenerate: { directory: 'auto-generated-api' } }] },
        { label: 'Auth & Row Level Security', items: [{ autogenerate: { directory: 'auth-and-row-level-security' } }] },
        { label: 'Realtime & Storage', items: [{ autogenerate: { directory: 'realtime-and-storage' } }] },
        { label: 'Edge Functions', items: [{ autogenerate: { directory: 'edge-functions' } }] },
        { label: 'Client Development', items: [{ autogenerate: { directory: 'client-development' } }] },
        { label: 'Production & Ecosystem', items: [{ autogenerate: { directory: 'production-and-ecosystem' } }] },
      ],
      }), preact()],
});
