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
    this.isConnected = true;
  }
  addEventListener(type, callback) { this.listeners[type] = callback; }
  setAttribute(name, value) { this[name] = value; }
  append(...items) { this.children.push(...items); }
  replaceChildren(...items) { this.children = items; }
  get childElementCount() { return this.children.length; }
  scrollIntoView() { this.scrolledIntoView = true; }
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
    const controls = ['boostId', 'pageName', 'createdLocal', 'startLocal', 'endLocal', 'budget', 'durationDays', 'purpose', 'desiredAction'];
    const values = Object.fromEntries(controls.map(name => [name, new ElementMock('input')]));
    this.elements = { namedItem: name => values[name] };
    this.reset = () => { for (const [name, value] of Object.entries(values)) if (name !== 'boostId') value.value = ''; };
  }
}

const quickInput = {
  pageName: 'Cedar Lens Photography',
  createdAt: '2026-11-13T08:00:00.000Z',
  startAt: '2026-11-14T09:00:00.000Z',
  budget: 40,
  durationDays: 5,
  purpose: 'Promote newborn photography',
  desiredAction: 'Message you'
};

const base = {
  clientName: 'Client A', pageName: 'Cedar Bakery', pageUrl: 'https://instagram.com/cedar',
  campaignName: 'Spring launch', goal: 'Messages', postUrl: 'https://instagram.com/p/shared',
  budget: 100, durationDays: 4, startAt: '2026-02-01T12:00:00.000Z'
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
    '#tracker', '#tracker-heading', '#tracker-editor', '#tracker-editor-title', '#tracker-groups', '#tracker-message', '#tracker-page', '#tracker-pages',
    '#tracker-clients', '#tracker-download-corrupt', '#tracker-add', '#tracker-import-review', '#tracker-import-summary', '#tracker-import-merge',
    '#tracker-import-replace', '#tracker-import-cancel', '#tracker-undo-import', '#tracker-search', '#tracker-status', '#tracker-ending',
    '#track-campaign', '#tracker-cancel-edit', '#tracker-export', '#tracker-import'
  ];
  for (const selector of selectorIds) elements.set(selector, new ElementMock());
  elements.set('#campaign-form', form);
  elements.set('#tracker-editor', editor);
  elements.get('#tracker-editor').hidden = true;
  elements.get('#tracker-import-review').hidden = true;
  elements.get('#tracker-undo-import').hidden = true;
  elements.get('#tracker-download-corrupt').hidden = true;
  const document = {
    activeElement: null,
    querySelector: selector => elements.get(selector) ?? null,
    createElement: tag => new ElementMock(tag)
  };
  const currentData = { pageName: '', pageUrl: '', businessDescription: '', products: '', locations: '', minAge: '18', maxAge: '65', gender: 'All', postUrl: '', budget: '', duration: '', orderingChannel: '', adGoal: 'More messages' };
  class FormDataMock {
    constructor(target) { this.target = target; }
    entries() {
      if (this.target === editor) {
        return Object.entries(Object.fromEntries(
          ['boostId', 'pageName', 'createdLocal', 'startLocal', 'endLocal', 'budget', 'durationDays', 'purpose', 'desiredAction']
            .map(name => [name, editor.elements.namedItem(name).value])
        ));
      }
      return Object.entries(currentData);
    }
  }
  const window = {
    localStorage: storage,
    confirm: () => true,
    setInterval: () => 17,
    clearInterval: () => {},
    addEventListener: () => {}
  };
  const appSource = readFileSync('app.js', 'utf8');
  const namedImport = appSource.match(/^import \{([^}]+)\} from '\.\/src\/tracker\.js(?:\?v=[^']+)?';/m);
  assert.ok(namedImport, 'tracker module import must be present');
  const importedNames = namedImport[1].split(',').map(name => name.trim());
  const importedTrackerBindings = Object.fromEntries(importedNames.map(name => [name, tracker[name]]));
  const source = appSource.replace(/^import[^\r\n]*(?:\r?\n|$)/gm, '');
  const sandbox = {
    document, window, FormData: FormDataMock, Intl, Date, structuredClone,
    navigator: { clipboard: { writeText: async () => {} } },
    calculateBudget, generateChatGPTPrompt, validateCampaign, ...importedTrackerBindings
  };
  assert.doesNotThrow(() => vm.runInNewContext(source, sandbox));

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
  const headings = app.groups.querySelectorAll('.campaign-heading');
  const titleBlocks = app.groups.querySelectorAll('.campaign-heading-copy');
  const goalTags = app.groups.querySelectorAll('.campaign-goal');
  const boostButtons = app.groups.querySelectorAll('.campaign-add-button');
  assert.equal(headings.length, 1);
  assert.equal(titleBlocks.length, 1);
  assert.equal(goalTags.length, 1);
  assert.equal(boostButtons.length, 1);
  assert.equal(headings[0].children[0], titleBlocks[0], 'campaign details must be grouped separately from its action');
  assert.equal(headings[0].children[1], boostButtons[0], 'Add boost must be a separate layout child');
  assert.equal(titleBlocks[0].children[0].textContent, 'Integration Campaign');
  assert.equal(goalTags[0].textContent, 'Messages');
  assert.ok(Number.parseFloat(bars[0].children[0].style.width) > 0);
  assert.match(cards[0].children.find(child => child.textContent.startsWith('Ends in')).textContent, /^Ends in/);
});

test('tracker opens the campaign editor independently of the brief and focuses it', () => {
  const app = setupTracker();
  const trigger = app.elements.get('#tracker-add');
  trigger.listeners.click({ currentTarget: trigger });
  assert.equal(app.elements.get('#tracker-editor').hidden, false);
  assert.equal(app.elements.get('#tracker-editor-title').focused, true);
  assert.equal(app.editor.elements.namedItem('pageName').value, '');
  assert.equal(app.editor.elements.namedItem('createdLocal').value.length > 0, true);
});

test('opening a new campaign while an edit is open does not overwrite the edited boost', () => {
  const state = tracker.createTrackerState();
  const boost = tracker.upsertTrackedBoost(state, quickInput);
  const app = setupTracker(state);
  const edit = app.groups.querySelectorAll('.button').find(button => button.dataset.focus === `edit:${boost.id}`);
  assert.ok(edit);
  edit.listeners.click({ currentTarget: edit });
  assert.equal(app.editor.elements.namedItem('boostId').value, boost.id);
  const add = app.elements.get('#tracker-add');
  add.listeners.click({ currentTarget: add });
  assert.equal(app.editor.elements.namedItem('boostId').value, '');
  assert.equal(app.editor.elements.namedItem('pageName').value, '');
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

test('closing the tracker editor returns focus to the control that opened it', () => {
  const state = tracker.createTrackerState();
  tracker.upsertBoost(state, base);
  const app = setupTracker(state);
  const edit = app.groups.querySelectorAll('.button').find(button => button.dataset.focus?.startsWith('edit:'));
  edit.listeners.click({ currentTarget: edit });
  assert.equal(app.elements.get('#tracker-editor-title').focused, true);
  app.elements.get('#tracker-cancel-edit').listeners.click({});
  assert.equal(app.elements.get('#tracker-editor').hidden, true);
  const replacement = app.groups.querySelectorAll('.button').find(button => button.dataset.focus === edit.dataset.focus);
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
  assert.match(app.elements.get('#tracker-import-summary').textContent, /This backup contains/);
  assert.match(app.elements.get('#tracker-import-summary').textContent, /1 client, 1 page, 1 campaign, and 1 boost/);
  assert.equal(app.elements.get('#tracker-import-summary').focused, true);
  assert.equal(countBoosts(JSON.parse(app.stored.get(tracker.STORAGE_KEY))), 1);

  app.elements.get('#tracker-import-merge').listeners.click({});
  assert.equal(countBoosts(JSON.parse(app.stored.get(tracker.STORAGE_KEY))), 2);
  assert.equal(app.elements.get('#tracker-import-review').hidden, true);
  assert.equal(app.elements.get('#tracker-undo-import').hidden, false);
  assert.match(app.elements.get('#tracker-message').textContent, /Backup merged: 1 new boost added/);

  app.elements.get('#tracker-undo-import').listeners.click({});
  assert.equal(countBoosts(JSON.parse(app.stored.get(tracker.STORAGE_KEY))), 1);
  assert.equal(app.elements.get('#tracker-undo-import').hidden, true);
  assert.match(app.elements.get('#tracker-message').textContent, /Import undone/);
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
  assert.equal(app.elements.get('#tracker-undo-import').hidden, false);
});

test('an invalid backup reports the error, closes any stale review, and resets the input', async () => {
  const app = setupTracker();
  const input = app.elements.get('#tracker-import');
  input.files = [{ size: 100, text: async () => 'not json' }];
  input.value = 'C:\\bad.json';
  await input.listeners.change({ currentTarget: input });
  assert.equal(input.value, '');
  assert.equal(app.elements.get('#tracker-import-review').hidden, true);
  assert.match(app.elements.get('#tracker-message').textContent, /Could not restore backup/);
});
