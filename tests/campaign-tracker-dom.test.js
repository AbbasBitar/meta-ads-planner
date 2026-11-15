import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { calculateBudget, generateChatGPTPrompt, validateCampaign } from '../src/intake.js';
import * as tracker from '../src/tracker.js';

class ElementMock {
  constructor(tagName = 'div') {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.listeners = {};
    this.style = {};
    this.dataset = {};
    this.value = '';
    this.textContent = '';
    this.className = '';
    this.hidden = false;
    this.focused = false;
  }
  addEventListener(type, callback) { this.listeners[type] = callback; }
  append(...items) { this.children.push(...items); }
  replaceChildren(...items) { this.children = items; }
  get childElementCount() { return this.children.length; }
  scrollIntoView() {}
  focus(options = {}) { this.focused = true; this.focusOptions = options; }
  select() {}
  querySelector(selector) {
    const match = /^\[data-focus="(.+)"\]$/.exec(selector);
    if (!match) return null;
    let found = null;
    const visit = node => {
      if (found) return;
      if (node.dataset?.focus === match[1]) { found = node; return; }
      for (const child of node.children ?? []) visit(child);
    };
    for (const child of this.children) visit(child);
    return found;
  }
  querySelectorAll(selector) {
    const className = selector.startsWith('.') ? selector.slice(1) : null;
    const matches = [];
    const visit = node => {
      if (className && String(node.className).split(/\s+/).includes(className)) matches.push(node);
      for (const child of node.children ?? []) visit(child);
    };
    visit(this);
    return matches;
  }
}

class FormMock extends ElementMock {
  constructor() {
    super('form');
    const controls = ['boostId', 'campaignId', 'clientName', 'pageName', 'pageUrl', 'postUrl', 'campaignName', 'goal', 'budget', 'durationDays', 'startLocal', 'endLocal', 'status'];
    const values = Object.fromEntries(controls.map(name => [name, new ElementMock('input')]));
    this.elements = { namedItem: name => values[name] };
    this.reset = () => { for (const value of Object.values(values)) value.value = ''; };
  }
}

const base = {
  clientName: 'Client A', pageName: 'Cedar Bakery', pageUrl: '@cedar', campaignName: 'Spring launch',
  goal: 'Messages', postUrl: '', budget: 100, durationDays: 4, startAt: '2026-02-01T12:00:00.000Z'
};

function countBoosts(state) {
  return state.pages.reduce((total, page) => total + page.campaigns.reduce((count, campaign) => count + campaign.boosts.length, 0), 0);
}

function setupTracker(state = tracker.createTrackerState()) {
  const stored = new Map([[tracker.STORAGE_KEY, JSON.stringify(state)]]);
  const storage = {
    getItem: key => stored.get(key) ?? null,
    setItem: (key, value) => { stored.set(key, value); }
  };
  const elements = new Map();
  const editor = new FormMock();
  const form = new ElementMock('form');
  form.querySelector = () => new ElementMock('input');
  const selectorIds = [
    '#campaign-form', '#form-errors', '#prompt-panel', '#generated-prompt', '#copy-status', '#total-budget', '#daily-budget', '#copy-prompt',
    '#tracker', '#tracker-heading', '#tracker-editor', '#tracker-editor-title', '#tracker-groups', '#tracker-message', '#tracker-page',
    '#tracker-clients', '#tracker-download-corrupt', '#new-campaign', '#tracker-import-review',
    '#tracker-import-summary', '#tracker-import-merge', '#tracker-import-replace', '#tracker-import-cancel', '#tracker-undo-import',
    '#tracker-search', '#tracker-status', '#tracker-ending', '#track-campaign', '#tracker-cancel-edit', '#tracker-export', '#tracker-import'
  ];
  for (const selector of selectorIds) elements.set(selector, new ElementMock());
  elements.set('#campaign-form', form);
  elements.set('#tracker-editor', editor);
  const document = {
    activeElement: null,
    querySelector: selector => elements.get(selector) ?? null,
    createElement: tag => new ElementMock(tag)
  };
  const currentData = { pageName: '', pageUrl: '', businessDescription: '', products: '', locations: '', minAge: '18', maxAge: '65', gender: 'All', postUrl: '', budget: '', duration: '', orderingChannel: '', adGoal: 'More messages' };
  class FormDataMock { constructor() {} entries() { return Object.entries(currentData); } }
  const window = {
    localStorage: storage,
    confirm: () => true,
    setInterval: () => 17,
    clearInterval: () => {},
    addEventListener: () => {}
  };
  const appSource = readFileSync('app.js', 'utf8');
  const namedImport = appSource.match(/^import \{([^}]+)\} from '\.\/src\/tracker\.js';/m);
  assert.ok(namedImport, 'tracker module import must be present');
  const importedNames = namedImport[1].split(',').map(name => name.trim());
  const importedTrackerBindings = Object.fromEntries(importedNames.map(name => [name, tracker[name]]));
  const source = appSource.replace(/^import[^\r\n]*(?:\r?\n|$)/gm, '');
  const sandbox = {
    document, window, FormData: FormDataMock, Intl, Date, structuredClone,
    navigator: { clipboard: { writeText: async () => {} } },
    calculateBudget, generateChatGPTPrompt, validateCampaign, ...importedTrackerBindings
  };
  vm.runInNewContext(source, sandbox);
  return { elements, editor, storage, stored, document, groups: elements.get('#tracker-groups') };
}

test('browser initialization renders a saved boost card, progress bar, and countdown without runtime errors', () => {
  const now = Date.now();
  const state = tracker.createTrackerState();
  tracker.upsertBoost(state, {
    clientName: 'DOM Test Client', pageName: 'DOM Test Page', pageUrl: '@dom-test',
    campaignName: 'Integration Campaign', goal: 'Messages', postUrl: '',
    budget: 125, durationDays: 2, startAt: new Date(now - 12 * 60 * 60 * 1000).toISOString()
  });
  const app = setupTracker(state);

  const cards = app.groups.querySelectorAll('.boost-card');
  const bars = app.groups.querySelectorAll('.progress-track');
  assert.equal(cards.length, 1);
  assert.equal(bars.length, 1);
  assert.ok(Number.parseFloat(bars[0].children[0].style.width) > 0);
  assert.match(cards[0].children.find(child => child.textContent.startsWith('Ends in')).textContent, /^Ends in/);
});

test('tracker opens a campaign editor independently of the brief and focuses it', () => {
  const app = setupTracker();
  const trigger = app.elements.get('#new-campaign');
  trigger.listeners.click({ currentTarget: trigger });
  assert.equal(app.elements.get('#tracker-editor').hidden, false);
  assert.equal(app.elements.get('#tracker-editor-title').focused, true);
  assert.equal(app.editor.elements.namedItem('clientName').value, '');
});

test('tracker re-render keeps focus on the equivalent card action', () => {
  const state = tracker.createTrackerState();
  tracker.upsertBoost(state, base);
  const app = setupTracker(state);
  const edit = app.groups.querySelectorAll('.button').find(button => button.dataset.focus?.startsWith('edit:'));
  assert.ok(edit);
  app.document.activeElement = edit;
  app.elements.get('#tracker-search').listeners.input({});
  const replacement = app.groups.querySelectorAll('.button').find(button => button.dataset.focus === edit.dataset.focus);
  assert.ok(replacement);
  assert.equal(replacement.focused, true);
});

test('backup import previews, merges, resets the file input, and supports undo', async () => {
  const current = tracker.createTrackerState();
  tracker.upsertBoost(current, { ...base, clientName: 'Current Client', pageName: 'Current Page', pageUrl: '@current', campaignName: 'Current Campaign' });
  const incoming = tracker.createTrackerState();
  tracker.upsertBoost(incoming, { ...base, clientName: 'Incoming Client', pageName: 'Incoming Page', pageUrl: '@incoming', campaignName: 'Incoming Campaign' });
  const app = setupTracker(current);

  const input = app.elements.get('#tracker-import');
  input.files = [{ size: 100, text: async () => JSON.stringify(incoming) }];
  input.value = 'C:\\backup.json';
  const event = { currentTarget: input };
  const pending = input.listeners.change(event);
  event.currentTarget = null;
  await pending;

  assert.equal(input.value, '');
  assert.equal(app.elements.get('#tracker-import-review').hidden, false);
  assert.match(app.elements.get('#tracker-import-summary').textContent, /1 boost/);
  assert.equal(countBoosts(JSON.parse(app.stored.get(tracker.STORAGE_KEY))), 1);

  app.elements.get('#tracker-import-merge').listeners.click({});
  assert.equal(countBoosts(JSON.parse(app.stored.get(tracker.STORAGE_KEY))), 2);
  assert.equal(app.elements.get('#tracker-import-review').hidden, true);
  assert.equal(app.elements.get('#tracker-undo-import').hidden, false);
  assert.match(app.elements.get('#tracker-message').textContent, /Backup merged/);

  app.elements.get('#tracker-undo-import').listeners.click({});
  assert.equal(countBoosts(JSON.parse(app.stored.get(tracker.STORAGE_KEY))), 1);
  assert.equal(app.elements.get('#tracker-undo-import').hidden, true);
});

test('backup restore leaves data untouched until replace is explicitly confirmed', async () => {
  const current = tracker.createTrackerState();
  tracker.upsertBoost(current, { ...base, clientName: 'Current Client', pageName: 'Current Page', pageUrl: '@current', campaignName: 'Current Campaign' });
  const incoming = tracker.createTrackerState();
  tracker.upsertBoost(incoming, { ...base, clientName: 'Incoming One', pageName: 'Incoming Page One', pageUrl: '@incoming-one', campaignName: 'Incoming Campaign' });
  tracker.upsertBoost(incoming, { ...base, clientName: 'Incoming Two', pageName: 'Incoming Page Two', pageUrl: '@incoming-two', campaignName: 'Incoming Campaign' });
  const app = setupTracker(current);
  const input = app.elements.get('#tracker-import');
  input.files = [{ size: 100, text: async () => JSON.stringify(incoming) }];

  await input.listeners.change({ currentTarget: input });
  assert.equal(countBoosts(JSON.parse(app.stored.get(tracker.STORAGE_KEY))), 1);
  app.elements.get('#tracker-import-cancel').listeners.click({});
  assert.equal(app.elements.get('#tracker-import-review').hidden, true);
  assert.equal(countBoosts(JSON.parse(app.stored.get(tracker.STORAGE_KEY))), 1);

  await input.listeners.change({ currentTarget: input });
  app.elements.get('#tracker-import-replace').listeners.click({});
  assert.equal(countBoosts(JSON.parse(app.stored.get(tracker.STORAGE_KEY))), 2);
  assert.match(app.elements.get('#tracker-message').textContent, /Backup replaced all tracker data/);
});
