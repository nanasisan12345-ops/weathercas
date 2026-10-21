import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { createLiveHandler } from './scripts/live-source.mjs';
import { createRecordingHandler } from './scripts/recording-api.mjs';
import { fileURLToPath } from 'node:url';

const siteURL = process.env.SITE_URL?.trim();
const liveEndpoint = process.env.VITE_LIVE_ENDPOINT?.trim();
if (liveEndpoint) {
  const url = new URL(liveEndpoint);
  if (url.protocol !== 'https:' || !url.hostname.endsWith('.workers.dev') || url.pathname !== '/live.json' || url.port || url.username || url.password || url.search || url.hash) {
    throw new Error('VITE_LIVE_ENDPOINT must be an HTTPS workers.dev URL ending in /live.json.');
  }
}
if (siteURL && (!siteURL.startsWith('https://') || new URL(siteURL).pathname !== '/weathercas/')) {
  throw new Error('SITE_URL must be an HTTPS URL ending in /weathercas/.');
}
const htmlEscape = (value: string) => value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
let localRecording: ReturnType<typeof createRecordingHandler> | undefined;

export default defineConfig({
  plugins: [react(), {
    name: 'weathercas-local-live-source',
    configureServer(server) {
      server.middlewares.use(createLiveHandler());
      localRecording = createRecordingHandler(fileURLToPath(new URL('./', import.meta.url)));
      server.middlewares.use(localRecording);
      server.httpServer?.on('close', () => { void localRecording?.dispose(); });
    },
    closeBundle() { return localRecording?.dispose(); },
  }, {
    name: 'weathercas-social-metadata',
    transformIndexHtml: { order: 'post', handler(html) {
      if (!siteURL) return html;
      const root = new URL(siteURL), image = new URL('assets/weathercas-ogp.png', root).href;
      return html.replace(/(<meta property="og:image" content=")[^"]+/, (_, prefix: string) => prefix + htmlEscape(image))
        .replace('</head>', `<meta property="og:url" content="${htmlEscape(root.href)}" /><link rel="canonical" href="${htmlEscape(root.href)}" /></head>`);
    } },
  }],
  base: '/weathercas/',
  cacheDir: 'Data/cache/vite',
  server: {
    watch: { ignored: ['**/Data/**', '**/release/**', '**/dist/**'] },
    fs: { deny: ['**/.git/**', '**/Data/**', '**/.env', '**/.env.*', '**/*.{crt,pem}'] },
    headers: { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'strict-origin-when-cross-origin' },
  },
});
