import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { mkdtemp, mkdir, writeFile, rm, readFile } from 'node:fs/promises';
import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import { selectRecordingFormats, recordingArguments, parseByteRange, OFFICIAL_CHANNEL } from '../scripts/recording-format.mjs';
import { createRecordingService } from '../scripts/recording-service.mjs';
import { createRecordingHandler } from '../scripts/recording-api.mjs';

const ID = 'abcdefghijk';
const video = { format_id: '270', has_drm: false, protocol: 'm3u8_native', url: 'https://manifest.googlevideo.com/video.m3u8', vcodec: 'avc1.4d4028', acodec: 'none', ext: 'mp4', width: 1920, height: 1080, fps: 30 };
const audio = { format_id: '234', has_drm: false, protocol: 'm3u8_native', url: 'https://manifest.googlevideo.com/audio.m3u8', vcodec: 'none', acodec: null, ext: 'mp4' };
const info = { id: ID, channel_id: OFFICIAL_CHANNEL, is_live: true, live_status: 'is_live', formats: [video, audio] };

test('preserves source quality and prefers 1080p60 when the source provides it', () => {
  assert.equal(selectRecordingFormats(info, ID).fps, 30);
  const selected = selectRecordingFormats({ ...info, formats: [...info.formats, { ...video, fps: 60 }, { ...video, width: 3840, height: 2160, fps: 60 }] }, ID);
  assert.equal(selected.height, 1080); assert.equal(selected.fps, 60);
  const args = recordingArguments(selected, 'recording.mp4');
  assert.equal(args[args.indexOf('-c') + 1], 'copy'); assert.ok(args.includes('aac_adtstoasc'));
  for (const forbidden of ['-r', '-vf', '-s', '-b:v', '-crf']) assert.equal(args.includes(forbidden), false);
});

test('rejects foreign channels, ended/DRM sources and non-Google media URLs', () => {
  for (const changed of [{ channel_id: 'foreign' }, { is_live: false }, { live_status: 'was_live' }, { has_drm: true },
    { formats: [{ ...video, url: 'https://googlevideo.com.evil.example/video' }, audio] },
    { formats: [{ ...video, url: 'http://127.0.0.1/private' }, audio] },
    { formats: [{ ...video, has_drm: true }, audio] }]) assert.throws(() => selectRecordingFormats({ ...info, ...changed }, ID));
  assert.throws(() => selectRecordingFormats(info, 'differentID'));
});

test('video byte ranges support seeking and reject invalid or multiple ranges', () => {
  assert.deepEqual(parseByteRange('bytes=10-20', 100), { start: 10, end: 20, partial: true });
  assert.deepEqual(parseByteRange('bytes=-10', 100), { start: 90, end: 99, partial: true });
  for (const range of ['bytes=100-', 'bytes=20-10', 'bytes=0-1,5-8', 'bytes=-', 'bytes=-0']) assert.equal(parseByteRange(range, 100), null);
});

const TEMP = path.resolve('Data/temp');
async function temporary(t) {
  await mkdir(TEMP, { recursive: true }); const root = await mkdtemp(path.join(TEMP, 'direct-recording-test-'));
  t.after(async () => { assert.equal(path.dirname(root), TEMP); await rm(root, { recursive: true, force: true }); }); return root;
}
async function waitFor(action) {
  const end = Date.now() + 3000;
  while (Date.now() < end) { if (await action()) return; await new Promise(resolve => setTimeout(resolve, 10)); }
  throw new Error('condition not reached');
}

test('service starts once, stops gracefully, validates output, and restores its saved result', async t => {
  const root = await temporary(t); let spawned = 0, argsUsed;
  const dependencies = { root, ensureTools: async () => ({ ffmpeg: 'fake', ffprobe: 'fake', yt: 'fake' }),
    resolveOfficial: async () => ({ state: 'listed', video: { id: ID, title: 'Official live' } }), extractInfo: async () => info,
    probe: async () => ({ streams: [{ codec_type: 'video', width: 1920, height: 1080, avg_frame_rate: '30/1' }, { codec_type: 'audio' }], format: { duration: '2', size: '20' } }),
    spawnRecorder: (exe, args) => {
      spawned++; argsUsed = args; const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
      child.stdin = new Writable({ write(chunk, encoding, done) {
        assert.equal(chunk.toString(), 'q\n');
        writeFile(args.at(-1), Buffer.from('test recording')).then(() => child.emit('close', 0)); done();
      } });
      child.kill = () => child.emit('close', -1);
      setImmediate(() => child.stdout.write('frame=60\nout_time_us=2000000\ntotal_size=20\nprogress=continue\n'));
      return child;
    } };
  const service = createRecordingService(dependencies); const job = await service.start(ID);
  await assert.rejects(service.start(ID), /すでに録画中/);
  await waitFor(async () => (await service.snapshot()).job.state === 'recording');
  assert.equal(spawned, 1); assert.equal(argsUsed[argsUsed.indexOf('-c') + 1], 'copy');
  await service.stop(job.id); await service.stop(job.id);
  await waitFor(async () => (await service.snapshot()).job.state === 'completed');
  assert.equal((await service.file(job.id)).size, 14);
  const saved = JSON.parse(await readFile(path.join(root, 'Data/recordings', job.id, 'job.json'), 'utf8'));
  assert.equal(saved.state, 'completed'); assert.equal(JSON.stringify(saved).includes('googlevideo'), false);
  await service.dispose();
  const restored = createRecordingService(dependencies);
  assert.equal((await restored.snapshot()).job.id, job.id); assert.equal((await restored.snapshot()).job.state, 'completed'); await restored.dispose();
});

test('source errors become readable state and preparation can be cancelled', async t => {
  const root = await temporary(t);
  const service = createRecordingService({ root, ensureTools: async () => ({}), resolveOfficial: async () => ({ state: 'offline', video: null }) });
  await service.start(ID); await waitFor(async () => (await service.snapshot()).job.state === 'failed');
  assert.match((await service.snapshot()).job.error, /配信先/); await service.dispose();
  let release;
  const cancelled = createRecordingService({ root, ensureTools: () => new Promise(resolve => { release = resolve; }) });
  const job = await cancelled.start(ID); await waitFor(() => !!release); await cancelled.stop(job.id); release({});
  assert.equal((await cancelled.snapshot()).job.state, 'cancelled'); await cancelled.dispose();
});

test('HTTP API requires same-origin token, validates IDs, and streams only known recording files', async t => {
  const root = await temporary(t); const file = path.join(root, 'sample.mp4'); await writeFile(file, Buffer.from('0123456789'));
  const id = 'a15be8ef-e6b6-4a31-87fb-0123456789ab'; let starts = 0;
  const fake = { snapshot: async () => ({ supported: true, job: null }), start: async () => { starts++; return { id }; }, stop: async () => ({ id }),
    file: async requested => { if (requested !== id) throw new Error('unknown'); return { path: file, size: 10, filename: 'recording.mp4' }; }, dispose: async () => {} };
  const handler = createRecordingHandler(root, fake);
  const server = http.createServer((req, res) => handler(req, res, () => { res.writeHead(404); res.end(); }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}/weathercas/api/recording`;
  const state = await (await fetch(base)).json(); assert.match(state.token, /^[a-f0-9]{64}$/);
  const headers = { 'Content-Type': 'application/json', 'X-WeatherCas-Token': state.token };
  assert.equal((await fetch(`${base}/start`, { method: 'POST', body: JSON.stringify({ video_id: ID }) })).status, 403);
  assert.equal((await fetch(`${base}/start`, { method: 'POST', headers: { ...headers, Origin: 'https://evil.example' }, body: JSON.stringify({ video_id: ID }) })).status, 403);
  assert.equal((await fetch(`${base}/start`, { method: 'POST', headers, body: JSON.stringify({ video_id: '../private' }) })).status, 400);
  assert.equal(starts, 0);
  assert.equal((await fetch(`${base}/start`, { method: 'POST', headers, body: JSON.stringify({ video_id: ID }) })).status, 202); assert.equal(starts, 1);
  const partial = await fetch(`${base}/${id}/file`, { headers: { Range: 'bytes=2-5' } });
  assert.equal(partial.status, 206); assert.equal(await partial.text(), '2345'); assert.equal(partial.headers.get('content-range'), 'bytes 2-5/10');
  assert.equal((await fetch(`${base}/${id}/file`, { headers: { Range: 'bytes=30-' } })).status, 416);
  assert.equal((await fetch(`${base}/../private/file`)).status, 404);
});
