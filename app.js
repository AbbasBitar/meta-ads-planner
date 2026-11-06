import { calculateBudget, generateChatGPTPrompt, validateCampaign } from './src/intake.js';

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

updateBudget();
