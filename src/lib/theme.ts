import { useCallback, useState } from 'react';

type Theme = 'light' | 'dark';

export function initTheme() {
  const stored = localStorage.getItem('lumen-theme') as Theme | null;
  const prefersDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches;
  document.documentElement.dataset.theme = stored ?? (prefersDark ? 'dark' : 'light');
}

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(
    () => (document.documentElement.dataset.theme as Theme | undefined) ?? 'light',
  );
  const toggle = useCallback(() => {
    setTheme((current) => {
      const next: Theme = current === 'dark' ? 'light' : 'dark';
      document.documentElement.dataset.theme = next;
      localStorage.setItem('lumen-theme', next);
      return next;
    });
  }, []);
  return { theme, toggle };
}
