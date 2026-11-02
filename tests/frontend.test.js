import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

test('getData excludes Turnstile response from customer data', () => {
  const source = readFileSync('app.js', 'utf8');

  const start = source.indexOf('function getData()');
  const end = source.indexOf('function money(', start);

  assert.ok(start >= 0 && end > start, 'getData function must exist');

  const code = source.slice(start, end);

  class MockFormData {
    constructor() {
      this.fields = new Map([
        ['client', 'Test Client'],
        ['description', 'Test business'],
        ['cf-turnstile-response', 'dummy-token'],
        ['channels', ['Instagram Direct']]
      ]);
    }

    delete(key) { this.fields.delete(key); }
    keys() { return this.fields.keys(); }
    get(key) { return this.fields.get(key); }
    getAll(key) { return this.fields.get(key) || []; }
  }

  const context = vm.createContext({
    FormData: MockFormData,
    form: {}
  });

  const result = vm.runInContext(code + '\ngetData()', context);

  assert.equal(result.client, 'Test Client');
  assert.equal(result.description, 'Test business');
  assert.equal(
    Object.hasOwn(result, 'cf-turnstile-response'),
    false
  );
  assert.equal(result.channels[0], 'Instagram Direct');
});
