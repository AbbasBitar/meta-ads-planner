import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync('theme.js', 'utf8');
const STORAGE_KEY = 'meta-ads-planner.theme.v1';

function harness({ saved = null, systemDark = false, storageBlocked = false, readyState = 'loading' } = {}) {
  const storage = new Map();
  if (saved !== null) storage.set(STORAGE_KEY, saved);
  const listeners = new Map();
  const windowListeners = new Map();
  const systemListeners = new Map();
  const attrs = {};
  const label = { textContent: 'Dark mode' };
  const icon = { textContent: '☾' };
  const toggle = {
    attributes: attrs,
    addEventListener(type, callback) { listeners.set(type, callback); },
    setAttribute(name, value) { attrs[name] = String(value); },
    querySelector(selector) {
      return selector === '.theme-toggle-label' ? label : selector === '.theme-toggle-icon' ? icon : null;
    }
  };
  const themeMeta = { content: '#f6f7f4' };
  const document = {
    documentElement: { dataset: {} },
    readyState,
    querySelector(selector) { return selector === 'meta[name="theme-color"]' ? themeMeta : null; },
    getElementById(id) { return id === 'theme-toggle' ? toggle : null; },
    addEventListener(type, callback) { listeners.set(type, callback); }
  };
  const media = {
    matches: systemDark,
    addEventListener(type, callback) { systemListeners.set(type, callback); }
  };
  const window = {
    matchMedia(query) {
      assert.equal(query, '(prefers-color-scheme: dark)');
      return media;
    },
    localStorage: {
      getItem(key) {
        if (storageBlocked) throw new Error('storage denied');
        return storage.get(key) ?? null;
      },
      setItem(key, value) {
        if (storageBlocked) throw new Error('storage denied');
        storage.set(key, value);
      }
    },
    addEventListener(type, callback) { windowListeners.set(type, callback); }
  };

  assert.doesNotThrow(() => vm.runInNewContext(source, { document, window }));
  return {
    document, window, toggle, themeMeta, label, icon, media, storage,
    ready() { listeners.get('DOMContentLoaded')?.(); },
    click() { listeners.get('click')?.(); },
    systemChange(matches) { media.matches = matches; systemListeners.get('change')?.(); },
    storageChange(value) { windowListeners.get('storage')?.({ key: STORAGE_KEY, newValue: value }); }
  };
}

test('uses the system dark preference without a saved override and initializes before body', () => {
  const ui = harness({ systemDark: true });
  assert.equal(ui.document.documentElement.dataset.theme, 'dark');
  assert.equal(ui.themeMeta.content, '#101813');
  ui.ready();
  assert.equal(ui.toggle.attributes['aria-pressed'], 'true');
  assert.equal(ui.toggle.attributes['aria-label'], 'Switch to light mode');
  assert.equal(ui.label.textContent, 'Light mode');
  assert.equal(ui.icon.textContent, '☀');
  assert.equal(ui.storage.size, 0, 'system preference must not persist as a manual override');
});

test('click toggles and persists explicit choices, surviving a later app initialization', () => {
  const ui = harness();
  ui.ready();
  assert.equal(ui.document.documentElement.dataset.theme, 'light');
  ui.click();
  assert.equal(ui.storage.get(STORAGE_KEY), 'dark');
  assert.equal(ui.document.documentElement.dataset.theme, 'dark');
  assert.equal(ui.toggle.attributes['aria-pressed'], 'true');
  ui.click();
  assert.equal(ui.storage.get(STORAGE_KEY), 'light');
  assert.equal(ui.toggle.attributes['aria-label'], 'Switch to dark mode');
  const reloaded = harness({ saved: ui.storage.get(STORAGE_KEY), systemDark: true, readyState: 'complete' });
  assert.equal(reloaded.document.documentElement.dataset.theme, 'light');
  assert.equal(reloaded.toggle.attributes['aria-pressed'], 'false');
});

test('OS preference changes live only while no explicit choice is stored', () => {
  const ui = harness();
  ui.ready();
  ui.systemChange(true);
  assert.equal(ui.document.documentElement.dataset.theme, 'dark');
  ui.click();
  assert.equal(ui.document.documentElement.dataset.theme, 'light');
  ui.systemChange(false);
  ui.systemChange(true);
  assert.equal(ui.document.documentElement.dataset.theme, 'light');
});

test('theme follows same-origin storage changes from another browser tab', () => {
  const ui = harness({ saved: 'light' });
  ui.ready();
  ui.storageChange('dark');
  assert.equal(ui.document.documentElement.dataset.theme, 'dark');
  ui.storageChange(null);
  ui.systemChange(false);
  assert.equal(ui.document.documentElement.dataset.theme, 'light');
});

test('restricted storage gracefully falls back to an in-session toggle', () => {
  const ui = harness({ storageBlocked: true, systemDark: true });
  ui.ready();
  assert.equal(ui.document.documentElement.dataset.theme, 'dark');
  assert.doesNotThrow(() => ui.click());
  assert.equal(ui.document.documentElement.dataset.theme, 'light');
  assert.equal(ui.toggle.attributes['aria-pressed'], 'false');
});

test('HTML includes early theme initializer and accessible button; stylesheet covers reports and forms', () => {
  const html = readFileSync('index.html', 'utf8');
  const css = readFileSync('styles.css', 'utf8');
  assert.ok(html.indexOf('src="theme.js?v=dark-mode-v1"') < html.indexOf('rel="stylesheet"'));
  assert.match(html, /id="theme-toggle"[^>]*type="button"[^>]*aria-label="Switch to dark mode"/);
  assert.match(css, /:root\[data-theme="dark"\]/);
  for (const selector of ['.site-header', '.budget-summary', '.tracker-toolbar', '.tracker-campaign', '.client-report', '.report-sheet', '.form-errors']) {
    assert.ok(css.includes(selector), `Dark styling must cover ${selector}`);
  }
  assert.match(css, /@media print/);
});
