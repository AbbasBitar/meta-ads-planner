import { calculateBudget, generateChatGPTPrompt, validateCampaign } from './src/intake.js';
import { calculateEndDate, COUNTDOWN_REFRESH_MS, createTrackerState, DAY_MS, ENDING_SOON_MS, exportTracker, filterBoosts, findBoost, formatSaveFailure, importTracker, isoToLocalInput, loadTracker, localInputToIso, MAX_BACKUP_BYTES, mergeTrackerStates, pageKey, removeBoost, replaceTracker, scheduleStatus, STORAGE_KEY, trackerCounts, upsertBoost } from './src/tracker.js';

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
    item.textContent = message.message;
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
  const button = event.currentTarget;
  try {
    await navigator.clipboard.writeText(promptOutput.value);
    copyStatus.textContent = 'Prompt copied. Paste it into ChatGPT when ready.';
    button.focus();
  } catch {
    promptOutput.focus();
    promptOutput.select();
    copyStatus.textContent = 'Clipboard access is unavailable. The prompt is selected; copy it with Ctrl+C or Command+C.';
  }
});

function initTracker() {
  const root = document.querySelector('#tracker');
  if (!root) return;
  const editor = document.querySelector('#tracker-editor');
  const groups = document.querySelector('#tracker-groups');
  const message = document.querySelector('#tracker-message');
  const pageFilter = document.querySelector('#tracker-page');
  const clientList = document.querySelector('#tracker-clients');
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
  const showMessage = value => { message.textContent = value; };
  const cloneState = () => structuredClone(state);
  const reportSaveFailure = error => showMessage(formatSaveFailure(error));
  const setUndo = value => { undoSnapshot = value; undoImport.hidden = !value; };
  const commit = (next, success, allowRecovery = false, keepUndo = false) => {
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
      if (!keepUndo) setUndo(null);
      return true;
    } catch (error) { reportSaveFailure(error); return false; }
  };
  const setForm = (name, value) => { editor.elements.namedItem(name).value = value ?? ''; };
  const findByFocus = key => {
    if (!key) return null;
    for (const button of groups.querySelectorAll?.('.button') ?? []) if (button.dataset.focus === key) return button;
    return null;
  };
  let editorTrigger = null;
  const resetEditor = ({ restoreFocus = false } = {}) => {
    const trigger = editorTrigger;
    const triggerKey = trigger?.dataset?.focus ?? null;
    editor.reset();
    editor.elements.namedItem('boostId').value = '';
    editor.elements.namedItem('campaignId').value = '';
    editor.elements.namedItem('status').value = 'Scheduled';
    editor.hidden = true;
    editorTrigger = null;
    if (!restoreFocus) return;
    const target = triggerKey ? findByFocus(triggerKey) : trigger;
    if (target && target.isConnected !== false) target.focus({ preventScroll: true });
    else document.querySelector('#new-campaign')?.focus({ preventScroll: true });
  };
  const recalc = () => {
    const start = editor.elements.namedItem('startLocal').value;
    const duration = Number(editor.elements.namedItem('durationDays').value);
    try { editor.elements.namedItem('endLocal').value = isoToLocalInput(calculateEndDate(localInputToIso(start), duration)); }
    catch { editor.elements.namedItem('endLocal').value = ''; }
  };
  const openEditor = (data = {}, trigger = null) => {
    editor.reset();
    for (const [key, value] of Object.entries(data)) setForm(key, value);
    if (!data.startLocal) setForm('startLocal', isoToLocalInput(new Date().toISOString()));
    if (!data.status) setForm('status', 'Scheduled');
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
    clientList.replaceChildren();
    for (const client of state.clients) { const option = document.createElement('option'); option.value = client.name; clientList.append(option); }
    for (const page of state.pages) {
      const client = state.clients.find(item => item.id === page.clientId);
      const option = document.createElement('option'); option.value = page.pageUrl; option.textContent = `${client?.name ?? 'Client'} — ${page.pageName}`; pageFilter.append(option);
    }
    pageFilter.value = selected;
    const filtered = filterBoosts(state, { query: document.querySelector('#tracker-search').value, pageUrl: pageFilter.value, status: document.querySelector('#tracker-status').value, ending: document.querySelector('#tracker-ending').value, now: clock });
    groups.replaceChildren();
    for (const page of filtered) {
      const section = document.createElement('section'); section.className = 'tracker-page-group';
      const heading = document.createElement('h3'); heading.textContent = `${page.clientName} · ${page.pageName}`; section.append(heading);
      let planned = 0;
      for (const campaign of page.campaigns) {
        const campaignSection = document.createElement('div'); campaignSection.className = 'tracker-campaign';
        const campaignHeading = document.createElement('div'); campaignHeading.className = 'campaign-heading';
        const campaignTitle = document.createElement('h4'); campaignTitle.textContent = campaign.name; campaignHeading.append(campaignTitle);
        if (campaign.goal) { const goal = document.createElement('span'); goal.textContent = campaign.goal; campaignHeading.append(goal); }
        campaignHeading.append(makeButton('Add boost', event => openEditor({ clientName: page.clientName, pageName: page.pageName, pageUrl: page.pageUrl, campaignId: campaign.id, campaignName: campaign.name, goal: campaign.goal }, event.currentTarget), `add-boost:${campaign.id}`));
        campaignSection.append(campaignHeading);
        for (const boost of campaign.boosts) {
          if (!boost.archived) planned += Number(boost.budget);
          const start = Date.parse(boost.startAt), end = Date.parse(boost.endAt), status = scheduleStatus(boost, clock);
          const duration = Number(boost.durationDays) * DAY_MS;
          const progress = Math.max(0, Math.min(100, ((clock - start) / duration) * 100));
          const remaining = end - clock;
          const card = document.createElement('article'); card.className = 'boost-card';
          const detail = document.createElement('p'); detail.textContent = `${money.format(boost.budget)} · ${boost.durationDays} days · ${status} (scheduled)${boost.archived ? ' · Archived' : ''}`; card.append(detail);
          const dates = document.createElement('p'); dates.textContent = `Starts ${formatDate(boost.startAt)} · Ends ${formatDate(boost.endAt)}`; card.append(dates);
          if (boost.postUrl) { const post = document.createElement('a'); post.textContent = 'View post'; post.href = boost.postUrl; post.target = '_blank'; post.rel = 'noopener noreferrer'; card.append(post); }
          const bar = document.createElement('div'); bar.className = 'progress-track'; const fill = document.createElement('span'); fill.style.width = `${progress}%`; bar.append(fill); card.append(bar);
          const countdown = document.createElement('p');
          if (status === 'Scheduled') countdown.textContent = `Starts in ${formatCountdown(start - clock)}`;
          else if (status === 'Active') countdown.textContent = `Ends in ${formatCountdown(remaining)}${remaining <= ENDING_SOON_MS ? ' · Ending soon' : ''}`;
          else countdown.textContent = status === 'Completed' ? 'Schedule completed' : `Countdown paused (${status})`;
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
      const total = document.createElement('p'); total.className = 'planned-total'; total.textContent = `Planned budget total: ${money.format(planned)}`; section.append(total); groups.append(section);
    }
    if (!groups.childElementCount) { const empty = document.createElement('p'); empty.textContent = 'No planned campaigns match these filters.'; groups.append(empty); }
    if (focusKey) {
      const target = findByFocus(focusKey);
      (target ?? document.querySelector('#tracker-heading'))?.focus({ preventScroll: true });
    }
  }
  function editBoost(page, campaign, boost, trigger) {
    openEditor({ boostId: boost.id, campaignId: campaign.id, clientName: page.clientName, pageName: page.pageName, pageUrl: page.pageUrl, campaignName: campaign.name, postUrl: boost.postUrl, goal: boost.goal, budget: boost.budget, durationDays: boost.durationDays, startLocal: isoToLocalInput(boost.startAt), status: boost.status }, trigger);
  }
  function formatCountdown(ms) { const hours = Math.max(0, Math.floor(ms / 3600000)); const days = Math.floor(hours / 24); return days ? `${days}d ${hours % 24}h` : `${hours}h`; }

  document.querySelector('#track-campaign').addEventListener('click', event => {
    const data = getFormData(); const problems = validateCampaign(data); showErrors(problems);
    if (problems.length) { form.querySelector(`[name="${problems[0].field}"]`)?.focus(); return; }
    const existingPage = state.pages.find(page => pageKey(page.pageUrl) === pageKey(data.pageUrl));
    const existingClient = existingPage ? state.clients.find(client => client.id === existingPage.clientId) : null;
    const goalKey = String(data.adGoal ?? '').trim().toLocaleLowerCase();
    const existingCampaign = existingPage?.campaigns.find(campaign => campaign.name.trim().toLocaleLowerCase() === goalKey);
    openEditor({
      clientName: existingClient?.name ?? '',
      pageName: existingPage?.pageName ?? data.pageName,
      pageUrl: existingPage?.pageUrl ?? data.pageUrl,
      postUrl: data.postUrl,
      goal: data.adGoal,
      campaignName: existingCampaign?.name ?? data.adGoal,
      campaignId: existingCampaign?.id ?? '',
      budget: data.budget,
      durationDays: data.duration
    }, event.currentTarget);
  });
  document.querySelector('#new-campaign').addEventListener('click', event => openEditor({}, event.currentTarget));
  editor.elements.namedItem('pageUrl').addEventListener('change', () => {
    if (editor.elements.namedItem('boostId').value) return;
    const value = editor.elements.namedItem('pageUrl').value.trim();
    if (!value) return;
    const page = state.pages.find(item => pageKey(item.pageUrl) === pageKey(value));
    if (!page) return;
    const client = state.clients.find(item => item.id === page.clientId);
    setForm('pageName', page.pageName);
    setForm('clientName', client?.name ?? '');
  });
  editor.elements.namedItem('startLocal').addEventListener('input', recalc);
  editor.elements.namedItem('durationDays').addEventListener('input', recalc);
  editor.addEventListener('submit', event => {
    event.preventDefault();
    try {
      const data = Object.fromEntries(new FormData(editor).entries());
      const next = cloneState();
      upsertBoost(next, { ...data, startAt: localInputToIso(data.startLocal), durationDays: Number(data.durationDays), budget: Number(data.budget) }, data.boostId || null);
      if (commit(next, 'Campaign boost saved. Its schedule is planned and does not confirm Meta delivery.')) resetEditor({ restoreFocus: true });
    } catch (error) { showMessage(`Could not save changes: ${error.message}. No changes were applied. Check the client, page, campaign, schedule, and browser storage, then retry.`); }
  });
  document.querySelector('#tracker-cancel-edit').addEventListener('click', () => resetEditor({ restoreFocus: true }));
  for (const selector of ['#tracker-search', '#tracker-page', '#tracker-status', '#tracker-ending']) document.querySelector(selector).addEventListener('input', render);
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
  const closeImportReview = () => { pendingImport = null; importReview.hidden = true; importSummary.textContent = ''; };
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
      summary = `Backup replaced all tracker data: ${incoming.boosts} boost${incoming.boosts === 1 ? '' : 's'} restored from ${formatCounts(incoming)}.`;
    }
    if (commit(next, `${summary} Undo is available until the next tracker change.`, true, true)) {
      setUndo(previous);
      closeImportReview();
      resetEditor();
      focusTrackerHeading();
    }
  };
  document.querySelector('#tracker-import-merge').addEventListener('click', () => restoreImported('merge'));
  document.querySelector('#tracker-import-replace').addEventListener('click', () => restoreImported('replace'));
  document.querySelector('#tracker-import-cancel').addEventListener('click', () => { closeImportReview(); focusTrackerHeading(); });
  undoImport.addEventListener('click', () => {
    if (!undoSnapshot) return;
    const previous = undoSnapshot;
    if (commit(previous, 'Import undone. Previous tracker data restored.', false)) focusTrackerHeading();
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
      showMessage(`Could not restore backup: ${error.message}. Existing saved data was left unchanged.`);
    } finally { input.value = ''; }
  });
  if (storageError) showMessage(`${storageError.message} Existing stored data has not been changed; download it or restore a valid backup.`);
  render();
  const refreshTimer = window.setInterval(render, COUNTDOWN_REFRESH_MS);
  window.addEventListener('pagehide', () => window.clearInterval(refreshTimer), { once: true });
}
updateBudget();
initTracker();
