import {validate,generate} from './planner.js';

const ORIGIN = 'https://abbasbitar.github.io';
const json=(data,status=200,origin='')=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff',...(origin===ORIGIN?{'access-control-allow-origin':ORIGIN,'vary':'Origin'}:{})}});
const validId=x=>typeof x==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(x);
const safeText=(value,max=400)=>typeof value==='string'&&value.length<=max&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value);
export function checkSubmission(body){
 if(!body||typeof body!=='object'||!body.data||typeof body.data!=='object'||!validId(body.submissionId)||!safeText(body.turnstileToken,2048)||!body.turnstileToken)return ['Invalid request'];
 const d=body.data;
 const allowed=['client','page','handle','representative','reference','category','product','platform','post','goal','destination','channels','locations','minAge','maxAge','gender','interests','audience','budgetType','budget','days','creative','language','notes'];
 for(const [k,v] of Object.entries(d)){
  if(!allowed.includes(k))return ['Unexpected field'];
  if(k==='channels'){if(!Array.isArray(v)||v.length>5||v.some(c=>!safeText(c,30)))return ['Invalid channels'];}
  else if(!safeText(v,k==='notes'?1000:k==='audience'||k==='locations'?500:250))return ['Invalid field length'];
 }
 if(!['Photography','Jewelry','Clothing','Baby','Other'].includes(d.category)||!['manager','boost'].includes(d.platform)||!['new','existing'].includes(d.post)||!['profile','messages','sales','reach','engagement','website'].includes(d.goal)||!['daily','lifetime'].includes(d.budgetType)||!['All','Women','Men'].includes(d.gender)||!['Arabic','English','Arabic and English'].includes(d.language)||!['Single image','Video / Reel','Carousel','Need recommendation'].includes(d.creative))return ['Invalid selection'];
 if(d.channels.some(c=>!['Instagram Direct','WhatsApp','Website','Phone','In person'].includes(c)))return ['Invalid contact channel'];
 return validate(d);
}
function formatReport(p,ref){
 const lines=[`📋 META ADS PLANNER — NEW SUBMISSION`,`Reference: ${ref}`,`Client: ${p.client}`,`Page: ${p.page}`,`Instagram: ${p.handle}`,`Representative: ${p.representative}`,`Client reference: ${p.reference}`,``,`🎯 CAMPAIGN`,`Product: ${p.product}`,`Tool: ${p.platform}`,`Ad source: ${p.post}`,`Objective: ${p.objective}`,`Conversion location: ${p.conversionLocation}`,`Performance goal: ${p.performanceGoal}`,`CTA: ${p.cta}`,``,`👥 AUDIENCE`,`Locations: ${p.locations}`,`Age: ${p.age}; Gender: ${p.gender}`,`Ideal customer: ${p.audience}`,`Interest searches (verify in Meta): ${p.interests.join(', ')||'Broad'}`,p.interestNotice,``,`💵 BUDGET`,`Type: ${p.budgetType}`,`Total: $${p.totalBudget.toFixed(2)}`,`Average/day: $${p.averageDaily.toFixed(2)}`,`Duration: ${p.durationDays} days`,``,`📣 CREATIVE`,`Format: ${p.creative}`,`Placements: ${p.placements}`,`Channels: ${p.channels}`,`Caption suggestion:\n${p.caption}`,``,`📝 NOTES`,`Notes: ${p.notes}`,``,`⚠️ REVIEW`,...p.warnings,``,`PRE-PUBLISH CHECKLIST`,...p.checklist.map(s=>`☐ ${s}`),``,`Meta settings and targeting availability require manual verification.`];
 return lines.join('\n');
}
export default {
 async fetch(request,env,ctx){
  const url=new URL(request.url),origin=request.headers.get('Origin')||'';
  if(request.method==='GET'&&url.pathname==='/health')return json({status:'ok',service:'meta-ads-planner-api'});
  if(url.pathname!=='/submit')return json({error:'Not found'},404);
  if(request.method==='OPTIONS')return origin===ORIGIN?new Response(null,{status:204,headers:{'access-control-allow-origin':ORIGIN,'access-control-allow-methods':'POST, OPTIONS','access-control-allow-headers':'content-type','access-control-max-age':'600','vary':'Origin'}}):json({error:'Forbidden'},403);
  if(request.method!=='POST')return json({error:'Method not allowed'},405,origin);
  if(origin!==ORIGIN)return json({error:'Forbidden origin'},403);
  if(!request.headers.get('content-type')?.toLowerCase().startsWith('application/json'))return json({error:'JSON required'},415,origin);
  if(Number(request.headers.get('content-length')||0)>12000)return json({error:'Request too large'},413,origin);
  if(!env.TURNSTILE_SECRET||!env.TELEGRAM_BOT_TOKEN||!env.TELEGRAM_CHAT_ID||!env.SUBMISSIONS)return json({error:'Server not configured'},503,origin);
  const raw=await request.text();if(raw.length>12000)return json({error:'Request too large'},413,origin);
  let body;try{body=JSON.parse(raw)}catch{return json({error:'Invalid JSON'},400,origin)}
  const errors=checkSubmission(body);if(errors.length)return json({error:errors[0]},400,origin);
  const ip=request.headers.get('CF-Connecting-IP')||'unknown';
  // KV is best-effort for distributed rate limits; Turnstile and Cloudflare WAF are additional layers.
  const ipDigest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(ip+':'+(env.RATE_SALT||env.TURNSTILE_SECRET)));
  const ipHash=Array.from(new Uint8Array(ipDigest)).map(x=>x.toString(16).padStart(2,'0')).join('');
  const rateKey=`rate:${ipHash}:${Math.floor(Date.now()/60000)}`;
  const count=Number(await env.SUBMISSIONS.get(rateKey)||0);
  if(count>=3)return json({error:'Too many submissions. Try again later.'},429,origin);
  await env.SUBMISSIONS.put(rateKey,String(count+1),{expirationTtl:120});
  const key=`submission:${body.submissionId}`;
  if(await env.SUBMISSIONS.get(key))return json({error:'Duplicate submission'},409,origin);
  const form=new FormData();form.append('secret',env.TURNSTILE_SECRET);form.append('response',body.turnstileToken);if(ip!=='unknown')form.append('remoteip',ip);
  let turnstile;try{const r=await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify',{method:'POST',body:form,signal:AbortSignal.timeout(8000)});turnstile=await r.json()}catch{return json({error:'Security verification unavailable. Try again.'},503,origin)}
  if(!turnstile.success||turnstile.hostname!=='abbasbitar.github.io')return json({error:'Security verification failed'},403,origin);
  const reference=`MAP-${new Date().toISOString().slice(0,10).replaceAll('-','')}-${body.submissionId.slice(0,8).toUpperCase()}`;
  const report=formatReport(generate(body.data),reference);
  // Telegram sendDocument supports reports larger than sendMessage's 4096-character limit.
  const payload=new FormData();payload.append('chat_id',env.TELEGRAM_CHAT_ID);payload.append('caption',`New Meta Ads Planner submission: ${reference}`);payload.append('document',new Blob([report],{type:'text/plain;charset=utf-8'}),`${reference}.txt`);
  let response,result;
  try{response=await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendDocument`,{method:'POST',body:payload,signal:AbortSignal.timeout(12000)});result=await response.json()}catch{return json({error:'Delivery uncertain. Contact the campaign owner before retrying.'},502,origin)}
  if(!response.ok||!result.ok){console.error('Telegram delivery failed',response.status,result.error_code);return json({error:'Delivery failed. Contact the campaign owner.'},502,origin)}
  await env.SUBMISSIONS.put(key,reference,{expirationTtl:86400});
  return json({success:true,reference},200,origin);
 }
};
