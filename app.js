import { calculateBudget, generateChatGPTPrompt, validateCampaign } from './src/intake.js';
import { calculateEndDate, exportTracker, filterBoosts, findBoost, importTracker, isoToLocalInput, loadTracker, localInputToIso, removeBoost, saveTracker, scheduleStatus, upsertBoost } from './src/tracker.js';

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
    item.textContent = message;
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
  let storage;
  try { storage = window.localStorage; } catch { storage = { getItem: () => null, setItem: () => { throw new Error('Browser storage is unavailable.'); } }; }
  const state = loadTracker(storage);
  let toast = '';
  let clock = Date.now();
  const formatDate = value => new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
  const showMessage = value => { toast = value; message.textContent = value; };
  const persist = () => { saveTracker(storage, state); render(); };
  const setForm = (name, value) => { editor.elements.namedItem(name).value = value ?? ''; };
  const resetEditor = () => { editor.reset(); editor.elements.namedItem('boostId').value = ''; editor.elements.namedItem('status').value = 'Scheduled'; editor.hidden = true; };
  const recalc = () => {
    const start = editor.elements.namedItem('startLocal').value;
    const duration = Number(editor.elements.namedItem('durationDays').value);
    try { editor.elements.namedItem('endLocal').value = isoToLocalInput(calculateEndDate(localInputToIso(start), duration)); }
    catch { editor.elements.namedItem('endLocal').value = ''; }
  };
  const openEditor = (data = {}) => {
    editor.reset();
    for (const [key, value] of Object.entries(data)) setForm(key, value);
    if (!data.startLocal) setForm('startLocal', isoToLocalInput(new Date().toISOString()));
    if (!data.status) setForm('status', 'Scheduled');
    editor.hidden = false; recalc(); editor.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };
  function render() {
    clock = Date.now();
    const selected = pageFilter.value;
    pageFilter.replaceChildren(Object.assign(document.createElement('option'), { value: '', textContent: 'All pages' }));
    for (const page of state.pages) { const option = document.createElement('option'); option.value = page.pageUrl; option.textContent = `${page.clientName} — ${page.pageName}`; pageFilter.append(option); }
    pageFilter.value = selected;
    const filtered = filterBoosts(state, { query: document.querySelector('#tracker-search').value, pageUrl: pageFilter.value, status: document.querySelector('#tracker-status').value, ending: document.querySelector('#tracker-ending').value, now: clock });
    groups.replaceChildren();
    for (const page of filtered) {
      const section = document.createElement('section'); section.className = 'tracker-page-group';
      const heading = document.createElement('h3'); heading.textContent = `${page.clientName} · ${page.pageName}`; section.append(heading);
      let planned = 0;
      for (const boost of page.boosts) {
        if (!boost.archived) planned += Number(boost.budget);
        const start = Date.parse(boost.startAt), end = Date.parse(boost.endAt), status = scheduleStatus(boost, clock);
        const duration = Number(boost.durationDays) * 86400000;
        const progress = Math.max(0, Math.min(100, ((clock - start) / duration) * 100));
        const remaining = end - clock;
        const card = document.createElement('article'); card.className = 'boost-card';
        const title = document.createElement('h4'); title.textContent = boost.goal || 'Planned boost'; card.append(title);
        const detail = document.createElement('p'); detail.textContent = `${money.format(boost.budget)} · ${boost.durationDays} days · ${status} (scheduled)${boost.archived ? ' · Archived' : ''}`; card.append(detail);
        const dates = document.createElement('p'); dates.textContent = `Starts ${formatDate(boost.startAt)} · Ends ${formatDate(boost.endAt)}`; card.append(dates);
        if (boost.postUrl) { const post = document.createElement('a'); post.textContent = 'View post'; post.href = boost.postUrl; post.target = '_blank'; post.rel = 'noopener noreferrer'; card.append(post); }
        const bar = document.createElement('div'); bar.className = 'progress-track'; const fill = document.createElement('span'); fill.style.width = `${progress}%`; bar.append(fill); card.append(bar);
        const countdown = document.createElement('p');
        if (status === 'Scheduled') countdown.textContent = `Starts in ${formatCountdown(start - clock)}`;
        else if (status === 'Active') countdown.textContent = `Ends in ${formatCountdown(remaining)}${remaining <= 3 * 86400000 ? ' · Ending soon' : ''}`;
        else countdown.textContent = status === 'Completed' ? 'Schedule completed' : `Countdown paused (${status})`;
        countdown.className = remaining > 0 && remaining <= 3 * 86400000 && status === 'Active' ? 'ending-soon' : ''; card.append(countdown);
        const actions = document.createElement('div'); actions.className = 'boost-actions';
        for (const [label, action] of [['Edit', () => editBoost(page, boost)], [boost.archived ? 'Restore' : 'Archive', () => { boost.archived = !boost.archived; persist(); showMessage(boost.archived ? 'Boost archived.' : 'Boost restored.'); }], ['Delete', () => { if (window.confirm('Delete this boost?')) { removeBoost(state, boost.id); persist(); showMessage('Boost deleted.'); } }]]) { const button = document.createElement('button'); button.type = 'button'; button.className = 'button button-secondary'; button.textContent = label; button.addEventListener('click', action); actions.append(button); }
        card.append(actions); section.append(card);
      }
      const total = document.createElement('p'); total.className = 'planned-total'; total.textContent = `Planned budget total: ${money.format(planned)}`; section.append(total); groups.append(section);
    }
    if (!groups.childElementCount) { const empty = document.createElement('p'); empty.textContent = 'No planned boosts match these filters.'; groups.append(empty); }
  }
  function editBoost(page, boost) {
    openEditor({ boostId: boost.id, clientName: page.clientName, pageName: page.pageName, pageUrl: page.pageUrl, postUrl: boost.postUrl, goal: boost.goal, budget: boost.budget, durationDays: boost.durationDays, startLocal: isoToLocalInput(boost.startAt), status: boost.status });
  }
  function formatCountdown(ms) { const hours = Math.max(0, Math.floor(ms / 3600000)); const days = Math.floor(hours / 24); return days ? `${days}d ${hours % 24}h` : `${hours}h`; }

  document.querySelector('#track-campaign').addEventListener('click', () => {
    const data = getFormData(); const problems = validateCampaign(data); showErrors(problems);
    if (problems.length) { form.querySelector(`[name="${problems[0].field}"]`)?.focus(); return; }
    openEditor({ clientName: data.pageName, pageName: data.pageName, pageUrl: data.pageUrl, postUrl: data.postUrl, goal: data.adGoal, budget: data.budget, durationDays: data.duration });
  });
  editor.elements.namedItem('startLocal').addEventListener('input', recalc);
  editor.elements.namedItem('durationDays').addEventListener('input', recalc);
  editor.addEventListener('submit', event => {
    event.preventDefault();
    try {
      const data = Object.fromEntries(new FormData(editor).entries());
      upsertBoost(state, { ...data, startAt: localInputToIso(data.startLocal), durationDays: Number(data.durationDays), budget: Number(data.budget) }, data.boostId || null);
      persist(); resetEditor(); showMessage('Boost saved. Its schedule is planned and does not confirm Meta delivery.');
    } catch (error) { showMessage(error.message); }
  });
  document.querySelector('#tracker-cancel-edit').addEventListener('click', resetEditor);
  for (const selector of ['#tracker-search', '#tracker-page', '#tracker-status', '#tracker-ending']) document.querySelector(selector).addEventListener('input', render);
  document.querySelector('#tracker-export').addEventListener('click', () => {
    const blob = new Blob([exportTracker(state)], { type: 'application/json' }); const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = 'meta-ads-planner-tracker.json'; link.click(); URL.revokeObjectURL(link.href);
  });
  document.querySelector('#tracker-import').addEventListener('change', async event => {
    const file = event.currentTarget.files?.[0]; if (!file) return;
    try { const imported = importTracker(await file.text()); state.version = imported.version; state.pages = imported.pages; persist(); showMessage('Backup restored.'); }
    catch (error) { showMessage(`Could not restore backup: ${error.message}`); }
    event.currentTarget.value = '';
  });
  render();
}

updateBudget();
initTracker();
