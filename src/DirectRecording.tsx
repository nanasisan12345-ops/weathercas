import { useEffect, useRef, useState } from 'react';
import { z } from 'zod';

const optionalText = z.string().max(1000).nullable();
const jobSchema = z.object({
  id: z.string().uuid(), video_id: z.string().regex(/^[A-Za-z0-9_-]{11}$/), title: z.string().max(500),
  state: z.enum(['preparing', 'recording', 'finalizing', 'completed', 'failed', 'cancelled']),
  message: optionalText, error: optionalText, warning: optionalText, width: z.number().positive().nullable(), height: z.number().positive().nullable(),
  fps: z.number().nonnegative().nullable(), seconds: z.number().nonnegative(), bytes: z.number().nonnegative(),
  filename: z.string().regex(/^[A-Za-z0-9._-]+\.mp4$/),
});
type Job = z.infer<typeof jobSchema>;
const stateSchema = z.object({ supported: z.boolean(), token: z.string().regex(/^[a-f0-9]{64}$/), job: jobSchema.nullable() });
const ACTIVE = ['preparing', 'recording', 'finalizing'];
const API = `${import.meta.env.BASE_URL}api/recording`;
function time(seconds: number) { return [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, Math.floor(seconds) % 60].map(value => String(value).padStart(2, '0')).join(':'); }

export function isLocalRecordingOrigin() {
  return window.location.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(window.location.hostname);
}
export default function DirectRecording(props: { videoID: string | null }) {
  return isLocalRecordingOrigin() ? <LocalRecording {...props} /> : null;
}
function LocalRecording({ videoID }: { videoID: string | null }) {
  const [job, setJob] = useState<Job | null>(null), [supported, setSupported] = useState<boolean | null>(null);
  const [error, setError] = useState(''), [connectionError, setConnectionError] = useState(''), [busy, setBusy] = useState(false);
  const token = useRef(''), locked = useRef(false), alive = useRef(true), mutation = useRef(0);
  const active = !!job && ACTIVE.includes(job.state);
  useEffect(() => {
    alive.current = true; let timer: number | undefined; const controller = new AbortController();
    async function refresh() {
      const version = mutation.current;
      try {
        const response = await fetch(API, { cache: 'no-store', signal: controller.signal });
        if (response.status === 404) { if (alive.current) setSupported(false); return; }
        if (!response.ok) throw new Error('録画サーバーに接続できませんでした。ローカルの起動状況をご確認ください。');
        const data = stateSchema.safeParse(await response.json());
        if (!data.success) throw new Error('録画サーバーの応答を確認できませんでした。');
        if (alive.current) { token.current = data.data.token; setSupported(data.data.supported); if (version === mutation.current) setJob(data.data.job); setConnectionError(''); }
      } catch (failure) {
        if (alive.current && !controller.signal.aborted) setConnectionError(failure instanceof Error ? failure.message : '録画サーバーに接続できませんでした。');
      } finally { if (alive.current && !controller.signal.aborted) timer = window.setTimeout(() => void refresh(), 1000); }
    }
    void refresh();
    return () => { alive.current = false; controller.abort(); window.clearTimeout(timer); };
  }, []);

  async function action(kind: 'start' | 'stop') {
    if (locked.current || !token.current) return;
    locked.current = true; mutation.current++; setBusy(true); setError('');
    try {
      const response = await fetch(`${API}/${kind}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-WeatherCas-Token': token.current },
        body: JSON.stringify(kind === 'start' ? { video_id: videoID } : { id: job?.id }), signal: AbortSignal.timeout(15000) });
      const data = await response.json();
      if (!response.ok) throw new Error(typeof data.error === 'string' ? data.error.slice(0, 500) : '録画の操作に失敗しました。');
      const result = jobSchema.safeParse(data.job);
      if (!result.success) throw new Error('録画サーバーの応答を確認できませんでした。');
      if (alive.current) setJob(result.data);
    } catch (failure) { if (alive.current) setError(failure instanceof Error ? failure.message : '録画の操作に失敗しました。'); }
    finally { locked.current = false; if (alive.current) setBusy(false); }
  }
  const labels = { preparing: '録画準備中', recording: '録画中', finalizing: '停止処理中', completed: '保存可能', failed: '録画失敗', cancelled: '中止' };
  const fileURL = job ? `${API}/${job.id}/file` : '';
  if (supported === false) return null;
  return <section id="capture" className="capture-widget"><div className="capture-heading"><h3>配信を元画質で録画</h3><span className={`badge ${job?.state === 'recording' ? 'live' : 'neutral'}`}>{job ? labels[job.state] : '待機中'}</span></div>
    <div className="capture-card"><div className="capture-controls"><button className="primary" onClick={() => void action('start')} disabled={!supported || !videoID || active || busy}>録画開始</button><button className="stop-recording" onClick={() => void action('stop')} disabled={!active || job?.state === 'finalizing' || busy}>{job?.state === 'preparing' ? '準備を中止' : '録画停止'}</button><output className="capture-timer" aria-label="録画経過時間">{time(job?.seconds || 0)}</output><span className="small muted">{((job?.bytes || 0) / 1024 / 1024).toFixed(1)} MB</span></div>
      <p className="small muted capture-quality">MP4・再圧縮なし / 最大1080p・60fps{job?.width && job.height && ` / 取得画質：${job.width}×${job.height}・${Number((job.fps || 0).toFixed(2))}fps`}</p>
      {!videoID && supported && !active && <p className="small muted">現在の公式配信を確認してから録画できます。</p>}
      {job?.message && <p className="capture-message" role="status">{job.message}</p>}
      {(error || connectionError || job?.error) && <p className="capture-error" role="alert">{error || connectionError || job?.error}</p>}
      {job?.warning && <p className="notice-inline">{job.warning}</p>}
      {job?.state === 'completed' && <div className="capture-result"><h3>録画プレビュー</h3><video key={job.id} src={fileURL} controls playsInline preload="metadata" aria-label="録画した動画のプレビュー" /><div className="capture-save"><a className="primary button-link" href={`${fileURL}?download=1`} download={job.filename}>MP4をPCに保存</a><span className="small muted">{job.width}×{job.height} / {Number((job.fps || 0).toFixed(2))}fps / {(job.bytes / 1024 / 1024).toFixed(1)} MB</span></div></div>}
      <details className="capture-help"><summary>録画方法・保存について</summary><p>「録画開始」で現在の配信の映像と音声を直接保存します。マウスポインター、プレイヤーのタイトル・操作ボタン、コメント欄は入りません。配信自体に入っているテロップは残ります。</p><p>元の映像・音声を再圧縮せずMP4にまとめます。配信元が30fpsの場合は30fpsのまま、60fpsの場合は最大60fpsで保存します。プレイヤーのミュートや表示サイズは録画に影響しません。配信の最新地点から始まるため、プレイヤーで巻き戻した再生位置とは一致しません。</p><p>初回は録画ツールをData/toolsへダウンロードします。録画はData/recordingsに保存し、最大30分・約2GBで停止します。サーバー起動中は画面を閉じても継続するため、終了するときは「録画停止」を押してください。過去の録画ファイルは次の録画後もData/recordingsに残ります。</p><p>許諾済みの公開配信が対象です。ログイン必須・DRM付きの配信には対応しません。</p></details>
    </div>
  </section>;
}
