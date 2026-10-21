import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createWeatherResolver, normalizeWeather, weatherSources, createWeatherHandler } from '../scripts/weather-source.mjs';
import { createMetadataWorker } from '../worker/live.mjs';

const fixtures = JSON.parse(readFileSync('tests/fixtures/weather-sources.json', 'utf8'));
test('all observed official response formats produce usable cards', () => {
  assert.equal(Object.keys(fixtures).length, Object.keys(weatherSources).length);
  for (const [id, raw] of Object.entries(fixtures)) {
    const data = normalizeWeather(id, raw);
    assert.ok(data.caption, id); assert.ok(data.images?.length || data.rows?.length || data.radar, id);
  }
  assert.equal(normalizeWeather('warnings', fixtures.warnings).rows.length, 2);
  assert.equal(normalizeWeather('tsunami', fixtures.tsunami).notice.includes('発表終了'), true);
  assert.equal(normalizeWeather('uv', fixtures.uv).rows.find(x => x.name === '東京').value, 'やや強い（3）');
  assert.equal(normalizeWeather('dry', fixtures.dry).rows[0].value, 'しっとり');
});
test('malformed data and foreign image or radar URLs cannot become cards', () => {
  for (const [id, raw] of Object.entries(fixtures)) assert.throws(() => normalizeWeather(id, raw === null ? {} : null), undefined, id);
  assert.throws(() => normalizeWeather('satellite', { url_list: [{ tm: 1, imgsrc: 'https://evil.example/test.png' }] }));
  assert.throws(() => normalizeWeather('radar', { tile: [{ tm: 1, isForecast: false, d: 'https://evil.example/tile' }] }));
  assert.throws(() => normalizeWeather('chart', { data: [{ forecastType: 'obs', pc: '../../secret' }] }));
});
test('fixed fetch destinations coalesce requests, expire, and never return stale data after failure', async () => {
  let time = 0, calls = 0, fail = false;
  const resolve = createWeatherResolver({ now: () => time, fetchJSON: async url => {
    assert.equal(url, weatherSources.forecast); calls++; if (fail) throw new Error('unavailable'); return fixtures.forecast;
  } });
  await assert.rejects(resolve('constructor')); await assert.rejects(resolve('https://evil.example')); assert.equal(calls, 0);
  const [a, b] = await Promise.all([resolve('forecast'), resolve('forecast')]); assert.deepEqual(a, b); assert.equal(calls, 1);
  await resolve('forecast'); assert.equal(calls, 1);
  time = 60001; fail = true; await assert.rejects(resolve('forecast')); assert.equal(calls, 2);
  fail = false; await resolve('forecast'); assert.equal(calls, 3);
});
test('default transport uses Worker-compatible manual redirects and rejects redirects', async t => {
  let redirect = false;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, weatherSources.forecast); assert.equal(options.redirect, 'manual');
    return redirect ? new Response(null, { status: 302, headers: { Location: 'https://evil.example' } })
      : new Response(JSON.stringify(fixtures.forecast), { headers: { 'Content-Type': 'application/json' } });
  });
  const resolve = createWeatherResolver({ cacheMilliseconds: 0 });
  assert.ok((await resolve('forecast')).images.length); redirect = true;
  await assert.rejects(resolve('forecast'), /HTTP 302/);
});
test('local weather handler rejects arbitrary URLs and writes before/after responses', async () => {
  const handler = createWeatherHandler(); let status, body, next = false;
  const res = { writeHead(s) { status = s; }, end(b) { body = b; } };
  await handler({ url: '/weathercas/data/weather/uv.json?url=https://evil.example', method: 'GET' }, res, () => {});
  assert.equal(status, 404); assert.equal(body, '{}');
  await handler({ url: '/weathercas/data/weather/uv.json', method: 'POST' }, res, () => {}); assert.equal(status, 405);
  await handler({ url: '/weathercas/', method: 'GET' }, res, () => { next = true; }); assert.equal(next, true);
});
test('weather Worker separates card cache keys, enforces CORS and contains errors', async () => {
  let keys = [], cached = [], calls = [];
  const worker = createMetadataWorker({ resolveWeather: async id => { calls.push(id); return { checked_at: 'now', caption: id }; },
    cache: { async match(key) { keys.push(key.url); }, async put(key, value) { cached.push([key.url, value.headers.get('Cache-Control')]); } } });
  const context = { waitUntil(p) { return p; } }, origin = 'https://nanasisan12345-ops.github.io';
  const req = (path, from = origin) => new Request(`https://example.workers.dev${path}`, { headers: { Origin: from } });
  for (const id of ['uv', 'forecast']) {
    const r = await worker.fetch(req(`/weather/${id}.json`), {}, context); assert.equal(r.status, 200);
    assert.equal(r.headers.get('Access-Control-Allow-Origin'), origin); assert.equal((await r.json()).caption, id);
  }
  assert.equal(new Set(keys).size, 2); assert.equal(cached.every(x => x[1] === 'public, max-age=60'), true);
  assert.equal((await worker.fetch(req('/weather/uv.json', 'https://evil.example'), {}, context)).status, 403);
  for (const path of ['/weather/constructor.json', '/weather/unknown.json', '/weather/uv.json?url=https://evil.example'])
    assert.equal((await worker.fetch(req(path), {}, context)).status, 404);
  assert.deepEqual(calls, ['uv', 'forecast']);
  const failed = createMetadataWorker({ resolveWeather: async () => { throw new Error('private upstream'); } });
  const response = await failed.fetch(req('/weather/uv.json'), {}, context); assert.equal(response.status, 503); assert.doesNotMatch(await response.text(), /private/);
});
