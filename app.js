import { calculateBudget, generateChatGPTPrompt, validateCampaign } from './src/intake.js';
import { calculateEndDate, COUNTDOWN_REFRESH_MS, createTrackerState, DAY_MS, ENDING_SOON_MS, exportTracker, filterBoosts, findBoost, formatSaveFailure, importTracker, isoToLocalInput, loadTracker, localInputToIso, MAX_BACKUP_BYTES, mergeTrackerStates, pageKey, removeBoost, replaceTracker, scheduleStatus, STORAGE_KEY, trackerCounts, upsertTrackedBoost } from './src/tracker.js?v=tracker-dashboard-v8';

const form = document.querySelector('#campaign-form');
const errors = document.querySelector('#form-errors');
const promptPanel = document.querySelector('#prompt-panel');
const promptHeading = document.querySelector('#prompt-heading');
const promptOutput = document.querySelector('#generated-prompt');
const promptBadge = document.querySelector('#prompt-badge');
const promptStale = document.querySelector('#prompt-stale');
const promptStaleMessage = document.querySelector('#prompt-stale-message');
const copyStatus = document.querySelector('#copy-status');
const copyPromptButton = document.querySelector('#copy-prompt');
const copyOpenButton = document.querySelector('#copy-open-chatgpt');
const regenerateButton = document.querySelector('#regenerate-prompt');
const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

const fieldErrorNodes = new Map();
const summaryItems = new Map();
let activeProblems = [];
let promptSignature = null;
let promptIsStale = false;

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

function fieldControls(field) {
  return Array.from(form.querySelectorAll(`[name="${field}"]`));
}

function focusField(field) {
  const control = fieldControls(field)[0];
  if (!control) return;
  control.focus();
  control.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
}

function getFieldError(field) {
  const existing = fieldErrorNodes.get(field);
  if (existing) return existing;
  const controls = fieldControls(field);
  if (!controls.length) return null;
  const fieldset = controls[0].closest?.('fieldset');
  const container = fieldset ?? controls[0].closest?.('label, fieldset') ?? controls[0].parentElement;
  if (!container) return null;
  const node = document.createElement('span');
  node.className = 'field-error';
  node.id = `field-error-${field}`;
  node.hidden = true;
  container.append(node);
  const entry = { controls, node, errorId: node.id };
  fieldErrorNodes.set(field, entry);
  return entry;
}

function clearFieldPresentation(entry) {
  entry.node.hidden = true;
  entry.node.textContent = '';
  for (const control of entry.controls) {
    control.removeAttribute('aria-invalid');
    const describedBy = (control.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(id => id && id !== entry.errorId);
    if (describedBy.length) control.setAttribute('aria-describedby', describedBy.join(' '));
    else control.removeAttribute('aria-describedby');
  }
}

function renderErrorSummary() {
  errors.replaceChildren();
  summaryItems.clear();
  if (!activeProblems.length) {
    errors.hidden = true;
    return;
  }
  const list = document.createElement('ul');
  for (const problem of activeProblems) {
    const item = document.createElement('li');
    if (problem.field) {
      const control = fieldControls(problem.field)[0];
      const link = document.createElement('a');
      if (control) {
        if (!control.id) control.id = `field-${problem.field}`;
        link.href = `#${control.id}`;
      }
      link.textContent = problem.message;
      link.addEventListener('click', event => {
        event.preventDefault();
        focusField(problem.field);
      });
      item.append(link);
      const items = summaryItems.get(problem.field) ?? [];
      items.push(item);
      summaryItems.set(problem.field, items);
    } else {
      item.textContent = problem.message;
    }
    list.append(item);
  }
  errors.append(list);
  errors.hidden = false;
}

function showErrors(messages) {
  for (const entry of fieldErrorNodes.values()) clearFieldPresentation(entry);
  activeProblems = messages.map(message => typeof message === 'string'
    ? { field: '', message }
    : { field: message?.field ?? '', message: message?.message ?? 'Please check this field.' });
  for (const problem of activeProblems) {
    if (!problem.field) continue;
    const entry = getFieldError(problem.field);
    if (!entry) continue;
    entry.node.textContent = problem.message;
    entry.node.hidden = false;
    for (const control of entry.controls) {
      control.setAttribute('aria-invalid', 'true');
      const describedBy = (control.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(Boolean);
      if (!describedBy.includes(entry.errorId)) describedBy.push(entry.errorId);
      control.setAttribute('aria-describedby', describedBy.join(' '));
    }
  }
  renderErrorSummary();
}

function clearFieldError(field) {
  const entry = fieldErrorNodes.get(field);
  if (entry) clearFieldPresentation(entry);
  const items = summaryItems.get(field) ?? [];
  for (const item of items) item.hidden = true;
  summaryItems.delete(field);
  const remaining = activeProblems.filter(problem => problem.field !== field);
  if (remaining.length === activeProblems.length) return;
  activeProblems = remaining;
  if (!activeProblems.length) errors.hidden = true;
}

function promptDataSignature() {
  return JSON.stringify(getFormData());
}

function setPromptStale(isStale) {
  if (isStale === promptIsStale) return;
  promptIsStale = isStale;
  promptStale.hidden = !isStale;
  promptBadge.textContent = isStale ? 'Out of date' : 'Generated';
  promptBadge.className = isStale ? 'ready-badge is-stale' : 'ready-badge';
  copyPromptButton.disabled = isStale;
  copyOpenButton.disabled = isStale;
  if (isStale) promptStaleMessage.textContent = 'The brief changed after this prompt was generated. Regenerate it to include your latest edits before copying.';
  else promptStaleMessage.textContent = '';
}

function updatePromptFreshness() {
  if (promptPanel.hidden || promptSignature === null) return;
  setPromptStale(promptDataSignature() !== promptSignature);
}

function generatePrompt() {
  const data = getFormData();
  const problems = validateCampaign(data);
  showErrors(problems);
  if (problems.length) {
    focusField(problems[0].field);
    return false;
  }
  promptOutput.value = generateChatGPTPrompt(data);
  promptSignature = JSON.stringify(data);
  setPromptStale(false);
  promptPanel.hidden = false;
  copyStatus.textContent = '';
  promptHeading.focus({ preventScroll: true });
  promptPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  return true;
}

async function copyPrompt(button) {
  try {
    await navigator.clipboard.writeText(promptOutput.value);
    copyStatus.textContent = 'Prompt copied. Paste it into ChatGPT when ready.';
    button.focus();
    return true;
  } catch {
    promptOutput.focus();
    promptOutput.select();
    copyStatus.textContent = 'Clipboard access is unavailable. The prompt is selected; copy it with Ctrl+C or Command+C.';
    return false;
  }
}

function handleFormUpdate(event) {
  const field = event?.target?.name;
  if (field) clearFieldError(field);
  updateBudget();
  updatePromptFreshness();
}

form.addEventListener('input', handleFormUpdate);
form.addEventListener('change', handleFormUpdate);
form.addEventListener('submit', event => {
  event.preventDefault();
  generatePrompt();
});

copyPromptButton.addEventListener('click', event => {
  if (promptIsStale) return;
  return copyPrompt(event.currentTarget);
});

regenerateButton.addEventListener('click', generatePrompt);

copyOpenButton.addEventListener('click', async event => {
  if (promptIsStale) return;
  const button = event.currentTarget;
  let popup = null;
  try { popup = window.open('https://chatgpt.com/', '_blank'); } catch { popup = null; }
  if (popup) popup.opener = null;
  const copied = await copyPrompt(button);
  if (!copied) {
    if (popup) copyStatus.textContent = 'ChatGPT opened in a new tab, but clipboard access is unavailable. The prompt is selected; copy it with Ctrl+C or Command+C and paste it there.';
    return;
  }
  copyStatus.textContent = popup
    ? 'Prompt copied and ChatGPT opened in a new tab. Paste and submit it there.'
    : 'Prompt copied. Your browser blocked the new tab; use the Open ChatGPT link above.';
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
  const importReview = document.querySelector('#tracker-import-review');
  const importSummary = document.querySelector('#tracker-import-summary');
  const undoImport = document.querySelector('#tracker-undo-import');
  let storage;
  let state;
  let storageError = null;
  let damagedRaw = null;
  let pendingImport = null;
  let undoSnapshot = null;
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
  const setMessage = (value, tone = 'success') => {
    message.setAttribute('role', tone === 'error' ? 'alert' : 'status');
    message.className = `tracker-message tracker-message--${tone}`;
    message.textContent = value.replace(/\.{2,}/g, '.');
  };
  const cloneState = () => structuredClone(state);
  const reportSaveFailure = error => setMessage(formatSaveFailure(error), 'error');
  const setUndo = value => { undoSnapshot = value; undoImport.hidden = !value; };
  const closeImportReview = () => { pendingImport = null; importReview.hidden = true; importSummary.textContent = ''; };
  const commit = (next, success, allowRecovery = false, keepUndo = false) => {
    if (storageError && !allowRecovery) {
      setMessage(`${storageError.message} Restore a valid backup before making tracker changes.`, 'error');
      return false;
    }
    try {
      state = replaceTracker(storage, next);
      storageError = null;
      damagedRaw = null;
      damagedDownload.hidden = true;
      render();
      setMessage(success);
      if (!keepUndo) { setUndo(null); closeImportReview(); }
      return true;
    } catch (error) { reportSaveFailure(error); return false; }
  };
  let editorContext = {};
  let editorTrigger = null;
  const findByFocus = key => {
    if (!key) return null;
    for (const button of groups.querySelectorAll?.('.button') ?? []) if (button.dataset.focus === key) return button;
    return null;
  };
  const setForm = (name, value) => { const field = editor.elements.namedItem(name); if (field) field.value = value ?? ''; };
  const resetEditor = ({ restoreFocus = false } = {}) => {
    const trigger = editorTrigger;
    const triggerKey = trigger?.dataset?.focus ?? null;
    editor.reset();
    setForm('boostId', '');
    editorContext = {};
    editor.hidden = true;
    editorTrigger = null;
    if (!restoreFocus) return;
    const target = triggerKey ? findByFocus(triggerKey) : trigger;
    if (target && target.isConnected !== false) target.focus({ preventScroll: true });
    else document.querySelector('#tracker-add')?.focus({ preventScroll: true });
  };
  const recalc = () => {
    const start = editor.elements.namedItem('startLocal').value;
    const duration = Number(editor.elements.namedItem('durationDays').value);
    try { editor.elements.namedItem('endLocal').value = isoToLocalInput(calculateEndDate(localInputToIso(start), duration)); }
    catch { editor.elements.namedItem('endLocal').value = ''; }
  };
  const openEditor = (data = {}, trigger = null) => {
    editor.reset();
    setForm('boostId', '');
    editorContext = { pageUrl: data.pageUrl, postUrl: data.postUrl, campaignId: data.campaignId };
    for (const [key, value] of Object.entries(data)) setForm(key, value);
    const nowLocal = isoToLocalInput(new Date().toISOString());
    if (!data.boostId && !data.createdLocal) setForm('createdLocal', nowLocal);
    if (!data.startLocal) setForm('startLocal', nowLocal);
    editor.hidden = false;
    editorTrigger = trigger;
    recalc();
    editor.scrollIntoView({ behavior: 'smooth', block: 'center' });
    document.querySelector('#tracker-editor-title')?.focus({ preventScroll: true });
  };
  const makeButton = (label, action, focusKey = '') => {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'button button-secondary'; button.textContent = label; if (focusKey) button.dataset.focus = focusKey; button.addEventListener('click', action); return button;
  };
  function render() {
    const focusKey = document.activeElement?.dataset?.focus ?? null;
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
    const filtered = filterBoosts(state, { query: document.querySelector('#tracker-search').value, pageUrl: pageFilter.value, status: document.querySelector('#tracker-status').value, ending: document.querySelector('#tracker-ending').value, archived: document.querySelector('#tracker-archived').value || 'hide', now: clock });
    const visibleBoosts = filtered.flatMap(page => page.campaigns.flatMap(campaign => campaign.boosts));
    const visibleBudget = visibleBoosts.reduce((sum, boost) => sum + (!boost.archived && scheduleStatus(boost, clock) !== 'Cancelled' ? boost.budget : 0), 0);
    document.querySelector('#tracker-summary').textContent = `${visibleBoosts.length} visible boost${visibleBoosts.length === 1 ? '' : 's'} · Visible planned budget: ${money.format(visibleBudget)}`;
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
        const addBoost = makeButton('Add boost', event => openEditor({ pageName: page.pageName, pageUrl: page.pageUrl, campaignId: campaign.id, purpose: campaign.name, desiredAction: '' }, event.currentTarget), `add-boost:${campaign.id}`);
        addBoost.className = 'button button-secondary campaign-add-button';
        campaignHeading.append(campaignInfo, addBoost);
        campaignSection.append(campaignHeading);
        for (const boost of campaign.boosts) {
          const start = Date.parse(boost.startAt), end = Date.parse(boost.endAt), status = scheduleStatus(boost, clock);
          if (!boost.archived && status !== 'Cancelled') planned += Number(boost.budget);
          const duration = Number(boost.durationDays) * DAY_MS;
          const progress = Math.max(0, Math.min(100, ((clock - start) / duration) * 100));
          const remaining = end - clock;
          const card = document.createElement('article'); card.className = 'boost-card';
          const detail = document.createElement('p'); detail.textContent = `${money.format(boost.budget)} · ${boost.durationDays} days · ${status}${boost.archived ? ' · Archived' : ''}`; card.append(detail);
          const purpose = document.createElement('p');
          purpose.textContent = `Purpose: ${boost.purpose || boost.goal || 'Not specified'} · Action: ${boost.desiredAction || 'Not recorded'}`;
          card.append(purpose);
          const dates = document.createElement('p');
          dates.textContent = `Created ${boost.createdAt ? formatDate(boost.createdAt) : 'not recorded'} · Starts ${formatDate(boost.startAt)} · Ends ${formatDate(boost.endAt)}`;
          card.append(dates);
          if (boost.postUrl) { const post = document.createElement('a'); post.textContent = 'View post'; post.href = boost.postUrl; post.target = '_blank'; post.rel = 'noopener noreferrer'; card.append(post); }
          if (status !== 'Paused' && status !== 'Cancelled') {
            const bar = document.createElement('div'); bar.className = 'progress-track'; bar.setAttribute('role', 'progressbar'); bar.setAttribute('aria-valuenow', String(Math.round(progress))); bar.setAttribute('aria-valuemin', '0'); bar.setAttribute('aria-valuemax', '100'); bar.setAttribute('aria-label', `Schedule progress for ${campaign.name}`); const fill = document.createElement('span'); fill.style.width = `${progress}%`; bar.append(fill); card.append(bar);
          }
          const countdown = document.createElement('p');
          if (status === 'Scheduled') countdown.textContent = `Starts in ${formatCountdown(start - clock)}`;
          else if (status === 'Active') countdown.textContent = `Ends in ${formatCountdown(remaining)}${remaining <= ENDING_SOON_MS ? ' · Ending soon' : ''}`;
          else countdown.textContent = status === 'Completed' ? 'Schedule completed' : status === 'Cancelled' ? 'Schedule cancelled' : `Countdown paused (${status})`;
          countdown.className = remaining > 0 && remaining <= ENDING_SOON_MS && status === 'Active' ? 'ending-soon' : ''; card.append(countdown);
          const actions = document.createElement('div'); actions.className = 'boost-actions';
          actions.append(makeButton('Edit', event => editBoost(page, campaign, boost, event.currentTarget), `edit:${boost.id}`));
          actions.append(makeButton(boost.archived ? 'Restore' : 'Archive', () => {
            const next = cloneState(); findBoost(next, boost.id).boost.archived = !boost.archived;
            commit(next, boost.archived ? 'Boost restored.' : 'Boost archived.');
          }, `archive:${boost.id}`));
          actions.append(makeButton('Delete', () => {
            if (!window.confirm('Delete this boost?')) return;
            const next = cloneState(); removeBoost(next, boost.id); commit(next, 'Boost deleted.');
          }, `delete:${boost.id}`));
          card.append(actions); campaignSection.append(card);
        }
        section.append(campaignSection);
      }
      const total = document.createElement('p'); total.className = 'planned-total'; total.textContent = `Visible planned budget: ${money.format(planned)}`; section.append(total); groups.append(section);
    }
    if (!groups.childElementCount) {
      const hasRecords = state.pages.length > 0;
      const empty = document.createElement('div'); empty.className = 'tracker-empty';
      const symbol = document.createElement('div'); symbol.className = 'tracker-empty-icon'; symbol.textContent = hasRecords ? '⌕' : '＋'; symbol.setAttribute('aria-hidden', 'true');
      const heading = document.createElement('h3'); heading.textContent = hasRecords ? 'No matching campaigns' : 'Your campaign workspace is ready';
      const description = document.createElement('p'); description.textContent = hasRecords ? 'Try changing your search or filters to find a saved campaign.' : 'Start by adding a campaign. Keep track of budgets, planned dates, and boosts for each client and page.';
      empty.append(symbol, heading, description);
      if (hasRecords) {
        const clear = makeButton('Clear filters', clearFilters);
        empty.append(clear);
        if (state.pages.some(page => page.campaigns.some(campaign => campaign.boosts.some(boost => boost.archived)))) {
          empty.append(makeButton('Show archived', () => { document.querySelector('#tracker-archived').value = 'all'; render(); }));
        }
      } else {
        const add = makeButton('+ Add your first campaign', event => openEditor({}, event.currentTarget), 'add-first');
        add.className = 'button button-primary';
        empty.append(add);
      }
      groups.append(empty);
    }
    if (focusKey) {
      const target = findByFocus(focusKey);
      (target ?? document.querySelector('#tracker-heading'))?.focus({ preventScroll: true });
    }
  }
  function clearFilters() {
    document.querySelector('#tracker-search').value = '';
    document.querySelector('#tracker-status').value = '';
    document.querySelector('#tracker-ending').value = '';
    document.querySelector('#tracker-archived').value = 'hide';
    pageFilter.value = '';
    render();
  }
  function editBoost(page, campaign, boost, trigger) {
    openEditor({
      boostId: boost.id, campaignId: campaign.id, pageName: page.pageName, pageUrl: page.pageUrl,
      createdLocal: boost.createdAt ? isoToLocalInput(boost.createdAt) : '',
      startLocal: isoToLocalInput(boost.startAt), durationDays: boost.durationDays,
      budget: boost.budget, purpose: boost.purpose || boost.goal || campaign.name,
      desiredAction: boost.desiredAction || ''
    }, trigger);
  }
  function formatCountdown(ms) {
  ms = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(ms / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(ms / 3600);
  const days = Math.floor(hours / 24);
  return days ? `${days}d ${hours % 24}h` : `${hours}h`;
}

  document.querySelector('#tracker-add')?.addEventListener('click', event => openEditor({}, event.currentTarget));
  document.querySelector('#track-campaign').addEventListener('click', event => {
    const data = getFormData(); const problems = validateCampaign(data); showErrors(problems);
    if (problems.length) { focusField(problems[0].field); return; }
    const actionByGoal = { 'More messages': 'Message you', 'More profile visits': 'Visit your profile', 'More website visits': 'Visit your website' };
    const purpose = String(data.products || '').slice(0, 160);
    const existingPage = state.pages.find(page => pageKey(page.pageUrl) === pageKey(data.pageUrl));
    const existingCampaign = existingPage?.campaigns.find(campaign => campaign.name.trim().toLocaleLowerCase() === purpose.trim().toLocaleLowerCase());
    openEditor({
      pageName: existingPage?.pageName ?? data.pageName,
      pageUrl: existingPage?.pageUrl ?? data.pageUrl,
      postUrl: data.postUrl,
      campaignId: existingCampaign?.id ?? '',
      purpose,
      desiredAction: actionByGoal[data.adGoal] || '',
      budget: data.budget,
      durationDays: data.duration
    }, event.currentTarget);
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
      if (commit(next, 'Campaign boost saved. Its schedule is planned and does not confirm Meta delivery.')) resetEditor({ restoreFocus: true });
    } catch (error) { setMessage(`Could not save changes: ${error.message}. No changes were applied. Check the page name, dates, purpose, desired action, and browser storage, then retry.`, 'error'); }
  });
  document.querySelector('#tracker-cancel-edit').addEventListener('click', () => resetEditor({ restoreFocus: true }));
  for (const selector of ['#tracker-search', '#tracker-page', '#tracker-status', '#tracker-ending', '#tracker-archived']) document.querySelector(selector).addEventListener('input', render);
  document.querySelector('#tracker-clear-filters').addEventListener('click', clearFilters);
  document.querySelector('#tracker-export').addEventListener('click', () => {
    const blob = new Blob([exportTracker(state)], { type: 'application/json' }); const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = 'meta-ads-planner-tracker.json'; link.click(); URL.revokeObjectURL(link.href);
  });
  damagedDownload.hidden = !damagedRaw;
  damagedDownload.addEventListener('click', () => {
    if (!damagedRaw) return;
    const blob = new Blob([damagedRaw], { type: 'application/json' }); const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = 'meta-ads-planner-corrupted-tracker.json'; link.click(); URL.revokeObjectURL(link.href);
  });
  const formatCounts = ({ clients, pages, campaigns, boosts }) =>
    `${clients} client${clients === 1 ? '' : 's'}, ${pages} page${pages === 1 ? '' : 's'}, ${campaigns} campaign${campaigns === 1 ? '' : 's'}, and ${boosts} boost${boosts === 1 ? '' : 's'}`;
  const focusTrackerHeading = () => document.querySelector('#tracker-heading')?.focus({ preventScroll: true });
  const restoreImported = mode => {
    if (!pendingImport) return;
    const previous = cloneState();
    const before = trackerCounts(state);
    let next = pendingImport;
    let summary;
    if (mode === 'merge') {
      next = mergeTrackerStates(state, pendingImport);
      const added = trackerCounts(next).boosts - before.boosts;
      summary = `Backup merged: ${added} new boost${added === 1 ? '' : 's'} added. Existing records were kept.`;
    } else {
      const incoming = trackerCounts(pendingImport);
      summary = `Backup replaced all tracker data: ${formatCounts(incoming)} restored.`;
    }
    if (commit(next, `${summary} Undo is available until the next tracker change.`, true, true)) {
      setUndo(previous);
      closeImportReview();
      resetEditor();
      focusTrackerHeading();
    }
  };
  document.querySelector('#tracker-import-merge')?.addEventListener('click', () => restoreImported('merge'));
  document.querySelector('#tracker-import-replace')?.addEventListener('click', () => restoreImported('replace'));
  document.querySelector('#tracker-import-cancel')?.addEventListener('click', () => { closeImportReview(); focusTrackerHeading(); });
  undoImport?.addEventListener('click', () => {
    if (!undoSnapshot) return;
    const previous = undoSnapshot;
    if (commit(previous, 'Import undone. Previous tracker data restored.')) focusTrackerHeading();
  });
  document.querySelector('#tracker-import').addEventListener('change', async event => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file) return;
    try {
      if (file.size > MAX_BACKUP_BYTES) throw new Error('Backup is too large to restore (maximum 1 MB).');
      const imported = importTracker(await file.text());
      pendingImport = imported;
      importSummary.textContent = `This backup contains ${formatCounts(trackerCounts(imported))}. The tracker currently contains ${formatCounts(trackerCounts(state))}. Merge keeps existing records and adds new ones; replace deletes all current tracker data.`;
      importReview.hidden = false;
      importReview.scrollIntoView({ behavior: 'smooth', block: 'center' });
      importSummary.focus({ preventScroll: true });
    } catch (error) {
      closeImportReview();
      setMessage(`Could not restore backup: ${error.message}. Existing saved data was left unchanged.`, 'error');
    } finally { input.value = ''; }
  });
  const syncFromStorage = () => {
    let next;
    try {
      if (!storage) storage = window.localStorage;
      next = loadTracker(storage);
    } catch (error) {
      storageError = error;
      try { damagedRaw = storage?.getItem(STORAGE_KEY) ?? null; } catch { /* keep the original storage error */ }
      damagedDownload.hidden = !damagedRaw;
      setMessage(`${error.message} The tracker still shows the last valid data loaded in this tab.`, 'error');
      return;
    }
    state = next;
    storageError = null;
    damagedRaw = null;
    damagedDownload.hidden = true;
    setUndo(null);
    const editingId = editor.hidden ? '' : editor.elements.namedItem('boostId')?.value ?? '';
    render();
    if (editingId && !findBoost(state, editingId)) {
      resetEditor();
      setMessage('Campaign tracker updated in another tab. The boost you were editing was removed, so the editor was closed.', 'warning');
    } else {
      setMessage('Campaign tracker updated in another tab.');
    }
    if (pendingImport && !importReview.hidden) {
      importSummary.textContent = `This backup contains ${formatCounts(trackerCounts(pendingImport))}. The tracker currently contains ${formatCounts(trackerCounts(state))}. Merge keeps existing records and adds new ones; replace deletes all current tracker data.`;
    }
  };
  window.addEventListener('storage', event => {
    if (event.key !== STORAGE_KEY && event.key !== null) return;
    if (storage && event.storageArea && event.storageArea !== storage) return;
    syncFromStorage();
  });
  let refreshTimer = null;
  const stopRefreshTimer = () => {
    if (refreshTimer === null) return;
    window.clearInterval(refreshTimer);
    refreshTimer = null;
  };
  const startRefreshTimer = () => {
    stopRefreshTimer();
    refreshTimer = window.setInterval(render, COUNTDOWN_REFRESH_MS);
  };
  window.addEventListener('pagehide', stopRefreshTimer);
  window.addEventListener('pageshow', event => {
    if (!event.persisted) return;
    render();
    startRefreshTimer();
  });
  if (storageError) setMessage(`${storageError.message} Existing stored data has not been changed; download it or restore a valid backup.`, 'error');
  render();
  startRefreshTimer();
}
updateBudget();
initTracker();
