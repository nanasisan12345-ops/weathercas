import { useEffect, useState } from 'react';
import { fresh, type LiveData } from './data';

export function chatURLs(videoID: string, hostname: string) {
  if (!/^[a-zA-Z0-9_-]{11}$/.test(videoID) || !/^[a-zA-Z0-9.-]+$/.test(hostname)) return null;
  return {
    embed: `https://www.youtube.com/live_chat?${new URLSearchParams({ v: videoID, embed_domain: hostname })}`,
    popup: `https://www.youtube.com/live_chat?${new URLSearchParams({ v: videoID, is_popout: '1' })}`,
  };
}
export default function LiveChat({ live, now }: { live: LiveData | null; now: number }) {
  const [small, setSmall] = useState(() => window.matchMedia('(max-width: 760px)').matches);
  useEffect(() => {
    const query = window.matchMedia('(max-width: 760px)');
    const update = () => setSmall(query.matches);
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  const video = live && fresh(live.checked_at, now) && ['listed', 'live'].includes(live.state) ? live.video : null;
  const urls = video ? chatURLs(video.id, window.location.hostname) : null;
  return <section className="card chat-card" aria-label="YouTubeライブコメント">
    <div className="panel-heading"><div><span className="kicker">YOUTUBE LIVE CHAT</span><h2>ライブコメント</h2></div><span className="badge">YouTube公式</span></div>
    <div className="chat-content">
      {!video || !urls ? <div className="chat-placeholder"><p>配信中の動画を確認できないため、コメント欄を表示できません。</p><a href="https://www.youtube.com/user/weathernews/live" target="_blank" rel="noopener noreferrer">公式ライブページで確認する</a></div> : small ?
        <div className="chat-placeholder"><p>スマートフォンでは、YouTube公式画面でコメントをご利用ください。</p><a className="primary button-link" href={`https://www.youtube.com/watch?v=${video.id}`} target="_blank" rel="noopener noreferrer">YouTubeで視聴・コメント</a></div> :
          <iframe key={video.id} title="YouTube公式ライブチャット" src={urls.embed} referrerPolicy="strict-origin-when-cross-origin" />}
    </div>
    <div className="chat-footer"><p>投稿やログインができない場合は、公式チャットを別ウィンドウで開いてください。投稿可否は配信側の設定にも依存します。</p>
      {urls && <a className="button-link" href={urls.popup} target="_blank" rel="noopener noreferrer">公式チャットでコメントを書く<span className="sr-only">（新しいタブ）</span></a>}
    </div>
  </section>;
}
