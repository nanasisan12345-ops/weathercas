import { useEffect, useState, type ReactNode } from 'react';
import CasterPhoto from './CasterPhoto';
import CasterSocials from './CasterSocials';
import DirectRecording, { isLocalRecordingOrigin } from './DirectRecording';
import LiveChat from './LiveChat';
import LiveCaster from './LiveCaster';
import ThemeToggle from './ThemeToggle';
import WeatherPanels from './WeatherPanels';
import { aggregate, currentScheduleRows, filterRecords, fresh, jstDate, livePresentation, loadDataset, loadLive, loadSchedule,
  parseRoute, routeHash, shiftDate, showTime,
  type Appearance, type CurrentSchedule, type Dataset, type LiveData, type Route } from './data';

const BASE = import.meta.env.BASE_URL;
const OFFICIAL = 'https://weathernews.jp/wnl/';
const localRecording = isLocalRecordingOrigin();
const statusNames = { confirmed: '確認済み', scheduled: '予定', unverified: '未確認' };
const nav = [['home', 'ホーム'], ['live', 'ライブ視聴'], ['weather', '天気・台風'],
  ['schedule', '出演番組表'], ['archive', '出演履歴'], ['statistics', '出演統計']] as const;

function Icon({ name }: { name: string }) {
  const paths: Record<string, ReactNode> = {
    home: <><path d="m3 10 9-7 9 7v10H3Z" /><path d="M9 20v-7h6v7" /></>,
    live: <><rect x="3" y="5" width="18" height="14" rx="3" /><path d="m10 9 6 3-6 3Z" /></>,
    schedule: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M7 3v4m10-4v4M3 11h18m-13 4h2m4 0h2" /></>,
    archive: <><circle cx="12" cy="12" r="9" /><path d="M12 7v6l4 2" /></>,
    statistics: <><path d="M4 21V10h4v11m4 0V3h4v18m4 0V7h2v14" /></>,
    capture: <><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="4" /></>,
    arrow: <><path d="M5 12h14m-6-6 6 6-6 6" /></>,
    search: <><circle cx="10" cy="10" r="6" /><path d="m15 15 6 6" /></>,
    weather: <><circle cx="8" cy="8" r="4" /><path d="M8 1v1M1 8h1m12-6-1 1M2 2l1 1m4 15h12a4 4 0 0 0 0-8 6 6 0 0 0-11-1 4.5 4.5 0 0 0-1 9Z" /></>,
  };
  return <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name] || paths.home}</svg>;
}
function External({ href, children, className }: { href: string; children: ReactNode; className?: string }) {
  return <a href={href} target="_blank" rel="noopener noreferrer" className={className}>{children}<svg className="external-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true"><path d="M6 3H3v10h10v-3M8 3h5v5m0-5L7 9" /></svg><span className="sr-only">（新しいタブ）</span></a>;
}
function SectionHead({ kicker, title, children }: { kicker: string; title: string; children?: ReactNode }) {
  return <div className="section-heading"><div><span className="kicker">{kicker}</span><h2>{title}</h2></div>{children}</div>;
}
function Empty({ children }: { children: ReactNode }) {
  return <div className="empty"><Icon name="archive" /><p>{children}</p></div>;
}
function Badge({ status }: { status: Appearance['status'] }) {
  return <span className={`badge ${status}`}>{statusNames[status]}</span>;
}
function ShortProgram({ value }: { value: string }) {
  return <>{value.replace(/^ウェザーニュースLiVE[・\s]*/, '') || 'ウェザーニュースLiVE'}</>;
}

function RecordRow({ row, onCaster, compact = false }: { row: Appearance; onCaster: (id: string) => void; compact?: boolean }) {
  const person = row.confirmed || row.planned;
  return <div className={`record-row ${compact ? 'compact-row' : ''}`}>
    <div className="record-time">{!compact && <time dateTime={row.date_jst}>{row.date_jst.replaceAll('-', '/')}</time>}<strong>{row.slot_start_jst}</strong><small>JST</small></div>
    <CasterPhoto id={person.caster_id} name={person.caster_name} />
    <div className="record-body"><div className="record-program"><ShortProgram value={row.program} /></div>
      {person.caster_id ? <div className="person-line"><button className="caster-button" onClick={() => onCaster(person.caster_id!)}>{person.caster_name}</button><CasterSocials id={person.caster_id} name={person.caster_name} /></div> : <strong className="muted">出演者未確認</strong>}
      {!compact && <details><summary>出典・予定の変更{row.changes.length ? `（${row.changes.length}件）` : ''}</summary>
        <p>掲載予定：{row.planned.caster_name || '未確認'}<br />実際の出演：{row.confirmed?.caster_name || '未確認'}<br />取得：{showTime(row.planned.source_checked_at)}</p>
        <p>日付は現在枠から並ぶ公式番組表とJST取得時刻に基づき整理しています。</p>
        <External href={row.planned.source_url}>公式番組表の取得元</External>
        {row.confirmed && <p><External href={row.confirmed.source_url}>出演確認の出典</External></p>}
        {row.changes.map((change, i) => <p key={i}>{showTime(change.changed_at)}：以前の予定 {change.previous_plan.caster_name || '未確認'} / {change.previous_program}</p>)}
      </details>}
    </div><Badge status={row.status} />
  </div>;
}

function Calendar({ date, rows, onDate }: { date: string; rows: Appearance[]; onDate: (value: string) => void }) {
  const month = date.slice(0, 7), first = `${month}-01`;
  const start = new Date(`${first}T12:00:00+09:00`).getUTCDay();
  const days = new Date(Number(month.slice(0, 4)), Number(month.slice(5)), 0).getDate();
  const counts = new Map<string, number>();
  rows.forEach(row => counts.set(row.date_jst, (counts.get(row.date_jst) || 0) + 1));
  function move(delta: number) {
    const value = new Date(`${first}T12:00:00Z`);
    value.setUTCMonth(value.getUTCMonth() + delta);
    onDate(value.toISOString().slice(0, 10));
  }
  return <div className="calendar"><div className="calendar-heading"><button onClick={() => move(-1)} aria-label="前の月">前月</button><strong>{month.replace('-', '年')}月</strong><button onClick={() => move(1)} aria-label="次の月">翌月</button></div>
    <div className="calendar-grid">{['日', '月', '火', '水', '木', '金', '土'].map(day => <span className="weekday" key={day}>{day}</span>)}
      {Array.from({ length: start }, (_, i) => <span key={`blank-${i}`} />)}
      {Array.from({ length: days }, (_, i) => {
        const value = `${month}-${String(i + 1).padStart(2, '0')}`, count = counts.get(value) || 0;
        return <button className={`${date === value ? 'selected' : ''} ${count ? 'has-records' : ''}`} key={value} onClick={() => onDate(value)} aria-label={`${value}、${count}件の記録`} aria-pressed={date === value}>{i + 1}<span aria-hidden="true">{count ? `${count}件` : '—'}</span></button>;
      })}</div><p className="small muted">件数は予定・未確認を含む観測記録です。</p></div>;
}
function Bars({ title, items }: { title: string; items: [string, number][] }) {
  const max = Math.max(1, ...items.map(([, count]) => count));
  return <article className="card chart-card"><h3>{title}</h3>{items.length ? <div className="bars" role="list">{items.map(([label, count]) => <div className="bar-row" role="listitem" key={label}>
    <span className="bar-label">{label.replace(/^ウェザーニュースLiVE[・\s]*/, '') || label}</span><div className="bar-track" aria-hidden="true"><div style={{ width: `${count / max * 100}%` }} /></div><strong>{count}<small>回</small></strong>
  </div>)}</div> : <p className="muted">集計対象の記録がありません。</p>}</article>;
}

export default function App() {
  const [route, setRoute] = useState(() => parseRoute(window.location.hash));
  const [data, setData] = useState<Dataset | null>(null), [live, setLive] = useState<LiveData | null>(null);
  const [currentSchedule, setCurrentSchedule] = useState<CurrentSchedule | null>(null), [scheduleFailed, setScheduleFailed] = useState(false);
  const [error, setError] = useState(''), [liveError, setLiveError] = useState(''), [loading, setLoading] = useState(true);
  const [now, setNow] = useState(Date.now());
  const [page, setPage] = useState(1);
  function update(patch: Partial<Route>, replace = false) {
    const next = { ...parseRoute(window.location.hash), ...patch };
    const hash = routeHash(next);
    if (window.location.hash !== hash) window.history[replace ? 'replaceState' : 'pushState'](null, '', hash);
    setRoute(next); setPage(1);
  }
  useEffect(() => {
    const sync = () => { setRoute(parseRoute(window.location.hash)); setPage(1); };
    window.addEventListener('popstate', sync); window.addEventListener('hashchange', sync);
    return () => { window.removeEventListener('popstate', sync); window.removeEventListener('hashchange', sync); };
  }, []);
  useEffect(() => {
    if (route.view === 'home') window.scrollTo({ top: 0 });
    else document.getElementById(route.view)?.scrollIntoView({ block: 'start' });
  }, [route.view, loading]);
  useEffect(() => {
    let active = true, livePending = false, schedulePending = false;
    async function refresh() {
      try { const result = await loadDataset(); if (active) { setData(result); setError(''); } }
      catch (e) { if (active) setError(e instanceof Error ? e.message : 'データの取得に失敗しました。'); }
      finally { if (active) setLoading(false); }
    }
    async function refreshLive() {
      if (livePending) return;
      livePending = true;
      try { const result = await loadLive(); if (active) { setLive(result); setLiveError(''); setNow(Date.now()); } }
      catch { if (active) { setLive(null); setLiveError('動画情報の読み込みに失敗しました。公式ページでご確認ください。'); } }
      finally { livePending = false; }
    }
    async function refreshSchedule() {
      if (schedulePending) return;
      schedulePending = true;
      try { const result = await loadSchedule(); if (active) { setCurrentSchedule(result); setScheduleFailed(false); setNow(Date.now()); } }
      catch { if (active) { setCurrentSchedule(null); setScheduleFailed(true); } }
      finally { schedulePending = false; }
    }
    const onVisible = () => { if (document.visibilityState === 'visible') { void refreshLive(); void refreshSchedule(); } };
    void refresh(); void refreshLive(); void refreshSchedule();
    const updateData = window.setInterval(() => { void refresh(); void refreshSchedule(); }, 300000);
    const updateLive = window.setInterval(() => void refreshLive(), 30000);
    const clock = window.setInterval(() => setNow(Date.now()), 15000);
    document.addEventListener('visibilitychange', onVisible); window.addEventListener('focus', onVisible);
    return () => { active = false; window.clearInterval(updateData); window.clearInterval(updateLive); window.clearInterval(clock);
      document.removeEventListener('visibilitychange', onVisible); window.removeEventListener('focus', onVisible); };
  }, []);
  const rows = data?.records || [], today = jstDate(new Date(now));
  const scheduleRows = currentScheduleRows(rows, currentSchedule, now);
  const todayRows = scheduleRows.filter(row => row.date_jst === today), dayRows = scheduleRows.filter(row => row.date_jst === route.date);
  const filtered = filterRecords(rows, route, data?.index.casters);
  const stats = aggregate(filtered, route.stats), presentation = livePresentation(live, now);
  const activeCasters = data?.index.casters.filter(caster => rows.some(row => row.planned.caster_id === caster.id || row.confirmed?.caster_id === caster.id)) || [];
  const stale = !data || !fresh(data.status.generated_at, now);
  const currentScheduleFresh = currentSchedule !== null && fresh(currentSchedule.checked_at, now, 10);
  const casterLink = (id: string) => update({ view: 'archive', caster: id, q: '', status: '', program: '', month: '', year: '' });
  const hasFailures = data?.status.sources.some(source => source.status === 'failed');
  const healthLabel = currentScheduleFresh ? '番組表確認済み' : error ? '読込失敗' : loading ? '読み込み中'
    : scheduleFailed ? '保存済み番組表を表示' : stale ? '番組表の更新待ち' : hasFailures ? '一部収集失敗' : '保存済み番組表';
  return <div className="app-layout" id="home">
    <a className="skip-link" href="#main-content">本文へ移動</a>
    <aside className="sidebar"><a className="site-mark" href="#home" onClick={e => { e.preventDefault(); update({ view: 'home' }); }}><img src={`${BASE}assets/weathercas-icon.png`} alt="" width="42" height="42" /><span>WeatherCas<small>ウェザキャス</small></span></a>
      <span className="side-label">EXPLORE</span><nav aria-label="メインナビゲーション">{nav.map(([key, title]) => <a key={key} href={routeHash({ ...route, view: key })} aria-current={route.view === key ? 'page' : undefined} onClick={e => { e.preventDefault(); update({ view: key }); }}><Icon name={key} /><span>{title}</span></a>)}</nav>
      <div className="sidebar-bottom"><p>ウェザーニュースLiVE<br />非公式ファンサイト</p><p>ウェザーニューズ社・YouTubeとは運営上の関係はありません。</p></div>
    </aside>
    <main id="main-content" className="main-content">
      <header className="topbar"><div><span className="kicker">WEATHERCASTER ARCHIVE</span><h1>ウェザキャス <span>/ WeatherCas</span></h1></div><div className="topbar-meta"><time>{new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit' }).format(new Date(now))} JST</time><span className="unofficial">非公式ファンサイト</span><ThemeToggle /></div></header>
      <div className="brand-hero"><div className="brand-content"><img src={`${BASE}assets/weathercas-logo.png`} alt="ウェザキャス WeatherCas 採用ロゴ" width="2172" height="724" fetchPriority="high" /></div><div className="brand-orbit" aria-hidden="true"><i /><i /><i /></div></div>
      <div className="collection-summary"><div className="update-stamp"><span className={`status-dot ${!currentScheduleFresh && (stale || error || hasFailures || scheduleFailed) ? 'pending' : ''}`} />{healthLabel}<small>{currentScheduleFresh ? '番組表確認 ' : '保存データ取得 '}{showTime(currentScheduleFresh ? currentSchedule.checked_at : data?.status.generated_at)}</small></div></div>
      {error && <div className="alert" role="alert">{data ? '前回読み込んだ記録を表示しています。' : ''}{error}<button onClick={() => window.location.reload()}>再読み込み</button></div>}
      {loading && <div className="notice-inline" role="status">公式データを読み込んでいます…</div>}
      {data && stale && !currentScheduleFresh && <p className="notice-inline collection-warning">最新の番組表を確認できていません。4時間以上前の保存データを表示しています。<External href="https://weathernews.jp/wnl/timetable.html">公式番組表で確認</External>。配信動画の情報は別に確認しています。</p>}
      <div className="hero-grid">
        <section className="card live-card" id="live"><div className="panel-heading"><h2><Icon name="live" />ウェザーニュースLiVE</h2><span className={`badge ${presentation.tone}`}>{presentation.tone === 'live' ? 'LIVE' : '公式動画'}</span></div>
          <div className="player">
            {presentation.embed && live?.video ? <iframe key={live.video.id} src={`https://www.youtube-nocookie.com/embed/${live.video.id}?autoplay=1&mute=1&playsinline=1`} title="ウェザーニュースLiVE 公式YouTube動画" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" referrerPolicy="strict-origin-when-cross-origin" allowFullScreen /> :
              <div className="player-placeholder"><svg viewBox="0 0 64 64" className="play-symbol" aria-hidden="true"><circle cx="32" cy="32" r="30" fill="none" stroke="currentColor" /><path d="m26 21 18 11-18 11Z" fill="currentColor" /></svg><strong>{presentation.embed ? '公式YouTube動画を視聴' : '公式配信ページでチェック'}</strong>
                <p>{presentation.label}</p><span className="small"><a href="#privacy">利用条件・プライバシー</a></span></div>}
          </div><DirectRecording videoID={presentation.embed && live?.video ? live.video.id : null} /><p className="live-title">{liveError || (fresh(live?.checked_at || '', now) ? live?.video?.title : '') || presentation.label}</p>
          <div className="live-footer"><div><span className={presentation.tone === 'live' ? 'live-text' : 'muted'}>{presentation.label}</span><small>動画情報取得：{showTime(live?.checked_at)}</small></div><div className="live-actions"><External href={OFFICIAL} className="primary button-link">公式配信を見る</External></div></div>
          <LiveCaster live={live} now={now} />
        </section>
        <LiveChat live={live} now={now} />
      </div>
        <section className="card today-card"><div className="panel-heading"><div><span className="kicker">TODAY’S LINEUP</span><h2>今日の出演予定</h2></div><span className="date-label">{today.slice(5).replace('-', '/')}</span></div><p className="small muted">取得できた枠のみ掲載。時刻はすべて日本時間です。</p>
          <div className="today-timetable">{todayRows.length ? todayRows.map(row => <RecordRow compact key={row.id} row={row} onCaster={casterLink} />) : <Empty>{loading ? '読み込み中です。' : '本日の予定はまだ取得されていません。'}</Empty>}</div>
          <a className="text-link" href="#schedule" onClick={e => { e.preventDefault(); update({ view: 'schedule', date: today }); }}>日付を選んで番組表を見る<Icon name="arrow" /></a>
        </section>
      <WeatherPanels />
      <section id="schedule"><SectionHead kicker="DAILY SCHEDULE" title="日付から出演番組を探す"><External href="https://weathernews.jp/wnl/timetable.html">公式番組表</External></SectionHead>
        <div className="schedule-grid"><div className="card calendar-card"><Calendar date={route.date} rows={rows} onDate={date => update({ date })} /></div>
          <div className="card schedule-detail"><div className="date-controls"><button onClick={() => update({ date: shiftDate(route.date, -1) })}>前日</button><label><span className="sr-only">番組表の日付</span><input type="date" value={route.date} onChange={e => { if (e.target.value) update({ date: e.target.value }); }} /></label><button onClick={() => update({ date: shiftDate(route.date, 1) })}>翌日</button><button onClick={() => update({ date: today })}>今日</button></div>
            <p className="small muted">予定は後から変更される場合があります。過去になった予定も、出演実績には変換しません。</p>
            {dayRows.length ? dayRows.map(row => <RecordRow key={row.id} row={row} onCaster={casterLink} />) : <Empty>この日の記録はありません。未取得の番組や出演者は補完していません。</Empty>}
          </div></div>
      </section>
      <section id="archive"><SectionHead kicker="ARCHIVE FINDER" title="キャスターと出演記録を探す"><span className="muted small">収録範囲：{data?.index.earliest_date || '未取得'} ～ {data?.index.latest_date || '未取得'}</span></SectionHead>
        <div className="card archive-card"><div className="search-box"><Icon name="search" /><label className="sr-only" htmlFor="history-search">出演履歴を検索</label><input id="history-search" type="search" placeholder="キャスター名・番組名・日付で検索" value={route.q} onChange={e => update({ q: e.target.value }, true)} maxLength={200} /></div>
          <div className="filters"><label>キャスター<select value={route.caster} onChange={e => update({ caster: e.target.value })}><option value="">すべてのキャスター</option>{activeCasters.map(c => <option value={c.id} key={c.id}>{c.name}</option>)}</select></label>
            <label>番組<select value={route.program} onChange={e => update({ program: e.target.value })}><option value="">すべての番組</option>{[...new Set(rows.map(row => row.program))].map(program => <option key={program}>{program}</option>)}</select></label>
            <label>年<select value={route.year} onChange={e => update({ year: e.target.value, month: '' })}><option value="">すべての年</option>{[...new Set(rows.map(row => row.date_jst.slice(0, 4)))].map(year => <option key={year}>{year}</option>)}</select></label>
            <label>月<select value={route.month} onChange={e => update({ month: e.target.value, year: e.target.value ? e.target.value.slice(0, 4) : '' })}><option value="">すべての月</option>{data?.index.months.filter(month => !route.year || month.startsWith(route.year)).map(month => <option key={month} value={month.replace('/', '-')}>{month.replace('/', '年')}月</option>)}</select></label>
            <label>確度<select value={route.status} onChange={e => update({ status: e.target.value })}><option value="">すべての確度</option>{Object.entries(statusNames).map(([key, title]) => <option key={key} value={key}>{title}</option>)}</select></label>
            <button onClick={() => update({ q: '', caster: '', program: '', month: '', year: '', status: '' })}>条件をクリア</button></div>
          <div className="results-heading" role="status"><strong>{filtered.length}件の記録</strong><span className="small muted">予定・確認済み・未確認を区別しています</span></div>
          {filtered.length ? [...filtered].reverse().slice((page - 1) * 50, page * 50).map(row => <RecordRow key={row.id} row={row} onCaster={casterLink} />) : <Empty>条件に一致する記録はありません。検索条件を変更するか、収集範囲をご確認ください。</Empty>}
          {filtered.length > 50 && <div className="pagination"><button disabled={page === 1} onClick={() => setPage(page - 1)}>前の50件</button><span>{page} / {Math.ceil(filtered.length / 50)}</span><button disabled={page * 50 >= filtered.length} onClick={() => setPage(page + 1)}>次の50件</button></div>}
          {route.caster && <div className="caster-info"><h3>{data?.index.casters.find(c => c.id === route.caster)?.name || route.caster} の出演記録</h3><p>キャスターの公式プロフィールと、このサイトで蓄積した予定・実績を確認できます。</p><External href={`https://weathernews.jp/wnl/caster/${encodeURIComponent(route.caster)}.html`}>公式プロフィール</External></div>}
        </div>
      </section>
      <section id="statistics"><SectionHead kicker="CASTER INSIGHTS" title="出演データを、わかりやすく。"><div className="segmented" aria-label="集計対象"><button aria-pressed={route.stats === 'confirmed'} onClick={() => update({ stats: 'confirmed' })}>確認済みの出演</button><button aria-pressed={route.stats === 'scheduled'} onClick={() => update({ stats: 'scheduled' })}>掲載予定</button></div></SectionHead>
        <p className="stats-description">上の検索条件に一致する{route.stats === 'confirmed' ? '確認済みの出演実績' : '公式番組表の掲載予定'}：<strong>{stats.total}枠</strong>。未確認の出演者は除外し、同じ枠を重複加算しません。</p>
        {!stats.total && <div className="notice-inline">{route.stats === 'confirmed' ? '確認済みの出演実績はまだありません。番組表から取得した予定は「掲載予定」で確認できます。' : '現在の条件に一致する予定はありません。'}</div>}
        <div className="charts-grid"><Bars title="キャスター別ランキング" items={stats.caster} /><Bars title="曜日別" items={stats.weekday} /><Bars title="月別" items={stats.month} /><Bars title="番組別" items={stats.program} /><Bars title="年別" items={stats.year} /></div>
      </section>
      <section className="official-videos"><SectionHead kicker="OFFICIAL VIDEOS" title="公式の最新動画"><External href="https://www.youtube.com/user/weathernews">公式YouTubeチャンネル</External></SectionHead><p className="small muted">公式一覧のアーカイブ動画です。出演履歴としては集計しません。取得：{showTime(live?.archives_checked_at)}</p>
        {live?.archives.length ? <div className="video-links">{live.archives.map(video => <External key={video.id} href={`https://www.youtube.com/watch?v=${video.id}`}><span><small>{showTime(video.published_at)} 公開</small><strong>{video.title}</strong></span></External>)}</div> : <Empty>アーカイブ動画をまだ取得できていません。</Empty>}
      </section>
      <section className="privacy-note" id="privacy"><h2>利用条件・プライバシー</h2><p>ウェザキャスは非公式のファンサイトです。情報の正確性・更新時刻・配信の継続は保証しません。最新情報は公式サイトをご確認ください。誤りの報告は公開リポジトリのIssuesへお寄せください。</p><p>このサイトは公式公開情報と、設定されている場合はYouTube API Servicesを利用します。YouTube機能の利用には<External href="https://www.youtube.com/t/terms">YouTube利用規約</External>が適用されます。ページ表示時に動画とPC版チャットを自動読み込みし、YouTubeへ接続します。IPアドレス等が送信され、第三者コンテンツ・広告やCookie等が利用される場合があります。<External href="https://policies.google.com/privacy">Googleプライバシーポリシー</External>をご確認ください。</p><p>本アプリ独自の解析・Cookieは使用しません。表示モードと天気カードの選択・順番・幅をブラウザーのlocalStorageに保存します。端末間での同期はしません。run.batの専用Edgeではプロジェクト内のData/browserに保持されます。{localRecording && <>ローカル版の録画は、このPCのNodeサーバーが配信の映像・音声を直接取得し、Data/recordingsに保存します。映像・音声を運営者へアップロードしません。初回の録画時はGitHubから録画ツールをData/toolsへ取得します。保存したファイルは利用者が削除できます。</>}ホスティング事業者はアクセスログを保持する場合があります。</p>{localRecording && <p>許諾済みの素材を対象とするローカル録画機能を提供しています。番組映像の利用には<External href="https://weathernews.jp/wnl/guideline/">公式ガイドライン</External>と<External href="https://developers.google.com/youtube/terms/developer-policies">YouTube APIポリシー</External>をそれぞれご確認ください。</p>}</section>
      <footer><span>WeatherCas / ウェザキャス</span><span>ウェザーニュースLiVE 非公式ファンサイト</span><External href={OFFICIAL}>ウェザーニュースLiVE公式</External></footer>
    </main>
  </div>;
}
