import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { calculateBudget, generateChatGPTPrompt, validateCampaign } from '../src/intake.js';

class MockElement {
  constructor() {
    this.listeners = {};
    this.children = [];
    this.hidden = false;
    this.textContent = '';
    this.value = '';
  }
  addEventListener(type, callback) { this.listeners[type] = callback; }
  replaceChildren(...children) { this.children = children; }
  append(...children) { this.children.push(...children); }
  focus() { this.focused = true; }
  select() { this.selected = true; }
  scrollIntoView() { this.scrolledIntoView = true; }
}

function makeApp(initialData) {
  let currentData = { ...initialData };
  const elements = new Map();
  const form = new MockElement();
  form.querySelector = selector => { form.focusedSelector = selector; return new MockElement(); };
  const selectors = ['#campaign-form', '#form-errors', '#prompt-panel', '#generated-prompt', '#copy-status', '#total-budget', '#daily-budget', '#copy-prompt'];
  for (const selector of selectors) elements.set(selector, new MockElement());
  elements.set('#campaign-form', form);
  elements.get('#form-errors').hidden = true;
  elements.get('#prompt-panel').hidden = true;
  const document = {
    querySelector: selector => elements.get(selector),
    createElement: () => new MockElement()
  };
  class MockFormData {
    entries() { return Object.entries(currentData); }
  }
  const clipboard = { copied: '', async writeText(text) { this.copied = text; } };
  const source = readFileSync('app.js', 'utf8').replace(/^import[^\r\n]*(?:\r?\n|$)/gm, '');
  vm.runInNewContext(source, {
    document,
    FormData: MockFormData,
    Intl,
    navigator: { clipboard },
    calculateBudget,
    generateChatGPTPrompt,
    validateCampaign
  });
  return {
    elements,
    form,
    clipboard,
    setData: data => { currentData = { ...data }; },
    async fire(element, event, payload = {}) { return elements.get(element).listeners[event](payload); }
  };
}

const sample = {
  pageName: 'Cedar & Stone',
  pageUrl: '@cedarstone',
  businessDescription: 'An independent bakery in Beirut',
  products: 'Sourdough, pastries, and coffee',
  locations: 'Beirut, Lebanon',
  minAge: '20',
  maxAge: '55',
  gender: 'All',
  postUrl: 'https://www.instagram.com/p/example/',
  budget: '300',
  duration: '14',
  orderingChannel: 'WhatsApp'
};

test('frontend prevents generation and reports a missing required field', () => {
  const app = makeApp({ ...sample, pageName: '' });
  let prevented = false;
  app.fire('#campaign-form', 'submit', { preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  assert.equal(app.elements.get('#form-errors').hidden, false);
  assert.equal(app.elements.get('#prompt-panel').hidden, true);
  assert.equal(app.form.focusedSelector, '[name="pageName"]');
});

test('frontend calculates daily budget and generates a prompt with every submitted value', () => {
  const app = makeApp(sample);
  app.fire('#campaign-form', 'input');
  assert.equal(app.elements.get('#total-budget').textContent, '$300.00');
  assert.equal(app.elements.get('#daily-budget').textContent, '$21.43 per day');
  app.fire('#campaign-form', 'submit', { preventDefault() {} });
  assert.equal(app.elements.get('#prompt-panel').hidden, false);
  assert.equal(app.elements.get('#prompt-panel').scrolledIntoView, true);
  const prompt = app.elements.get('#generated-prompt').value;
  for (const value of Object.values(sample)) assert.ok(prompt.includes(String(value)), `Prompt is missing ${value}`);
});

test('frontend copies the generated prompt and links to ChatGPT without campaign data in the URL', async () => {
  const app = makeApp(sample);
  app.fire('#campaign-form', 'submit', { preventDefault() {} });
  const prompt = app.elements.get('#generated-prompt').value;
  await app.fire('#copy-prompt', 'click', { currentTarget: new MockElement() });
  assert.equal(app.clipboard.copied, prompt);
  assert.match(app.elements.get('#copy-status').textContent, /Prompt copied/);
  const html = readFileSync('index.html', 'utf8');
  assert.match(html, /href="https:\/\/chatgpt\.com\/" target="_blank" rel="noopener noreferrer"/);
});

test('frontend safely falls back when clipboard permission is unavailable', async () => {
  const app = makeApp(sample);
  app.clipboard.writeText = async () => { throw new Error('clipboard unavailable'); };
  app.fire('#campaign-form', 'submit', { preventDefault() {} });
  await app.fire('#copy-prompt', 'click', { currentTarget: new MockElement() });
  assert.equal(app.elements.get('#generated-prompt').selected, true);
  assert.match(app.elements.get('#copy-status').textContent, /Ctrl\+C/);
});

test('prompt form keeps one required goal field and does not register on prompt generation', () => {
  const html = readFileSync('index.html', 'utf8');
  assert.equal((html.match(/name="adGoal"/g) ?? []).length, 1);
  assert.match(html, /name="adGoal" required/);
  assert.match(html, /name="clientName" list="tracker-clients" required/);
  assert.match(html, /id="track-campaign" type="button"/);
  const promptSubmit = readFileSync('app.js', 'utf8').split("form.addEventListener('submit'")[1].split("document.querySelector('#copy-prompt')")[0];
  assert.doesNotMatch(promptSubmit, /upsertBoost|saveTracker/);
  const trackAction = readFileSync('app.js', 'utf8').split("document.querySelector('#track-campaign')")[1].split("editor.elements.namedItem('startLocal')")[0];
  assert.doesNotMatch(trackAction, /clientName:\s*data\.pageName/);
});
