import type { ReactNode } from 'react';
import { isRegularProgram, matchesProgram, normalize, programSlots as slots, programsBySlot, shortProgram,
  type Appearance, type Broadcast, type DataIndex, type ReferenceRecord, type Route } from './data';
import './monthly-schedule.css';

const dateFormat = new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', day: 'numeric', weekday: 'short' });
type Entry = { date: string; slot: string | null; program: string; record?: Appearance; video?: Broadcast; reference?: ReferenceRecord };

export function mergeEntries(rows: Appearance[], filtered: Appearance[], videos: Broadcast[], references: ReferenceRecord[],
  route: Route, casters: DataIndex['casters']) {
  const entries: Entry[] = filtered.map(record => ({
    date: record.date_jst, slot: record.slot_start_jst, program: shortProgram(record.program), record,
  }));
  const displayed = new Map(entries.map(entry => [entry.record!.id, entry]));
  const saved = new Map(rows.map(record => [record.id, record]));
  const casterByName = new Map(casters.map(caster => [normalize(caster.name), caster]));
  const covered = new Set([...rows.map(row => row.id + shortProgram(row.program)),
    ...videos.map(video => video.date_jst + 'T' + video.slot_start_jst + shortProgram(video.program))]);
  const query = normalize(route.q);
  for (const video of videos) {
    const id = video.date_jst + 'T' + video.slot_start_jst;
    const row = saved.get(id);
    const program = shortProgram(video.program);
    const entry = row && shortProgram(row.program) === program ? displayed.get(id) : undefined;
    const caster = casterByName.get(normalize(video.caster_name || ''));
    const matches = (!route.caster || caster?.id === route.caster) &&
      matchesProgram(route.program, video.slot_start_jst, video.program) &&
      (!route.month || video.date_jst.startsWith(route.month)) && (!route.year || video.date_jst.startsWith(route.year)) &&
      normalize([video.date_jst, video.program, video.caster_name, video.forecaster_name, caster?.id, ...(caster?.aliases || [])].join(' ')).includes(query);
    if (entry && !entry.video) entry.video = video;
    else if (matches) entries.push({ date: video.date_jst, slot: video.slot_start_jst, program, video });
  }
  const visibleSlots = new Map(entries.map(entry => [entry.date + 'T' + entry.slot + entry.program, entry]));
  for (const reference of references) {
    const { date_jst: date, slot_start_jst: slot } = reference;
    const program = programsBySlot.get(slot)!;
    const key = date + 'T' + slot + program;
    const entry = visibleSlots.get(key);
    if (entry) entry.reference = reference;
    if (covered.has(key)) continue;
    const people = reference.casters.map(name => casterByName.get(normalize(name)));
    if ((route.caster && !reference.casters.some((name, index) =>
          route.caster === (people[index]?.id || 'ref:' + normalize(name)))) ||
        !matchesProgram(route.program, slot, program) ||
        (route.month && !date.startsWith(route.month)) || (route.year && !date.startsWith(route.year)) ||
        !normalize([date, program, ...reference.casters, ...reference.forecasters,
          ...people.flatMap(caster => caster ? [caster.id, ...caster.aliases] : [])].join(' ')).includes(query)) continue;
    entries.push({ date, slot, program, reference });
  }
  const month = route.month || route.date.slice(0, 7);
  return entries.filter(entry => entry.date.startsWith(month));
}

export function entryCasters(entry: Entry): string[] {
  const name = entry.record?.confirmed?.caster_name || entry.record?.planned.caster_name || entry.video?.caster_name;
  return name ? [name] : entry.reference?.casters || [];
}

function ProgramCell({ entry }: { entry: Entry }) {
  const { record, video, reference, slot, program } = entry;
  const label = entryCasters(entry).join('・');
  const verifiedVideoId = video?.video_id || record?.youtube_video_id;
  const videoId = verifiedVideoId || reference?.video_id;
  const forecasters = video?.forecaster_name || reference?.forecasters.join('・');
  return <div className="monthly-program" title={slot ? `${slot} ${program}` : program}>
    {(label || forecasters) && <div className="monthly-program-people">
      {label && <strong title={label}><span className="sr-only">キャスター </span>{label}</strong>}
      {forecasters && <small title={forecasters}><span className="sr-only">予報士 </span>{forecasters}</small>}
    </div>}
    {videoId && <a className="monthly-thumbnail" href={`https://www.youtube.com/watch?v=${videoId}`} target="_blank" rel="noopener noreferrer"
        aria-label={`${entry.date} ${program}をYouTubeで見る（${verifiedVideoId ? '' : '参考番組表のリンク・'}新しいタブ）`}>
        <img key={videoId} src={`https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`} alt="" width={320} height={180}
          loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={event => { event.currentTarget.hidden = true; }} />
        <span className="monthly-thumbnail-placeholder" aria-hidden="true">▶</span>
      </a>}
    {!label && !forecasters && !videoId && <span className="muted" aria-label="出演者・動画未確認">—</span>}
  </div>;
}

export default function MonthlySchedule({ rows, officialCount, videos, entries, referenceMonths, referenceLoading, referenceError,
  casters, route, today, loading, videosUnavailable, filters, onDate }: {
  rows: Appearance[]; officialCount: number; videos: Broadcast[]; casters: DataIndex['casters']; route: Route;
  entries: Entry[]; referenceMonths: string[]; referenceLoading: boolean; referenceError: boolean;
  today: string; loading: boolean; videosUnavailable: boolean; filters: ReactNode; onDate: (date: string, detail?: boolean) => void;
}) {
  const month = route.month || route.date.slice(0, 7);
  const label = month.replace('-', '年') + '月';
  const months = [...new Set([month, today.slice(0, 7), ...referenceMonths, ...rows.map(row => row.date_jst.slice(0, 7)),
    ...videos.map(video => video.date_jst.slice(0, 7))])].sort().reverse();
  const byDay = new Map<string, Entry[]>();
  const counts = new Map<string, { planned: number; confirmed: number; video: number; reference: number }>();
  for (const entry of entries) {
    const day = byDay.get(entry.date) || [];
    day.push(entry);
    byDay.set(entry.date, day);
    const { record, video } = entry;
    for (const person of entryCasters(entry)) {
      const caster = casters.find(item => normalize(item.name) === normalize(person))?.name || person;
      const count = counts.get(caster) || { planned: 0, confirmed: 0, video: 0, reference: 0 };
      if (record?.status === 'scheduled') count.planned++;
      else if (record?.status === 'confirmed') count.confirmed++;
      else if (!video) count.reference++;
      else count.video++;
      counts.set(caster, count);
    }
  }
  const days = new Date(`${month}-01T00:00Z`);
  days.setUTCMonth(days.getUTCMonth() + 1, 0);
  const total = entries.length;
  const hasConfirmed = [...counts.values()].some(count => count.confirmed > 0);
  return <div className="card monthly-card" id="archive">
    <div className="monthly-heading">
      <label>表示月 <select value={month} onChange={event => onDate(event.target.value + '-01')}>
        {months.map(value => <option key={value} value={value}>{value.replace('-', '年')}月</option>)}
      </select></label>
      <p className="small muted">公式番組表、公式動画、参考番組表を区別しています。日付を選ぶと番組表の詳細を開けます。</p>
    </div>
    {filters}
    {videosUnavailable && <p className="small muted">過去の動画情報を読み込めませんでした。</p>}
    {referenceError && <p className="small muted">この月の参考番組表を読み込めませんでした。</p>}
    <div className="results-heading" role="status"><strong>{label}の表示 {total}件</strong><span className="small muted">公式番組表（全月） {officialCount}件の記録</span></div>
    {loading || (referenceLoading && !total) ? <p className="small muted">番組情報を読み込んでいます…</p> : !total ? <p className="monthly-empty muted">この月に表示できる番組情報はありません。表示月や絞り込み条件を変更してください。</p> : (route.caster || route.program) ?
      <ul className="monthly-results-grid" aria-label={`${label}の該当番組一覧`} role="list">
        {[...entries].sort((a, b) => a.date.localeCompare(b.date) || (a.slot || '99').localeCompare(b.slot || '99')).map(entry =>
          <li key={entry.record?.id || entry.video?.video_id || entry.date + 'T' + entry.slot} className="monthly-result-card">
            <header>
              <button onClick={() => onDate(entry.date, true)} aria-label={`${entry.date} ${entry.program}の日別詳細`}>
                <time dateTime={entry.date}>{entry.date.slice(5).replace('-', '/')}</time>
              </button>
              <strong title={entry.program}>{entry.slot && <time>{entry.slot} </time>}{entry.program}</strong>
            </header>
            <ProgramCell entry={entry} />
          </li>)}
      </ul> :
      <div className="monthly-scroll" role="region" aria-label={`${label}の番組表（横にスクロールできます）`} tabIndex={0}>
        <table className="monthly-table">
          <caption className="sr-only">{label}の番組表（日本時間）</caption>
          <thead><tr><th scope="col">日付</th>{slots.map(([time, title]) => <th scope="col" key={time}><time>{time}</time>{title}</th>)}<th scope="col">特別番組・その他</th></tr></thead>
          <tbody>{Array.from({ length: days.getUTCDate() }, (_, index) => {
            const date = `${month}-${String(index + 1).padStart(2, '0')}`;
            const day = byDay.get(date) || [];
            const regular = slots.map(([time, program]) => day.filter(entry => entry.slot === time && entry.program === program));
            const extra = day.filter(entry => !isRegularProgram(entry.slot, entry.program))
              .sort((a, b) => (a.slot || '99').localeCompare(b.slot || '99'));
            return <tr key={date} className={date === today ? 'monthly-today' : undefined}>
              <th scope="row"><button onClick={() => onDate(date, true)} aria-label={`${date}の日別詳細`}
                aria-pressed={date === route.date}>{dateFormat.format(new Date(`${date}T12:00+09:00`))}</button></th>
              {[...regular, extra].map((cell, column) => <td key={column}>{cell.length ? cell.map(entry =>
                <ProgramCell key={entry.record?.id || entry.video?.video_id || 'reference-' + entry.slot} entry={entry} />) : <span className="muted" aria-label="記録なし">—</span>}</td>)}
            </tr>;
          })}</tbody>
        </table>
      </div>}
    {counts.size > 0 && <details className="monthly-summary">
      <summary>{label}のキャスター別集計</summary>
      <table><thead><tr><th scope="col">キャスター</th><th scope="col">予定</th>{hasConfirmed && <th scope="col">確認済み</th>}<th scope="col">動画掲載のみ</th><th scope="col">参考番組表</th></tr></thead>
        <tbody>{[...counts].sort(([a], [b]) => a.localeCompare(b, 'ja')).map(([name, count]) =>
          <tr key={name}><th scope="row">{name}</th><td>{count.planned}</td>{hasConfirmed && <td>{count.confirmed}</td>}<td>{count.video}</td><td>{count.reference}</td></tr>)}</tbody>
      </table>
    </details>}
  </div>;
}
