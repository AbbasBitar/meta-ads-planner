/* Theme initialization runs in <head> to avoid a flash of the wrong theme. */
(() => {
  const STORAGE_KEY = 'meta-ads-planner.theme.v1';
  const root = document.documentElement;
  const system = typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-color-scheme: dark)')
    : null;

  function readPreference() {
    try {
      const value = window.localStorage.getItem(STORAGE_KEY);
      return value === 'light' || value === 'dark' ? value : null;
    } catch {
      // Storage may be unavailable in private or restricted browser contexts.
      return null;
    }
  }

  let preference = readPreference();

  function applyTheme() {
    const theme = preference ?? (system?.matches ? 'dark' : 'light');
    const isDark = theme === 'dark';
    root.dataset.theme = theme;

    const themeMeta = document.querySelector('meta[name="theme-color"]');
    if (themeMeta) themeMeta.content = isDark ? '#101813' : '#f6f7f4';

    const toggle = document.getElementById('theme-toggle');
    if (!toggle) return;
    toggle.setAttribute('aria-pressed', String(isDark));
    toggle.setAttribute('aria-label', isDark ? 'Switch to light mode' : 'Switch to dark mode');

    const label = toggle.querySelector('.theme-toggle-label');
    if (label) label.textContent = isDark ? 'Light mode' : 'Dark mode';
    const icon = toggle.querySelector('.theme-toggle-icon');
    if (icon) icon.textContent = isDark ? '☀' : '☾';
  }

  function initToggle() {
    const toggle = document.getElementById('theme-toggle');
    if (!toggle) return;
    toggle.addEventListener('click', () => {
      preference = root.dataset.theme === 'dark' ? 'light' : 'dark';
      try { window.localStorage.setItem(STORAGE_KEY, preference); }
      catch { /* Continue switching themes for this page session. */ }
      applyTheme();
    });
    applyTheme();
  }

  applyTheme();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initToggle, { once: true });
  } else {
    initToggle();
  }

  const onSystemChange = () => { if (preference === null) applyTheme(); };
  if (system?.addEventListener) system.addEventListener('change', onSystemChange);
  else if (system?.addListener) system.addListener(onSystemChange);

  window.addEventListener('storage', event => {
    if (event.key !== STORAGE_KEY) return;
    preference = event.newValue === 'dark' || event.newValue === 'light' ? event.newValue : null;
    applyTheme();
  });
})();
