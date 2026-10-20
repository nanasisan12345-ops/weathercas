import { useState } from 'react';
import photos from '../config/caster-photos.json';

export function getCasterPhoto(id: string | null) {
  if (!photos.enabled || !id) return null;
  const entry = (photos.photos as Record<string, { url: string; profile_url: string }>)[id];
  if (!entry) return null;
  try {
    const url = new URL(entry.url), profile = new URL(entry.profile_url);
    return url.protocol === 'https:' && url.hostname === 'gvs.weathernews.jp' &&
      /^\/wnl\/caster\/images\/caster\/[a-z]+\.(webp|png)(?:$)/.test(url.pathname) &&
      profile.protocol === 'https:' && profile.hostname === 'weathernews.jp' &&
      profile.pathname === `/wnl/caster/${id}.html` ? entry : null;
  } catch { return null; }
}
export default function CasterPhoto({ id, name }: { id: string | null; name: string | null }) {
  const [failedURL, setFailedURL] = useState<string | null>(null);
  const photo = getCasterPhoto(id);
  if (!photo || failedURL === photo.url) return <span className="caster-photo photo-placeholder" aria-label={name ? `${name}の写真を表示できません` : '出演者未確認'}><svg viewBox="0 0 40 40" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><circle cx="20" cy="13" r="7" /><path d="M7 35v-4a13 13 0 0 1 26 0v4" /></svg></span>;
  return <a className="caster-photo" href={photo.profile_url} target="_blank" rel="noopener noreferrer" aria-label={`${name || id}の公式プロフィール（写真出典・新しいタブ）`}>
    <img src={photo.url} alt={`${name || id}の公式プロフィール写真`} width="64" height="64" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailedURL(photo.url)} />
  </a>;
}
