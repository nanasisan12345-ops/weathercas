import { getCACertificates, setDefaultCACertificates } from 'node:tls';

// Keep verification enabled and also trust the operating system's CA store.
setDefaultCACertificates([...getCACertificates('default'), ...getCACertificates('system')]);
const SOURCE = 'https://site.weathernews.jp/site/live/json/list.json';
const VALID_ID = /^[A-Za-z0-9_-]{11}$/;

export function createLiveResolver({ fetchJSON = getJSON, now = Date.now } = {}) {
  let snapshot, expires = 0, pending;
  const verified = new Map();
  return async function resolve() {
    if (snapshot && now() < expires) return snapshot;
    if (pending) return pending;
    pending = (async () => {
      const checked = new Date(now()).toISOString();
      try {
        const data = await fetchJSON(SOURCE);
        if (!data || !Array.isArray(data.ondemand) || data.ondemand.length > 100 || !('live' in data)) throw new Error('source_shape');
        const video = item => {
          if (!item || !VALID_ID.test(item.id) || typeof item.title !== 'string' || !item.title.length || item.title.length > 500 || typeof item.live !== 'boolean' || !Number.isInteger(item.publishedAt) || item.publishedAt < 946684800 || item.publishedAt > 4102444800) throw new Error('video_shape');
          return { id: item.id, title: item.title, source_url: SOURCE, published_at: new Date(item.publishedAt * 1000).toISOString() };
        };
        const listed = data.live ? video(data.live) : null;
        const current = data.live?.live === true ? listed : null;
        let allowed = false;
        if (current) {
          if ((verified.get(current.id) || 0) > now()) allowed = true;
          else {
            const embed = await fetchJSON(`https://www.youtube.com/oembed?${new URLSearchParams({ url: `https://www.youtube.com/watch?v=${current.id}`, format: 'json' })}`);
            allowed = embed?.type === 'video' && ['https://www.youtube.com/@weathernews', 'https://www.youtube.com/user/weathernews'].includes(embed.author_url) && typeof embed.html === 'string' && embed.html.includes(`https://www.youtube.com/embed/${current.id}`);
            if (!allowed) throw new Error('channel_or_embed');
            verified.clear(); verified.set(current.id, now() + 3600000);
          }
        }
        snapshot = { schema_version: 1, checked_at: checked, state: current ? 'listed' : 'offline', video: current,
          embed_allowed: allowed, verification: 'official_listing', archives: data.ondemand.map(video), archives_checked_at: checked };
      } catch {
        snapshot = { schema_version: 1, checked_at: checked, state: 'failed', video: null,
          embed_allowed: false, verification: 'unverified', archives: [], archives_checked_at: null };
      }
      expires = now() + 60000;
      return snapshot;
    })();
    try { return await pending; } finally { pending = undefined; }
  };
}

async function getJSON(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(10000), headers: { Accept: 'application/json', 'User-Agent': 'WeatherCas/0.1 (live metadata, 60-second cache)' } });
  if (!response.ok) throw new Error('upstream_failed');
  const bytes = await response.text();
  if (bytes.length > 2000000) throw new Error('upstream_too_large');
  return JSON.parse(bytes);
}

export function createLiveHandler() {
  const resolve = createLiveResolver();
  return async (req, res, next) => {
    if (new URL(req.url, 'http://127.0.0.1').pathname !== '/weathercas/data/live.json') return next();
    if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405); res.end(); return; }
    const body = JSON.stringify(await resolve());
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    res.end(req.method === 'HEAD' ? undefined : body);
  };
}
