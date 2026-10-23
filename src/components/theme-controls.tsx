'use client';

import { useEffect, useRef } from 'react';

type Theme = 'light' | 'dark';
type Accent = 'indigo' | 'emerald' | 'rose' | 'amber';
const STORAGE_KEY = 'leadgen-official-theme-v1';

export function ThemeControls() {
  const accentRef = useRef<HTMLSelectElement>(null);

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') as { theme?: Theme; accent?: Accent };
      const nextTheme = saved.theme === 'dark' || saved.theme === 'light'
        ? saved.theme
        : window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
      const nextAccent = ['indigo', 'emerald', 'rose', 'amber'].includes(saved.accent || '') ? saved.accent as Accent : 'indigo';
      if (accentRef.current) accentRef.current.value = nextAccent;
      document.documentElement.dataset.theme = nextTheme;
      document.documentElement.dataset.accent = nextAccent;
    } catch {
      document.documentElement.dataset.theme = 'light';
      document.documentElement.dataset.accent = 'indigo';
    }
  }, []);

  function save(nextTheme: Theme, nextAccent: Accent) {
    document.documentElement.dataset.theme = nextTheme;
    document.documentElement.dataset.accent = nextAccent;
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ theme: nextTheme, accent: nextAccent })); } catch { /* Appearance still applies when storage is unavailable. */ }
  }

  function toggleTheme() {
    const currentTheme = document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
    const currentAccent = (document.documentElement.dataset.accent || 'indigo') as Accent;
    save(currentTheme === 'dark' ? 'light' : 'dark', currentAccent);
  }

  return <aside aria-label="Appearance settings" className="fixed bottom-3 right-3 z-40 flex items-center gap-2 rounded-xl border border-slate-300 bg-white/95 p-2 shadow-lg backdrop-blur sm:bottom-5 sm:right-5">
    <button type="button" aria-label="Toggle light and dark mode" onClick={toggleTheme} className="min-h-10 rounded-lg border border-slate-300 px-3 text-sm font-semibold">Toggle mode</button>
    <label className="sr-only" htmlFor="accent-theme">Accent theme</label><select ref={accentRef} id="accent-theme" aria-label="Accent theme" defaultValue="indigo" onChange={(event) => save(document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light', event.target.value as Accent)} className="min-h-10 max-w-28 rounded-lg border border-slate-300 bg-white px-2 text-sm"><option value="indigo">Indigo</option><option value="emerald">Emerald</option><option value="rose">Rose</option><option value="amber">Amber</option></select>
  </aside>;
}
