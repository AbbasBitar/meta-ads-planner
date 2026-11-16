export const STORAGE_KEY = 'meta-ads-planner.tracker.v1';
export const DAY_MS = 86400000;
export const ENDING_SOON_MS = DAY_MS;
export const MAX_BACKUP_BYTES = 1_000_000;
export const COUNTDOWN_REFRESH_MS = 30000;
export const BOOST_STATUSES = Object.freeze(['Scheduled', 'Active', 'Completed', 'Paused', 'Cancelled']);
export const BOOST_ACTIONS = Object.freeze(['Visit your profile', 'Visit your website', 'Message you', 'Mix of actions']);

function record(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function onlyKeys(value, allowed, label) {
  if (Object.keys(value).some(key => !allowed.includes(key))) throw new Error(`Backup contains an unexpected ${label} field.`);
}
function boundedString(value, label, max = 500, required = true) {
  if (typeof value !== 'string' || value.length > max || (required && !value.trim())) throw new Error(`Backup contains an invalid ${label}.`);
  return value;
}
export function pageKey(value) { return value.trim().toLocaleLowerCase().replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, ''); }

export function parseInstant(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value)) throw new Error('Invalid ISO 8601 timestamp.');
  const time = Date.parse(value);
  if (!Number.isFinite(time) || new Date(time).toISOString() !== value) throw new Error('Invalid ISO 8601 timestamp.');
  return time;
}

export function calculateEndDate(start, durationDays) {
  const days = Number(durationDays);
  if (!Number.isInteger(days) || days < 1) throw new Error('Duration must be a positive whole number of days.');
  return new Date(parseInstant(start) + days * DAY_MS).toISOString();
}

function isSafePostUrl(value) {
  if (!value) return true;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && /(^|\.)(instagram\.com|facebook\.com|fb\.watch)$/i.test(url.hostname) && !url.username && !url.password && !url.port;
  } catch { return false; }
}

export const MAX_RESULT_ENTRIES = 400;

export function isValidResultDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\d$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function validateResultsLog(log) {
  if (!Array.isArray(log) || log.length > MAX_RESULT_ENTRIES) throw new Error('Backup contains an invalid results log.');
  const dates = new Set();
  for (const entry of log) {
    if (!record(entry)) throw new Error('Backup contains an invalid results entry.');
    onlyKeys(entry, ['date', 'spend', 'results'], 'results entry');
    if (!isValidResultDate(entry.date)) throw new Error('Backup contains an invalid results date.');
    if (dates.has(entry.date)) throw new Error('Backup contains duplicate results dates.');
    dates.add(entry.date);
    if (typeof entry.spend !== 'number' || !Number.isFinite(entry.spend) || entry.spend < 0 || entry.spend > 1_000_000) throw new Error('Backup contains an invalid results spend.');
    if (!Number.isInteger(entry.results) || entry.results < 0 || entry.results > 1_000_000) throw new Error('Backup contains an invalid results count.');
  }
}

export function localInputToIso(value) {
  const date = new Date(value);
  if (!value || !Number.isFinite(date.getTime())) throw new Error('Enter a valid start date and time.');
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  if (local !== value) throw new Error('That local date and time does not exist in your timezone.');
  return date.toISOString();
}

export function isoToLocalInput(value) {
  const date = new Date(parseInstant(value));
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

export function scheduleStatus(boost, now = Date.now()) {
  if (boost.status === 'Paused' || boost.status === 'Cancelled') return boost.status;
  const start = parseInstant(boost.startAt);
  const end = parseInstant(boost.endAt);
  if (now < start) return 'Scheduled';
  if (now < end) return 'Active';
  return 'Completed';
}

export function createTrackerState() { return { version: 2, clients: [], pages: [] }; }

export function migrateTracker(state) {
  if (!record(state) || state.version !== 1 || !Array.isArray(state.pages)) throw new Error('Backup data has an unsupported format.');
  const next = createTrackerState();
  const clients = new Map();
  for (const oldPage of state.pages) {
    if (!record(oldPage) || !Array.isArray(oldPage.boosts)) throw new Error('Legacy backup contains an invalid page.');
    let clientId = clients.get(oldPage.clientName);
    if (!clientId) {
      clientId = `migrated-client-${clients.size + 1}`;
      clients.set(oldPage.clientName, clientId);
      next.clients.push({ id: clientId, name: oldPage.clientName });
    }
    const page = { id: oldPage.id, clientId, pageName: oldPage.pageName, pageUrl: oldPage.pageUrl, campaigns: [] };
    for (const oldBoost of oldPage.boosts) {
      page.campaigns.push({ id: `migrated-campaign-${oldPage.id}-${oldBoost.id}`, name: oldBoost.goal || 'Imported campaign', goal: oldBoost.goal || '', boosts: [{ ...oldBoost }] });
    }
    next.pages.push(page);
  }
  return validateState(next);
}

export function validateState(state) {
  if (!record(state) || state.version !== 2 || !Array.isArray(state.clients) || !Array.isArray(state.pages)) throw new Error('Backup data has an unsupported format.');
  onlyKeys(state, ['version', 'clients', 'pages'], 'root');
  if (state.clients.length > 500 || state.pages.length > 1000) throw new Error('Backup contains too many clients or pages.');
  const ids = new Set();
  const addId = (id, label) => {
    boundedString(id, `${label} ID`, 160);
    if (ids.has(id)) throw new Error('Backup contains duplicate IDs.');
    ids.add(id);
  };
  const clients = new Map();
  const clientNames = new Set();
  for (const client of state.clients) {
    if (!record(client)) throw new Error('Backup contains an invalid client.');
    onlyKeys(client, ['id', 'name'], 'client');
    addId(client.id, 'client');
    const name = boundedString(client.name, 'client name', 160).trim().toLocaleLowerCase();
    if (clientNames.has(name)) throw new Error('Backup contains duplicate clients.');
    clientNames.add(name); clients.set(client.id, client);
  }
  const pageKeys = new Set();
  let campaignCount = 0, boostCount = 0;
  for (const page of state.pages) {
    if (!record(page) || !Array.isArray(page.campaigns)) throw new Error('Backup contains an invalid page.');
    onlyKeys(page, ['id', 'clientId', 'pageName', 'pageUrl', 'campaigns'], 'page');
    addId(page.id, 'page');
    boundedString(page.pageName, 'page name', 160);
    const url = boundedString(page.pageUrl, 'page handle or URL', 500);
    if (!clients.has(page.clientId)) throw new Error('Backup references an unknown client.');
    const key = pageKey(url);
    if (pageKeys.has(key)) throw new Error('Backup contains duplicate page records.');
    pageKeys.add(key);
    campaignCount += page.campaigns.length;
    if (campaignCount > 3000) throw new Error('Backup contains too many campaigns.');
    for (const campaign of page.campaigns) {
      if (!record(campaign) || !Array.isArray(campaign.boosts)) throw new Error('Backup contains an invalid campaign.');
      onlyKeys(campaign, ['id', 'name', 'goal', 'boosts'], 'campaign');
      addId(campaign.id, 'campaign');
      boundedString(campaign.name, 'campaign name', 160);
      boundedString(campaign.goal, 'campaign goal', 160, false);
      boostCount += campaign.boosts.length;
      if (boostCount > 10000) throw new Error('Backup contains too many boosts.');
      for (const boost of campaign.boosts) {
        if (!record(boost)) throw new Error('Backup contains an invalid boost.');
        onlyKeys(boost, ['id', 'postUrl', 'goal', 'budget', 'durationDays', 'startAt', 'endAt', 'status', 'archived', 'createdAt', 'purpose', 'desiredAction', 'targetCpa', 'resultsLog'], 'boost');
        addId(boost.id, 'boost');
        if (typeof boost.budget !== 'number' || !Number.isFinite(boost.budget) || boost.budget <= 0 || !Number.isInteger(boost.durationDays) || boost.durationDays < 1) throw new Error('Backup contains an invalid budget or duration.');
        if (!BOOST_STATUSES.includes(boost.status) || typeof boost.archived !== 'boolean') throw new Error('Backup contains an invalid boost status.');
        boundedString(boost.postUrl, 'post URL', 500, false);
        if (!isSafePostUrl(boost.postUrl)) throw new Error('Backup contains an unsafe post URL.');
        boundedString(boost.goal, 'boost goal', 160, false);
        if (boost.createdAt !== undefined) parseInstant(boost.createdAt);
        if (boost.purpose !== undefined) boundedString(boost.purpose, 'boost purpose', 160);
        if (boost.desiredAction !== undefined && !BOOST_ACTIONS.includes(boost.desiredAction)) throw new Error('Backup contains an invalid boost desired action.');
        if (boost.targetCpa !== undefined && (typeof boost.targetCpa !== 'number' || !Number.isFinite(boost.targetCpa) || boost.targetCpa <= 0 || boost.targetCpa > 100_000)) throw new Error('Backup contains an invalid target cost per result.');
        if (boost.resultsLog !== undefined) validateResultsLog(boost.resultsLog);
        const expected = calculateEndDate(boost.startAt, boost.durationDays);
        if (parseInstant(boost.endAt) !== parseInstant(expected)) throw new Error('Backup contains an invalid end date.');
      }
    }
  }
  return state;
}

export function loadTracker(storage) {
  const raw = storage.getItem(STORAGE_KEY);
  if (!raw) return createTrackerState();
  if (new TextEncoder().encode(raw).length > MAX_BACKUP_BYTES) throw new Error('Saved tracker data exceeds the supported size and was left untouched.');
  let parsed;
  try { parsed = JSON.parse(raw); } catch { throw new Error('Saved tracker data is corrupted and was left untouched. Download it or restore a valid backup.'); }
  if (parsed?.version === 1) return migrateTracker(parsed);
  try { return validateState(parsed); }
  catch (error) { throw new Error(`Saved tracker data is invalid and was left untouched: ${error.message}`); }
}

export function saveTracker(storage, state) {
  validateState(state);
  const json = JSON.stringify(state);
  if (new TextEncoder().encode(json).length > MAX_BACKUP_BYTES) throw new Error('Tracker data is too large to save. Remove old archived records or export a backup.');
  storage.setItem(STORAGE_KEY, json);
  return state;
}

export function replaceTracker(storage, replacement) {
  saveTracker(storage, replacement);
  return structuredClone(replacement);
}

export function trackerCounts(state) {
  let campaigns = 0;
  let boosts = 0;
  for (const page of state.pages) {
    campaigns += page.campaigns.length;
    for (const campaign of page.campaigns) boosts += campaign.boosts.length;
  }
  return { clients: state.clients.length, pages: state.pages.length, campaigns, boosts };
}

function collectIds(state) {
  const ids = new Set();
  for (const client of state.clients) ids.add(client.id);
  for (const page of state.pages) {
    ids.add(page.id);
    for (const campaign of page.campaigns) {
      ids.add(campaign.id);
      for (const boost of campaign.boosts) ids.add(boost.id);
    }
  }
  return ids;
}

export function mergeTrackerStates(current, incoming) {
  validateState(current);
  validateState(incoming);
  const merged = structuredClone(current);
  const ids = collectIds(merged);
  const freshId = () => {
    let id;
    do { id = uid(); } while (ids.has(id));
    ids.add(id);
    return id;
  };
  const clientsByName = new Map(merged.clients.map(client => [client.name.trim().toLocaleLowerCase(), client]));
  const clientIds = new Map();
  const addedClientIds = new Set();
  for (const client of incoming.clients) {
    const nameKey = client.name.trim().toLocaleLowerCase();
    let target = clientsByName.get(nameKey);
    if (!target) {
      const id = ids.has(client.id) ? freshId() : client.id;
      ids.add(id);
      target = { id, name: client.name };
      merged.clients.push(target);
      clientsByName.set(nameKey, target);
      addedClientIds.add(id);
    }
    clientIds.set(client.id, target.id);
  }
  for (const page of incoming.pages) {
    const clientId = clientIds.get(page.clientId);
    const key = pageKey(page.pageUrl);
    let targetPage = merged.pages.find(item => pageKey(item.pageUrl) === key);
    if (!targetPage) {
      const id = ids.has(page.id) ? freshId() : page.id;
      ids.add(id);
      targetPage = { id, clientId, pageName: page.pageName, pageUrl: page.pageUrl, campaigns: [] };
      merged.pages.push(targetPage);
    }
    for (const campaign of page.campaigns) {
      const campaignKey = campaign.name.trim().toLocaleLowerCase();
      let targetCampaign = targetPage.campaigns.find(item => item.name.trim().toLocaleLowerCase() === campaignKey);
      if (!targetCampaign) {
        const id = ids.has(campaign.id) ? freshId() : campaign.id;
        ids.add(id);
        targetCampaign = { id, name: campaign.name, goal: campaign.goal, boosts: [] };
        targetPage.campaigns.push(targetCampaign);
      }
      for (const boost of campaign.boosts) {
        if (ids.has(boost.id)) continue;
        const copy = structuredClone(boost);
        ids.add(copy.id);
        targetCampaign.boosts.push(copy);
      }
    }
  }
  merged.clients = merged.clients.filter(client => !addedClientIds.has(client.id) || merged.pages.some(page => page.clientId === client.id));
  return validateState(merged);
}

export function formatSaveFailure(error) {
  return `Could not save changes: ${error?.message ?? 'browser storage is unavailable'}. No changes were applied. Check browser storage space or restore a valid backup, then retry.`;
}

export function transactTracker(storage, state, mutate) {
  const next = structuredClone(state);
  mutate(next);
  saveTracker(storage, next);
  return next;
}

export function importTracker(json) {
  if (typeof json !== 'string' || new TextEncoder().encode(json).length > MAX_BACKUP_BYTES) throw new Error('Backup is too large to restore (maximum 1 MB).');
  let state;
  try { state = JSON.parse(json); } catch { throw new Error('Backup is not valid JSON.'); }
  return state?.version === 1 ? migrateTracker(state) : validateState(state);
}
export function exportTracker(state) { validateState(state); return JSON.stringify(state, null, 2); }

function uid() { return globalThis.crypto?.randomUUID?.() ?? `r${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`; }

export function upsertBoost(state, input, boostId = null) {
  const clientName = String(input.clientName ?? '').trim();
  const pageName = String(input.pageName ?? '').trim();
  const pageUrl = String(input.pageUrl ?? '').trim();
  const campaignName = String(input.campaignName ?? input.goal ?? '').trim();
  const goal = String(input.goal ?? '').trim();
  if (!clientName || !pageName || !pageUrl || !campaignName) throw new Error('Client, page, and campaign names are required.');
  const budget = Number(input.budget);
  const durationDays = Number(input.durationDays);
  if (!Number.isFinite(budget) || budget <= 0) throw new Error('Budget must be greater than zero.');
  if (!Number.isInteger(durationDays) || durationDays < 1) throw new Error('Duration must be a positive whole number of days.');
  const postUrl = String(input.postUrl ?? '').trim();
  if (!isSafePostUrl(postUrl)) throw new Error('Post URL must be a valid HTTPS Instagram or Facebook URL.');
  const startAt = new Date(parseInstant(input.startAt)).toISOString();
  const endAt = calculateEndDate(startAt, durationDays);
  const createdAt = input.createdAt === undefined ? undefined : new Date(parseInstant(input.createdAt)).toISOString();
  const purpose = input.purpose === undefined ? undefined : boundedString(input.purpose, 'boost purpose', 160);
  const desiredAction = input.desiredAction;
  if (desiredAction !== undefined && !BOOST_ACTIONS.includes(desiredAction)) throw new Error('Choose a valid ad action.');
  const clientKey = clientName.toLocaleLowerCase();
  let client = state.clients.find(item => item.name.toLocaleLowerCase() === clientKey);
  const key = pageKey(pageUrl);
  const existingPage = boostId ? state.pages.find(p => p.campaigns.some(c => c.boosts.some(b => b.id === boostId))) : null;
  if (boostId && !existingPage) throw new Error('Selected boost no longer exists.');
  if (existingPage && pageKey(existingPage.pageUrl) !== key) throw new Error('A boost cannot be moved to another page.');
  let page = existingPage ?? state.pages.find(item => pageKey(item.pageUrl) === key);
  if (page && page.clientId !== client?.id) throw new Error(`This page is already assigned to ${state.clients.find(item => item.id === page.clientId)?.name ?? 'another client'}.`);
  if (input.campaignId && !page) throw new Error('Selected campaign no longer exists.');
  const existingCampaign = boostId ? page?.campaigns.find(c => c.boosts.some(b => b.id === boostId)) : null;
  if (existingPage && existingPage.pageName !== pageName) throw new Error('Rename the page using the page action, not the boost editor.');
  if (existingCampaign && (existingCampaign.name !== campaignName || existingCampaign.goal !== goal)) throw new Error('Edit the campaign using its own action, not the boost editor.');
  let campaign = existingCampaign ?? (input.campaignId ? page?.campaigns.find(c => c.id === input.campaignId) : null);
  if (input.campaignId && !campaign) throw new Error('Selected campaign no longer exists.');
  if (boostId && input.campaignId && existingCampaign?.id !== input.campaignId) throw new Error('A boost cannot be moved to another campaign.');
  if (!campaign && !boostId && page) {
    const nameKey = campaignName.toLocaleLowerCase();
    campaign = page.campaigns.find(item => item.name.trim().toLocaleLowerCase() === nameKey) ?? null;
  }
  const status = input.status ?? 'Scheduled';
  if (!BOOST_STATUSES.includes(status)) throw new Error('Choose a valid boost status.');
  if (!client) { client = { id: uid(), name: clientName }; state.clients.push(client); }
  if (!page) { page = { id: uid(), clientId: client.id, pageName, pageUrl, campaigns: [] }; state.pages.push(page); }
  if (!campaign) { campaign = { id: uid(), name: campaignName, goal, boosts: [] }; page.campaigns.push(campaign); }
  const previous = boostId ? campaign.boosts.find(item => item.id === boostId) : null;
  const boost = { ...(previous ?? {}), id: previous?.id ?? uid(), postUrl, goal, budget, durationDays, startAt, endAt, status: input.status ?? previous?.status ?? 'Scheduled', archived: input.archived ?? previous?.archived ?? false };
  if (createdAt !== undefined) boost.createdAt = createdAt;
  if (purpose !== undefined) boost.purpose = purpose;
  if (desiredAction !== undefined) boost.desiredAction = desiredAction;
  if (previous) Object.assign(previous, boost); else campaign.boosts.push(boost);
  const stored = previous ?? boost;
  if (Object.hasOwn(input, 'targetCpa')) {
    const raw = input.targetCpa;
    if (raw === undefined || raw === null || raw === '') delete stored.targetCpa;
    else {
      const target = Number(raw);
      if (!Number.isFinite(target) || target <= 0 || target > 100000) throw new Error('Target cost per result must be a positive number.');
      stored.targetCpa = target;
    }
  }
  return stored;
}

export function renameTrackedEntity(state, kind, id, name, expectedName) {
  const value = typeof name === 'string' ? name.trim() : '';
  if (!value || value.length > 160) throw new Error('Enter a name of up to 160 characters.');
  let target;
  let siblings;
  if (kind === 'page') {
    target = state.pages.find(page => page.id === id);
    siblings = state.pages;
  } else if (kind === 'campaign') {
    const page = state.pages.find(item => item.campaigns.some(campaign => campaign.id === id));
    target = page?.campaigns.find(campaign => campaign.id === id);
    siblings = page?.campaigns;
  } else throw new Error('Unknown record type.');
  if (!target) throw new Error('This record no longer exists.');
  const key = kind === 'page' ? 'pageName' : 'name';
  if (expectedName !== undefined && target[key] !== expectedName) throw new Error('This name changed in another tab. Close and reopen the rename form.');
  if (siblings.some(item => item !== target && item[key].trim().toLocaleLowerCase() === value.toLocaleLowerCase())) {
    throw new Error(`A ${kind} with that name already exists${kind === 'campaign' ? ' on this page' : ''}.`);
  }
  target[key] = value;
}

/**
 * Minimal form adapter. Keeps the existing client -> page -> campaign -> boost
 * relationships out of the editor, without rewriting or discarding old records.
 * The creation date represents the date entered by the user, not Meta delivery proof.
 */
export function upsertTrackedBoost(state, input, boostId = null, context = {}) {
  const pageName = String(input.pageName ?? '').trim();
  const purpose = String(input.purpose ?? '').trim();
  const desiredAction = String(input.desiredAction ?? '');
  if (!pageName || pageName.length > 160) throw new Error('Enter a page name (up to 160 characters).');
  if (!purpose || purpose.length > 160) throw new Error('Enter a boost purpose (up to 160 characters).');
  if (!BOOST_ACTIONS.includes(desiredAction)) throw new Error('Choose what people should do when they see your ad.');
  if (typeof input.createdAt !== 'string') throw new Error('Enter the boost creation date.');
  parseInstant(input.createdAt);

  const found = boostId ? findBoost(state, boostId) : null;
  if (boostId && !found) throw new Error('Selected boost no longer exists.');
  let page = found?.page;
  if (!page && context.pageUrl) page = state.pages.find(item => pageKey(item.pageUrl) === pageKey(context.pageUrl));
  if (!page) {
    const matchingPages = state.pages.filter(item => item.pageName.trim().toLocaleLowerCase() === pageName.toLocaleLowerCase());
    if (matchingPages.length > 1) throw new Error('Multiple pages have that name. Use a distinct page name to avoid mixing records.');
    page = matchingPages[0] ?? null;
  }
  const client = page ? state.clients.find(item => item.id === page.clientId) : null;
  const campaign = found?.campaign ?? (context.campaignId ? page?.campaigns.find(item => item.id === context.campaignId) : null);
  if (context.campaignId && !campaign && !found) throw new Error('The selected campaign no longer exists.');
  const pageUrl = page?.pageUrl ?? context.pageUrl ?? `@tracker-${uid().replace(/[^a-z0-9-]/gi, '').toLowerCase()}`;
  return upsertBoost(state, {
    clientName: client?.name ?? 'Tracked pages',
    pageName,
    pageUrl,
    campaignId: campaign?.id,
    campaignName: campaign?.name ?? purpose,
    goal: campaign?.goal ?? desiredAction,
    postUrl: found?.boost.postUrl ?? context.postUrl ?? '',
    status: found?.boost.status ?? 'Scheduled',
    archived: found?.boost.archived ?? false,
    budget: input.budget,
    durationDays: input.durationDays,
    startAt: input.startAt,
    createdAt: input.createdAt,
    purpose,
    desiredAction,
    targetCpa: input.targetCpa
  }, boostId);
}

export function removeBoost(state, boostId) {
  for (const page of state.pages) {
    const campaign = page.campaigns.find(item => item.boosts.some(boost => boost.id === boostId));
    if (!campaign) continue;
    campaign.boosts = campaign.boosts.filter(boost => boost.id !== boostId);
    if (!campaign.boosts.length) page.campaigns = page.campaigns.filter(item => item !== campaign);
    if (!page.campaigns.length) state.pages = state.pages.filter(item => item !== page);
    if (!state.pages.some(item => item.clientId === page.clientId)) state.clients = state.clients.filter(item => item.id !== page.clientId);
    return true;
  }
  return false;
}

export function findBoost(state, boostId) {
  for (const page of state.pages) for (const campaign of page.campaigns) {
    const boost = campaign.boosts.find(item => item.id === boostId);
    if (boost) return { client: state.clients.find(item => item.id === page.clientId), page, campaign, boost };
  }
  return null;
}

export function filterBoosts(state, { query = '', pageUrl = '', status = '', ending = '', archived = 'hide', now = Date.now() } = {}) {
  const needle = query.trim().toLocaleLowerCase();
  const terms = needle ? needle.split(/\s+/) : [];
  return state.pages.map(page => {
    const client = state.clients.find(item => item.id === page.clientId);
    const campaigns = page.campaigns.map(campaign => ({ ...campaign, boosts: campaign.boosts.filter(boost => {
      if (archived === 'hide' && boost.archived) return false;
      if (archived === 'only' && !boost.archived) return false;
      if (pageUrl && page.pageUrl !== pageUrl) return false;
      if (status && scheduleStatus(boost, now) !== status) return false;
      if (ending === 'soon' && (parseInstant(boost.endAt) <= now || parseInstant(boost.endAt) > now + ENDING_SOON_MS)) return false;
      const searchable = [client?.name, page.pageName, page.pageUrl, campaign.name, campaign.goal, boost.postUrl, boost.goal, boost.purpose, boost.desiredAction].join(' ').toLocaleLowerCase();
      if (terms.some(term => !searchable.includes(term))) return false;
      return true;
    }).sort((a, b) => {
      const rank = boost => ({ Active: 0, Scheduled: 1, Paused: 2, Completed: 3, Cancelled: 4 })[scheduleStatus(boost, now)];
      return rank(a) - rank(b) || parseInstant(a.startAt) - parseInstant(b.startAt);
    }) })).filter(campaign => campaign.boosts.length);
    return { ...page, clientName: client?.name ?? '', campaigns };
  }).filter(page => page.campaigns.length);
}

export const BOOST_SIGNALS = Object.freeze(['on-track', 'watch', 'over-target', 'no-target', 'no-data']);

export function logBoostResults(state, boostId, entry) {
  const found = findBoost(state, boostId);
  if (!found) throw new Error('Selected boost no longer exists.');
  if (!isValidResultDate(entry?.date)) throw new Error('Enter a valid results date.');
  const spend = Number(entry.spend);
  const results = Number(entry.results);
  if (!Number.isFinite(spend) || spend < 0 || spend > 1_000_000) throw new Error('Spend must be a number from 0 to 1,000,000.');
  if (!Number.isInteger(results) || results < 0 || results > 1_000_000) throw new Error('Results must be a whole number from 0 to 1,000,000.');
  if (spend === 0 && results === 0) throw new Error('Enter spend, results, or both.');
  const log = [...(found.boost.resultsLog ?? [])];
  const record = { date: entry.date, spend, results };
  const index = log.findIndex(item => item.date === entry.date);
  if (index >= 0) log[index] = record;
  else {
    if (log.length >= MAX_RESULT_ENTRIES) throw new Error('This boost already has the maximum number of results entries.');
    log.push(record);
  }
  log.sort((a, b) => (a.date < b.date ? -1 : 1));
  found.boost.resultsLog = log;
  return record;
}

export function boostPerformance(boost, now = Date.now()) {
  const log = Array.isArray(boost.resultsLog) ? boost.resultsLog : [];
  const spendToDate = log.reduce((sum, entry) => sum + entry.spend, 0);
  const resultsToDate = log.reduce((sum, entry) => sum + entry.results, 0);
  const actualCpa = resultsToDate > 0 ? spendToDate / resultsToDate : null;
  const plannedDaily = boost.budget / boost.durationDays;
  const daysElapsed = Math.max(0, Math.min(boost.durationDays, (now - parseInstant(boost.startAt)) / DAY_MS));
  const expectedSpend = plannedDaily * daysElapsed;
  const pacing = expectedSpend > 0 ? spendToDate / expectedSpend : null;
  const pacingStatus = pacing === null ? 'unknown' : pacing < 0.8 ? 'under' : pacing > 1.2 ? 'over' : 'ok';
  const targetCpa = boost.targetCpa ?? null;
  let signal = 'no-data';
  if (log.length) {
    if (targetCpa) {
      if (actualCpa !== null) signal = actualCpa > targetCpa * 2 ? 'over-target' : actualCpa > targetCpa ? 'watch' : 'on-track';
      else signal = spendToDate >= targetCpa * 2 ? 'over-target' : spendToDate >= targetCpa ? 'watch' : 'on-track';
    } else signal = 'no-target';
  }
  return { spendToDate, resultsToDate, actualCpa, plannedDaily, daysElapsed, expectedSpend, pacing, pacingStatus, targetCpa, signal };
}

export function dailyChecklist(state, now = Date.now()) {
  const rows = [];
  for (const page of state.pages) {
    const client = state.clients.find(item => item.id === page.clientId);
    for (const campaign of page.campaigns) {
      for (const boost of campaign.boosts) {
        if (boost.archived || scheduleStatus(boost, now) !== 'Active') continue;
        rows.push({
          boostId: boost.id,
          clientName: client?.name ?? '',
          pageName: page.pageName,
          campaignName: campaign.name,
          purpose: boost.purpose || boost.goal || campaign.name,
          budget: boost.budget,
          performance: boostPerformance(boost, now)
        });
      }
    }
  }
  const rank = { 'over-target': 0, watch: 1, 'no-data': 2, 'on-track': 3, 'no-target': 4 };
  rows.sort((a, b) => rank[a.performance.signal] - rank[b.performance.signal]);
  return rows;
}


export function weeklySummary(state, now = Date.now()) {
  const endDate = new Date(now - new Date(now).getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  const startDate = new Date(Date.parse(`${endDate}T00:00:00.000Z`) - 6 * DAY_MS).toISOString().slice(0, 10);
  const pages = [];
  let totalSpend = 0;
  let totalResults = 0;
  let best = null;
  let worst = null;
  for (const page of state.pages) {
    const client = state.clients.find(item => item.id === page.clientId);
    const boosts = [];
    let pageSpend = 0;
    let pageResults = 0;
    for (const campaign of page.campaigns) {
      for (const boost of campaign.boosts) {
        const entries = (boost.resultsLog ?? []).filter(entry => entry.date >= startDate && entry.date <= endDate);
        if (!entries.length) continue;
        const spend = entries.reduce((sum, entry) => sum + entry.spend, 0);
        const results = entries.reduce((sum, entry) => sum + entry.results, 0);
        const cpa = results > 0 ? spend / results : null;
        pageSpend += spend;
        pageResults += results;
        boosts.push({ boostId: boost.id, campaignName: campaign.name, purpose: boost.purpose || boost.goal || campaign.name, spend, results, cpa });
        if (cpa !== null) {
          if (!best || cpa < best.cpa) best = { boostId: boost.id, pageName: page.pageName, purpose: boost.purpose || boost.goal || campaign.name, cpa };
          if (!worst || cpa > worst.cpa) worst = { boostId: boost.id, pageName: page.pageName, purpose: boost.purpose || boost.goal || campaign.name, cpa };
        }
      }
    }
    if (!boosts.length) continue;
    totalSpend += pageSpend;
    totalResults += pageResults;
    pages.push({ pageId: page.id, pageName: page.pageName, clientName: client?.name ?? '', spend: pageSpend, results: pageResults, cpa: pageResults > 0 ? pageSpend / pageResults : null, boosts });
  }
  return {
    startDate,
    endDate,
    totals: { spend: totalSpend, results: totalResults, cpa: totalResults > 0 ? totalSpend / totalResults : null },
    pages,
    best,
    worst
  };
}
