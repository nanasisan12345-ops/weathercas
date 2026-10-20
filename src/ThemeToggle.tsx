import { useState } from 'react';

export default function ThemeToggle() {
  const [dark, setDark] = useState(() => document.documentElement.dataset.theme === 'dark');
  function toggle() {
    const next = !dark;
    document.documentElement.dataset.theme = next ? 'dark' : 'light';
    try { localStorage.setItem('weathercas.theme', next ? 'dark' : 'light'); } catch { /* Storage may be disabled; switching still works. */ }
    setDark(next);
  }
  return <button className="theme-toggle" type="button" onClick={toggle} aria-pressed={dark} aria-label="ダークモード" title={dark ? 'ライトモードに切り替え' : 'ダークモードに切り替え'}>
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
      {dark ? <><circle cx="12" cy="12" r="4" /><path d="M12 1v3m0 16v3M1 12h3m16 0h3M4 4l2 2m12 12 2 2M4 20l2-2M18 6l2-2" /></> : <path d="M20.5 14A9 9 0 0 1 10 3.5 9 9 0 1 0 20.5 14Z" />}
    </svg><span>{dark ? 'ライト' : 'ダーク'}</span>
  </button>;
}
