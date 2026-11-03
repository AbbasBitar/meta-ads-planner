import {validate,calculateBudget} from './src/intake.js';
import {parsePostEntries} from './src/intake.js';
import {preflightCampaign} from './src/preflight.js';
const form=document.querySelector('#intake');
const errors=document.querySelector('#errors');
const preview=document.querySelector('#budgetPreview');
const status=document.querySelector('#submitStatus');
const preflight=document.querySelector('#preflight');
const submit=document.querySelector('#submit');
const config=window.PLANNER_CONFIG;
let widgetId=null;
let memoryPendingSubmission=null;
let unresolvedSubmissionId=null;
let approvedUnresolvedId=null;
let storageUnavailable=false;
const PENDING_SUBMISSION_PREFIX='meta-ads-planner:pending:';
const UNRESOLVED_SUBMISSION_KEY='meta-ads-planner:unresolved-submission-id';
const PENDING_RETENTION_MS=7*24*60*60*1000;
function canonicalize(value){
  if(Array.isArray(value))return value.map(canonicalize);
  if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonicalize(value[key])]));
  return value;
}
async function payloadDigest(data){
  const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(canonicalize(data))));
  return Array.from(new Uint8Array(bytes),value=>value.toString(16).padStart(2,'0')).join('');
}
function readLocalStorage(key){try{return localStorage.getItem(key);}catch{storageUnavailable=true;return null;}}
function getUnresolvedSubmissionId(){
  if(unresolvedSubmissionId)return unresolvedSubmissionId;
  const stored=readLocalStorage(UNRESOLVED_SUBMISSION_KEY);
  if(stored&&stored!==approvedUnresolvedId){unresolvedSubmissionId=stored;return stored;}
  return null;
}
async function withSubmissionLock(callback){
  const locks=globalThis.navigator?.locks;
  if(!locks?.request)throw new Error('This browser cannot safely coordinate submissions across tabs. Open Meta Ads Planner in a browser with Web Locks support to submit.');
  let callbackStarted=false;
  try{
    return await locks.request('meta-ads-planner-submission',{ifAvailable:true},lock=>{
      if(!lock)throw new Error('A submission is already being processed in another tab. Wait for it to finish, then check its status before retrying.');
      callbackStarted=true;
      return callback();
    });
  }catch(error){
    if(callbackStarted||/another tab/i.test(error?.message||''))throw error;
    throw new Error('Safe cross-tab submission coordination is unavailable. No submission was sent.');
  }
}
async function submissionIdFor(data){
  const digest=await payloadDigest(data);
  return withSubmissionLock(()=>submissionIdForDigest(digest));
}
async function submissionIdForDigest(digest){
  let unresolved;
  try{unresolved=localStorage.getItem(UNRESOLVED_SUBMISSION_KEY);}
  catch{storageUnavailable=true;throw new Error('Browser storage could not be read safely. No submission was sent. Enable browser storage and try again.');}
  if(unresolved&&unresolved!==approvedUnresolvedId){unresolvedSubmissionId=unresolved;return null;}
  const now=Date.now(),key=PENDING_SUBMISSION_PREFIX+digest;
  let serialized,pending;
  try{
    serialized=localStorage.getItem(key);
    pending=serialized===null?null:JSON.parse(serialized);
  }catch{
    storageUnavailable=true;
    throw new Error('Browser storage could not be read safely. No submission was sent. Enable browser storage and try again.');
  }
  if(pending&&pending.id===approvedUnresolvedId){
    try{localStorage.removeItem(key);if(localStorage.getItem(key)!==null)throw new Error('storage removal did not persist');}
    catch{storageUnavailable=true;throw new Error('The previous submission record could not be cleared safely. No submission was sent.');}
    pending=null;
  }
  if(pending&&pending.digest===digest&&typeof pending.id==='string'&&pending.id&&Number.isFinite(pending.createdAt)&&pending.createdAt<=now&&now-pending.createdAt<=PENDING_RETENTION_MS){
    storageUnavailable=false;memoryPendingSubmission=pending;return pending.id;
  }
  if(pending){
    try{localStorage.removeItem(key);if(localStorage.getItem(key)!==null)throw new Error('storage removal did not persist');}
    catch{storageUnavailable=true;throw new Error('An expired or invalid submission record could not be cleared safely. No submission was sent.');}
    memoryPendingSubmission=null;
  }
  const record={id:crypto.randomUUID(),digest,createdAt:now};
  const recordText=JSON.stringify(record);
  try{
    localStorage.setItem(key,recordText);
    if(localStorage.getItem(key)!==recordText)throw new Error('submission record read-back mismatch');
  }catch{
    storageUnavailable=true;
    throw new Error('Browser storage could not persist and verify the recovery ID. No submission was sent. Enable browser storage and try again.');
  }
  storageUnavailable=false;memoryPendingSubmission=record;
  approvedUnresolvedId=null;
  return record.id;
}
function removeStoredRecordForId(id){
  let removed=true;
  try{
    for(let index=localStorage.length-1;index>=0;index--){
      const key=localStorage.key(index);
      if(!key?.startsWith(PENDING_SUBMISSION_PREFIX))continue;
      try{
        if(JSON.parse(localStorage.getItem(key)||'null')?.id===id){
          localStorage.removeItem(key);
          if(JSON.parse(localStorage.getItem(key)||'null')?.id===id)removed=false;
        }
      }catch{removed=false;}
    }
  }catch{storageUnavailable=true;removed=false;}
  if(!removed)storageUnavailable=true;
  return removed;
}
function clearPendingSubmission(id=memoryPendingSubmission?.id||unresolvedSubmissionId){
  if(memoryPendingSubmission?.id===id)memoryPendingSubmission=null;
  if(unresolvedSubmissionId===id)unresolvedSubmissionId=null;
  approvedUnresolvedId=null;
  let cleared=!id||removeStoredRecordForId(id);
  try{
    if(localStorage.getItem(UNRESOLVED_SUBMISSION_KEY)===id){
      localStorage.removeItem(UNRESOLVED_SUBMISSION_KEY);
      if(localStorage.getItem(UNRESOLVED_SUBMISSION_KEY)===id)throw new Error('unresolved marker removal did not persist');
    }
  }catch{storageUnavailable=true;cleared=false;}
  return cleared;
}
function markDeliveryUnknown(id){
  unresolvedSubmissionId=id;
  try{
    localStorage.setItem(UNRESOLVED_SUBMISSION_KEY,id);
    if(localStorage.getItem(UNRESOLVED_SUBMISSION_KEY)!==id)throw new Error('unresolved marker read-back mismatch');
  }catch{storageUnavailable=true;}
}
function clearDeliveryUnknown(id){
  try{
    const stored=localStorage.getItem(UNRESOLVED_SUBMISSION_KEY);
    if(stored&&stored!==id)return false;
    if(stored===id)localStorage.removeItem(UNRESOLVED_SUBMISSION_KEY);
    if(localStorage.getItem(UNRESOLVED_SUBMISSION_KEY)===id)throw new Error('unresolved marker removal did not persist');
    if(unresolvedSubmissionId===id)unresolvedSubmissionId=null;
    return true;
  }catch{storageUnavailable=true;return false;}
}
function deliveryIsUnknown(response,result){
  if(response.status===503&&['submissions_paused','maintenance_configuration_invalid'].includes(result.code))return false;
  return result.status==='delivery_unknown'||response.status===409||(response.status>=500&&!(response.status===503&&/Security verification unavailable|Server not configured/i.test(result.error||''))&&!(response.status===502&&/Telegram rejected the delivery/i.test(result.error||'')));
}
function getData(){
  const f = new FormData(form);

  // Turnstile verification is sent separately, not as customer data.
  f.delete('cf-turnstile-response');
  if(f.get('post')!=='multiple')f.delete('postEntries');

  return Object.fromEntries(
    [...f.keys()]
      .filter(k => k !== 'channels')
      .map(k => [k, f.get(k)])
      .concat([['channels', f.getAll('channels')]])
  );
}
function money(n){return new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(n);}
const multiSection=document.querySelector('#multiPostSection');
const postCards=document.querySelector('#postCards');
const addPost=document.querySelector('#addPost');
const postBudgetBreakdown=document.querySelector('#postBudgetBreakdown');
let postRows=[];
let nextPostRowId=0;
function addPostRow(url='',budget=''){
  if(postRows.length>=10)return;
  const id=++nextPostRowId;
  const card=document.createElement('div');
  card.className='post-card';
  const title=document.createElement('strong');
  title.className='post-card-title';
  const fields=document.createElement('div');
  fields.className='post-card-fields';
  const urlLabel=document.createElement('label');
  urlLabel.textContent='Post / Reel URL';
  const urlInput=document.createElement('input');
  urlInput.type='url';urlInput.placeholder='https://www.instagram.com/p/...';
  urlInput.maxLength=250;urlInput.inputMode='url';urlInput.value=url;
  urlLabel.append(urlInput);
  const budgetLabel=document.createElement('label');
  budgetLabel.textContent='Budget (USD)';
  const budgetInput=document.createElement('input');
  budgetInput.type='number';budgetInput.min='0.01';budgetInput.max='100000';
  budgetInput.step='0.01';budgetInput.placeholder='e.g. 20';budgetInput.value=budget;
  budgetLabel.append(budgetInput);
  const remove=document.createElement('button');
  remove.type='button';remove.className='secondary-button remove-post';remove.textContent='Remove';
  remove.addEventListener('click',()=>{
    postRows=postRows.filter(row=>row.id!==id);
    card.remove();refreshPostRows();update();
  });
  fields.append(urlLabel,budgetLabel,remove);
  const feedback=document.createElement('p');feedback.className='post-card-feedback';
  feedback.setAttribute('role','status');
  card.append(title,fields,feedback);
  postCards.append(card);
  postRows.push({id,card,title,urlInput,budgetInput,remove,feedback});
  refreshPostRows();
}
function refreshPostRows(){
  postRows.forEach((row,i)=>{
    row.title.textContent='Post '+(i+1);
    row.remove.disabled=postRows.length<=2;
    row.urlInput.required=form.elements.post.value==='multiple';
    row.budgetInput.required=form.elements.post.value==='multiple';
  });
  addPost.disabled=postRows.length>=10;
}
function syncPostFields(){
  const multiple=form.elements.post.value==='multiple';
  const single=form.elements.post.value==='existing';
  multiSection.hidden=!multiple;
  document.querySelector('#singlePostLabel').hidden=!single;
  form.elements.postUrl.required=single;
  form.elements.budget.readOnly=multiple;
  form.elements.postEntries.disabled=!multiple;
  if(!multiple){
    postBudgetBreakdown.hidden=true;
    refreshPostRows();
    return;
  }
  const seen=new Set();
  let totalCents=0;
  let allValid=postRows.length>=2;
  const lines=[];
  const breakdown=[];
  postRows.forEach((row,i)=>{
    const url=row.urlInput.value.trim();
    const raw=row.budgetInput.value.trim();
    const amount=Number(raw);
    const validUrl=url.length>0 && /^https:\/\/(?:www\.|m\.|web\.)?(?:instagram\.com|facebook\.com)\/|^https:\/\/fb\.watch\//i.test(url);
    const duplicate=seen.has(url)&&url!=='';
    seen.add(url);
    const validAmount=/^\d+(?:\.\d{1,2})?$/.test(raw)&&Number.isFinite(amount)&&amount>=0.01&&amount<=100000;
    row.feedback.textContent=duplicate?'This URL is already added.':url&&!validUrl?'Use an HTTPS Instagram or Facebook post URL.':raw&&!validAmount?'Enter a valid USD amount (up to two decimals).':'';
    row.urlInput.setCustomValidity(duplicate?'Duplicate post URL':url&&!validUrl?'Invalid post URL':'');
    row.budgetInput.setCustomValidity(raw&&!validAmount?'Invalid USD budget':'');
    if(!validUrl||duplicate||!validAmount)allValid=false;
    if(validAmount)totalCents+=Math.round(amount*100);
    lines.push(url+' | '+raw);
    breakdown.push('Post '+(i+1)+': '+(validAmount?money(amount):'—'));
  });
  form.elements.postEntries.value=lines.join('\n');
  form.elements.budget.value=allValid?(totalCents/100).toFixed(2):'';
  postBudgetBreakdown.hidden=false;
  postBudgetBreakdown.replaceChildren();
  const heading=document.createElement('strong');
  heading.textContent='Individual post budgets';
  const list=document.createElement('ul');
  breakdown.forEach(line=>{const li=document.createElement('li');li.textContent=line;list.append(li);});
  const total=document.createElement('strong');
  total.textContent=allValid?'Combined total: '+money(totalCents/100):'Complete all post URLs and budgets to calculate the total.';
  postBudgetBreakdown.append(heading,list,total);
  refreshPostRows();
}
addPost.addEventListener('click',()=>{addPostRow();update();postRows.at(-1).urlInput.focus();});
addPostRow();addPostRow();
function renderPreflight(x){
  const result=preflightCampaign(x);
  preflight.replaceChildren();
  const title=document.createElement('strong');title.textContent='Campaign pre-publish review';preflight.append(title);
  for(const [heading,items] of [['Required corrections',result.blocking],['Suggestions',result.warnings],['Verify in Meta',result.checks]]){
    if(!items.length)continue;
    const label=document.createElement('p');label.textContent=heading;preflight.append(label);
    const list=document.createElement('ul');for(const item of items){const li=document.createElement('li');li.textContent=item;list.append(li);}preflight.append(list);
  }
  if(!result.blocking.length&&!result.warnings.length){const p=document.createElement('p');p.textContent='No preflight warnings detected. Meta availability and campaign approval still require verification.';preflight.append(p);}
}
function update(){syncPostFields();const x=getData();renderPreflight(x);if(Number(x.budget)>0&&Number(x.days)>0){const b=calculateBudget(x);preview.textContent=`Estimated total: ${money(b.total)} · Average daily: ${money(b.averageDaily)} · ${b.days} days`;}else preview.textContent='Enter a valid budget and duration.';}
form.addEventListener('input',update);form.addEventListener('change',update);form.addEventListener('reset',()=>{postCards.replaceChildren();postRows=[];addPostRow();addPostRow();queueMicrotask(update);});update();
function showErrors(messages,action){const all=[...messages];if(storageUnavailable)all.push('Browser storage is unavailable. Recovery across browser sessions cannot be guaranteed.');errors.replaceChildren();if(all.length){const ul=document.createElement('ul');for(const m of all){const li=document.createElement('li');li.textContent=m;ul.append(li);}errors.append(ul);}if(action){const button=document.createElement('button');button.type='button';button.textContent='The campaign owner checked Telegram and approved a new submission';button.addEventListener('click',action);errors.append(button);}}
function showReconciliationInstructions(){
  const id=getUnresolvedSubmissionId();
  if(!id)return false;
  showErrors([`Delivery for submission ${id} is unknown. Do not submit again. Contact the campaign owner with this ID and wait for them to check Telegram and approve any new submission.`],()=>{
    approvedUnresolvedId=id;const cleared=clearPendingSubmission(id);approvedUnresolvedId=id;
    if(!cleared){showErrors(['Browser storage could not clear the previous recovery record. No replacement submission was created. Enable browser storage and reload before continuing.']);return;}
    showErrors(['The previous ID was cleared after your confirmation. Complete security verification and submit again only as approved by the campaign owner.']);
  });
  return true;
}
try{localStorage.getItem(PENDING_SUBMISSION_PREFIX);localStorage.getItem(UNRESOLVED_SUBMISSION_KEY);}catch{storageUnavailable=true;}
if(!showReconciliationInstructions()&&storageUnavailable)showErrors([]);
function initTurnstile(){if(!window.turnstile){setTimeout(initTurnstile,150);return;}if(!config?.turnstileSiteKey||config.turnstileSiteKey.startsWith('REPLACE_')){showErrors(['Turnstile is not configured. Contact the administrator.']);submit.disabled=true;return;}widgetId=window.turnstile.render('#turnstile',{sitekey:config.turnstileSiteKey});}
initTurnstile();
form.addEventListener('submit',async e=>{
 e.preventDefault();status.textContent='';if(showReconciliationInstructions())return;showErrors([]);
 const data=getData(), problems=validate(data);
 if(problems.length){showErrors(problems);errors.scrollIntoView();return;}
 const token=widgetId===null?'':window.turnstile?.getResponse(widgetId);
 if(!token){showErrors(['Complete the security verification before submitting.']);return;}
 submit.disabled=true;submit.textContent='Submitting…';
 let submissionId=null,requestStarted=false;
 try{
   await withSubmissionLock(async()=>{
    const digest=await payloadDigest(data);
    submissionId=await submissionIdForDigest(digest);
    if(!submissionId){showReconciliationInstructions();return;}
    markDeliveryUnknown(submissionId);
    if(storageUnavailable)throw new Error('Browser storage could not persist and verify the in-progress submission marker. No submission was sent.');
    const controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),18000);
    let response;let result;try{requestStarted=true;response=await fetch(config.apiUrl+'/submit',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({data,turnstileToken:token,submissionId}),signal:controller.signal});try{result=await response.json();}catch(error){markDeliveryUnknown(submissionId);error.deliveryUnknown=true;throw error;}}finally{clearTimeout(timeout);}
    if(!response.ok||!result.success){
     const error=new Error(result.error||'Submission failed. Please retry.');
     error.deliveryUnknown=deliveryIsUnknown(response,result);
     if(error.deliveryUnknown)markDeliveryUnknown(submissionId);
     else if(!clearDeliveryUnknown(submissionId)){markDeliveryUnknown(submissionId);error.deliveryUnknown=true;}
     throw error;
    }
    const recoveryCleared=clearPendingSubmission(submissionId);
    form.reset();update();status.textContent=`Submitted successfully. Reference: ${result.reference}. The campaign owner will receive the report privately.`;
    if(!recoveryCleared)showErrors(['The campaign was delivered, but browser storage could not clear its recovery record. Keep the reference above and contact the administrator before making another submission.']);
    status.scrollIntoView({behavior:'smooth'});
   });
 }catch(err){if(requestStarted&&(err.name==='AbortError'||(err.name==='TypeError'&&!err.deliveryUnknown))){markDeliveryUnknown(submissionId);err.deliveryUnknown=true;}showErrors([err.name==='AbortError'?'Request timed out. Please contact the campaign owner before retrying to avoid duplicates.':err.message||'Submission failed.'],err.deliveryUnknown?()=>{const id=unresolvedSubmissionId||getUnresolvedSubmissionId();approvedUnresolvedId=id;const cleared=clearPendingSubmission(id);approvedUnresolvedId=id;if(!cleared){showErrors(['Browser storage could not clear the previous recovery record. No replacement submission was created. Enable browser storage and reload before continuing.']);return;}showErrors(['The previous ID was cleared after your confirmation. Complete security verification and submit again only as approved by the campaign owner.']);}:null);}
 finally{submit.disabled=false;submit.textContent='Submit configuration for review';if(widgetId!==null)window.turnstile?.reset(widgetId);}
});
