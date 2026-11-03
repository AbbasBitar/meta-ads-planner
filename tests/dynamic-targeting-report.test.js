import test from 'node:test';
import assert from 'node:assert/strict';
import { recommendTargeting } from '../worker/dynamic-targeting.js';
import { generate } from '../worker/planner.js';
import { checkSubmission, formatReport } from '../worker/index.js';
import { privateObjectiveDecision } from '../worker/private-recommendation.js';

const base={client:'Client',page:'Page',representative:'Rep',category:'Photography',product:'Newborn sessions',locations:'Saida',audience:'Parents of infants',channels:['Instagram Direct'],budget:'20',days:'4',minAge:'23',maxAge:'45',budgetType:'lifetime',goal:'profile',language:'English',platform:'manager',post:'new',gender:'All',creative:'Single image'};
test('newborn targeting proposes demographic and interest categories separately',()=>{
 const result=recommendTargeting(base);
 assert.ok(result.demographics.includes('Parents (up to 12 months)'));
 assert.ok(result.interests.includes('Baby shower'));
 assert.doesNotMatch(result.note,/confirmed available/i);
});
test('arbitrary business type is accepted and gets a clearly unverified product search term',()=>{
 const data={...base,category:'Pet services',product:'Dog grooming and washing',audience:'Dog owners'};
 assert.deepEqual(checkSubmission({data,submissionId:'12345678-1234-4123-8123-123456789012',turnstileToken:'token'}),[]);
 const targeting=recommendTargeting(data);
 assert.ok(targeting.interests.includes('Dog grooming and washing'));
 assert.equal(targeting.source,'no confident category match');
 assert.deepEqual(targeting.demographics,[]);
});
test('automotive and education do not inherit newborn suggestions',()=>{
 for(const [category,product,expected] of [['Car detailing','Vehicle polishing','Car care'],['Online education','Python training courses','Online learning']]){
  const r=recommendTargeting({...base,category,product,audience:'Adults'});
  assert.ok(r.interests.includes(expected));
  assert.ok(!r.demographics.includes('Parents (up to 12 months)'));
 }
});
test('explicit user interest ideas are kept unverified and deduplicated',()=>{
 const r=recommendTargeting({...base,interests:'Baby shower, Local families, Local families'});
 assert.equal(r.interests.filter(x=>x==='Baby shower').length,1);
 assert.equal(r.interests.filter(x=>x==='Local families').length,1);
});
test('compact report follows Campaign, Ad Set, Ad order and does not promise targeting',()=>{
 const p=generate(base),decision=privateObjectiveDecision(base);
 const report=formatReport(p,'MAP-TEST',decision);
 assert.ok(report.indexOf('CAMPAIGN')<report.indexOf('AD SET'));
 assert.ok(report.indexOf('AD SET')<report.indexOf('\nAD\n'));
 assert.match(report,/Detailed targeting — demographics/);
 assert.match(report,/unverified search suggestions/);
 assert.doesNotMatch(report,/Caption suggestion|PRE-PUBLISH CHECKLIST/);
 assert.ok(report.split('\n').length<45);
});
test('unresolved sales objective remains explicitly unconfirmed',()=>{
 const data={...base,goal:'sales'};
 const report=formatReport(generate(data),'MAP-TEST',privateObjectiveDecision(data));
 assert.match(report,/Objective: Needs confirmation in Meta/);
 assert.match(report,/Objective clarification:/);
});

test('unrelated words do not accidentally trigger automotive or jewelry targeting',()=>{
 const r=recommendTargeting({...base,category:'Home services',product:'Carpet cleaning for spring',audience:'Homeowners'});
 assert.ok(!r.interests.includes('Car care'));
 assert.ok(!r.interests.includes('Jewelry'));
});
test('unknown category does not invent demographics',()=>{
 const r=recommendTargeting({...base,category:'Custom industrial service',product:'Industrial calibration',audience:'Factory operators'});
 assert.deepEqual(r.demographics,[]);
 assert.match(r.note,/not confirmed Meta targeting options/);
});

test('staged deployment accepts legacy Other category with free-text industry description',()=>{
 const data={...base,category:'Other',description:'Car detailing',product:'Vehicle polishing',audience:'Vehicle owners'};
 const r=generate(data);
 assert.ok(r.interests.includes('Car care'));
 assert.match(formatReport(r,'MAP-TEST',privateObjectiveDecision(data)),/Business: Car detailing/);
 assert.deepEqual(checkSubmission({data,submissionId:'12345678-1234-4123-8123-123456789012',turnstileToken:'token'}),[]);
});
