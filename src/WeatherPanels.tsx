import { useEffect, useState, type ReactNode } from 'react';
import { defaultWeatherLayout, LAYOUT_KEY, loadWeather, moveWeatherCard, parseWeatherLayout, weatherPanels, type WeatherData, type WeatherLayout, type WeatherPanel } from './weather-data';

function External({ href, children }: { href: string; children: ReactNode }) {
  return <a href={href} target="_blank" rel="noopener noreferrer">{children}<span className="sr-only">（新しいタブ）</span></a>;
}
function WeatherImage({ src, label, page, refresh }: { src: string; label: string; page: string; refresh: number }) {
  const url = new URL(src); url.searchParams.set('t', String(refresh)); const image = url.href;
  const [failed, setFailed] = useState('');
  return failed === image ? <div className="weather-unavailable" role="status"><p>画像を読み込めませんでした。</p><External href={page}>公式の{label}を開く</External></div>
    : <a className="weather-map" href={page} target="_blank" rel="noopener noreferrer" aria-label={`${label}の公式ページ（新しいタブ）`}><img src={image} alt={`ウェザーニュース公式：${label}`} loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(image)} /></a>;
}
function Radar({ base, page }: { base: string; page: string }) {
  const [failed, setFailed] = useState('');
  return failed === base ? <div className="weather-unavailable"><p>雨雲画像を読み込めませんでした。</p><External href={page}>公式の雨雲レーダーを開く</External></div> : <>
    <a href={page} target="_blank" rel="noopener noreferrer" className="weather-radar" aria-label="公式の雨雲レーダー（新しいタブ）">
      {[5, 6].flatMap(y => [13, 14].map(x => <div className="radar-tile" key={`${x}-${y}`}><img src={`https://cyberjapandata.gsi.go.jp/xyz/pale/4/${x}/${y}.png`} alt="" loading="lazy" onError={() => setFailed(base)} /><img className="rain-layer" src={`${base}/4_${x}_${y}.png`} alt="" loading="lazy" onError={() => setFailed(base)} /></div>))}
    </a><img className="radar-legend" src="https://tile.weathernews.jp/nowcast/res/legend_zoomradar_rain@2x.png" alt="雨の強さの凡例（mm/h）" loading="lazy" />
    <p className="small muted">地図：<External href="https://maps.gsi.go.jp/development/ichiran.html">国土地理院・淡色地図</External>。雨雲：ウェザーニュース。</p>
  </>;
}
function CardContent({ panel, refresh }: { panel: WeatherPanel; refresh: number }) {
  const [data, setData] = useState<WeatherData>(), [error, setError] = useState(''), [retry, setRetry] = useState(0);
  const [selected, setSelected] = useState(0), [search, setSearch] = useState('');
  useEffect(() => {
    if (!panel.source) return;
    let active = true; setError(''); setData(undefined);
    loadWeather(panel.source).then(value => { if (active) setData(value); }, e => { if (active) setError(e instanceof Error ? e.message : '天気情報を取得できませんでした。'); });
    return () => { active = false; };
  }, [panel.source, refresh, retry]);
  if (panel.image) return <WeatherImage src={panel.image} label={panel.title} page={panel.page} refresh={refresh} />;
  if (error) return <div className="weather-unavailable" role="status"><p>{error}</p><button type="button" onClick={() => setRetry(x => x + 1)}>再試行</button> <External href={panel.page}>公式で確認</External></div>;
  if (!data) return <div className="weather-loading" role="status">天気情報を読み込んでいます…</div>;
  const image = data.images?.[panel.pick ?? Math.min(selected, data.images.length - 1)];
  const rows = data.rows?.filter(x => `${x.name} ${x.value}`.includes(search));
  return <><p className="weather-caption">{data.caption}</p>{data.notice && <p className="notice-inline">{data.notice}</p>}
    {data.images && data.images.length > 1 && panel.pick === undefined && <label className="weather-date">予報日<select aria-label={`${panel.title}の予報日`} value={Math.min(selected, data.images.length - 1)} onChange={e => setSelected(Number(e.target.value))}>{data.images.map((x, i) => <option key={x.src} value={i}>{x.label}</option>)}</select></label>}
    {image && <WeatherImage src={image.src} label={`${panel.title} ${image.label}`} page={panel.page} refresh={refresh} />}
    {data.radar && <Radar base={data.radar} page={panel.page} />}
    {panel.id === 'warnings' && <label className="weather-search">地域名・情報名<input type="search" value={search} placeholder="例：横浜、強風" onChange={e => setSearch(e.target.value)} aria-label="警報・注意報の地域名・情報名" /></label>}
    {rows && <div className="weather-table-scroll" tabIndex={0} role="region" aria-label={`${panel.title}の一覧`}>{rows.length ? <table className="weather-table"><thead><tr><th scope="col">{panel.id === 'warnings' ? '地域' : '地点'}</th><th scope="col">情報</th></tr></thead><tbody>{rows.map((x, i) => <tr key={`${x.name}-${i}`}><th scope="row">{x.name}</th><td>{x.value}{x.detail && <small>{x.detail}</small>}</td></tr>)}</tbody></table> : <p className="weather-empty">{search ? '一致する情報はありません。' : '掲載されている情報はありません。最新の発表は公式ページをご確認ください。'}</p>}</div>}
    <p className="small muted weather-checked">確認：{new Date(data.checked_at).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })} JST</p></>;
}
export default function WeatherPanels() {
  const [initial] = useState(() => { try { return { cards: parseWeatherLayout(localStorage.getItem(LAYOUT_KEY)), message: '' }; } catch { return { cards: defaultWeatherLayout(), message: '保存した配置を読み込めませんでした。初期配置で表示します。' }; } });
  const [cards, setCards] = useState(initial.cards), [message, setMessage] = useState(initial.message);
  const [editing, setEditing] = useState(false), [dragged, setDragged] = useState('');
  const [refresh, setRefresh] = useState(() => Math.floor(Date.now() / 300000));
  useEffect(() => { const timer = window.setInterval(() => setRefresh(Math.floor(Date.now() / 300000)), 300000); return () => window.clearInterval(timer); }, []);
  function save(next: WeatherLayout, action: string) {
    setCards(next);
    try { localStorage.setItem(LAYOUT_KEY, JSON.stringify({ version: 1, cards: next })); setMessage(`${action}。このブラウザーに保存しました。`); }
    catch { setMessage(`${action}。ブラウザーの保存が使えないため、再読込すると元に戻ります。`); }
  }
  function toggle(id: string) { save(cards.some(x => x.id === id) ? cards.filter(x => x.id !== id) : [...cards, { id, wide: false }], '表示項目を変更しました'); }
  function move(from: string, to: string) { save(moveWeatherCard(cards, from, to), '順番を変更しました'); }
  return <section id="weather" className="weather-section" aria-label="カスタマイズできる天気情報"><div className="section-heading"><div><span className="kicker">MY WEATHER</span><h2>全国の天気・台風情報</h2></div><button type="button" className={editing ? 'primary' : ''} aria-expanded={editing} aria-controls="weather-customize" onClick={() => setEditing(x => !x)}>{editing ? '編集を完了' : '表示・配置をカスタマイズ'}</button></div>
    <p className="small muted weather-summary">{cards.length} / {weatherPanels.length}種類を表示 · 5分ごとに確認。防災情報は公式の最新発表もご確認ください。</p>
    {editing && <div className="card weather-customize" id="weather-customize"><div className="weather-customize-heading"><div><h3>表示する情報を選ぶ</h3><p className="small muted">選択すると末尾に追加します。カード上部で順番や幅を変更できます。配置はこのブラウザーに自動保存されます。</p></div><button type="button" onClick={() => save(defaultWeatherLayout(), '初期配置に戻しました')}>初期配置に戻す</button></div>
      <div className="weather-catalog">{[...new Set(weatherPanels.map(p => p.group))].map(group => <fieldset key={group}><legend>{group}</legend>{weatherPanels.filter(p => p.group === group).map(p => <label key={p.id} className="weather-choice"><input type="checkbox" checked={cards.some(x => x.id === p.id)} onChange={() => toggle(p.id)} /><span><strong>{p.title}</strong><small>{p.description}</small></span></label>)}</fieldset>)}</div><div className="weather-catalog-footer"><button type="button" className="primary" onClick={() => setEditing(false)}>編集を完了</button></div></div>}
    <p className="weather-save-status small" role="status">{message}</p>
    {!cards.length && <div className="card weather-empty"><p>表示する天気情報を選んでください。</p><button type="button" onClick={() => setEditing(true)}>表示する情報を選ぶ</button></div>}
    <div className="weather-grid">{cards.map((card, index) => { const panel = weatherPanels.find(x => x.id === card.id)!;
      return <article key={card.id} data-weather-id={card.id} className={`card weather-panel${card.wide ? ' weather-wide' : ''}${dragged === card.id ? ' weather-dragging' : ''}`} onDragOver={e => { if (dragged) e.preventDefault(); }} onDrop={e => { e.preventDefault(); if (dragged) move(dragged, card.id); setDragged(''); }}>
        {editing && <div className="weather-edit-tools" aria-label={`${panel.title}の配置`}><button type="button" className="weather-drag-handle" draggable onDragStart={e => { setDragged(card.id); e.dataTransfer.setData('text/plain', card.id); e.dataTransfer.effectAllowed = 'move'; }} onDragEnd={() => setDragged('')} aria-label={`${panel.title}をドラッグして移動`} title="ドラッグして移動"><svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">{[4, 8, 12].flatMap(y => [5, 10].map(x => <circle key={`${x}-${y}`} cx={x} cy={y} r="1.2" />))}</svg></button>
          <button type="button" disabled={index === 0} aria-label={`${panel.title}を前へ`} onClick={() => move(card.id, cards[index - 1].id)}>前へ</button><button type="button" disabled={index === cards.length - 1} aria-label={`${panel.title}を後ろへ`} onClick={() => move(card.id, cards[index + 1].id)}>後ろへ</button>
          <button type="button" aria-pressed={card.wide} aria-label={`${panel.title}を横幅いっぱいに表示`} onClick={() => save(cards.map(x => x.id === card.id ? { ...x, wide: !x.wide } : x), '幅を変更しました')}>{card.wide ? '標準幅に' : '横幅いっぱいに'}</button><button type="button" aria-label={`${panel.title}を非表示`} onClick={() => toggle(card.id)}>非表示</button></div>}
        <div className="panel-heading"><h3>{panel.title}</h3><External href={panel.page}>公式で詳しく</External></div><CardContent panel={panel} refresh={refresh} /><p className="small muted weather-attribution">出典：ウェザーニュース。図・情報の対象日時をご確認ください。</p></article>;
    })}</div></section>;
}
