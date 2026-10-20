import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile, rename, readdir, stat, statfs, appendFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createLiveResolver } from './live-source.mjs';
import { ensureRecordingTools } from './recording-tools.mjs';
import { JOB_ID, VIDEO_ID, RecordingError, selectRecordingFormats, recordingArguments } from './recording-format.mjs';

const ACTIVE = new Set(['preparing', 'recording', 'finalizing']);
const safeLog = value => String(value).replace(/https?:\/\/[^\s"']+/g, '<remote-url>').slice(-16000);

async function commandJSON(executable, args, { root, signal, timeout = 60000 }) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { cwd: root, windowsHide: true, signal,
      env: childEnvironment(root), stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '', errors = '', settled = false;
    const finish = (error, result) => { if (settled) return; settled = true; clearTimeout(timer); error ? reject(error) : resolve(result); };
    const timer = setTimeout(() => { child.kill(); finish(new RecordingError('source_timeout', '配信の確認がタイムアウトしました。もう一度お試しください。')); }, timeout);
    child.stdout.on('data', bytes => { output += bytes.toString('utf8'); if (output.length > 12000000) { child.kill(); finish(new Error('response_too_large')); } });
    child.stderr.on('data', bytes => { errors = (errors + bytes.toString('utf8')).slice(-16000); });
    child.once('error', error => finish(error));
    child.once('close', code => {
      if (code !== 0) { const error = new RecordingError('source_failed', '配信データを取得できませんでした。公開中の配信か、接続状況をご確認ください。'); error.details = safeLog(errors); finish(error); return; }
      try { finish(null, JSON.parse(output)); } catch { finish(new Error('invalid_source_json')); }
    });
  });
}

function childEnvironment(root) {
  return { ...process.env, TEMP: path.join(root, 'Data/temp'), TMP: path.join(root, 'Data/temp'),
    PYTHONPYCACHEPREFIX: path.join(root, 'Data/cache/python'), XDG_CACHE_HOME: path.join(root, 'Data/cache'),
    DENO_DIR: path.join(root, 'Data/cache/deno'), NODE_USE_SYSTEM_CA: '1' };
}

export async function extractRecordingInfo(tools, videoID, root, signal) {
  return commandJSON(tools.yt, ['--ignore-config', '--no-cache-dir', '--compat-options', 'no-certifi',
    '--js-runtimes', `node:${process.execPath}`, '--no-remote-components', '--no-playlist', '--no-live-from-start',
    '--skip-download', '--dump-single-json', '--', `https://www.youtube.com/watch?v=${videoID}`], { root, signal });
}
export async function probeRecording(tools, file, root) {
  return commandJSON(tools.ffprobe, ['-v', 'error', '-show_entries', 'stream=codec_type,codec_name,width,height,avg_frame_rate:format=duration,size', '-of', 'json', file], { root, timeout: 15000 });
}

export function createRecordingService({ root, resolveOfficial = createLiveResolver(), ensureTools = ensureRecordingTools,
  extractInfo = extractRecordingInfo, probe = probeRecording, spawnRecorder = spawn, maxSeconds = 1800, maxBytes = 2147483648 } = {}) {
  root = path.resolve(root);
  const directory = path.join(root, 'Data/recordings'), logDirectory = path.join(root, 'Data/logs/recording');
  const jobs = new Map(); let current = null, disposed = false;
  const outputPath = id => path.join(directory, id, 'recording.mp4');
  const publicJob = job => job ? Object.fromEntries(['id', 'video_id', 'title', 'state', 'message', 'error', 'warning', 'width', 'height', 'fps', 'seconds', 'bytes', 'frames', 'started_at', 'finished_at', 'filename'].map(key => [key, job[key] ?? null])) : null;
  const log = (id, text) => appendFile(path.join(logDirectory, `${id}.log`), `${new Date().toISOString()} ${safeLog(text)}\n`).catch(() => {});
  async function persist(job) {
    const snapshot = JSON.stringify(publicJob(job), null, 2);
    job.save = (job.save || Promise.resolve()).then(async () => {
      const destination = path.join(directory, job.id, 'job.json');
      await mkdir(path.dirname(destination), { recursive: true });
      await writeFile(`${destination}.temp`, snapshot); await rename(`${destination}.temp`, destination);
    }).catch(error => log(job.id, `metadata_write_failed ${error.code || 'unknown'}`));
    return job.save;
  }
  async function finish(job, code) {
    clearTimeout(job.killTimer); clearTimeout(job.limitTimer);
    job.process = null; job.state = 'finalizing'; job.message = 'MP4ファイルを確認しています…';
    try {
      const result = await probe(job.tools, outputPath(job.id), root);
      const video = result.streams?.find(stream => stream.codec_type === 'video');
      const audio = result.streams?.find(stream => stream.codec_type === 'audio');
      if (!video || !audio || !(Number(result.format?.duration) > 0)) throw new Error('empty_recording');
      const [numerator, denominator = '1'] = String(video.avg_frame_rate).split('/').map(Number);
      job.width = video.width; job.height = video.height; job.fps = denominator ? numerator / denominator : job.fps;
      job.seconds = Number(result.format.duration); job.bytes = Number(result.format.size);
      job.state = 'completed'; job.message = '録画を停止しました。MP4を確認して保存できます。';
      if (code !== 0) { job.warning = '通信または録画処理が中断されました。保存できた部分のMP4を確認してください。'; }
    } catch (error) {
      job.state = job.cancelled ? 'cancelled' : 'failed';
      job.error ||= '再生できる録画データが作成されませんでした。配信を確認してもう一度お試しください。';
      job.message = job.cancelled ? '録画の準備を中止しました。' : '録画を保存できませんでした。';
      await log(job.id, `finalize_failed ${error.code || error.name || 'unknown'}`);
    }
    job.finished_at = new Date().toISOString(); await persist(job);
  }
  const ready = (async () => {
    await Promise.all([mkdir(directory, { recursive: true }), mkdir(logDirectory, { recursive: true }), mkdir(path.join(root, 'Data/temp'), { recursive: true })]);
    const recovered = [];
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (!entry.isDirectory() || !JOB_ID.test(entry.name)) continue;
      try {
        const job = JSON.parse(await readFile(path.join(directory, entry.name, 'job.json'), 'utf8'));
        if (job.id !== entry.name || !VIDEO_ID.test(job.video_id) || !['preparing', 'recording', 'finalizing', 'completed', 'failed', 'cancelled'].includes(job.state)) continue;
        jobs.set(job.id, job); recovered.push(job);
        if (ACTIVE.has(job.state)) {
          try { job.tools = await ensureTools(root); await finish(job, -1); }
          catch { job.state = 'failed'; job.error = '前回の録画処理が終了しました。保存済みのファイルはData/recordingsに保持しています。'; await persist(job); }
        }
      } catch { /* Ignore incomplete metadata; keep the original folder and recording. */ }
    }
    recovered.sort((a, b) => String(b.id).localeCompare(String(a.id)));
    current = recovered.sort((a, b) => String(b.finished_at || b.started_at || '').localeCompare(String(a.finished_at || a.started_at || '')))[0] || null;
  })();

  async function run(job) {
    try {
      const space = await statfs(directory);
      if (Number(space.bavail) * Number(space.bsize) < 268435456) throw new RecordingError('disk_space', '保存先の空き容量が不足しています。256MB以上の空きを確保してください。');
      job.tools = await ensureTools(root, message => { if (!job.cancelled) job.message = message; });
      if (job.cancelled || disposed) return;
      const official = await resolveOfficial();
      if (!official?.video || official.state === 'failed' || official.state === 'offline' || official.video.id !== job.video_id) throw new RecordingError('video_changed', '公式の配信先が切り替わりました。ページを更新してから録画してください。');
      job.message = '配信の元画質と音声を確認しています…';
      const info = await extractInfo(job.tools, job.video_id, root, job.controller.signal);
      if (job.cancelled || disposed) return;
      const selected = selectRecordingFormats(info, job.video_id);
      Object.assign(job, { title: String(official.video.title).slice(0, 500), width: selected.width, height: selected.height, fps: selected.fps });
      await persist(job);
      const child = spawnRecorder(job.tools.ffmpeg, recordingArguments(selected, outputPath(job.id), { maxSeconds, maxBytes }),
        { cwd: root, windowsHide: true, env: childEnvironment(root), stdio: ['pipe', 'pipe', 'pipe'] });
      job.process = child; let buffer = '', closed = false;
      child.stdout.on('data', bytes => {
        buffer += bytes.toString('utf8');
        const lines = buffer.split(/\r?\n/); buffer = lines.pop() || '';
        for (const line of lines) {
          const [key, value] = line.split('='); const n = Number(value);
          if (!Number.isFinite(n) || n < 0) continue;
          if (key === 'out_time_us') job.seconds = n / 1000000;
          if (key === 'total_size') job.bytes = n;
          if (key === 'frame') job.frames = n;
        }
        if (job.frames > 0 && job.state === 'preparing') {
          job.state = 'recording'; job.started_at = new Date().toISOString(); job.message = '配信の映像と音声を再圧縮せず録画中です。'; void persist(job);
        }
      });
      child.stderr.on('data', bytes => { void log(job.id, bytes.toString('utf8')); });
      child.stdin.on('error', () => { /* The process may have finished before the stop request arrives. */ });
      let resolveClosed;
      job.closed = new Promise(resolve => { resolveClosed = resolve; });
      const end = code => { if (closed) return; closed = true; job.done = finish(job, code).finally(resolveClosed); };
      child.once('error', error => { job.error = '録画処理を起動できませんでした。'; void log(job.id, `process_error ${error.code || 'unknown'}`); end(-1); });
      child.once('close', end);
      job.limitTimer = setTimeout(() => { void stop(job.id); }, (maxSeconds + 60) * 1000); job.limitTimer.unref();
      if (job.cancelled || disposed) await stop(job.id);
    } catch (error) {
      if (job.cancelled) return;
      job.state = 'failed'; job.error = error instanceof RecordingError ? error.message : '録画を開始できませんでした。接続と録画ツールをご確認ください。';
      job.finished_at = new Date().toISOString(); await log(job.id, `${error.code || error.name || 'unknown'} ${error.details || ''}`); await persist(job);
    }
  }
  async function start(videoID) {
    await ready;
    if (disposed) throw new RecordingError('server_stopped', '録画サーバーを再起動してください。');
    if (!VIDEO_ID.test(videoID)) throw new RecordingError('invalid_video', '録画する動画を確認できません。');
    if (current && ACTIVE.has(current.state)) throw new RecordingError('busy', 'すでに録画中、または停止処理中です。');
    const id = randomUUID();
    const job = { id, video_id: videoID, title: '', state: 'preparing', message: '録画を準備しています…', error: null,
      seconds: 0, bytes: 0, frames: 0, controller: new AbortController(),
      filename: `weathercas-${videoID}-${new Date().toISOString().replace(/[:.]/g, '-')}.mp4` };
    current = job; jobs.set(id, job); await persist(job); job.run = run(job); return publicJob(job);
  }
  async function stop(id) {
    await ready;
    const job = jobs.get(id);
    if (!job || !JOB_ID.test(id)) throw new RecordingError('not_found', '録画データが見つかりません。');
    if (!ACTIVE.has(job.state) || job.state === 'finalizing') return publicJob(job);
    if (!job.process) {
      job.cancelled = true; job.controller?.abort(); job.state = 'cancelled'; job.message = '録画の準備を中止しました。'; await persist(job);
    } else if (job.state !== 'finalizing') {
      job.state = 'finalizing'; job.message = '録画を停止し、MP4を確定しています…'; job.process.stdin.write('q\n');
      job.killTimer = setTimeout(() => { job.process?.kill(); }, 20000); job.killTimer.unref(); await persist(job);
    }
    return publicJob(job);
  }
  return {
    async snapshot() { await ready; if (current && !ACTIVE.has(current.state)) await current.save; return { supported: process.platform === 'win32' && process.arch === 'x64', job: publicJob(current), max_seconds: maxSeconds, max_bytes: maxBytes }; },
    start, stop,
    async file(id) {
      await ready; const job = jobs.get(id);
      if (!JOB_ID.test(id) || !job || job.state !== 'completed') throw new RecordingError('not_found', '保存できる録画データがありません。');
      const file = outputPath(id), info = await stat(file); return { path: file, size: info.size, filename: job.filename };
    },
    async dispose() { disposed = true; await ready; if (current && ACTIVE.has(current.state)) await stop(current.id); if (current?.closed) await current.closed; },
  };
}
