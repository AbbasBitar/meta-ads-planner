import test from 'node:test';
import assert from 'node:assert/strict';
import { DAY_MS, STORAGE_KEY, calculateEndDate, createTrackerState, exportTracker, filterBoosts, findBoost, importTracker, loadTracker, localInputToIso, removeBoost, saveTracker, scheduleStatus, upsertBoost, validateState } from '../src/tracker.js';

const base = { clientName: 'Client A', pageName: 'Cedar Bakery', pageUrl: 'https://instagram.com/cedar', postUrl: 'https://instagram.com/p/shared', goal: 'Messages', budget: 100, durationDays: 4, startAt: '2026-02-01T12:00:00.000Z' };
function memoryStorage(initial = null) { let value = initial; return { getItem: key => key === STORAGE_KEY ? value : null, setItem: (key, next) => { if (key === STORAGE_KEY) value = next; }, get value() { return value; } }; }

test('end date is timestamp arithmetic for elapsed 24-hour periods', () => {
  assert.equal(calculateEndDate('2026-01-01T12:34:56.000Z', 3), '2026-01-04T12:34:56.000Z');
  assert.throws(() => calculateEndDate('2026-01-01T00:00:00Z', 0), /positive whole number/);
  assert.throws(() => calculateEndDate('not a timestamp', 1), /Invalid timestamp/);
});

test('local inputs become ISO UTC instants and invalid timestamps are rejected', () => {
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
    assert.match(end, /2026-03-08T17:00:00\.000Z/);
    assert.throws(() => localInputToIso('2026-03-08T02:30'), /does not exist/);
  } finally { if (previous === undefined) delete process.env.TZ; else process.env.TZ = previous; }
});

test('boost CRUD is isolated across pages and allows overlapping boosts for the same post', () => {
  const state = createTrackerState();
  const one = upsertBoost(state, base);
  const overlapping = upsertBoost(state, { ...base, budget: 75, startAt: '2026-02-02T12:00:00Z' });
  const otherPage = upsertBoost(state, { ...base, clientName: 'Client B', pageName: 'Olive Studio', pageUrl: '@olive' });
  assert.equal(state.pages.length, 2);
  assert.equal(state.pages[0].boosts.length, 2);
  assert.equal(state.pages[0].boosts[0].postUrl, state.pages[0].boosts[1].postUrl);
  assert.equal(upsertBoost(state, { ...base, durationDays: 8 }, one.id).endAt, '2026-02-09T12:00:00.000Z');
  assert.equal(findBoost(state, one.id).boost.durationDays, 8);
  assert.equal(removeBoost(state, overlapping.id), true);
  assert.ok(findBoost(state, otherPage.id));
  assert.equal(state.pages[0].boosts.length, 1);
  assert.equal(removeBoost(state, one.id), true);
  assert.ok(findBoost(state, otherPage.id));
});

test('duplicate page records are prevented and schedule status preserves manual states', () => {
  const state = createTrackerState();
  const boost = upsertBoost(state, base);
  upsertBoost(state, { ...base, pageName: 'Updated Name', budget: 125 });
  upsertBoost(state, { ...base, clientName: 'Different client', pageUrl: 'https://www.instagram.com/cedar/' });
  assert.equal(state.pages.length, 1);
  assert.equal(state.pages[0].boosts.length, 3);
  assert.equal(scheduleStatus(boost, Date.parse('2026-02-01T11:59:59Z')), 'Scheduled');
  assert.equal(scheduleStatus(boost, Date.parse('2026-02-02T12:00:00Z')), 'Active');
  assert.equal(scheduleStatus(boost, Date.parse('2026-02-05T12:00:00Z')), 'Completed');
  boost.status = 'Paused';
  assert.equal(scheduleStatus(boost, Date.parse('2026-02-02T12:00:00Z')), 'Paused');
  boost.status = 'Cancelled';
  assert.equal(scheduleStatus(boost, Date.parse('2026-02-02T12:00:00Z')), 'Cancelled');
});

test('filters group matching page boosts and ending soon uses stored schedule timestamps', () => {
  const state = createTrackerState();
  upsertBoost(state, base);
  upsertBoost(state, { ...base, clientName: 'Client B', pageName: 'Olive', pageUrl: '@olive', startAt: '2026-02-05T12:00:00Z' });
  const matching = filterBoosts(state, { query: 'cedar', status: 'Active', now: Date.parse('2026-02-02T12:00:00Z') });
  assert.equal(matching.length, 1);
  assert.equal(matching[0].boosts.length, 1);
  const ending = filterBoosts(state, { ending: 'soon', now: Date.parse('2026-02-02T12:00:00Z') });
  assert.equal(ending.length, 1);
});

test('storage corruption resets safely and backup import/export validates records', () => {
  const storage = memoryStorage('{broken json');
  assert.deepEqual(loadTracker(storage), createTrackerState());
  const state = createTrackerState(); upsertBoost(state, base);
  saveTracker(storage, state);
  const restored = importTracker(exportTracker(state));
  assert.deepEqual(restored, state);
  assert.throws(() => importTracker('{"version":8,"pages":[]}'), /unsupported format/);
  const invalid = structuredClone(state);
  invalid.pages[0].boosts[0].endAt = 'invalid';
  assert.throws(() => validateState(invalid), /Invalid timestamp/);
});
