import { createLiveResolver } from '../scripts/live-resolver.mjs';

const ORIGIN = 'https://nanasisan12345-ops.github.io';
export function createMetadataWorker({ resolve = createLiveResolver({ cacheMilliseconds: 0 }), cache } = {}) {
  return {
    async fetch(request, env, context) {
      const url = new URL(request.url), origin = request.headers.get('Origin');
      const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff', 'X-Robots-Tag': 'noindex, nofollow', Vary: 'Origin' };
      const error = (status, message) => new Response(JSON.stringify({ error: message }), { status, headers });
      if (origin && origin !== ORIGIN) return error(403, 'このサイトからは利用できません。');
      if (origin) headers['Access-Control-Allow-Origin'] = ORIGIN;
      if (url.pathname !== '/live.json' || url.search) return error(404, 'ページが見つかりません。');
      if (request.method === 'OPTIONS') {
        if (!['GET', 'HEAD'].includes(request.headers.get('Access-Control-Request-Method'))) return error(405, '読み取り専用です。');
        return new Response(null, { status: 204, headers: { ...headers, 'Access-Control-Allow-Methods': 'GET, HEAD',
          'Access-Control-Allow-Headers': 'Accept, Cache-Control, Pragma', 'Access-Control-Max-Age': '86400' } });
      }
      if (!['GET', 'HEAD'].includes(request.method)) return error(405, '読み取り専用です。');
      try {
        const storage = cache || globalThis.caches?.default;
        const key = new Request(`${url.origin}/live.json`);
        let response = await storage?.match(key);
        if (!response) {
          const data = await resolve();
          response = new Response(JSON.stringify(data), { headers: { 'Content-Type': headers['Content-Type'], 'Cache-Control': 'public, max-age=15' } });
          if (storage && data.state !== 'failed') context.waitUntil(storage.put(key, response.clone()));
        }
        return new Response(request.method === 'HEAD' ? null : response.body, { status: 200, headers });
      } catch { return error(503, '配信情報を確認できませんでした。'); }
    },
  };
}

export default createMetadataWorker();
