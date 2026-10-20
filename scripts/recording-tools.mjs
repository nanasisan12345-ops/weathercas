import { readFile, writeFile, mkdir, access, rename, readdir, copyFile, mkdtemp } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { RecordingError } from './recording-format.mjs';

const installations = new Map();
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
export function ensureRecordingTools(root, progress = () => {}) {
  if (process.platform !== 'win32' || process.arch !== 'x64') return Promise.reject(new RecordingError('unsupported_platform', '直接録画はWindows 64bitのローカル起動版で利用できます。'));
  if (installations.has(root)) return installations.get(root);
  const pending = install(root, progress).catch(error => { installations.delete(root); throw error; });
  installations.set(root, pending); return pending;
}

async function install(root, progress) {
  const lock = JSON.parse(await readFile(path.join(root, 'config/recording-tools.json'), 'utf8'));
  const base = path.join(root, 'Data/tools/recording');
  const bin = path.join(base, lock.ffmpeg.version);
  const yt = path.join(base, `yt-dlp-${lock.extractor.version}.exe`);
  const ffmpeg = path.join(bin, 'ffmpeg.exe'), ffprobe = path.join(bin, 'ffprobe.exe');
  const manifestPath = path.join(base, 'installed.json'), lockHash = digest(JSON.stringify(lock));
  await mkdir(base, { recursive: true });
  try {
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    if (manifest.lock_hash === lockHash) {
      await Promise.all([access(yt), access(ffmpeg), access(ffprobe)]);
      return { yt, ffmpeg, ffprobe };
    }
  } catch (error) { if (error.code && error.code !== 'ENOENT') throw error; }
  progress('録画ツールを準備しています（初回のみダウンロード）…');
  async function download(tool) {
    if (!/^https:\/\/github\.com\/yt-dlp\/(yt-dlp|FFmpeg-Builds)\/releases\/download\//.test(tool.url) || !/^[a-f0-9]{64}$/.test(tool.sha256) || path.basename(tool.file) !== tool.file) throw new RecordingError('invalid_tool_config', '録画ツールの設定を確認できません。');
    const target = path.join(base, tool.file);
    try { if (digest(await readFile(target)) === tool.sha256) return target; }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    const response = await fetch(tool.url, { signal: AbortSignal.timeout(180000) });
    if (!response.ok || !response.body) throw new RecordingError('tool_download', '録画ツールをダウンロードできませんでした。接続を確認して再度お試しください。');
    const temp = `${target}.${randomUUID()}.partial`, hash = createHash('sha256'); let size = 0;
    await pipeline(Readable.fromWeb(response.body), new Transform({ transform(chunk, encoding, callback) {
      size += chunk.length;
      if (size > 300000000) return callback(new Error('tool_too_large'));
      hash.update(chunk); callback(null, chunk);
    } }), createWriteStream(temp, { flags: 'wx' }));
    if (hash.digest('hex') !== tool.sha256) throw new RecordingError('tool_digest', '録画ツールの検証に失敗しました。実行せずに中止しました。');
    try { await access(target); await rename(target, `${target}.previous-${randomUUID()}`); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    await rename(temp, target); return target;
  }
  const [extractor, archive] = await Promise.all([download(lock.extractor), download(lock.ffmpeg)]);
  const stage = await mkdtemp(path.join(base, 'unpack-'));
  progress('録画ツールを展開しています…');
  await new Promise((resolve, reject) => {
    // Use .NET directly so inherited PowerShell 7 module paths cannot break Windows PowerShell's Archive module.
    const unzip = "$ErrorActionPreference='Stop'; [void][System.Reflection.Assembly]::LoadWithPartialName('System.IO.Compression.FileSystem'); [System.IO.Compression.ZipFile]::ExtractToDirectory($env:WEATHERCAS_TOOL_ZIP, $env:WEATHERCAS_TOOL_STAGE)";
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', unzip],
      { windowsHide: true, stdio: 'ignore', env: { ...process.env, TEMP: path.join(root, 'Data/temp'), TMP: path.join(root, 'Data/temp'), WEATHERCAS_TOOL_ZIP: archive, WEATHERCAS_TOOL_STAGE: stage } });
    child.once('error', reject); child.once('close', code => code === 0 ? resolve() : reject(new RecordingError('tool_extract', '録画ツールを展開できませんでした。')));
  });
  const folders = await readdir(stage, { withFileTypes: true });
  const packageRoot = path.join(stage, folders.find(entry => entry.isDirectory())?.name || '');
  const sourceBin = path.join(packageRoot, 'bin');
  await mkdir(bin, { recursive: true });
  for (const entry of await readdir(sourceBin, { withFileTypes: true })) {
    if (entry.isFile() && /\.(exe|dll)$/.test(entry.name)) await copyFile(path.join(sourceBin, entry.name), path.join(bin, entry.name));
  }
  await copyFile(extractor, yt);
  for (const entry of await readdir(packageRoot, { withFileTypes: true })) {
    if (entry.isFile() && /license|readme/i.test(entry.name)) await copyFile(path.join(packageRoot, entry.name), path.join(bin, entry.name));
  }
  await Promise.all([access(yt), access(ffmpeg), access(ffprobe)]);
  await writeFile(manifestPath, JSON.stringify({ lock_hash: lockHash, installed_at: new Date().toISOString(), tools: lock }, null, 2));
  return { yt, ffmpeg, ffprobe };
}
