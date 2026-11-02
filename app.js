import {validate,calculateBudget} from './src/planner.js';
const form=document.querySelector('#intake');
const errors=document.querySelector('#errors');
const preview=document.querySelector('#budgetPreview');
const status=document.querySelector('#submitStatus');
const submit=document.querySelector('#submit');
const config=window.PLANNER_CONFIG;
let widgetId=null;
function getData(){
  const f = new FormData(form);

  // Turnstile verification is sent separately, not as customer data.
  f.delete('cf-turnstile-response');

  return Object.fromEntries(
    [...f.keys()]
      .filter(k => k !== 'channels')
      .map(k => [k, f.get(k)])
      .concat([['channels', f.getAll('channels')]])
  );
}
function money(n){return new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(n);}
function update(){const x=getData();if(Number(x.budget)>0&&Number(x.days)>0){const b=calculateBudget(x);preview.textContent=`Estimated total: ${money(b.total)} · Average daily: ${money(b.averageDaily)} · ${b.days} days`;}else preview.textContent='Enter a valid budget and duration.';}
form.addEventListener('input',update);form.addEventListener('change',update);update();
function showErrors(messages){errors.replaceChildren();if(messages.length){const ul=document.createElement('ul');for(const m of messages){const li=document.createElement('li');li.textContent=m;ul.append(li);}errors.append(ul);}}
function initTurnstile(){if(!window.turnstile){setTimeout(initTurnstile,150);return;}if(!config?.turnstileSiteKey||config.turnstileSiteKey.startsWith('REPLACE_')){showErrors(['Turnstile is not configured. Contact the administrator.']);submit.disabled=true;return;}widgetId=window.turnstile.render('#turnstile',{sitekey:config.turnstileSiteKey});}
initTurnstile();
form.addEventListener('submit',async e=>{
 e.preventDefault();showErrors([]);status.textContent='';
 const data=getData(), problems=validate(data);
 if(problems.length){showErrors(problems);errors.scrollIntoView();return;}
 const token=widgetId===null?'':window.turnstile?.getResponse(widgetId);
 if(!token){showErrors(['Complete the security verification before submitting.']);return;}
 submit.disabled=true;submit.textContent='Submitting…';
 try{
  const controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),18000);
  let response;try{response=await fetch(config.apiUrl+'/submit',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({data,turnstileToken:token,submissionId:crypto.randomUUID()}),signal:controller.signal});}finally{clearTimeout(timeout);}
  const result=await response.json();
  if(!response.ok||!result.success)throw new Error(result.error||'Submission failed. Please retry.');
  form.reset();update();status.textContent=`Submitted successfully. Reference: ${result.reference}. The campaign owner will receive the report privately.`;
  status.scrollIntoView({behavior:'smooth'});
 }catch(err){showErrors([err.name==='AbortError'?'Request timed out. Please contact the campaign owner before retrying to avoid duplicates.':err.message||'Submission failed.']);}
 finally{submit.disabled=false;submit.textContent='Submit configuration for review';if(widgetId!==null)window.turnstile?.reset(widgetId);}
});
