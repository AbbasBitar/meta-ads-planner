import { calculateBudget, generateChatGPTPrompt, validateCampaign } from './src/intake.js';
import { calculateEndDate, COUNTDOWN_REFRESH_MS, createTrackerState, DAY_MS, ENDING_SOON_MS, exportTracker, filterBoosts, findBoost, formatSaveFailure, importTracker, isoToLocalInput, loadTracker, localInputToIso, MAX_BACKUP_BYTES, removeBoost, replaceTracker, scheduleStatus, STORAGE_KEY, upsertTrackedBoost } from './src/tracker.js';

const form = document.querySelector('#campaign-form');
const errors = document.querySelector('#form-errors');
const promptPanel = document.querySelector('#prompt-panel');
const promptOutput = document.querySelector('#generated-prompt');
const copyStatus = document.querySelector('#copy-status');
const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

function getFormData() {
  const data = Object.fromEntries(new FormData(form).entries());
  data.minAge = Number(data.minAge);
  data.maxAge = Number(data.maxAge);
  data.budget = Number(data.budget);
  data.duration = Number(data.duration);
  return data;
}

function updateBudget() {
  const data = getFormData();
  const total = document.querySelector('#total-budget');
  const daily = document.querySelector('#daily-budget');
  if (!Number.isFinite(data.budget) || data.budget <= 0) {
    total.textContent = '-';
    daily.textContent = 'Enter a budget and duration';
    return;
  }
  total.textContent = money.format(data.budget);
  if (!Number.isInteger(data.duration) || data.duration < 1) {
    daily.textContent = 'Enter a campaign duration';
    return;
  }
  daily.textContent = `${money.format(calculateBudget(data).daily)} per day`;
}

function showErrors(messages) {
  errors.replaceChildren();
  if (!messages.length) {
    errors.hidden = true;
    return;
  }
  const list = document.createElement('ul');
  for (const message of messages) {
    const item = document.createElement('li');
    item.textContent = typeof message === 'string' ? message : message?.message ?? 'Please check this field.';
    list.append(item);
  }
  errors.append(list);
  errors.hidden = false;
}

form.addEventListener('input', updateBudget);
form.addEventListener('change', updateBudget);
form.addEventListener('submit', event => {
  event.preventDefault();
  const data = getFormData();
  const problems = validateCampaign(data);
  showErrors(problems);
  if (problems.length) {
    form.querySelector(`[name="${problems[0].field}"]`)?.focus();
    return;
  }
  promptOutput.value = generateChatGPTPrompt(data);
  promptPanel.hidden = false;
  copyStatus.textContent = '';
  promptPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
});

document.querySelector('#copy-prompt').addEventListener('click', async event => {
  try {
    await navigator.clipboard.writeText(promptOutput.value);
    copyStatus.textContent = 'Prompt copied. Paste it into ChatGPT when ready.';
  } catch {
    promptOutput.focus();
    promptOutput.select();
    copyStatus.textContent = 'Clipboard access is unavailable. The prompt is selected; copy it with Ctrl+C or Command+C.';
  }
  event.currentTarget.focus();
});

function initTracker() {
  const root = document.querySelector('#tracker');
  if (!root) return;
  const editor = document.querySelector('#tracker-editor');
  const groups = document.querySelector('#tracker-groups');
  const message = document.querySelector('#tracker-message');
  const pageFilter = document.querySelector('#tracker-page');
  const pageNames = document.querySelector('#tracker-pages');
  const damagedDownload = document.querySelector('#tracker-download-corrupt');
  let storage;
  let state;
  let storageError = null;
  let damagedRaw = null;
  try {
    storage = window.localStorage;
    state = loadTracker(storage);
  } catch (error) {
    storageError = error;
    state = createTrackerState();
    try { damagedRaw = storage?.getItem(STORAGE_KEY) ?? null; } catch { /* retain the storage error for recovery instructions */ }
  }
  let clock = Date.now();
  const formatDate = value => new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
  const showMessage = value => { message.textContent = value; };
  const cloneState = () => structuredClone(state);
  const reportSaveFailure = error => showMessage(formatSaveFailure(error));
  const commit = (next, success, allowRecovery = false) => {
    if (storageError && !allowRecovery) {
      showMessage(`${storageError.message} Restore a valid backup before making tracker changes.`);
      return false;
    }
    try {
      state = replaceTracker(storage, next);
      storageError = null;
      damagedRaw = null;
      damagedDownload.hidden = true;
      render();
      showMessage(success);
      return true;
    } catch (error) { reportSaveFailure(error); return false; }
  };
  let editorContext = {};
  const setForm = (name, value) => { const field = editor.elements.namedItem(name); if (field) field.value = value ?? ''; };
  const resetEditor = () => { editor.reset(); setForm('boostId', ''); editorContext = {}; editor.hidden = true; };
  const recalc = () => {
    const start = editor.elements.namedItem('startLocal').value;
    const duration = Number(editor.elements.namedItem('durationDays').value);
    try { editor.elements.namedItem('endLocal').value = isoToLocalInput(calculateEndDate(localInputToIso(start), duration)); }
    catch { editor.elements.namedItem('endLocal').value = ''; }
  };
  const openEditor = (data = {}) => {
    editor.reset();
    editorContext = { pageUrl: data.pageUrl, postUrl: data.postUrl, campaignId: data.campaignId };
    for (const [key, value] of Object.entries(data)) setForm(key, value);
    const nowLocal = isoToLocalInput(new Date().toISOString());
    if (!data.boostId && !data.createdLocal) setForm('createdLocal', nowLocal);
    if (!data.startLocal) setForm('startLocal', nowLocal);
    editor.hidden = false; recalc(); editor.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };
  const makeButton = (label, action) => {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'button button-secondary'; button.textContent = label; button.addEventListener('click', action); return button;
  };
  function render() {
    clock = Date.now();
    const selected = pageFilter.value;
    pageFilter.replaceChildren(Object.assign(document.createElement('option'), { value: '', textContent: 'All pages' }));
    pageNames.replaceChildren();
    const knownNames = new Set();
    for (const page of state.pages) {
      const key = page.pageName.trim().toLocaleLowerCase();
      if (knownNames.has(key)) continue;
      knownNames.add(key);
      const option = document.createElement('option'); option.value = page.pageName; pageNames.append(option);
    }
    for (const page of state.pages) {
      const client = state.clients.find(item => item.id === page.clientId);
      const option = document.createElement('option'); option.value = page.pageUrl; option.textContent = `${client?.name ?? 'Client'} — ${page.pageName}`; pageFilter.append(option);
    }
    pageFilter.value = selected;
    const filtered = filterBoosts(state, { query: document.querySelector('#tracker-search').value, pageUrl: pageFilter.value, status: document.querySelector('#tracker-status').value, ending: document.querySelector('#tracker-ending').value, now: clock });
    groups.replaceChildren();
    for (const page of filtered) {
      const section = document.createElement('section'); section.className = 'tracker-page-group';
      const heading = document.createElement('h3'); heading.textContent = page.clientName === 'Tracked pages' ? page.pageName : `${page.clientName} · ${page.pageName}`; section.append(heading);
      let planned = 0;
      for (const campaign of page.campaigns) {
        const campaignSection = document.createElement('div'); campaignSection.className = 'tracker-campaign';
        const campaignHeading = document.createElement('div'); campaignHeading.className = 'campaign-heading';
        const campaignInfo = document.createElement('div'); campaignInfo.className = 'campaign-heading-copy';
        const campaignTitle = document.createElement('h4'); campaignTitle.textContent = campaign.name; campaignInfo.append(campaignTitle);
        if (campaign.goal) { const goal = document.createElement('span'); goal.className = 'campaign-goal'; goal.textContent = campaign.goal; campaignInfo.append(goal); }
        const addBoost = makeButton('Add boost', () => openEditor({ pageName: page.pageName, pageUrl: page.pageUrl, campaignId: campaign.id, purpose: campaign.name, desiredAction: '' }));
        addBoost.className = 'button button-secondary campaign-add-button';
        campaignHeading.append(campaignInfo, addBoost);
        campaignSection.append(campaignHeading);
        for (const boost of campaign.boosts) {
          if (!boost.archived) planned += Number(boost.budget);
          const start = Date.parse(boost.startAt), end = Date.parse(boost.endAt), status = scheduleStatus(boost, clock);
          const duration = Number(boost.durationDays) * DAY_MS;
          const progress = Math.max(0, Math.min(100, ((clock - start) / duration) * 100));
          const remaining = end - clock;
          const card = document.createElement('article'); card.className = 'boost-card';
          const detail = document.createElement('p'); detail.textContent = `${money.format(boost.budget)} · ${boost.durationDays} days · ${status} (scheduled)${boost.archived ? ' · Archived' : ''}`; card.append(detail);
          const purpose = document.createElement('p');
          purpose.textContent = `Purpose: ${boost.purpose || boost.goal || 'Not specified'} · Action: ${boost.desiredAction || 'Not recorded'}`;
          card.append(purpose);
          const dates = document.createElement('p');
          dates.textContent = `Created ${boost.createdAt ? formatDate(boost.createdAt) : 'not recorded'} · Starts ${formatDate(boost.startAt)} · Ends ${formatDate(boost.endAt)}`;
          card.append(dates);
          if (boost.postUrl) { const post = document.createElement('a'); post.textContent = 'View post'; post.href = boost.postUrl; post.target = '_blank'; post.rel = 'noopener noreferrer'; card.append(post); }
          const bar = document.createElement('div'); bar.className = 'progress-track'; const fill = document.createElement('span'); fill.style.width = `${progress}%`; bar.append(fill); card.append(bar);
          const countdown = document.createElement('p');
          if (status === 'Scheduled') countdown.textContent = `Starts in ${formatCountdown(start - clock)}`;
          else if (status === 'Active') countdown.textContent = `Ends in ${formatCountdown(remaining)}${remaining <= ENDING_SOON_MS ? ' · Ending soon' : ''}`;
          else countdown.textContent = status === 'Completed' ? 'Schedule completed' : `Countdown paused (${status})`;
          countdown.className = remaining > 0 && remaining <= ENDING_SOON_MS && status === 'Active' ? 'ending-soon' : ''; card.append(countdown);
          const actions = document.createElement('div'); actions.className = 'boost-actions';
          actions.append(makeButton('Edit', () => editBoost(page, campaign, boost)));
          actions.append(makeButton(boost.archived ? 'Restore' : 'Archive', () => {
            const next = cloneState(); findBoost(next, boost.id).boost.archived = !boost.archived;
            commit(next, boost.archived ? 'Boost restored.' : 'Boost archived.');
          }));
          actions.append(makeButton('Delete', () => {
            if (!window.confirm('Delete this boost?')) return;
            const next = cloneState(); removeBoost(next, boost.id); commit(next, 'Boost deleted.');
          }));
          card.append(actions); campaignSection.append(card);
        }
        section.append(campaignSection);
      }
      const total = document.createElement('p'); total.className = 'planned-total'; total.textContent = `Planned budget total: ${money.format(planned)}`; section.append(total); groups.append(section);
    }
    if (!groups.childElementCount) {
      const hasRecords = state.pages.length > 0;
      const empty = document.createElement('div'); empty.className = 'tracker-empty';
      const symbol = document.createElement('div'); symbol.className = 'tracker-empty-icon'; symbol.textContent = hasRecords ? '⌕' : '＋'; symbol.setAttribute('aria-hidden', 'true');
      const heading = document.createElement('h3'); heading.textContent = hasRecords ? 'No matching campaigns' : 'Your campaign workspace is ready';
      const description = document.createElement('p'); description.textContent = hasRecords ? 'Try changing your search or filters to find a saved campaign.' : 'Start by adding a campaign. Keep track of budgets, planned dates, and boosts for each client and page.';
      empty.append(symbol, heading, description);
      if (hasRecords) {
        const clear = makeButton('Clear filters', () => {
          document.querySelector('#tracker-search').value = '';
          document.querySelector('#tracker-status').value = '';
          document.querySelector('#tracker-ending').value = '';
          pageFilter.value = '';
          render();
        });
        empty.append(clear);
      } else {
        const add = makeButton('+ Add your first campaign', () => openEditor());
        add.className = 'button button-primary';
        empty.append(add);
      }
      groups.append(empty);
    }
  }
  function editBoost(page, campaign, boost) {
    openEditor({
      boostId: boost.id, campaignId: campaign.id, pageName: page.pageName, pageUrl: page.pageUrl,
      createdLocal: boost.createdAt ? isoToLocalInput(boost.createdAt) : '',
      startLocal: isoToLocalInput(boost.startAt), durationDays: boost.durationDays,
      budget: boost.budget, purpose: boost.purpose || boost.goal || campaign.name,
      desiredAction: boost.desiredAction || ''
    });
  }
  function formatCountdown(ms) { const hours = Math.max(0, Math.floor(ms / 3600000)); const days = Math.floor(hours / 24); return days ? `${days}d ${hours % 24}h` : `${hours}h`; }

  document.querySelector('#tracker-add')?.addEventListener('click', () => openEditor());
  document.querySelector('#track-campaign').addEventListener('click', () => {
    const data = getFormData(); const problems = validateCampaign(data); showErrors(problems);
    if (problems.length) { form.querySelector(`[name="${problems[0].field}"]`)?.focus(); return; }
    const actionByGoal = { 'More messages': 'Message you', 'More profile visits': 'Visit your profile', 'More website visits': 'Visit your website' };
    openEditor({ pageName: data.pageName, pageUrl: data.pageUrl, postUrl: data.postUrl,
      purpose: String(data.products || '').slice(0, 160), desiredAction: actionByGoal[data.adGoal] || '',
      budget: data.budget, durationDays: data.duration });
  });
  editor.elements.namedItem('startLocal').addEventListener('input', recalc);
  editor.elements.namedItem('durationDays').addEventListener('input', recalc);
  editor.addEventListener('submit', event => {
    event.preventDefault();
    try {
      const data = Object.fromEntries(new FormData(editor).entries());
      const next = cloneState();
      upsertTrackedBoost(next, {
        pageName: data.pageName,
        createdAt: localInputToIso(data.createdLocal),
        startAt: localInputToIso(data.startLocal),
        durationDays: Number(data.durationDays),
        budget: Number(data.budget),
        purpose: data.purpose,
        desiredAction: data.desiredAction
      }, data.boostId || null, editorContext);
      if (commit(next, 'Campaign boost saved. Its schedule is planned and does not confirm Meta delivery.')) resetEditor();
    } catch (error) { showMessage(`Could not save changes: ${error.message}. No changes were applied. Check the page name, dates, purpose, desired action, and browser storage, then retry.`); }
  });
  document.querySelector('#tracker-cancel-edit').addEventListener('click', resetEditor);
  for (const selector of ['#tracker-search', '#tracker-page', '#tracker-status', '#tracker-ending']) document.querySelector(selector).addEventListener('input', render);
  document.querySelector('#tracker-export').addEventListener('click', () => {
    const blob = new Blob([exportTracker(state)], { type: 'application/json' }); const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = 'meta-ads-planner-tracker.json'; link.click(); URL.revokeObjectURL(link.href);
  });
  damagedDownload.hidden = !damagedRaw;
  damagedDownload.addEventListener('click', () => {
    if (!damagedRaw) return;
    const blob = new Blob([damagedRaw], { type: 'application/json' }); const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = 'meta-ads-planner-corrupted-tracker.json'; link.click(); URL.revokeObjectURL(link.href);
  });
  document.querySelector('#tracker-import').addEventListener('change', async event => {
    const file = event.currentTarget.files?.[0]; if (!file) return;
    try {
      if (file.size > MAX_BACKUP_BYTES) throw new Error('Backup is too large to restore (maximum 1 MB).');
      const imported = importTracker(await file.text());
      if (commit(imported, 'Backup restored.', true)) resetEditor();
    } catch (error) { showMessage(`Could not restore backup: ${error.message}. Existing saved data was left unchanged.`); }
    event.currentTarget.value = '';
  });
  if (storageError) showMessage(`${storageError.message} Existing stored data has not been changed; download it or restore a valid backup.`);
  render();
  const refreshTimer = window.setInterval(render, COUNTDOWN_REFRESH_MS);
  window.addEventListener('pagehide', () => window.clearInterval(refreshTimer), { once: true });
}
updateBudget();
initTracker();
