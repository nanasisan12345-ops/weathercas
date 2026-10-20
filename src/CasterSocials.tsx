import socials from '../config/caster-socials.json';

type Network = 'x' | 'instagram' | 'tiktok';
const labels: Record<Network, string> = { x: 'X', instagram: 'Instagram', tiktok: 'TikTok' };
const hosts: Record<Network, string> = { x: 'x.com', instagram: 'www.instagram.com', tiktok: 'www.tiktok.com' };

export default function CasterSocials({ id, name }: { id: string; name: string | null }) {
  const entry = (socials.casters as Record<string, { source_url: string; links: Partial<Record<Network, string>> }>)[id];
  if (!entry || entry.source_url !== `https://weathernews.jp/wnl/caster/${id}.html`) return null;
  const links = (Object.keys(labels) as Network[]).flatMap(network => {
    const href = entry.links[network];
    try {
      const url = new URL(href || '');
      return url.protocol === 'https:' && url.hostname === hosts[network] && !url.username && !url.password && !url.port ? [{ network, href }] : [];
    } catch { return []; }
  });
  if (!links.length) return null;
  return <span className="caster-socials" aria-label={`${name || id}のSNS`}>{links.map(({ network, href }) =>
    <a key={network} href={href} target="_blank" rel="noopener noreferrer" aria-label={`${name || id}の${labels[network]}（新しいタブ）`} title={`${name || id}の${labels[network]}`}>
      <svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">
        {network === 'x' ? <path d="M18.9 2H22l-6.8 7.8L23.2 22h-6.3L12 14.6 5.5 22H2.3l8.2-9.4L.8 2h6.5l5.9 7.8L18.9 2Zm-1.1 18h1.7L6.4 3.9H4.6L17.8 20Z" /> : network === 'instagram' ? <><rect x="3" y="3" width="18" height="18" rx="5" fill="none" stroke="currentColor" strokeWidth="2" /><circle cx="12" cy="12" r="4" fill="none" stroke="currentColor" strokeWidth="2" /><circle cx="17.5" cy="6.5" r="1.2" /></> : <path d="M14 2h3c.2 2.4 1.6 3.8 4 4v3a9 9 0 0 1-4-1v8a6 6 0 1 1-6-6v3a3 3 0 1 0 3 3V2Z" />}
      </svg>
    </a>)}</span>;
}
