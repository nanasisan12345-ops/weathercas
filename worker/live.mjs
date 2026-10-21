import { createLiveResolver } from '../scripts/live-resolver.mjs';
import { createWeatherResolver, weatherSources } from '../scripts/weather-source.mjs';

const ORIGIN = 'https://nanasisan12345-ops.github.io';
export function createMetadataWorker({ resolve = createLiveResolver({ cacheMilliseconds: 0 }),
  resolveWeather = createWeatherResolver({ cacheMilliseconds: 0 }), cache } = {}) {
  return {
    async fetch(request, env, context) {
      const url = new URL(request.url), origin = request.headers.get('Origin');
      const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff', 'X-Robots-Tag': 'noindex, nofollow', Vary: 'Origin' };
      const error = (status, message) => new Response(JSON.stringify({ error: message }), { status, headers });
      if (origin && origin !== ORIGIN) return error(403, 'このサイトからは利用できません。');
      if (origin) headers['Access-Control-Allow-Origin'] = ORIGIN;
      const weather = /^\/weather\/([a-z]+)\.json$/.exec(url.pathname);
      if ((url.pathname !== '/live.json' && (!weather || !Object.hasOwn(weatherSources, weather[1]))) || url.search) return error(404, 'ページが見つかりません。');
      if (request.method === 'OPTIONS') {
        if (!['GET', 'HEAD'].includes(request.headers.get('Access-Control-Request-Method'))) return error(405, '読み取り専用です。');
        return new Response(null, { status: 204, headers: { ...headers, 'Access-Control-Allow-Methods': 'GET, HEAD',
          'Access-Control-Allow-Headers': 'Accept, Cache-Control, Pragma', 'Access-Control-Max-Age': '86400' } });
      }
      if (!['GET', 'HEAD'].includes(request.method)) return error(405, '読み取り専用です。');
      try {
        const storage = cache || globalThis.caches?.default;
        const key = new Request(`${url.origin}${url.pathname}`);
        let response = await storage?.match(key);
        if (!response) {
          const data = weather ? await resolveWeather(weather[1]) : await resolve();
          response = new Response(JSON.stringify(data), { headers: { 'Content-Type': headers['Content-Type'], 'Cache-Control': `public, max-age=${weather ? 60 : 15}` } });
          if (storage && data.state !== 'failed') context.waitUntil(storage.put(key, response.clone()));
        }
        return new Response(request.method === 'HEAD' ? null : response.body, { status: 200, headers });
      } catch (cause) {
        console.error('Metadata lookup failed', weather?.[1] || 'live', cause instanceof Error ? cause.message : 'unknown');
        return error(503, weather ? '天気情報を確認できませんでした。' : '配信情報を確認できませんでした。');
      }
    },
  };
}

export default createMetadataWorker();
