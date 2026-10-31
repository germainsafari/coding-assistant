// Light/dark theme. "system" follows prefers-color-scheme (dark unless the OS asks for light).
// The same logic runs as an inline script in index.html to avoid a flash on load.
export type ThemePref = 'system' | 'light' | 'dark';
export type Theme = 'light' | 'dark';

const KEY = 'hearth.theme';
const lightQuery = typeof window !== 'undefined' ? window.matchMedia('(prefers-color-scheme: light)') : null;

export function loadThemePref(): ThemePref {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
}

export const resolveTheme = (p: ThemePref): Theme => (p === 'system' ? (lightQuery?.matches ? 'light' : 'dark') : p);

export function applyTheme(p: ThemePref): Theme {
  const t = resolveTheme(p);
  document.documentElement.classList.toggle('dark', t === 'dark');
  try {
    if (p === 'system') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, p);
  } catch {}
  return t;
}

/** Calls `fn` when the OS theme changes. Returns an unsubscribe function. */
export function onSystemThemeChange(fn: () => void) {
  lightQuery?.addEventListener('change', fn);
  return () => lightQuery?.removeEventListener('change', fn);
}
