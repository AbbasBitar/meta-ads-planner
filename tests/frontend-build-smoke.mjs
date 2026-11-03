import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

test('built frontend assets and module exports remain usable', async () => {
  for (const path of ['index.html','app.js','config.js','styles.css','src/intake.js','src/planner.js']) {
    assert.ok(existsSync('dist/'+path), 'Missing dist/'+path);
  }
  for (const path of ['src/recommendation.js','src/legacy-objective-adapter.js']) {
    assert.ok(!existsSync('dist/'+path), 'Private module exposed: '+path);
  }
  const html = readFileSync('dist/index.html','utf8');
  assert.match(html, /app\.js/);
  assert.match(html, /config\.js/);
  const app = readFileSync('dist/app.js','utf8');
  assert.match(app, /from ['"]\.\/src\/intake\.js['"]/);
  const intake = await import(pathToFileURL(resolve('dist/src/intake.js')).href);
  const planner = await import(pathToFileURL(resolve('dist/src/planner.js')).href);
  for (const name of ['required','validPostUrl','validate','calculateBudget']) {
    if (name === 'required') assert.ok(Array.isArray(intake[name]), 'required must be an array');
    else assert.equal(typeof intake[name], 'function', name);
    assert.strictEqual(planner[name], intake[name], name);
  }
});
