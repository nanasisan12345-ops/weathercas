import { randomBytes } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { createRecordingService } from './recording-service.mjs';
import { JOB_ID, VIDEO_ID, parseByteRange, RecordingError } from './recording-format.mjs';

const BASE = '/weathercas/api/recording';
function sendJSON(res, code, body) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(JSON.stringify(body));
}
async function readBody(req) {
  if (req.headers['content-type']?.split(';')[0].trim() !== 'application/json') throw new RecordingError('invalid_request', 'リクエスト形式を確認できません。');
  let data = '';
  for await (const bytes of req) { data += bytes; if (data.length > 1024) throw new RecordingError('invalid_request', 'リクエストが大きすぎます。'); }
  try { return JSON.parse(data); } catch { throw new RecordingError('invalid_request', 'リクエスト形式を確認できません。'); }
}
export function createRecordingHandler(root, service = createRecordingService({ root })) {
  const token = randomBytes(32).toString('hex');
  const handler = async (req, res, next) => {
    let url;
    try { url = new URL(req.url, `http://${req.headers.host}`); } catch { return next(); }
    if (url.pathname !== BASE && !url.pathname.startsWith(`${BASE}/`)) return next();
    const local = ['127.0.0.1', 'localhost'].includes(url.hostname) && url.protocol === 'http:' && !url.username && !url.password;
    const ownOrigin = `http://${req.headers.host}`;
    if (!local || url.origin !== ownOrigin || (req.headers.origin && req.headers.origin !== ownOrigin) || req.headers['sec-fetch-site'] === 'cross-site') {
      sendJSON(res, 403, { error: 'このPCのWeatherCas画面から操作してください。' }); return;
    }
    try {
      if (url.pathname === BASE && req.method === 'GET') { sendJSON(res, 200, { ...await service.snapshot(), token }); return; }
      if (url.pathname === `${BASE}/start` || url.pathname === `${BASE}/stop`) {
        if (req.method !== 'POST') { sendJSON(res, 405, { error: 'この操作にはPOSTが必要です。' }); return; }
        if (req.headers['x-weathercas-token'] !== token) { sendJSON(res, 403, { error: '接続を確認してから操作をやり直してください。' }); return; }
        const body = await readBody(req);
        if (url.pathname.endsWith('/start')) {
          if (typeof body?.video_id !== 'string' || !VIDEO_ID.test(body.video_id)) throw new RecordingError('invalid_request', '録画する動画を確認できません。');
          sendJSON(res, 202, { job: await service.start(body.video_id) });
        } else {
          if (typeof body?.id !== 'string' || !JOB_ID.test(body.id)) throw new RecordingError('invalid_request', '録画データを確認できません。');
          sendJSON(res, 202, { job: await service.stop(body.id) });
        }
        return;
      }
      const match = new RegExp(`^${BASE}/([a-f0-9-]+)/file$`).exec(url.pathname);
      if (match && JOB_ID.test(match[1]) && ['GET', 'HEAD'].includes(req.method)) {
        const file = await service.file(match[1]);
        const range = parseByteRange(req.headers.range, file.size);
        if (!range) { res.writeHead(416, { 'Content-Range': `bytes */${file.size}` }); res.end(); return; }
        const headers = { 'Content-Type': 'video/mp4', 'Accept-Ranges': 'bytes', 'Content-Length': range.end - range.start + 1,
          'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
          'Content-Disposition': `${url.searchParams.get('download') === '1' ? 'attachment' : 'inline'}; filename="${file.filename.replace(/[^A-Za-z0-9._-]/g, '_')}"` };
        if (range.partial) headers['Content-Range'] = `bytes ${range.start}-${range.end}/${file.size}`;
        res.writeHead(range.partial ? 206 : 200, headers);
        if (req.method === 'HEAD') { res.end(); return; }
        const stream = createReadStream(file.path, { start: range.start, end: range.end });
        stream.once('error', () => res.destroy()); res.once('close', () => stream.destroy()); stream.pipe(res); return;
      }
      sendJSON(res, 404, { error: '録画機能のURLが見つかりません。' });
    } catch (error) {
      if (res.headersSent) { res.destroy(); return; }
      const code = error.code === 'not_found' || error.code === 'ENOENT' ? 404 : error.code === 'busy' ? 409 : error instanceof RecordingError ? 400 : 500;
      sendJSON(res, code, { error: error instanceof RecordingError ? error.message : '録画サーバーの処理に失敗しました。空き容量と起動状況をご確認ください。' });
    }
  };
  handler.dispose = () => service.dispose();
  return handler;
}
