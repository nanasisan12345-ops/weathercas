import test from 'node:test';
import assert from 'node:assert/strict';
import { createLiveResolver } from '../scripts/live-source.mjs';

test('live IDs roll over after the cache expires, with shared requests and channel verification', async () => {
  let time = Date.parse('2026-10-20T02:00:00Z'), id = 'abcdefghijk', calls = 0;
  const resolve = createLiveResolver({ now: () => time, fetchJSON: async url => {
    calls++;
    if (url.includes('oembed')) return { type: 'video', author_url: 'https://www.youtube.com/@weathernews', html: `https://www.youtube.com/embed/${id}` };
    return { live: { id, title: 'Official', publishedAt: 1790000000, live: true }, ondemand: [] };
  } });
  const first = await Promise.all(Array.from({ length: 5 }, () => resolve()));
  assert.equal(calls, 2); assert.ok(first.every(data => data.video.id === id));
  id = 'lmnopqrstuv'; time += 60001;
  const next = await resolve(); assert.equal(next.video.id, id); assert.equal(calls, 4);
  time += 60001; await resolve(); assert.equal(calls, 5); // Reuse the checked channel for an unchanged ID.
});

test('failure or an unverified channel never retains the previous video', async () => {
  let time = 1790000000000, fail = false;
  const resolve = createLiveResolver({ now: () => time, fetchJSON: async url => {
    if (fail) throw new Error('private error must not be exposed');
    if (url.includes('oembed')) return { type: 'video', author_url: 'https://www.youtube.com/@weathernews', html: 'https://www.youtube.com/embed/abcdefghijk' };
    return { live: { id: 'abcdefghijk', title: 'Official', publishedAt: 1790000000, live: true }, ondemand: [] };
  } });
  assert.equal((await resolve()).state, 'listed'); fail = true; time += 60001;
  const failed = await resolve(); assert.equal(failed.state, 'failed'); assert.equal(failed.video, null); assert.equal(failed.embed_allowed, false);
  const foreign = createLiveResolver({ fetchJSON: async url => url.includes('oembed') ? { type: 'video', author_url: 'https://www.youtube.com/@foreign', html: 'https://www.youtube.com/embed/abcdefghijk' } : { live: { id: 'abcdefghijk', title: 'Foreign', live: true, publishedAt: 1790000000 }, ondemand: [] } });
  assert.equal((await foreign()).state, 'failed');
});
