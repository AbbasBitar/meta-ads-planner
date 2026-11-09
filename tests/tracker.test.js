import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { COUNTDOWN_REFRESH_MS, DAY_MS, ENDING_SOON_MS, MAX_BACKUP_BYTES, STORAGE_KEY, calculateEndDate, createTrackerState, exportTracker, filterBoosts, findBoost, formatSaveFailure, importTracker, loadTracker, localInputToIso, removeBoost, replaceTracker, saveTracker, scheduleStatus, transactTracker, upsertBoost, validateState } from '../src/tracker.js';

const base = { clientName: 'Client A', pageName: 'Cedar Bakery', pageUrl: 'https://instagram.com/cedar', campaignName: 'Spring launch', goal: 'Messages', postUrl: 'https://instagram.com/p/shared', budget: 100, durationDays: 4, startAt: '2026-02-01T12:00:00.000Z' };
function memoryStorage(options = {}) { let value = options.initial ?? null; return { getItem: key => key === STORAGE_KEY ? value : null, setItem: (key, next) => { if (options.failWrite) throw new Error('quota exceeded'); if (key === STORAGE_KEY) value = next; }, get value() { return value; } }; }

function addBoost(state, input, boostId = null) { return upsertBoost(state, input, boostId); }

test('end date is timestamp arithmetic for elapsed 24-hour periods', () => {
  assert.equal(calculateEndDate('2026-01-01T12:34:56.000Z', 3), '2026-01-04T12:34:56.000Z');
  assert.throws(() => calculateEndDate('2026-01-01T00:00:00.000Z', 0), /positive whole number/);
  assert.throws(() => calculateEndDate('not a timestamp', 1), /ISO 8601 timestamp/);
});

test('local inputs become ISO UTC instants and reject invalid timezone wall times', () => {
  const previous = process.env.TZ;
  process.env.TZ = 'Asia/Beirut';
  try {
    assert.equal(localInputToIso('2026-01-01T12:00'), new Date('2026-01-01T12:00').toISOString());
    assert.throws(() => localInputToIso(''), /valid start/);
  } finally { if (previous === undefined) delete process.env.TZ; else process.env.TZ = previous; }
});

test('daylight saving changes do not change a duration from 24 elapsed hours', () => {
  const previous = process.env.TZ;
  process.env.TZ = 'America/New_York';
  try {
    const start = localInputToIso('2026-03-07T12:00');
    const end = calculateEndDate(start, 1);
    assert.equal(Date.parse(end) - Date.parse(start), DAY_MS);
    assert.equal(end, '2026-03-08T17:00:00.000Z');
    assert.throws(() => localInputToIso('2026-03-08T02:30'), /does not exist/);
  } finally { if (previous === undefined) delete process.env.TZ; else process.env.TZ = previous; }
});

test('separate clients, pages, campaigns and overlapping boosts retain stable relationships', () => {
  const state = createTrackerState();
  const one = addBoost(state, base);
  const located = findBoost(state, one.id);
  const overlapping = addBoost(state, { ...base, campaignId: located.campaign.id, budget: 75, startAt: '2026-02-02T12:00:00.000Z' });
  const secondCampaignBoost = addBoost(state, { ...base, campaignName: 'Summer sale', campaignId: undefined, postUrl: 'https://instagram.com/p/other' });
  const otherClientBoost = addBoost(state, { ...base, clientName: 'Client B', pageName: 'Olive Studio', pageUrl: '@olive', campaignName: 'Launch', postUrl: '' });
  assert.equal(state.clients.length, 2);
  assert.equal(state.pages.length, 2);
  assert.equal(state.pages[0].campaigns.length, 2);
  assert.equal(state.pages[0].campaigns[0].boosts.length, 2);
  assert.equal(findBoost(state, overlapping.id).campaign.id, located.campaign.id);
  assert.notEqual(findBoost(state, secondCampaignBoost.id).campaign.id, located.campaign.id);
  assert.equal(findBoost(state, otherClientBoost.id).client.name, 'Client B');
  assert.equal(addBoost(state, { ...base, campaignId: located.campaign.id, durationDays: 8 }, one.id).endAt, '2026-02-09T12:00:00.000Z');
  assert.equal(findBoost(state, one.id).boost.durationDays, 8);
  assert.equal(removeBoost(state, overlapping.id), true);
  assert.equal(findBoost(state, secondCampaignBoost.id).campaign.boosts.length, 1);
  assert.equal(findBoost(state, otherClientBoost.id).boost.id, otherClientBoost.id);
  assert.equal(removeBoost(state, secondCampaignBoost.id), true);
  assert.equal(state.pages[0].campaigns.length, 1);
});

test('page uniqueness and page ownership are enforced without partial mutation', () => {
  const state = createTrackerState();
  addBoost(state, base);
  const before = structuredClone(state);
  assert.throws(() => addBoost(state, { ...base, clientName: 'Other Client' }), /already assigned/);
  assert.throws(() => addBoost(state, { ...base, campaignId: 'missing-campaign' }), /no longer exists/);
  assert.deepEqual(state, before);
  assert.throws(() => validateState({ ...before, pages: [...before.pages, { ...before.pages[0], id: 'another-page', pageUrl: 'https://www.instagram.com/cedar/' }] }), /duplicate page/);
});

test('calculated schedule statuses remain separate from manual paused and cancelled states', () => {
  const state = createTrackerState();
  const boost = addBoost(state, base);
  assert.equal(scheduleStatus(boost, Date.parse('2026-02-01T11:59:59.000Z')), 'Scheduled');
  assert.equal(scheduleStatus(boost, Date.parse('2026-02-02T12:00:00.000Z')), 'Active');
  assert.equal(scheduleStatus(boost, Date.parse('2026-02-05T12:00:00.000Z')), 'Completed');
  boost.status = 'Paused'; assert.equal(scheduleStatus(boost, Date.parse('2026-02-02T12:00:00.000Z')), 'Paused');
  boost.status = 'Cancelled'; assert.equal(scheduleStatus(boost, Date.parse('2026-02-02T12:00:00.000Z')), 'Cancelled');
});

test('ending-soon filters use an exact 24-hour threshold', () => {
  const state = createTrackerState();
  addBoost(state, { ...base, durationDays: 1 });
  assert.equal(ENDING_SOON_MS, DAY_MS);
  assert.equal(filterBoosts(state, { ending: 'soon', now: Date.parse('2026-02-01T12:00:00.000Z') }).length, 1);
  assert.equal(filterBoosts(state, { ending: 'soon', now: Date.parse('2026-02-02T12:00:00.000Z') }).length, 0);
  assert.equal(filterBoosts(state, { ending: 'soon', now: Date.parse('2026-02-02T12:00:00.001Z') }).length, 0);
});

test('filters search client, page and campaign and apply status', () => {
  const state = createTrackerState();
  const active = addBoost(state, base);
  addBoost(state, { ...base, clientName: 'Client B', pageName: 'Olive', pageUrl: '@olive', campaignName: 'Different' });
  const matches = filterBoosts(state, { query: 'spring cedar', status: 'Active', now: Date.parse('2026-02-02T12:00:00.000Z') });
  assert.equal(matches.length, 1);
  assert.equal(matches[0].campaigns[0].boosts[0].id, active.id);
});

test('v1 backups migrate into clients, pages, campaigns, and boosts with stable IDs', () => {
  const legacy = { version: 1, pages: [{ id: 'page-old', clientName: 'Legacy Client', pageName: 'Legacy Page', pageUrl: '@legacy', boosts: [{ id: 'boost-old', postUrl: '', goal: 'Reach', budget: 50, durationDays: 2, startAt: '2026-01-01T00:00:00.000Z', endAt: '2026-01-03T00:00:00.000Z', status: 'Scheduled', archived: false }] }] };
  const imported = importTracker(JSON.stringify(legacy));
  assert.equal(imported.version, 2);
  assert.equal(imported.clients[0].name, 'Legacy Client');
  assert.equal(imported.pages[0].campaigns[0].boosts[0].id, 'boost-old');
  assert.deepEqual(imported, importTracker(JSON.stringify(legacy)));
});

test('storage corruption is reported and left untouched', () => {
  const storage = memoryStorage({ initial: '{broken json' });
  assert.throws(() => loadTracker(storage), /corrupted and was left untouched/);
  assert.equal(storage.value, '{broken json');
});

test('imports and exports validate structure, global IDs, types, URL safety and size', () => {
  const state = createTrackerState();
  addBoost(state, base);
  const other = addBoost(state, { ...base, clientName: 'Other', pageName: 'Other', pageUrl: '@other', campaignName: 'Other' });
  const invalid = structuredClone(state);
  invalid.pages[1].campaigns[0].boosts[0].id = invalid.pages[0].campaigns[0].boosts[0].id;
  assert.throws(() => validateState(invalid), /duplicate IDs/);
  const badBudget = structuredClone(state); badBudget.pages[0].campaigns[0].boosts[0].budget = '100';
  assert.throws(() => validateState(badBudget), /invalid budget/);
  const badLink = structuredClone(state); badLink.pages[0].campaigns[0].boosts[0].postUrl = 'javascript:alert(1)';
  assert.throws(() => validateState(badLink), /unsafe post URL/);
  const badShape = structuredClone(state); badShape.pages[0].campaigns[0].boosts[0].unexpected = 'field';
  assert.throws(() => validateState(badShape), /unexpected boost field/);
  assert.throws(() => importTracker('x'.repeat(MAX_BACKUP_BYTES + 1)), /too large/);
  assert.ok(findBoost(state, other.id));
});

test('create, update, delete, and replacement transactions do not alter memory after storage failures', () => {
  const state = createTrackerState();
  const original = structuredClone(state);
  const failedStorage = memoryStorage({ failWrite: true });
  assert.throws(() => transactTracker(failedStorage, state, next => addBoost(next, base)), /quota exceeded/);
  assert.deepEqual(state, original);

  const storage = memoryStorage();
  let saved = transactTracker(storage, state, next => addBoost(next, base));
  const boostId = saved.pages[0].campaigns[0].boosts[0].id;
  const beforeUpdate = structuredClone(saved);
  assert.throws(() => transactTracker(failedStorage, saved, next => addBoost(next, { ...base, budget: 200 }, boostId)), /quota exceeded/);
  assert.deepEqual(saved, beforeUpdate);
  assert.throws(() => transactTracker(failedStorage, saved, next => removeBoost(next, boostId)), /quota exceeded/);
  assert.deepEqual(saved, beforeUpdate);
  assert.throws(() => replaceTracker(failedStorage, createTrackerState()), /quota exceeded/);
  assert.deepEqual(saved, beforeUpdate);
  assert.throws(() => saveTracker(failedStorage, createTrackerState()), /quota exceeded/);
});

test('storage failures have actionable user-facing guidance and countdowns refresh automatically', () => {
  assert.match(formatSaveFailure(new Error('quota exceeded')), /No changes were applied.*Check browser storage space.*retry/);
  assert.equal(COUNTDOWN_REFRESH_MS, 30000);
  const app = readFileSync('app.js', 'utf8');
  assert.match(app, /window\.setInterval\(render, COUNTDOWN_REFRESH_MS\)/);
  assert.match(app, /window\.clearInterval\(refreshTimer\)/);
});

test('valid backup export and restore preserve separate campaign entities', () => {
  const storage = memoryStorage();
  const state = createTrackerState(); addBoost(state, base);
  saveTracker(storage, state);
  assert.deepEqual(importTracker(exportTracker(state)), state);
  assert.deepEqual(loadTracker(storage), state);
  assert.throws(() => importTracker('{"version":8,"pages":[]}'), /unsupported format/);
});
