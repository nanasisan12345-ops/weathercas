export const OFFICIAL_CHANNEL = 'UCNsidkYpIAQ4QaufptQBPHQ';
export const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
export const JOB_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export class RecordingError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

function mediaURL(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.port &&
      (url.hostname === 'googlevideo.com' || url.hostname.endsWith('.googlevideo.com'));
  } catch { return false; }
}

export function selectRecordingFormats(info, expectedID) {
  if (!VIDEO_ID.test(expectedID) || info?.id !== expectedID || info.channel_id !== OFFICIAL_CHANNEL) {
    throw new RecordingError('channel_mismatch', '公式チャンネルの配信であることを確認できませんでした。');
  }
  if (info.is_live !== true || info.live_status !== 'is_live') throw new RecordingError('not_live', 'この動画は現在のライブ配信ではありません。');
  if (info.has_drm === true || !Array.isArray(info.formats)) throw new RecordingError('unsupported_source', '直接保存できる配信形式を確認できませんでした。');
  const formats = info.formats.filter(f => f.has_drm === false && ['m3u8', 'm3u8_native'].includes(f.protocol) && mediaURL(f.url));
  const videos = formats.filter(f => f.ext === 'mp4' && /^avc1[.]/i.test(f.vcodec || '') &&
    Number.isFinite(f.height) && f.height > 0 && f.height <= 1080 && Number.isFinite(f.width) && f.width <= 1920 &&
    Number.isFinite(f.fps) && f.fps > 0 && f.fps <= 60);
  videos.sort((a, b) => b.height - a.height || b.fps - a.fps || (b.tbr || 0) - (a.tbr || 0));
  const video = videos[0];
  if (!video) throw new RecordingError('no_video_format', '1080p・60fps以下のMP4互換の配信を取得できませんでした。');
  const combined = video.acodec && video.acodec !== 'none';
  const audios = formats.filter(f => f.vcodec === 'none' && ['mp4', 'm4a'].includes(f.ext));
  audios.sort((a, b) => (b.abr || b.tbr || Number(b.format_id) || 0) - (a.abr || a.tbr || Number(a.format_id) || 0));
  const audio = combined ? null : audios[0];
  if (!combined && !audio) throw new RecordingError('no_audio_format', '配信の音声を取得できませんでした。');
  return { video, audio, width: video.width, height: video.height, fps: video.fps };
}

export function recordingArguments(selected, output, { maxSeconds = 1800, maxBytes = 2147483648 } = {}) {
  const input = url => ['-tls_verify', '1', '-rw_timeout', '15000000', '-live_start_index', '-1', '-i', url];
  return ['-hide_banner', '-loglevel', 'warning', '-n', ...input(selected.video.url),
    ...(selected.audio ? input(selected.audio.url) : []), '-map', '0:v:0', '-map', selected.audio ? '1:a:0' : '0:a:0',
    '-c', 'copy', '-bsf:a', 'aac_adtstoasc', '-t', String(maxSeconds), '-fs', String(maxBytes),
    '-movflags', '+frag_keyframe+empty_moov+default_base_moof', '-progress', 'pipe:1', '-nostats', '-f', 'mp4', output];
}

export function parseByteRange(value, size) {
  if (!value) return { start: 0, end: size - 1, partial: false };
  const match = /^bytes=(\d*)-(\d*)$/.exec(value);
  if (!match || (!match[1] && !match[2])) return null;
  const start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
  const end = match[1] ? (match[2] ? Math.min(size - 1, Number(match[2])) : size - 1) : size - 1;
  return Number.isSafeInteger(start) && Number.isSafeInteger(end) && start >= 0 && start <= end && start < size ? { start, end, partial: true } : null;
}
