export const STORAGE_KEY = 'meta-ads-planner.tracker.v1';
export const DAY_MS = 86400000;
export const ENDING_SOON_MS = DAY_MS;
export const MAX_BACKUP_BYTES = 1_000_000;
export const COUNTDOWN_REFRESH_MS = 30000;
export const BOOST_STATUSES = Object.freeze(['Scheduled', 'Active', 'Completed', 'Paused', 'Cancelled']);

function record(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function onlyKeys(value, allowed, label) {
  if (Object.keys(value).some(key => !allowed.includes(key))) throw new Error(`Backup contains an unexpected ${label} field.`);
}
function boundedString(value, label, max = 500, required = true) {
  if (typeof value !== 'string' || value.length > max || (required && !value.trim())) throw new Error(`Backup contains an invalid ${label}.`);
  return value;
}
function pageKey(value) { return value.trim().toLocaleLowerCase().replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, ''); }

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
        onlyKeys(boost, ['id', 'postUrl', 'goal', 'budget', 'durationDays', 'startAt', 'endAt', 'status', 'archived'], 'boost');
        addId(boost.id, 'boost');
        if (typeof boost.budget !== 'number' || !Number.isFinite(boost.budget) || boost.budget <= 0 || !Number.isInteger(boost.durationDays) || boost.durationDays < 1) throw new Error('Backup contains an invalid budget or duration.');
        if (!BOOST_STATUSES.includes(boost.status) || typeof boost.archived !== 'boolean') throw new Error('Backup contains an invalid boost status.');
        boundedString(boost.postUrl, 'post URL', 500, false);
        if (!isSafePostUrl(boost.postUrl)) throw new Error('Backup contains an unsafe post URL.');
        boundedString(boost.goal, 'boost goal', 160, false);
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
  let campaign = existingCampaign ?? (input.campaignId ? page?.campaigns.find(c => c.id === input.campaignId) : null);
  if (input.campaignId && !campaign) throw new Error('Selected campaign no longer exists.');
  if (boostId && input.campaignId && existingCampaign?.id !== input.campaignId) throw new Error('A boost cannot be moved to another campaign.');
  const status = input.status ?? 'Scheduled';
  if (!BOOST_STATUSES.includes(status)) throw new Error('Choose a valid boost status.');
  if (!client) { client = { id: uid(), name: clientName }; state.clients.push(client); }
  if (!page) { page = { id: uid(), clientId: client.id, pageName, pageUrl, campaigns: [] }; state.pages.push(page); }
  if (!campaign) { campaign = { id: uid(), name: campaignName, goal, boosts: [] }; page.campaigns.push(campaign); }
  const previous = boostId ? campaign.boosts.find(item => item.id === boostId) : null;
  const boost = { ...(previous ?? {}), id: previous?.id ?? uid(), postUrl, goal, budget, durationDays, startAt, endAt, status: input.status ?? previous?.status ?? 'Scheduled', archived: input.archived ?? previous?.archived ?? false };
  if (previous) Object.assign(previous, boost); else campaign.boosts.push(boost);
  if (existingCampaign) { existingCampaign.name = campaignName; existingCampaign.goal = goal; }
  return boost;
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

export function filterBoosts(state, { query = '', pageUrl = '', status = '', ending = '', now = Date.now() } = {}) {
  const needle = query.trim().toLocaleLowerCase();
  const terms = needle ? needle.split(/\s+/) : [];
  return state.pages.map(page => {
    const client = state.clients.find(item => item.id === page.clientId);
    const campaigns = page.campaigns.map(campaign => ({ ...campaign, boosts: campaign.boosts.filter(boost => {
      if (pageUrl && page.pageUrl !== pageUrl) return false;
      if (status && scheduleStatus(boost, now) !== status) return false;
      if (ending === 'soon' && (parseInstant(boost.endAt) <= now || parseInstant(boost.endAt) > now + ENDING_SOON_MS)) return false;
      const searchable = [client?.name, page.pageName, page.pageUrl, campaign.name, campaign.goal, boost.postUrl, boost.goal].join(' ').toLocaleLowerCase();
      if (terms.some(term => !searchable.includes(term))) return false;
      return true;
    }) })).filter(campaign => campaign.boosts.length);
    return { ...page, clientName: client?.name ?? '', campaigns };
  }).filter(page => page.campaigns.length);
}
