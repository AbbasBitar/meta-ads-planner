import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { calculateBudget, generateChatGPTPrompt, validateCampaign } from '../src/intake.js';

const validCampaign = {
  pageName: 'Cedar & Stone',
  pageUrl: '@cedarstone',
  businessDescription: 'A neighborhood bakery.',
  products: 'Sourdough and pastries',
  locations: 'Beirut, Lebanon',
  minAge: 22,
  maxAge: 55,
  gender: 'All',
  postUrl: '',
  budget: 300,
  duration: 14,
  orderingChannel: 'WhatsApp'
};

test('required campaign information is validated', () => {
  const result = validateCampaign({ ...validCampaign, pageName: ' ', products: '', locations: '' });
  assert.deepEqual(result.map(problem => problem.field), ['pageName', 'products', 'locations']);
  assert.deepEqual(validateCampaign(validCampaign), []);
});

test('budget calculations divide total spend by campaign duration', () => {
  assert.deepEqual(calculateBudget(validCampaign), { total: 300, duration: 14, daily: 300 / 14 });
  assert.deepEqual(calculateBudget({ budget: '40', duration: '4' }), { total: 40, duration: 4, daily: 10 });
});

test('age validation enforces the 18–65 range and ordered bounds', () => {
  for (const [minAge, maxAge, field] of [[17, 40, 'minAge'], [18, 66, 'maxAge'], [40, 39, 'maxAge'], [18.5, 40, 'minAge']]) {
    assert.ok(validateCampaign({ ...validCampaign, minAge, maxAge }).some(problem => problem.field === field), `${minAge}–${maxAge}`);
  }
});

test('budget and duration must be positive, and an order channel must be selected', () => {
  const result = validateCampaign({ ...validCampaign, budget: 0, duration: 0, orderingChannel: '' });
  assert.deepEqual(result.map(problem => problem.field), ['budget', 'duration', 'orderingChannel']);
});

test('an omitted post URL is valid and clearly represented in the prompt', () => {
  assert.deepEqual(validateCampaign({ ...validCampaign, postUrl: '' }), []);
  assert.match(generateChatGPTPrompt({ ...validCampaign, postUrl: '' }), /Existing Instagram\/Facebook post URL: "Not provided"/);
});

test('the selected ordering channel is included in the prompt', () => {
  const prompt = generateChatGPTPrompt({ ...validCampaign, orderingChannel: 'Instagram Direct' });
  assert.match(prompt, /How customers place orders: "Instagram Direct"/);
  assert.match(prompt, /based on how customers actually place orders/);
});

test('prompt contains campaign information and all requested recommendations', () => {
  const prompt = generateChatGPTPrompt(validCampaign);
  for (const value of [
    'Cedar & Stone', '@cedarstone', 'A neighborhood bakery.', 'Sourdough and pastries',
    'Beirut, Lebanon', '22', '55', 'All', '$300.00', '$21.43 per day', '14 days', 'WhatsApp',
    'likely customer segments', 'target audience', 'targeting interests', 'campaign objective',
    'Geographic targeting', 'call to action', 'Campaign', 'pre-publish checklist', 'assumptions'
  ]) assert.ok(prompt.toLowerCase().includes(value.toLowerCase()), `Prompt is missing ${value}`);
  assert.match(prompt, /Research online when useful/);
  assert.match(prompt, /Do not invent Meta targeting interests/);
  assert.match(prompt, /suggestion that must be confirmed in Meta Ads Manager/);
  assert.match(prompt, /Do not guarantee sales/);
  assert.match(prompt, /Do not claim to have inspected the post/);
});

test('Arabic text and special characters are preserved as quoted prompt values', () => {
  const prompt = generateChatGPTPrompt({
    ...validCampaign,
    pageName: 'مخبز بيروت — "البيت"',
    products: 'مناقيش، خبز طازج & قهوة',
    locations: 'بيروت\nصيدا'
  });
  assert.ok(prompt.includes('"مخبز بيروت — \\"البيت\\""'));
  assert.ok(prompt.includes('"مناقيش، خبز طازج & قهوة"'));
  assert.ok(prompt.includes('"بيروت\\nصيدا"'));
});

test('v2 has no submission, Telegram, API key, or campaign-data URL behavior', () => {
  const app = readFileSync('app.js', 'utf8');
  const html = readFileSync('index.html', 'utf8');
  assert.doesNotMatch(app, /fetch\s*\(|XMLHttpRequest|\/api\/submit|telegram|openrouter|api[_-]?key/i);
  assert.doesNotMatch(html, /\/api\/submit|telegram|openrouter|turnstile/i);
  assert.match(html, /href="https:\/\/chatgpt\.com\/"/);
  assert.doesNotMatch(html, /href="https:\/\/chatgpt\.com\/[^"]*[?&]/);
  assert.doesNotMatch(app, /window\.open|location\.href|location\.assign/);
});

test('the small-screen layout collapses fields and choices responsively', () => {
  const css = readFileSync('styles.css', 'utf8');
  assert.match(css, /@media\s*\(max-width:\s*650px\)/);
  assert.match(css, /\.field-grid\{grid-template-columns:1fr;gap:0\}/);
  assert.match(css, /\.choice-grid\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)\}/);
});
