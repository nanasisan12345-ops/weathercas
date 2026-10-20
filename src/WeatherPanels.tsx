import { useEffect, useState } from 'react';

const panels = [
  { title: '全国の天気予報', image: 'https://site.weathernews.jp/site/forecast/image/map/JAPAN.today.png', page: 'https://weathernews.jp/', alt: 'ウェザーニュース公式の全国の今日の天気予報図', width: 1024, height: 1024 },
  { title: '台風情報', image: 'https://gvs.weathernews.jp/s/typhoon/img/data/multi_onebox.png', page: 'https://weathernews.jp/onebox/typhoon/', alt: 'ウェザーニュース公式の台風進路予想図・日本広域', width: 1200, height: 900 },
];

function WeatherImage({ panel, refresh }: { panel: typeof panels[number]; refresh: number }) {
  const src = `${panel.image}?t=${refresh}`;
  const [failed, setFailed] = useState('');
  return <article className="card weather-panel"><div className="panel-heading"><h3>{panel.title}</h3><a href={panel.page} target="_blank" rel="noopener noreferrer">公式で詳しく<span className="sr-only">（新しいタブ）</span></a></div>
    {failed === src ? <div className="weather-unavailable" role="status"><p>画像を読み込めませんでした。</p><a className="button-link" href={panel.page} target="_blank" rel="noopener noreferrer">公式の{panel.title}を開く</a></div> :
      <a className="weather-map" href={panel.page} target="_blank" rel="noopener noreferrer" aria-label={`${panel.title}の公式ページ（新しいタブ）`}><img src={src} alt={panel.alt} width={panel.width} height={panel.height} loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(src)} /></a>}
    <p className="small muted weather-attribution">出典：ウェザーニュース。画像内の発表日時をご確認ください。</p>
  </article>;
}

export default function WeatherPanels() {
  const [refresh, setRefresh] = useState(() => Math.floor(Date.now() / 300000));
  useEffect(() => {
    const timer = window.setInterval(() => setRefresh(Math.floor(Date.now() / 300000)), 300000);
    return () => window.clearInterval(timer);
  }, []);
  return <section id="weather" className="weather-section" aria-label="天気予報と台風情報"><div className="section-heading"><div><span className="kicker">WEATHER & TYPHOON</span><h2>全国の天気・台風情報</h2></div></div><div className="weather-grid">{panels.map(panel => <WeatherImage key={panel.title} panel={panel} refresh={refresh} />)}</div></section>;
}
