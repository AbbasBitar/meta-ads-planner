import {validate,generate} from './planner.js';
import {privateObjectiveDecision,formatPrivateDecision} from './private-recommendation.js';
import {authorizeAccess,getAccessToken} from './access.js';

const ALLOWED_ORIGINS = new Set([
  'https://abbasbitar.github.io',
  'https://ads-planner.teckhub.net'
]);
const isAllowedOrigin = origin => ALLOWED_ORIGINS.has(origin);
const json=(data,status=200,origin='')=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff',...(isAllowedOrigin(origin)?{'access-control-allow-origin':origin,'vary':'Origin'}:{})}});
const validId=x=>typeof x==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(x);
const safeText=(value,max=400)=>typeof value==='string'&&value.length<=max&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value);
function legacySubmissionState(value){
 if(!value)return null;
 try{const parsed=JSON.parse(value);if(parsed&&typeof parsed.status==='string')return parsed;}catch{}
 return {status:'delivered',reference:value};
}
export function checkSubmission(body){
 if(!body||typeof body!=='object'||!body.data||typeof body.data!=='object'||!validId(body.submissionId)||!safeText(body.turnstileToken,2048)||!body.turnstileToken)return ['Invalid request'];
 const d=body.data;
const allowed = [
  'client',
  'page',
  'handle',
  'representative',
  'reference',
  'category',
  'product',
  'description',
  'platform',
  'post',
  'postUrl',
  'postEntries',
  'goal',
  'destination',
  'channels',
  'locations',
  'minAge',
  'maxAge',
  'gender',
  'interests',
  'audience',
  'budgetType',
  'budget',
  'days',
  'creative',
  'language',
  'notes'
];
for(const [k,v] of Object.entries(d)){
  if(!allowed.includes(k))return ['Unexpected field'];
  if(k==='channels'){if(!Array.isArray(v)||v.length>5||v.some(c=>!safeText(c,30)))return ['Invalid channels'];}
  else if(!safeText(v,k==='postEntries'?3000:k==='notes'?1000:k==='audience'||k==='locations'?500:250))return ['Invalid field length'];
 }
 if(typeof d.category!=='string'||!d.category.trim()||d.category.length>120||!['manager','boost'].includes(d.platform)||!['new','existing','multiple'].includes(d.post)||!['profile','messages','sales','reach','engagement','website'].includes(d.goal)||!['daily','lifetime'].includes(d.budgetType)||!['All','Women','Men'].includes(d.gender)||!['Arabic','English','Arabic and English'].includes(d.language)||!['Single image','Video / Reel','Carousel','Need recommendation'].includes(d.creative))return ['Invalid selection'];
 if(d.channels.some(c=>!['Instagram Direct','WhatsApp','Website','Phone','In person'].includes(c)))return ['Invalid contact channel'];
 return validate(d);
}
export function formatReport(p,ref,decision){
 const lines=[
  'META ADS — CONFIGURATION','Reference: '+ref,
  'Client: '+p.client+' | Page: '+p.page,
  'Business: '+p.business+' | Product: '+p.product,
  '',
  'CAMPAIGN',
  'Tool: '+(p.platform==='manager'?'Meta Ads Manager':'Instagram Boost'),
  'Goal: '+p.goal,
  'Objective: '+(decision.status==='recommended'?(decision.candidateMetaObjective||p.objective):'Needs confirmation in Meta'),
  '',
  'AD SET',
  'Destination: '+(decision.status==='recommended'?(decision.destination||p.conversionLocation):p.conversionLocation+' (verify)'),
  'Performance goal: '+(decision.status==='recommended'?(decision.performanceGoal||p.performanceGoal):'Verify after objective selection'),
  'Locations: '+p.locations,
  'Age: '+p.age+' | Gender: '+p.gender,
  'Detailed targeting — interests (suggestions): '+(p.interests.join(', ')||'Broad; no confident interest match'),
  'Detailed targeting — demographics (suggestions): '+(p.targetingDemographics.join(', ')||'None'),
  'Budget: $'+p.totalBudget.toFixed(2)+' '+p.budgetType+' | Average/day: $'+p.averageDaily.toFixed(2),
  'Duration: '+p.durationDays+' days',
  'Placements: '+p.placements,
  '',
  'AD',
  'Source: '+p.post,
  ...(p.postEntries.length?p.postEntries.map((entry,i)=>'Post '+(i+1)+': '+entry.url+' — $'+entry.budget.toFixed(2)):[...(p.post==='existing'?['Post: '+p.postUrl]:[])]),
  'Format: '+p.creative,
  'CTA: '+(decision.status==='recommended'?(decision.cta||p.cta):'Verify in Meta'),
  'Orders/contact: '+p.channels,
  '',
  'VERIFY BEFORE PUBLISHING',
  'Targeting terms are unverified search suggestions; availability, Advantage+ expansion, placements and CTA must be checked in Meta.',
  ...(decision.status!=='recommended'?['Objective clarification: '+decision.rationale]:[]),
  ...p.warnings.slice(0,3),
  ...(p.notes?['Notes: '+p.notes]:[])
 ];
 return lines.join('\n');
}
function canonicalize(value){
 if(Array.isArray(value))return value.map(canonicalize);
 if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonicalize(value[key])]));
 return value;
}
async function payloadDigest(data){
 const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(canonicalize(data))));
 return Array.from(new Uint8Array(digest),value=>value.toString(16).padStart(2,'0')).join('');
}
const coordinatorJson=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});

export class SubmissionCoordinator {
 constructor(state,env){this.state=state;this.env=env;this.active=false;}
 async fetch(request){
  if(request.method!=='POST')return coordinatorJson({error:'Method not allowed'},405);
  if(this.active)return coordinatorJson({error:'Submission is already being processed. Retry with the same submission ID.'},409);
  this.active=true;
  try{
   const body=await request.json();
   const digest=await payloadDigest(body.data);
   const existing=await this.state.storage.get('submission');
   if(!existing&&body.legacyState){
    const legacy=body.legacyState;
    if(legacy.status==='delivered'){
     const imported={payloadDigest:digest,status:'delivery_unknown',reference:legacy.reference||null,updatedAt:Date.now()};
     await this.state.storage.put('submission',imported);
     return coordinatorJson({status:'delivery_unknown',reference:imported.reference,error:'A previous submission reference has no stored payload digest. Ask the campaign owner to verify it in Telegram before submitting again.'},409);
    }
    if(legacy.status==='processing'||legacy.status==='uncertain'){
     const imported={payloadDigest:digest,status:'delivery_unknown',reference:legacy.reference||null,updatedAt:Date.now()};
     await this.state.storage.put('submission',imported);
     return coordinatorJson({status:'delivery_unknown',reference:imported.reference,error:'A previous version may have delivered this submission. Ask the campaign owner to check Telegram before submitting again.'},409);
    }
   }
   if(existing&&existing.payloadDigest!==digest)return coordinatorJson({error:'Submission ID was already used with different campaign data.'},409);
   if(existing?.status==='delivered')return coordinatorJson({success:true,reference:existing.reference},200);
   if(existing?.status==='delivery_unknown')return coordinatorJson({status:'delivery_unknown',reference:existing.reference||null,error:`Delivery outcome is unknown${existing.reference?` for ${existing.reference}`:''}. Do not submit again. Contact the campaign owner with this reference; they must check Telegram and confirm whether it arrived before advising a new submission.`},409);
   if(existing?.status==='sending'){
    const unknown={...existing,status:'delivery_unknown',updatedAt:Date.now()};
    await this.state.storage.put('submission',unknown);
    return coordinatorJson({status:'delivery_unknown',reference:unknown.reference||null,error:`A previous send stopped before its outcome was recorded${unknown.reference?` (${unknown.reference})`:''}. Do not submit again. Contact the campaign owner with this reference; they must check Telegram and confirm whether it arrived before advising a new submission.`},409);
   }
   const submission={payloadDigest:digest,status:'validating',updatedAt:Date.now(),reference:existing?.reference||null};
   await this.state.storage.put('submission',submission);
   const {TURNSTILE_SECRET,TELEGRAM_BOT_TOKEN,TELEGRAM_CHAT_ID}=this.env;
   const challenge=new FormData();challenge.append('secret',TURNSTILE_SECRET);challenge.append('response',body.turnstileToken);if(body.ip&&body.ip!=='unknown')challenge.append('remoteip',body.ip);
   let verification;
   try{
    const response=await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify',{method:'POST',body:challenge,signal:AbortSignal.timeout(8000)});
    if(!response.ok)return coordinatorJson({error:'Security verification unavailable. Retry with a fresh verification token.'},503);
    verification=await response.json();
   }catch{return coordinatorJson({error:'Security verification unavailable. Retry with a fresh verification token.'},503)}
   if(!verification.success||!['abbasbitar.github.io','ads-planner.teckhub.net'].includes(verification.hostname))return coordinatorJson({error:'Security verification failed. Complete a fresh verification and retry.'},403);
   const reference=`MAP-${new Date().toISOString().slice(0,10).replaceAll('-','')}-${body.submissionId.slice(0,8).toUpperCase()}`;
   const decision=privateObjectiveDecision(body.data);
   const report=formatReport(generate(body.data),reference,decision)+'\n\n'+formatPrivateDecision(decision);
   const payload=new FormData();payload.append('chat_id',TELEGRAM_CHAT_ID);payload.append('caption',[
    '📋 NEW META ADS CAMPAIGN',`Reference: ${reference}`,`Business: ${body.data.client}`,`Page: ${body.data.page}`,`Objective: ${body.data.goal}`,`Locations: ${body.data.locations}`,`Audience: ${body.data.gender}, ${body.data.minAge}-${body.data.maxAge}`,`Budget: $${body.data.budget} (${body.data.budgetType})`,`Duration: ${body.data.days} days`,`Orders: ${body.data.channels.join(', ')}`,`Post: ${body.data.post==='multiple'?`${body.data.postEntries.split(/\r?\n/).filter(Boolean).length} existing posts (see report)`:body.data.postUrl||'New ad / not supplied'}`,'Full campaign report attached.'
   ].map((line,index)=>String(line).slice(0,[40,45,50,50,45,60,45,50,35,60,256,40][index])).join('\n'));
   payload.append('document',new Blob([report],{type:'text/plain;charset=utf-8'}),`${reference}.txt`);
   const sending={...submission,status:'sending',reference,updatedAt:Date.now()};
   await this.state.storage.put('submission',sending);
   let telegramResponse,result;
   try{
    telegramResponse=await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendDocument`,{method:'POST',body:payload,signal:AbortSignal.timeout(12000)});
    result=await telegramResponse.json();
   }catch{
    await this.state.storage.put('submission',{...sending,status:'delivery_unknown',updatedAt:Date.now()});
    return coordinatorJson({status:'delivery_unknown',reference,error:`Telegram may have received ${reference}, but its response was lost. Do not submit again. Contact the campaign owner with this reference; they must check Telegram and confirm whether it arrived before advising a new submission.`},502);
   }
   if(telegramResponse.ok&&result?.ok===false){
    await this.state.storage.put('submission',{...submission,status:'validating',reference,updatedAt:Date.now()});
    console.error('Telegram rejected delivery',telegramResponse.status,result.error_code);
    return coordinatorJson({error:'Telegram rejected the delivery. Complete a fresh verification token and retry the same submission.'},502);
   }
   if(!telegramResponse.ok||result?.ok!==true){
    await this.state.storage.put('submission',{...sending,status:'delivery_unknown',updatedAt:Date.now()});
    console.error('Telegram delivery outcome uncertain',telegramResponse.status,result?.error_code);
    return coordinatorJson({status:'delivery_unknown',reference,error:`Telegram delivery outcome is unknown for ${reference}. Do not submit again. Contact the campaign owner with this reference; they must check Telegram and confirm whether it arrived before advising a new submission.`},502);
   }
   await this.state.storage.put('submission',{...sending,status:'delivered',updatedAt:Date.now()});
   return coordinatorJson({success:true,reference},200);
  }catch(error){
   console.error('Submission coordinator failed',error?.message||error);
   return coordinatorJson({error:'Submission coordination failed. Retry with the same submission ID.'},503);
  }finally{this.active=false;}
 }
}
export default {
 async fetch(request,env,ctx){
  const url=new URL(request.url),origin=request.headers.get('Origin')||'';
  if(request.method==='GET'&&url.pathname==='/health')return json({status:'ok',service:'meta-ads-planner-api'});
  if(url.pathname!=='/submit')return json({error:'Not found'},404);
  if(request.method==='OPTIONS')return isAllowedOrigin(origin)?new Response(null,{status:204,headers:{'access-control-allow-origin':origin,'access-control-allow-methods':'POST, OPTIONS','access-control-allow-headers':'content-type','access-control-max-age':'600','vary':'Origin'}}):json({error:'Forbidden'},403);
  if(request.method!=='POST')return json({error:'Method not allowed'},405,origin);

   // Require a cryptographically verified Cloudflare Access JWT.
   const accessToken=getAccessToken(request);
   const authenticated=await authorizeAccess(accessToken,env.ACCESS_AUD,env.APPROVED_EMAILS);

   if(!authenticated)return json({error:'Unauthorized'},401,origin);
  if(!isAllowedOrigin(origin))return json({error:'Forbidden origin'},403);
  if(env.SUBMISSIONS_PAUSED==='true')return json({error:'Submissions are temporarily paused for maintenance. Your recovery ID has been preserved; retry after submissions are re-enabled.',code:'submissions_paused',status:'maintenance'},503,origin);
  if(env.SUBMISSIONS_PAUSED!=='false')return json({error:'Submissions are unavailable because maintenance mode is missing or misconfigured. Your recovery ID has been preserved. Contact the administrator.',code:'maintenance_configuration_invalid',status:'maintenance'},503,origin);
  if(!request.headers.get('content-type')?.toLowerCase().startsWith('application/json'))return json({error:'JSON required'},415,origin);
  if(Number(request.headers.get('content-length')||0)>12000)return json({error:'Request too large'},413,origin);
  if(!env.TURNSTILE_SECRET||!env.TELEGRAM_BOT_TOKEN||!env.TELEGRAM_CHAT_ID||!env.SUBMISSIONS||!env.SUBMISSION_COORDINATOR)return json({error:'Server not configured'},503,origin);
  const raw=await request.text();if(raw.length>12000)return json({error:'Request too large'},413,origin);
  let body;try{body=JSON.parse(raw)}catch{return json({error:'Invalid JSON'},400,origin)}
  const errors=checkSubmission(body);if(errors.length)return json({error:errors[0]},400,origin);
  const ip=request.headers.get('CF-Connecting-IP')||'unknown';
  // KV remains a best-effort rate limiter; all submission state is coordinated by a Durable Object.
  const ipDigest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(ip+':'+(env.RATE_SALT||env.TURNSTILE_SECRET)));
  const ipHash=Array.from(new Uint8Array(ipDigest)).map(x=>x.toString(16).padStart(2,'0')).join('');
  const rateKey=`rate:${ipHash}:${Math.floor(Date.now()/60000)}`;
  const count=Number(await env.SUBMISSIONS.get(rateKey)||0);
  if(count>=3)return json({error:'Too many submissions. Try again later.'},429,origin);
  await env.SUBMISSIONS.put(rateKey,String(count+1),{expirationTtl:120});
  const legacyState=legacySubmissionState(await env.SUBMISSIONS.get(`submission:${body.submissionId}`));
  const coordinator=env.SUBMISSION_COORDINATOR.get(env.SUBMISSION_COORDINATOR.idFromName(body.submissionId));
  let coordinated;
  try{
   coordinated=await coordinator.fetch('https://submission-coordinator.internal/submit',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({submissionId:body.submissionId,data:body.data,turnstileToken:body.turnstileToken,ip,legacyState})});
  }catch(error){
   console.error('Submission coordinator unavailable',error?.message||error);
   return json({error:'Submission coordinator unavailable. Retry with the same submission ID.'},503,origin);
  }
  let result;try{result=await coordinated.json()}catch{return json({error:'Invalid response from submission coordinator'},502,origin)}
  return json(result,coordinated.status,origin);
 }
};
