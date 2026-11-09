export const STORAGE_KEY = 'meta-ads-planner.tracker.v1';
export const DAY_MS = 86400000;
export const BOOST_STATUSES = Object.freeze(['Scheduled', 'Active', 'Completed', 'Paused', 'Cancelled']);

export function parseInstant(value) {
  const time = typeof value === 'number' ? value : Date.parse(value);
  if (!Number.isFinite(time)) throw new Error('Invalid timestamp.');
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
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

export function scheduleStatus(boost, now = Date.now()) {
  if (boost.status === 'Paused' || boost.status === 'Cancelled') return boost.status;
  const start = parseInstant(boost.startAt);
  const end = parseInstant(boost.endAt);
  if (now < start) return 'Scheduled';
  if (now < end) return 'Active';
  return 'Completed';
}

export function createTrackerState() { return { version: 1, pages: [] }; }

export function validateState(state) {
  if (!state || state.version !== 1 || !Array.isArray(state.pages)) throw new Error('Backup data has an unsupported format.');
  const pageIds = new Set();
  const pageKeys = new Set();
  for (const page of state.pages) {
    if (!page || typeof page.id !== 'string' || typeof page.clientName !== 'string' || typeof page.pageName !== 'string' || typeof page.pageUrl !== 'string' || !Array.isArray(page.boosts)) throw new Error('Backup contains an invalid page.');
    if (pageIds.has(page.id)) throw new Error('Backup contains duplicate page records.');
    pageIds.add(page.id);
    const pageKey = page.pageUrl.trim().toLocaleLowerCase().replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '');
    if (pageKeys.has(pageKey)) throw new Error('Backup contains duplicate page records.');
    pageKeys.add(pageKey);
    const boostIds = new Set();
    for (const boost of page.boosts) {
      if (!boost || typeof boost.id !== 'string' || boostIds.has(boost.id)) throw new Error('Backup contains an invalid boost.');
      boostIds.add(boost.id);
      if (!Number.isFinite(Number(boost.budget)) || Number(boost.budget) <= 0 || !Number.isInteger(Number(boost.durationDays)) || Number(boost.durationDays) < 1) throw new Error('Backup contains an invalid budget or duration.');
      if (!BOOST_STATUSES.includes(boost.status)) throw new Error('Backup contains an invalid boost status.');
      if (!isSafePostUrl(String(boost.postUrl ?? ''))) throw new Error('Backup contains an unsafe post URL.');
      const expected = calculateEndDate(boost.startAt, boost.durationDays);
      if (parseInstant(boost.endAt) !== parseInstant(expected)) throw new Error('Backup contains an invalid end date.');
    }
  }
  return state;
}

export function loadTracker(storage) {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    return raw ? validateState(JSON.parse(raw)) : createTrackerState();
  } catch {
    return createTrackerState();
  }
}

export function saveTracker(storage, state) {
  validateState(state);
  storage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function importTracker(json) { return validateState(JSON.parse(json)); }
export function exportTracker(state) { validateState(state); return JSON.stringify(state, null, 2); }

function uid() { return globalThis.crypto?.randomUUID?.() ?? `r${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`; }

export function upsertBoost(state, input, boostId = null) {
  const clientName = String(input.clientName ?? '').trim();
  const pageName = String(input.pageName ?? '').trim();
  const pageUrl = String(input.pageUrl ?? '').trim();
  if (!clientName || !pageName || !pageUrl) throw new Error('Client, page name, and page handle or URL are required.');
  const budget = Number(input.budget);
  const durationDays = Number(input.durationDays);
  if (!Number.isFinite(budget) || budget <= 0) throw new Error('Budget must be greater than zero.');
  if (!Number.isInteger(durationDays) || durationDays < 1) throw new Error('Duration must be a positive whole number of days.');
  const postUrl = String(input.postUrl ?? '').trim();
  if (!isSafePostUrl(postUrl)) throw new Error('Post URL must be a valid HTTPS Instagram or Facebook URL.');
  const startAt = new Date(parseInstant(input.startAt)).toISOString();
  const endAt = calculateEndDate(startAt, durationDays);
  const pageKey = pageUrl.toLocaleLowerCase().replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '');
  const existingPage = boostId ? state.pages.find(p => p.boosts.some(b => b.id === boostId)) : null;
  if (existingPage && existingPage.pageUrl.toLocaleLowerCase().replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '') !== pageKey) throw new Error('A boost cannot be moved to another page.');
  let page = existingPage ?? state.pages.find(item => item.pageUrl.toLocaleLowerCase().replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '') === pageKey);
  if (!page) {
    page = { id: uid(), clientName, pageName, pageUrl, boosts: [] };
    state.pages.push(page);
  }
  const previous = boostId ? page.boosts.find(item => item.id === boostId) : null;
  if (previous) { page.clientName = clientName; page.pageName = pageName; }
  const boost = { ...(previous ?? {}), id: previous?.id ?? uid(), postUrl, goal: String(input.goal ?? '').trim(), budget, durationDays, startAt, endAt, status: input.status ?? previous?.status ?? 'Scheduled', archived: input.archived ?? previous?.archived ?? false };
  if (!BOOST_STATUSES.includes(boost.status)) throw new Error('Choose a valid boost status.');
  if (previous) Object.assign(previous, boost); else page.boosts.push(boost);
  return boost;
}

export function removeBoost(state, boostId) {
  const page = state.pages.find(item => item.boosts.some(boost => boost.id === boostId));
  if (!page) return false;
  page.boosts = page.boosts.filter(boost => boost.id !== boostId);
  if (!page.boosts.length) state.pages = state.pages.filter(item => item !== page);
  return true;
}

export function findBoost(state, boostId) {
  for (const page of state.pages) { const boost = page.boosts.find(item => item.id === boostId); if (boost) return { page, boost }; }
  return null;
}

export function filterBoosts(state, { query = '', pageUrl = '', status = '', ending = '', now = Date.now() } = {}) {
  const needle = query.trim().toLocaleLowerCase();
  return state.pages.map(page => ({ ...page, boosts: page.boosts.filter(boost => {
    if (pageUrl && page.pageUrl !== pageUrl) return false;
    if (status && scheduleStatus(boost, now) !== status) return false;
    if (ending === 'soon' && (parseInstant(boost.endAt) < now || parseInstant(boost.endAt) > now + 3 * DAY_MS)) return false;
    if (needle && ![page.clientName, page.pageName, page.pageUrl, boost.postUrl, boost.goal].join(' ').toLocaleLowerCase().includes(needle)) return false;
    return true;
  }) })).filter(page => page.boosts.length);
}
