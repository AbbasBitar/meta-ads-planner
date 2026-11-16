import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { calculateBudget, generateChatGPTPrompt, validateCampaign } from '../src/intake.js';

class MockElement {
  constructor(tagName = 'div') {
    this.tagName = tagName.toUpperCase();
    this.listeners = {};
    this.children = [];
    this.attributes = {};
    this.hidden = false;
    this.textContent = '';
    this.value = '';
    this.className = '';
    this.id = '';
    this.disabled = false;
    this.focused = false;
  }
  addEventListener(type, callback) { this.listeners[type] = callback; }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  getAttribute(name) { return Object.hasOwn(this.attributes, name) ? this.attributes[name] : null; }
  removeAttribute(name) { delete this.attributes[name]; }
  replaceChildren(...children) { this.children = children; }
  append(...children) { this.children.push(...children); }
  focus() { this.focused = true; }
  select() { this.selected = true; }
  scrollIntoView() { this.scrolledIntoView = true; }
}

class MockForm extends MockElement {
  constructor(controlsByName) {
    super('form');
    this.controlsByName = controlsByName;
  }
  querySelectorAll(selector) {
    const match = /^\[name="(.+)"\]$/.exec(selector);
    return match ? this.controlsByName.get(match[1]) ?? [] : [];
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
}

const FIELD_NAMES = ['creationMethod', 'adGoal', 'pageName', 'pageUrl', 'businessDescription', 'products', 'locations', 'minAge', 'maxAge', 'gender', 'postUrl', 'budget', 'duration', 'orderingChannel'];

function makeControl(name) {
  const control = new MockElement('input');
  control.name = name;
  control.parentElement = new MockElement('label');
  control.closest = selector => selector === 'fieldset' ? control.fieldset ?? null : control.parentElement;
  return control;
}

function makeApp(initialData) {
  let currentData = { ...initialData };
  const elements = new Map();
  const controlsByName = new Map(FIELD_NAMES.map(name => [name, [makeControl(name)]]));
  const radioFieldset = new MockElement('fieldset');
  controlsByName.get('orderingChannel')[0].fieldset = radioFieldset;
  const form = new MockForm(controlsByName);
  const selectors = [
    '#campaign-form', '#form-errors', '#prompt-panel', '#prompt-heading', '#generated-prompt',
    '#prompt-badge', '#prompt-stale', '#prompt-stale-message', '#copy-status', '#copy-prompt',
    '#copy-open-chatgpt', '#regenerate-prompt', '#total-budget', '#daily-budget'
  ];
  for (const selector of selectors) elements.set(selector, new MockElement());
  elements.set('#campaign-form', form);
  elements.get('#form-errors').hidden = true;
  elements.get('#prompt-panel').hidden = true;
  elements.get('#prompt-stale').hidden = true;
  const document = {
    querySelector: selector => elements.get(selector),
    createElement: tag => new MockElement(tag)
  };
  class MockFormData {
    entries() { return Object.entries(currentData); }
  }
  const clipboard = { copied: '', async writeText(text) { this.copied = text; } };
  const window = {
    opened: null,
    addEventListener: () => {},
    open(url) { window.opened = url; return { opener: null }; }
  };
  const source = readFileSync('app.js', 'utf8').replace(/^import[^\r\n]*(?:\r?\n|$)/gm, '');
  vm.runInNewContext(source, {
    document,
    window,
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
    controlsByName,
    radioFieldset,
    clipboard,
    window,
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
  assert.equal(app.elements.get('#form-errors').children[0].children[0].children[0].textContent, 'Page name is required.');
  assert.doesNotMatch(app.elements.get('#form-errors').children[0].children[0].children[0].textContent, /\[object Object\]/);
  assert.equal(app.elements.get('#prompt-panel').hidden, true);
  assert.equal(app.controlsByName.get('pageName')[0].focused, true);
});

test('inline field errors are linked, marked invalid, and clear when the field is edited', () => {
  const app = makeApp({ ...sample, pageName: '', budget: '' });
  app.fire('#campaign-form', 'submit', { preventDefault() {} });

  const pageControl = app.controlsByName.get('pageName')[0];
  const pageError = pageControl.parentElement.children.find(node => node.id === 'field-error-pageName');
  assert.ok(pageError);
  assert.equal(pageError.hidden, false);
  assert.equal(pageError.textContent, 'Page name is required.');
  assert.equal(pageControl.getAttribute('aria-invalid'), 'true');
  assert.match(pageControl.getAttribute('aria-describedby'), /field-error-pageName/);

  const summaryLink = app.elements.get('#form-errors').children[0].children[0].children[0];
  assert.equal(summaryLink.href, '#field-pageName');
  summaryLink.listeners.click({ preventDefault() {} });
  assert.equal(pageControl.focused, true);

  app.fire('#campaign-form', 'input', { target: pageControl });
  assert.equal(pageControl.getAttribute('aria-invalid'), null);
  assert.equal(pageError.hidden, true);
  const visibleSummary = app.elements.get('#form-errors').children[0].children.filter(item => !item.hidden);
  assert.equal(visibleSummary.length, 1);
  assert.doesNotMatch(visibleSummary[0].textContent, /Page name/);

  const budgetControl = app.controlsByName.get('budget')[0];
  app.fire('#campaign-form', 'input', { target: budgetControl });
  assert.equal(app.elements.get('#form-errors').hidden, true);
});

test('radio-group errors render below the whole group', () => {
  const app = makeApp({ ...sample, orderingChannel: '' });
  app.fire('#campaign-form', 'submit', { preventDefault() {} });
  const radios = app.controlsByName.get('orderingChannel');
  const inline = app.radioFieldset.children.find(node => node.id === 'field-error-orderingChannel');
  assert.ok(inline, 'radio-group error must be rendered in the fieldset');
  assert.equal(inline.hidden, false);
  assert.equal(inline.textContent, 'Choose how customers place orders.');
  assert.equal(radios[0].getAttribute('aria-invalid'), 'true');
  assert.match(radios[0].getAttribute('aria-describedby'), /field-error-orderingChannel/);
});

test('prompt freshness and inline error controls use accessible markup', () => {
  const html = readFileSync('index.html', 'utf8');
  assert.match(html, /id="form-errors"[^>]*role="alert"/);
  assert.doesNotMatch(html, /id="form-errors"[^>]*aria-live/);
  assert.match(html, /<h2 id="prompt-heading" tabindex="-1">/);
  assert.match(html, /id="prompt-stale"[^>]*hidden/);
  assert.match(html, /id="regenerate-prompt"/);
  assert.match(html, /id="copy-open-chatgpt"/);
  assert.match(html, /Copy &amp; open ChatGPT/);
});

test('frontend calculates daily budget and generates a prompt with every submitted value', () => {
  const app = makeApp(sample);
  app.fire('#campaign-form', 'input');
  assert.equal(app.elements.get('#total-budget').textContent, '$300.00');
  assert.equal(app.elements.get('#daily-budget').textContent, '$21.43 per day');
  app.fire('#campaign-form', 'submit', { preventDefault() {} });
  assert.equal(app.elements.get('#prompt-panel').hidden, false);
  assert.equal(app.elements.get('#prompt-panel').scrolledIntoView, true);
  assert.equal(app.elements.get('#prompt-heading').focused, true);
  const prompt = app.elements.get('#generated-prompt').value;
  for (const value of Object.values(sample)) assert.ok(prompt.includes(String(value)), `Prompt is missing ${value}`);
});

test('prompt panel marks the prompt out of date and blocks copying after the brief changes', () => {
  const app = makeApp(sample);
  app.fire('#campaign-form', 'submit', { preventDefault() {} });
  assert.equal(app.elements.get('#prompt-stale').hidden, true);

  app.setData({ ...sample, budget: '600' });
  app.fire('#campaign-form', 'input');
  assert.equal(app.elements.get('#prompt-stale').hidden, false);
  assert.equal(app.elements.get('#prompt-badge').textContent, 'Out of date');
  assert.equal(app.elements.get('#copy-prompt').disabled, true);
  assert.equal(app.elements.get('#copy-open-chatgpt').disabled, true);

  app.setData(sample);
  app.fire('#campaign-form', 'input');
  assert.equal(app.elements.get('#prompt-stale').hidden, true);
  assert.equal(app.elements.get('#prompt-badge').textContent, 'Generated');
  assert.equal(app.elements.get('#copy-prompt').disabled, false);
});

test('regenerate rebuilds the prompt from the current form values', () => {
  const app = makeApp(sample);
  app.fire('#campaign-form', 'submit', { preventDefault() {} });
  app.setData({ ...sample, budget: '600', duration: '20' });
  app.fire('#campaign-form', 'input');
  assert.equal(app.elements.get('#copy-prompt').disabled, true);

  app.elements.get('#regenerate-prompt').listeners.click({});
  assert.match(app.elements.get('#generated-prompt').value, /\$600\.00/);
  assert.equal(app.elements.get('#prompt-stale').hidden, true);
  assert.equal(app.elements.get('#copy-prompt').disabled, false);
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

test('copy and open copies the prompt and opens ChatGPT in a new tab', async () => {
  const app = makeApp(sample);
  app.fire('#campaign-form', 'submit', { preventDefault() {} });
  const button = new MockElement();
  await app.fire('#copy-open-chatgpt', 'click', { currentTarget: button });
  assert.equal(app.clipboard.copied, app.elements.get('#generated-prompt').value);
  assert.equal(app.window.opened, 'https://chatgpt.com/');
  assert.match(app.elements.get('#copy-status').textContent, /ChatGPT opened/);
});

test('copy and open explains when the browser blocks the new tab', async () => {
  const app = makeApp(sample);
  app.window.open = () => null;
  app.fire('#campaign-form', 'submit', { preventDefault() {} });
  await app.fire('#copy-open-chatgpt', 'click', { currentTarget: new MockElement() });
  assert.match(app.elements.get('#copy-status').textContent, /blocked the new tab/);
});

test('frontend captures the copy button before awaiting clipboard access', async () => {
  const app = makeApp(sample);
  app.fire('#campaign-form', 'submit', { preventDefault() {} });
  const button = new MockElement();
  const event = { currentTarget: button };
  const pending = app.fire('#copy-prompt', 'click', event);
  event.currentTarget = null;
  await pending;
  assert.equal(button.focused, true);
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
  const trackerEditor = html.split('<form id="tracker-editor"')[1].split('</form>')[0];
  for (const field of ['pageName', 'createdLocal', 'startLocal', 'endLocal', 'budget', 'durationDays', 'purpose', 'desiredAction']) {
    assert.match(trackerEditor, new RegExp(`name="${field}"`), `Missing tracker field ${field}`);
  }
  for (const hiddenFromUser of ['clientName', 'pageUrl', 'postUrl', 'campaignName', 'goal', 'status']) {
    assert.doesNotMatch(trackerEditor, new RegExp(`name="${hiddenFromUser}"`), `Unexpected tracker editor field ${hiddenFromUser}`);
  }
  for (const action of ['Visit your profile', 'Visit your website', 'Message you', 'Mix of actions']) {
    assert.match(trackerEditor, new RegExp(`value="${action}"`));
  }
  assert.match(html, /id="track-campaign" type="button"/);
  const promptSubmit = readFileSync('app.js', 'utf8').split("form.addEventListener('submit'")[1].split("copyPromptButton.addEventListener('click'")[0];
  assert.doesNotMatch(promptSubmit, /upsertBoost|saveTracker/);
  const trackAction = readFileSync('app.js', 'utf8').split("document.querySelector('#track-campaign')")[1].split("editor.elements.namedItem('startLocal')")[0];
  assert.doesNotMatch(trackAction, /clientName:\s*data\.pageName/);
});

test('tracker backup footer groups copy and actions without duplicate controls', () => {
  const html = readFileSync('index.html', 'utf8');
  const css = readFileSync('styles.css', 'utf8');
  const footer = html.match(/<div class="tracker-backup"[^>]*>([\s\S]*?)<\/div>\s*<\/section>/)?.[1];
  assert.ok(footer, 'tracker backup footer must exist');
  assert.match(footer, /class="tracker-backup-copy"/);
  assert.match(footer, /class="tracker-backup-actions"/);
  assert.match(footer, /class="tracker-backup-title"/);
  assert.match(footer, /class="tracker-backup-note"/);
  for (const id of ['tracker-export', 'tracker-import', 'tracker-download-corrupt']) {
    assert.equal((html.match(new RegExp(`id="${id}"`, 'g')) ?? []).length, 1, `${id} must appear exactly once`);
  }
  assert.ok(css.includes('#tracker .tracker-backup-actions'));
  assert.ok(css.includes('#tracker .tracker-backup-copy'));
  assert.ok(css.includes('@media (max-width: 480px)'));
});
