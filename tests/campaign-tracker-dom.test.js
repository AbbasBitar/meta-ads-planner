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
    this.value = '';
    this.textContent = '';
    this.className = '';
    this.hidden = false;
  }
  addEventListener(type, callback) { this.listeners[type] = callback; }
  append(...items) { this.children.push(...items); }
  replaceChildren(...items) { this.children = items; }
  get childElementCount() { return this.children.length; }
  scrollIntoView() {}
  focus() {}
  select() {}
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
    this.reset = () => { for (const value of Object.values(values)) value.value = ''; };
  }
}

test('browser initialization renders a saved boost card, progress bar, and countdown without runtime errors', () => {
  const now = Date.now();
  const state = tracker.createTrackerState();
  tracker.upsertBoost(state, {
    clientName: 'DOM Test Client', pageName: 'DOM Test Page', pageUrl: '@dom-test',
    campaignName: 'Integration Campaign', goal: 'Messages', postUrl: '',
    budget: 125, durationDays: 2, startAt: new Date(now - 12 * 60 * 60 * 1000).toISOString()
  });
  const stored = new Map([[tracker.STORAGE_KEY, JSON.stringify(state)]]);
  const storage = { getItem: key => stored.get(key) ?? null, setItem: (key, value) => stored.set(key, value) };
  const elements = new Map();
  const editor = new FormMock();
  const form = new ElementMock('form');
  form.querySelector = () => new ElementMock('input');
  const selectorIds = [
    '#campaign-form', '#form-errors', '#prompt-panel', '#generated-prompt', '#copy-status', '#total-budget', '#daily-budget', '#copy-prompt',
    '#tracker', '#tracker-editor', '#tracker-groups', '#tracker-message', '#tracker-page', '#tracker-pages', '#tracker-download-corrupt',
    '#tracker-search', '#tracker-status', '#tracker-ending', '#track-campaign', '#tracker-cancel-edit', '#tracker-export', '#tracker-import'
  ];
  for (const selector of selectorIds) elements.set(selector, new ElementMock());
  elements.set('#campaign-form', form);
  elements.set('#tracker-editor', editor);
  const document = { querySelector: selector => elements.get(selector) ?? null, createElement: tag => new ElementMock(tag) };
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
  const sandbox = { document, window, FormData: FormDataMock, Intl, Date, navigator: { clipboard: { writeText: async () => {} } },
    calculateBudget, generateChatGPTPrompt, validateCampaign, ...importedTrackerBindings };
  assert.doesNotThrow(() => vm.runInNewContext(source, sandbox));

  const groups = elements.get('#tracker-groups');
  const cards = groups.querySelectorAll('.boost-card');
  const bars = groups.querySelectorAll('.progress-track');
  assert.equal(cards.length, 1);
  assert.equal(bars.length, 1);
  const headings = groups.querySelectorAll('.campaign-heading');
  const titleBlocks = groups.querySelectorAll('.campaign-heading-copy');
  const goalTags = groups.querySelectorAll('.campaign-goal');
  const boostButtons = groups.querySelectorAll('.campaign-add-button');
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
