import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { BOOST_ACTIONS, COUNTDOWN_REFRESH_MS, DAY_MS, ENDING_SOON_MS, MAX_BACKUP_BYTES, STORAGE_KEY, boostPerformance, calculateEndDate, createTrackerState, dailyChecklist, exportTracker, filterBoosts, findBoost, formatSaveFailure, importTracker, loadTracker, localInputToIso, logBoostResults, mergeTrackerStates, removeBoost, renameTrackedEntity, replaceTracker, saveTracker, scheduleStatus, trackerCounts, transactTracker, upsertBoost, upsertTrackedBoost, validateState, weeklySummary, exportResultsCsv } from '../src/tracker.js';

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

test('a repeated save reuses the same page and campaign instead of duplicating', () => {
  const state = createTrackerState();
  const first = addBoost(state, base);
  const second = addBoost(state, { ...base, startAt: '2026-02-03T12:00:00.000Z' });
  assert.equal(state.clients.length, 1);
  assert.equal(state.pages.length, 1);
  assert.equal(state.pages[0].campaigns.length, 1);
  assert.equal(findBoost(state, second.id).campaign.id, findBoost(state, first.id).campaign.id);
});

test('merging a backup adds new records without overwriting current data and is idempotent', () => {
  const current = createTrackerState();
  const currentBoost = addBoost(current, { ...base, campaignName: 'Current campaign' });
  const incoming = createTrackerState();
  const incomingBoost = addBoost(incoming, {
    ...base, clientName: 'Client B', pageName: 'Olive Studio', pageUrl: '@olive',
    campaignName: 'Incoming campaign', postUrl: 'https://instagram.com/p/other'
  });
  const merged = mergeTrackerStates(current, incoming);
  assert.equal(trackerCounts(merged).boosts, 2);
  assert.equal(findBoost(merged, currentBoost.id).boost.budget, 100);
  assert.equal(findBoost(merged, incomingBoost.id).boost.budget, 100);
  const again = mergeTrackerStates(merged, incoming);
  assert.equal(trackerCounts(again).boosts, 2);
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

test('archive filters hide archived boosts by default and can show or isolate them', () => {
  const state = createTrackerState();
  const first = addBoost(state, base);
  const second = addBoost(state, { ...base, budget: 200 });
  second.archived = true;
  const ids = options => filterBoosts(state, options).flatMap(page => page.campaigns.flatMap(campaign => campaign.boosts.map(boost => boost.id)));
  assert.deepEqual(ids({}), [first.id]);
  assert.deepEqual(new Set(ids({ archived: 'all' })), new Set([first.id, second.id]));
  assert.deepEqual(ids({ archived: 'only' }), [second.id]);
});

test('boosts sort active first, then upcoming by start date without mutating stored order', () => {
  const state = createTrackerState();
  const future = addBoost(state, { ...base, startAt: '2026-02-10T12:00:00.000Z' });
  const active = addBoost(state, base);
  const soon = addBoost(state, { ...base, startAt: '2026-02-04T12:00:00.000Z' });
  const result = filterBoosts(state, { now: Date.parse('2026-02-02T12:00:00.000Z') });
  assert.deepEqual(result[0].campaigns[0].boosts.map(boost => boost.id), [active.id, soon.id, future.id]);
  assert.deepEqual(state.pages[0].campaigns[0].boosts.map(boost => boost.id), [future.id, active.id, soon.id]);
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

const quickInput = {
  pageName: 'Cedar Lens Photography',
  createdAt: '2026-11-13T08:00:00.000Z',
  startAt: '2026-11-14T09:00:00.000Z',
  budget: 40,
  durationDays: 5,
  purpose: 'Promote newborn photography',
  desiredAction: 'Message you'
};

test('simplified boost capture preserves timestamps, action, purpose, and v2 compatibility', () => {
  const state = createTrackerState();
  const boost = upsertTrackedBoost(state, quickInput);
  assert.equal(state.version, 2);
  assert.equal(state.clients.length, 1);
  assert.equal(state.pages.length, 1);
  assert.equal(state.pages[0].pageName, quickInput.pageName);
  assert.equal(boost.createdAt, quickInput.createdAt);
  assert.equal(boost.startAt, quickInput.startAt);
  assert.equal(boost.endAt, '2026-11-19T09:00:00.000Z');
  assert.equal(boost.purpose, quickInput.purpose);
  assert.equal(boost.desiredAction, 'Message you');
  assert.ok(state.pages[0].pageUrl.startsWith('@tracker-'));
  assert.deepEqual(importTracker(exportTracker(state)), state);
  assert.deepEqual(BOOST_ACTIONS, ['Visit your profile', 'Visit your website', 'Message you', 'Mix of actions']);
});

test('simplified boost edit preserves existing client, campaign, status, link, and IDs', () => {
  const state = createTrackerState();
  const legacy = upsertBoost(state, base);
  legacy.status = 'Paused';
  const before = findBoost(state, legacy.id);
  const originalPageId = before.page.id;
  const originalCampaignId = before.campaign.id;
  const changed = upsertTrackedBoost(state, { ...quickInput, pageName: 'Cedar Bakery', desiredAction: 'Visit your profile', budget: 70 }, legacy.id);
  const after = findBoost(state, legacy.id);
  assert.equal(changed.id, legacy.id);
  assert.equal(after.page.id, originalPageId);
  assert.equal(after.campaign.id, originalCampaignId);
  assert.equal(after.client.name, 'Client A');
  assert.equal(after.page.pageUrl, base.pageUrl);
  assert.equal(after.page.pageName, 'Cedar Bakery');
  assert.equal(after.boost.status, 'Paused');
  assert.equal(after.boost.postUrl, base.postUrl);
  assert.equal(after.boost.budget, 70);
  assert.equal(after.boost.createdAt, quickInput.createdAt);
  assert.equal(after.boost.desiredAction, 'Visit your profile');
});

test('explicit renames preserve relationships and reject duplicates and stale edits', () => {
  const state = createTrackerState();
  const first = upsertTrackedBoost(state, quickInput);
  const second = upsertTrackedBoost(state, { ...quickInput, purpose: 'Second' });
  const other = upsertTrackedBoost(state, { ...quickInput, pageName: 'Other page' });
  const page = findBoost(state, first.id).page;
  const campaign = findBoost(state, first.id).campaign;
  const before = structuredClone(state);
  assert.throws(() => renameTrackedEntity(state, 'page', page.id, 'Other page', page.pageName), /already exists/);
  assert.throws(() => renameTrackedEntity(state, 'campaign', campaign.id, 'Second', campaign.name), /already exists/);
  assert.throws(() => renameTrackedEntity(state, 'page', page.id, 'Changed', 'stale'), /another tab/);
  assert.throws(() => renameTrackedEntity(state, 'page', page.id, '  ', page.pageName), /Enter a name/);
  assert.deepEqual(state, before);
  renameTrackedEntity(state, 'page', page.id, ' New page ', page.pageName);
  renameTrackedEntity(state, 'campaign', campaign.id, 'New campaign', campaign.name);
  assert.equal(findBoost(state, first.id).page.pageName, 'New page');
  assert.equal(findBoost(state, second.id).page.pageName, 'New page');
  assert.equal(findBoost(state, first.id).campaign.name, 'New campaign');
  assert.equal(findBoost(state, first.id).boost.purpose, quickInput.purpose);
  assert.equal(findBoost(state, other.id).page.pageName, 'Other page');
  assert.deepEqual(importTracker(exportTracker(state)), state);
});

test('boost editing cannot silently rename a shared page or campaign', () => {
  const state = createTrackerState();
  const boost = upsertBoost(state, base);
  const before = structuredClone(state);
  assert.throws(() => upsertTrackedBoost(state, { ...quickInput, pageName: 'Changed' }, boost.id), /Rename the page/);
  assert.throws(() => upsertBoost(state, { ...base, campaignName: 'Changed' }, boost.id), /Edit the campaign/);
  assert.deepEqual(state, before);
});

test('existing and new boosts on the same page reuse a stable page relationship', () => {
  const state = createTrackerState();
  upsertTrackedBoost(state, quickInput);
  const page = state.pages[0];
  const campaignId = page.campaigns[0].id;
  const second = upsertTrackedBoost(state, { ...quickInput, purpose: 'New session offer', desiredAction: 'Mix of actions' });
  assert.equal(state.pages.length, 1);
  assert.equal(page.campaigns.length, 2);
  const third = upsertTrackedBoost(state, { ...quickInput, purpose: 'Another reel' }, null, { pageUrl: page.pageUrl, campaignId });
  assert.equal(findBoost(state, third.id).campaign.id, campaignId);
  assert.equal(findBoost(state, second.id).page.id, page.id);
});

test('new boost fields validate strictly and older v2 backups remain readable', () => {
  const state = createTrackerState();
  const legacy = upsertBoost(state, base);
  assert.equal(legacy.createdAt, undefined);
  assert.equal(legacy.desiredAction, undefined);
  assert.deepEqual(importTracker(exportTracker(state)), state);
  for (const desiredAction of ['More clicks', '', 'Go viral']) {
    assert.throws(() => upsertTrackedBoost(state, { ...quickInput, desiredAction }), /Choose what people should do/);
  }
  assert.throws(() => upsertTrackedBoost(state, { ...quickInput, createdAt: 'invalid' }), /timestamp/);
  const invalid = structuredClone(state);
  invalid.pages[0].campaigns[0].boosts[0].desiredAction = 'Bad action';
  assert.throws(() => validateState(invalid), /invalid boost desired action/);
  assert.equal(state.pages.length, 1);
  assert.equal(state.pages[0].campaigns.length, 1);
});

test('results logging validates input and upserts by date idempotently', () => {
  const state = createTrackerState();
  const boost = addBoost(state, base);
  const entry = logBoostResults(state, boost.id, { date: '2026-02-02', spend: '12.50', results: '4' });
  assert.deepEqual(entry, { date: '2026-02-02', spend: 12.5, results: 4 });
  logBoostResults(state, boost.id, { date: '2026-02-01', spend: 10, results: 3 });
  logBoostResults(state, boost.id, { date: '2026-02-02', spend: 15, results: 5 });
  const log = findBoost(state, boost.id).boost.resultsLog;
  assert.deepEqual(log, [{ date: '2026-02-01', spend: 10, results: 3 }, { date: '2026-02-02', spend: 15, results: 5 }]);
  assert.equal(log.length, 2);
  assert.throws(() => logBoostResults(state, boost.id, { date: '2026-13-40', spend: 1, results: 1 }), /valid results date/);
  assert.throws(() => logBoostResults(state, boost.id, { date: '2026-02-03', spend: -1, results: 1 }), /Spend must be/);
  assert.throws(() => logBoostResults(state, boost.id, { date: '2026-02-03', spend: 1, results: 1.5 }), /whole number/);
  assert.throws(() => logBoostResults(state, boost.id, { date: '2026-02-03', spend: 0, results: 0 }), /spend, results, or both/);
  assert.throws(() => logBoostResults(state, 'missing', { date: '2026-02-03', spend: 1, results: 1 }), /no longer exists/);
});

test('boost performance computes pacing and cost signals', () => {
  const now = Date.parse('2026-02-03T12:00:00.000Z');
  const state = createTrackerState();
  const boost = addBoost(state, { ...base, targetCpa: 5 });
  assert.equal(findBoost(state, boost.id).boost.targetCpa, 5);
  assert.equal(boostPerformance(findBoost(state, boost.id).boost, now).signal, 'no-data');
  logBoostResults(state, boost.id, { date: '2026-02-02', spend: 10, results: 4 });
  let perf = boostPerformance(findBoost(state, boost.id).boost, now);
  assert.equal(perf.signal, 'on-track');
  assert.equal(perf.actualCpa, 2.5);
  assert.equal(perf.plannedDaily, 25);
  assert.equal(perf.daysElapsed, 2);
  assert.equal(perf.pacing, 10 / 50);
  assert.equal(perf.pacingStatus, 'under');
  logBoostResults(state, boost.id, { date: '2026-02-03', spend: 60, results: 8 });
  perf = boostPerformance(findBoost(state, boost.id).boost, now);
  assert.equal(perf.signal, 'watch');
  assert.equal(perf.pacingStatus, 'over');
  logBoostResults(state, boost.id, { date: '2026-02-03', spend: 200, results: 8 });
  assert.equal(boostPerformance(findBoost(state, boost.id).boost, now).signal, 'over-target');
});

test('spend without results escalates against the target', () => {
  const now = Date.parse('2026-02-02T12:00:00.000Z');
  const state = createTrackerState();
  const boost = addBoost(state, { ...base, targetCpa: 5 });
  logBoostResults(state, boost.id, { date: '2026-02-02', spend: 4, results: 0 });
  assert.equal(boostPerformance(findBoost(state, boost.id).boost, now).signal, 'on-track');
  logBoostResults(state, boost.id, { date: '2026-02-02', spend: 6, results: 0 });
  assert.equal(boostPerformance(findBoost(state, boost.id).boost, now).signal, 'watch');
  logBoostResults(state, boost.id, { date: '2026-02-02', spend: 11, results: 0 });
  assert.equal(boostPerformance(findBoost(state, boost.id).boost, now).signal, 'over-target');
  const noTarget = addBoost(state, { ...base, campaignName: 'No target', postUrl: '' });
  logBoostResults(state, noTarget.id, { date: '2026-02-02', spend: 10, results: 2 });
  assert.equal(boostPerformance(findBoost(state, noTarget.id).boost, now).signal, 'no-target');
});

test('editing a boost preserves logged results and can change or clear the target', () => {
  const state = createTrackerState();
  const boost = addBoost(state, { ...base, targetCpa: 5 });
  logBoostResults(state, boost.id, { date: '2026-02-02', spend: 10, results: 2 });
  addBoost(state, { ...base, budget: 120 }, boost.id);
  assert.deepEqual(findBoost(state, boost.id).boost.resultsLog, [{ date: '2026-02-02', spend: 10, results: 2 }]);
  assert.equal(findBoost(state, boost.id).boost.targetCpa, 5);
  addBoost(state, { ...base, targetCpa: 8 }, boost.id);
  assert.equal(findBoost(state, boost.id).boost.targetCpa, 8);
  addBoost(state, { ...base, targetCpa: '' }, boost.id);
  assert.equal(findBoost(state, boost.id).boost.targetCpa, undefined);
  assert.throws(() => addBoost(state, { ...base, targetCpa: -3 }, boost.id), /positive number/);
});

test('daily checklist ranks active boosts by urgency and skips archived or inactive ones', () => {
  const now = Date.parse('2026-02-03T12:00:00.000Z');
  const state = createTrackerState();
  const over = addBoost(state, { ...base, targetCpa: 5 });
  logBoostResults(state, over.id, { date: '2026-02-02', spend: 100, results: 5 });
  const ok = addBoost(state, { ...base, campaignName: 'Second', postUrl: '', targetCpa: 5 });
  logBoostResults(state, ok.id, { date: '2026-02-02', spend: 10, results: 4 });
  const silent = addBoost(state, { ...base, campaignName: 'Third', postUrl: '' });
  const scheduled = addBoost(state, { ...base, campaignName: 'Future', postUrl: '', startAt: '2026-03-01T12:00:00.000Z' });
  const rows = dailyChecklist(state, now);
  assert.deepEqual(rows.map(row => row.campaignName), ['Spring launch', 'Third', 'Second']);
  assert.deepEqual(rows.map(row => row.performance.signal), ['over-target', 'no-data', 'on-track']);
  assert.equal(rows[0].budget, 100);
  assert.equal(rows.some(row => row.boostId === scheduled.id), false);
  const next = structuredClone(state);
  findBoost(next, over.id).boost.archived = true;
  assert.equal(dailyChecklist(next, now).some(row => row.boostId === over.id), false);
});

test('results log and target survive export and import roundtrip and validate strictly', () => {
  const state = createTrackerState();
  const boost = addBoost(state, { ...base, targetCpa: 5 });
  logBoostResults(state, boost.id, { date: '2026-02-02', spend: 12.5, results: 4 });
  const restored = importTracker(exportTracker(state));
  const restoredBoost = findBoost(restored, boost.id).boost;
  assert.equal(restoredBoost.targetCpa, 5);
  assert.deepEqual(restoredBoost.resultsLog, [{ date: '2026-02-02', spend: 12.5, results: 4 }]);
  const tampered = JSON.parse(exportTracker(state));
  tampered.pages[0].campaigns[0].boosts[0].resultsLog.push({ date: '2026-02-02', spend: 1, results: 1 });
  assert.throws(() => importTracker(JSON.stringify(tampered)), /duplicate results dates/);
  const invalid = JSON.parse(exportTracker(state));
  invalid.pages[0].campaigns[0].boosts[0].targetCpa = -1;
  assert.throws(() => importTracker(JSON.stringify(invalid)), /invalid target cost per result/);
});

test('weekly summary aggregates the last 7 days per page and finds best and worst CPA', () => {
  const now = Date.parse('2026-02-10T15:00:00.000Z');
  const state = createTrackerState();
  const a = addBoost(state, base);
  const b = addBoost(state, { ...base, campaignName: 'Second', postUrl: '' });
  const other = addBoost(state, { ...base, clientName: 'Client B', pageName: 'Olive Studio', pageUrl: '@olive', campaignName: 'Launch', postUrl: '' });
  logBoostResults(state, a.id, { date: '2026-02-09', spend: 20, results: 10 });
  logBoostResults(state, a.id, { date: '2026-02-03', spend: 999, results: 99 });
  logBoostResults(state, b.id, { date: '2026-02-10', spend: 30, results: 3 });
  logBoostResults(state, other.id, { date: '2026-02-08', spend: 12, results: 6 });
  const summary = weeklySummary(state, now);
  assert.equal(summary.startDate, '2026-02-04');
  assert.equal(summary.endDate, '2026-02-10');
  assert.equal(summary.pages.length, 2);
  const cedar = summary.pages.find(page => page.pageName === 'Cedar Bakery');
  assert.equal(cedar.spend, 50);
  assert.equal(cedar.results, 13);
  assert.deepEqual(summary.totals, { spend: 62, results: 19, cpa: 62 / 19 });
  assert.equal(summary.best.boostId, a.id);
  assert.equal(summary.best.cpa, 2);
  assert.equal(summary.worst.boostId, b.id);
  assert.equal(summary.worst.cpa, 10);
});

test('weekly summary is empty without recent entries and ignores zero-result CPAs in extremes', () => {
  const now = Date.parse('2026-02-10T15:00:00.000Z');
  const state = createTrackerState();
  const boost = addBoost(state, base);
  assert.equal(weeklySummary(state, now).pages.length, 0);
  logBoostResults(state, boost.id, { date: '2026-02-02', spend: 10, results: 2 });
  assert.equal(weeklySummary(state, now).pages.length, 0, 'entries older than 7 days are excluded');
  logBoostResults(state, boost.id, { date: '2026-02-10', spend: 15, results: 0 });
  const summary = weeklySummary(state, now);
  assert.equal(summary.pages.length, 1);
  assert.equal(summary.totals.cpa, null);
  assert.equal(summary.best, null);
  assert.equal(summary.worst, null);
});

test('results CSV export formats rows, quotes unsafe cells, and sorts by date', () => {
  const state = createTrackerState();
  const a = addBoost(state, { ...base, clientName: 'Client, A' });
  const b = addBoost(state, { ...base, clientName: 'Client, A', campaignName: 'Quoted "sale"', postUrl: '' });
  logBoostResults(state, b.id, { date: '2026-02-03', spend: 30, results: 0 });
  logBoostResults(state, a.id, { date: '2026-02-02', spend: 12.5, results: 5 });
  const csv = exportResultsCsv(state);
  const lines = csv.trim().split(/\r?\n/);
  assert.equal(lines[0], 'Date,Client,Page,Campaign,Purpose,Spend (USD),Results,Cost per result (USD)');
  assert.equal(lines[1], '2026-02-02,"Client, A",Cedar Bakery,Spring launch,Messages,12.50,5,2.50');
  assert.equal(lines[2], '2026-02-03,"Client, A",Cedar Bakery,"Quoted ""sale""",Messages,30.00,0,');
  assert.equal(lines.length, 3);
  assert.equal(exportResultsCsv(createTrackerState()).trim().split(/\r?\n/).length, 1, 'empty state exports only the header');
});

test('weekly summary filters by client for reports', () => {
  const now = Date.parse('2026-02-10T15:00:00.000Z');
  const state = createTrackerState();
  const a = addBoost(state, base);
  const other = addBoost(state, { ...base, clientName: 'Client B', pageName: 'Olive Studio', pageUrl: '@olive', campaignName: 'Launch', postUrl: '' });
  logBoostResults(state, a.id, { date: '2026-02-09', spend: 20, results: 10 });
  logBoostResults(state, other.id, { date: '2026-02-09', spend: 12, results: 6 });
  const clientA = state.clients.find(item => item.name === 'Client A');
  const clientB = state.clients.find(item => item.name === 'Client B');
  const filtered = weeklySummary(state, now, clientA.id);
  assert.equal(filtered.pages.length, 1);
  assert.equal(filtered.pages[0].pageName, 'Cedar Bakery');
  assert.deepEqual(filtered.totals, { spend: 20, results: 10, cpa: 2 });
  assert.equal(filtered.pages[0].boosts[0].targetCpa, null);
  assert.equal(weeklySummary(state, now, clientB.id).totals.spend, 12);
  assert.equal(weeklySummary(state, now, 'missing-client').pages.length, 0);
});
