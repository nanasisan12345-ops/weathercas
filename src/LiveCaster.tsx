import { useState } from 'react';
import CasterPhoto from './CasterPhoto';
import { liveCasterProfiles, profileCheckedOn, type CasterProfile } from './live-caster';
import { fresh, type LiveData } from './data';

function Profile({ profile }: { profile: CasterProfile }) {
  return <div className="live-caster-profile" data-caster-id={profile.id}>
    <div className="live-caster-bio"><CasterPhoto id={profile.id} name={profile.name} /><div className="live-caster-details">
      <p className="live-caster-reading">{profile.reading}</p><div className="person-line"><h4>{profile.name}</h4></div>
      <dl className="live-caster-facts">{profile.facts.map(fact => <div key={fact.label}><dt>{fact.label}</dt><dd>{fact.value}</dd></div>)}</dl>
      <a className="small" href={profile.source_url} target="_blank" rel="noopener noreferrer">公式プロフィールで詳しく<span className="sr-only">（新しいタブ）</span></a>
      <p className="small muted profile-source">出典：ウェザーニュース公式プロフィール · 確認 {profileCheckedOn}</p>
    </div></div>
  </div>;
}
export default function LiveCaster({ live, now }: { live: LiveData | null; now: number }) {
  const profiles = liveCasterProfiles(live, now), identity = `${live?.video?.id || ''}:${live?.video?.title || ''}`;
  const [selection, setSelection] = useState({ identity, id: '' });
  const selected = profiles.find(p => selection.identity === identity && p.id === selection.id) || profiles[0];
  const offline = live?.state === 'offline', unavailable = !live || live.state === 'failed' || !fresh(live.checked_at, now);
  return <section className="live-caster" aria-label="この配信のキャスター"><div className="panel-heading"><div><span className="kicker">ON THIS BROADCAST</span><h3>この配信のキャスター</h3></div></div>
    {selected ? <><p className="small muted">公式の配信タイトルに掲載されたキャスターです。番組切替時に更新します。</p>
      {profiles.length > 1 && <div className="live-caster-selector" aria-label="プロフィールを表示するキャスター">{profiles.map(profile => <button key={profile.id} type="button" aria-pressed={profile.id === selected.id} onClick={() => setSelection({ identity, id: profile.id })}>{profile.name}</button>)}</div>}
      <Profile key={`${identity}:${selected.id}`} profile={selected} />
    </> : <p className="small muted live-caster-empty">{offline ? '配信が再開したらキャスター情報を表示します。' : unavailable ? '配信情報を確認できないため、キャスター情報は表示していません。' : '公式の配信タイトルからキャスターを確認できませんでした。'} <a href="https://weathernews.jp/wnl/caster/index.html" target="_blank" rel="noopener noreferrer">公式キャスター一覧</a></p>}
  </section>;
}
