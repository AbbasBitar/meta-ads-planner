import { recommendTargeting } from './dynamic-targeting.js';
export const required = ['client','page','representative','product','locations','audience'];
export function validPostUrl(value) {
  if (typeof value !== 'string' || value.length > 250) return false;

  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();

    if (url.protocol !== 'https:' ||
        url.username || url.password ||
        url.port || !['www.instagram.com', 'instagram.com', 'm.instagram.com',
                      'www.facebook.com', 'facebook.com', 'm.facebook.com',
                      'web.facebook.com', 'fb.watch'].includes(host)) {
      return false;
    }

    if (host === 'fb.watch') {
      return /^\/[A-Za-z0-9_-]+\/?$/.test(url.pathname);
    }

    return url.pathname.length > 1 && url.pathname !== '//';
  } catch {
    return false;
  }
}

export function parsePostEntries(value) {
  if(typeof value!=='string'||value.length>3000)return null;
  const lines=value.split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
  if(lines.length<2||lines.length>10)return null;
  const entries=[],seen=new Set();
  for(const line of lines){
    const parts=line.split('|').map(s=>s.trim());
    if(parts.length!==2||!validPostUrl(parts[0]))return null;
    const amount=Number(parts[1]);
    if(!/^\d+(?:\.\d{1,2})?$/.test(parts[1])||!Number.isFinite(amount)||amount<0.01||amount>100000)return null;
    const normalized=new URL(parts[0]).href;
    if(seen.has(normalized))return null;
    seen.add(normalized);entries.push({url:normalized,budget:amount});
  }
  if(entries.reduce((sum,e)=>sum+Math.round(e.budget*100),0)>10000000)return null;
  return entries;
}
export function validate(x){
  if (x.post === 'multiple') {
    const entries=parsePostEntries(x.postEntries);
    if(!entries)return ['Provide 2–10 unique valid HTTPS Instagram/Facebook post URLs, each followed by | and its USD budget (maximum $100,000 combined).'];
    const sum=entries.reduce((total,e)=>total+Math.round(e.budget*100),0)/100;
    if(Math.abs(Number(x.budget)-sum)>0.001)return ['Total budget must equal the sum of individual post budgets'];
  }
  if (x.post === 'existing' && !String(x.postUrl ?? '').trim()) {
    return ['Post / Reel URL is required when using an existing post'];
  }
  if (String(x.postUrl ?? '').trim() && !validPostUrl(x.postUrl.trim())) {
    return ['Enter a valid HTTPS Instagram or Facebook post URL'];
  }

 const errors=[];
 if(typeof x.category!=='string'||!x.category.trim()||x.category.length>120) errors.push('Business type / industry is required (up to 120 characters)');
 for(const k of required) if(!String(x[k]??'').trim()) errors.push(`${k} is required`);
 const money=Number(x.budget), days=Number(x.days), min=Number(x.minAge), max=Number(x.maxAge);
 if(!Number.isFinite(money)||money<=0||money>100000) errors.push('Budget must be between $0.01 and $100,000');
 if(!Number.isInteger(days)||days<1||days>365) errors.push('Duration must be 1–365 days');
 if(!Number.isInteger(min)||!Number.isInteger(max)||min<18||max>65||min>max) errors.push('Age range must be 18–65, with minimum <= maximum');
 if(!Array.isArray(x.channels)||!x.channels.length) errors.push('Choose at least one contact channel');
 if(x.goal==='website'&&!/^https:\/\/[^\s.]+\.[^\s]+$/i.test(x.destination||'')) errors.push('Website traffic requires a valid HTTPS website URL');
 return errors;
}
export function calculateBudget(x){const amount=Number(x.budget),days=Number(x.days);return {total:x.budgetType==='daily'?amount*days:amount,averageDaily:x.budgetType==='daily'?amount:amount/days,days};}
const objectives={profile:['Traffic','Instagram or Facebook → Instagram profile','Maximize Instagram profile visits','Visit Instagram profile'],messages:['Engagement','Messaging apps (if available)','Maximize conversations','Send message'],sales:['Sales or Engagement','Choose based on measurable purchase/booking path','Purchases if tracked; otherwise conversations','Shop now / Send message'],reach:['Awareness','Ad account / relevant identity','Maximize reach','Learn more'],engagement:['Engagement','On your ad','Maximize post engagement','Learn more'],website:['Traffic','Website','Maximize landing page views','Learn more']};
export function generate(x){const errors=validate(x);if(errors.length)throw new Error(errors.join('; '));const budget=calculateBudget(x);const [objective,location,performance,cta]=objectives[x.goal]||objectives.profile;const targeting=recommendTargeting(x);const ideas=targeting.interests;const channels=x.channels.join(', ');const isPhotography=/photo|portrait|تصوير|فوتوغراف/i.test([x.category,x.description,x.product].join(' '));const intro=x.language==='Arabic'?`اكتشفوا ${x.product} ✨\nتابعوا صفحتنا وشاهدوا أعمالنا. للحجز والاستفسار تواصلوا معنا عبر ${channels}.`:x.language==='English'?`Discover ${x.product} ✨\nExplore our work and follow our page. For details or bookings, contact us via ${channels}.`:`اكتشفوا ${x.product} ✨ تواصلوا معنا للحجز.\nDiscover ${x.product}. Contact us for details or bookings.`;
return {client:x.client,page:x.page,handle:x.handle||'Not supplied',representative:x.representative,reference:x.reference||'Not assigned',business:x.category,product:x.product,description:x.description||'',platform:x.platform,post:x.post,postUrl:x.postUrl||'Not supplied',postEntries:x.post==='multiple'?parsePostEntries(x.postEntries):[],goal:x.goal,objective,conversionLocation:location,performanceGoal:performance,cta,locations:x.locations,locationGuidance:'Use precise city targeting where available; check radius units and coverage in Meta. Avoid excessive overlapping radii.',age:`${x.minAge}–${x.maxAge}`,gender:x.gender,audience:x.audience,interests:[...new Set(ideas)].slice(0,10),targetingDemographics:targeting.demographics,targetingSource:targeting.source,interestNotice:targeting.note+' Suggested interest search terms must be verified in Meta.',channels,budgetType:x.budgetType,totalBudget:budget.total,averageDaily:budget.averageDaily,durationDays:budget.days,creative:x.creative,placements:x.goal==='profile'?'Instagram Feed, Stories, Reels (verify supported placements; manual restrictions may increase costs)':'Advantage+ placements initially; review actual destination and platform compatibility',caption:intro,tracking:x.goal==='website'?'Verify website tracking, consent and events before publishing':'Track profile visits, messages, bookings and spend; no website pixel required for profile visits',notes:x.notes||'',warnings:[...(budget.averageDaily<5?['Low average daily budget may limit delivery.']:[]),...(isPhotography?['Use only customer images with appropriate consent, particularly photos of children.']:[]),...(x.goal==='sales'&&!x.channels.includes('Website')?['Without tracked purchases, a messaging-oriented objective may better match the actual booking process.']:[])],checklist:['Verify ad account status, payment method and spending limits','Confirm Instagram identity and profile destination','Review city/radius coverage and audience size','Verify interests and available performance goals in Meta','Preview every selected placement and check image cropping','Confirm budget type, total and end date','Check caption, CTA and contact channel','Publish only after client approval; monitor spend and delivery']};}
