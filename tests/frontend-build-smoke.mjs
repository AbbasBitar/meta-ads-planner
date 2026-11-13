import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';

test('build contains only the usable v2 frontend assets', () => {
  for (const path of ['dist/index.html', 'dist/app.js', 'dist/styles.css', 'dist/src/intake.js']) {
    assert.ok(existsSync(path), `Missing ${path}`);
  }
  assert.deepEqual(readdirSync('dist').sort(), ['app.js', 'index.html', 'src', 'styles.css']);
  assert.deepEqual(readdirSync('dist/src').sort(), ['intake.js', 'tracker.js']);
  const html = readFileSync('dist/index.html', 'utf8');
  assert.match(html, /campaign-form/);
  assert.match(html, /data-ui-revision="tracker-layout-v4"/);
  assert.ok(html.includes('href="styles.css?v=tracker-layout-v4"'), 'stylesheet revision must be included');
  assert.ok(html.includes('src="app.js?v=tracker-layout-v4"'), 'app module revision must be included');
  assert.match(html, /https:\/\/chatgpt\.com\//);
  const app = readFileSync('dist/app.js', 'utf8');
  assert.match(app, /generateChatGPTPrompt/);
  assert.match(app, /initTracker/);
  assert.doesNotMatch(app, /fetch\s*\(|\/api\/submit|telegram|openrouter/i);
});
