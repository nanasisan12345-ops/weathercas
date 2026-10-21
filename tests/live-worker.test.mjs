import test from 'node:test';
import assert from 'node:assert/strict';
import { createMetadataWorker } from '../worker/live.mjs';
import { createLiveResolver } from '../scripts/live-resolver.mjs';

const origin = 'https://nanasisan12345-ops.github.io';
const request = (path = '/live.json', options = {}) => new Request(`https://weathercas-live.example.workers.dev${path}`, options);
const context = { waitUntil() {} };

test('public metadata allows the Pages origin, HEAD and preflight without caching in the browser', async () => {
  const worker = createMetadataWorker({ resolve: async () => ({ state: 'offline', video: null }) });
  const response = await worker.fetch(request('/live.json', { headers: { Origin: origin } }), {}, context);
  assert.equal(response.status, 200); assert.equal(response.headers.get('Access-Control-Allow-Origin'), origin);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.deepEqual(await response.json(), { state: 'offline', video: null });
  assert.equal(await (await worker.fetch(request('/live.json', { method: 'HEAD' }), {}, context)).text(), '');
  assert.equal((await worker.fetch(request('/live.json', { method: 'OPTIONS', headers: { Origin: origin, 'Access-Control-Request-Method': 'GET' } }), {}, context)).status, 204);
});

test('worker rejects foreign origins, proxy parameters, other paths and mutations before fetching', async () => {
  let calls = 0; const worker = createMetadataWorker({ resolve: async () => { calls++; } });
  for (const [path, options, status] of [['/live.json', { headers: { Origin: 'https://evil.example' } }, 403],
    ['/live.json?url=https://evil.example', {}, 404], ['/other', {}, 404], ['/live.json', { method: 'POST' }, 405]]) {
    assert.equal((await worker.fetch(request(path, options), {}, context)).status, status);
  }
  assert.equal(calls, 0);
});

test('worker uses the edge cache and contains upstream failures', async () => {
  let calls = 0; const cache = { async match() { return new Response('{"state":"offline"}'); } };
  const worker = createMetadataWorker({ cache, resolve: async () => { calls++; } });
  assert.equal((await (await worker.fetch(request(), {}, context)).json()).state, 'offline'); assert.equal(calls, 0);
  const failed = createMetadataWorker({ resolve: async () => { throw new Error('private upstream information'); } });
  const response = await failed.fetch(request(), {}, context);
  assert.equal(response.status, 503); assert.equal((await response.text()).includes('private'), false);
});

for (let day = 0; day < 5; day++) {
  test(`15-second metadata cache follows broadcast changes and an offline night, cycle ${day + 1}`, async () => {
    let time = Date.parse('2026-10-21T08:00:00Z') + day * 86400000, id = 'abcdefghijk', offline = false;
    const resolve = createLiveResolver({ now: () => time, cacheMilliseconds: 15000, fetchJSON: async url =>
      url.includes('oembed') ? { type: 'video', author_url: 'https://www.youtube.com/@weathernews', html: `https://www.youtube.com/embed/${id}` } :
        { live: offline ? null : { id, title: 'Official', publishedAt: 1790000000, live: true }, ondemand: [] } });
    const worker = createMetadataWorker({ resolve });
    const state = async () => (await worker.fetch(request(), {}, context)).json();
    assert.equal((await state()).video.id, id);
    id = 'lmnopqrstuv'; time += 15001; assert.equal((await state()).video.id, id);
    offline = true; time += 15001; assert.equal((await state()).state, 'offline');
    offline = false; id = 'abcdefghijk'; time += 8 * 3600000; assert.equal((await state()).video.id, id);
  });
}
