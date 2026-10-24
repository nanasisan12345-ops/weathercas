import { z } from 'zod';
import source from '../config/caster-profiles.json';
import { fresh, type LiveData } from './data';

const schema = z.object({ name: z.string().min(1).max(80), reading: z.string().max(80), source_url: z.url(),
  facts: z.array(z.object({ label: z.string().max(30), value: z.string().max(300) })).max(8) });
export type CasterProfile = z.infer<typeof schema> & { id: string };
export function liveCasterProfiles(live: LiveData | null, now: number): CasterProfile[] {
  if (!live?.video || !['listed', 'live'].includes(live.state) || !fresh(live.checked_at, now)) return [];
  const normalize = (value: string) => value.normalize('NFKC').replace(/\s/g, '');
  const title = normalize(live.video.title);
  return Object.entries(source.profiles).flatMap(([id, raw]) => {
    const value = schema.safeParse(raw);
    if (!value.success || value.data.source_url !== `https://weathernews.jp/wnl/caster/${id}.html`) return [];
    return title.includes(normalize(value.data.name)) ? [{ id, ...value.data }] : [];
  }).sort((a, b) => title.indexOf(normalize(a.name)) - title.indexOf(normalize(b.name)));
}
export const profileCheckedOn = source.checked_on;
