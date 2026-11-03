import test from 'node:test';
import assert from 'node:assert/strict';
import {parsePostEntries,validate,calculateBudget} from '../src/intake.js';
import {checkSubmission} from '../worker/index.js';
import {generate} from '../worker/planner.js';

const entries='https://www.instagram.com/p/ABC123/ | 10\nhttps://www.instagram.com/reel/DEF456/ | 15.50';
const base={client:'Client',page:'Page',representative:'Rep',product:'Baby clothing',locations:'Beirut',audience:'Parents',channels:['Instagram Direct'],budget:'25.50',days:'5',minAge:'23',maxAge:'45',budgetType:'lifetime',goal:'profile',category:'Baby',language:'English',platform:'boost',post:'multiple',postEntries:entries,gender:'Women',creative:'Single image'};
const submission=d=>({data:d,turnstileToken:'test-token',submissionId:'123e4567-e89b-42d3-a456-426614174000'});

test('accepts two existing posts with custom budgets end-to-end',()=>{
  assert.deepEqual(validate(base),[]);
  assert.deepEqual(checkSubmission(submission(base)),[]);
  const report=generate(base);
  assert.equal(report.postEntries.length,2);
  assert.deepEqual(report.postEntries.map(x=>x.budget),[10,15.5]);
  assert.equal(report.totalBudget,25.5);
  assert.equal(calculateBudget(base).averageDaily,5.1);
});
test('rejects mismatched total budget',()=>assert.ok(validate({...base,budget:'20'}).length));
test('rejects invalid, duplicated and non-HTTPS post URLs',()=>{
  for(const value of [entries.replace('https://www.instagram.com/reel/DEF456/','https://example.com/'),entries.replace('https://www.instagram.com/reel/DEF456/','https://www.instagram.com/p/ABC123/'),entries.replace('https://www.instagram.com/reel/DEF456/','http://www.instagram.com/reel/DEF456/')]){
    assert.ok(checkSubmission(submission({...base,postEntries:value})).length);
  }
});
test('rejects invalid custom amounts and more than ten posts',()=>{
  assert.equal(parsePostEntries(entries.replace('15.50','-1')),null);
  assert.equal(parsePostEntries(entries.replace('15.50','15.555')),null);
  assert.equal(parsePostEntries(Array.from({length:11},(_,i)=>`https://www.instagram.com/p/P${i}/ | 1`).join('\n')),null);
});
test('preserves single existing post behavior',()=>{
  const single={...base,post:'existing',postUrl:'https://www.instagram.com/p/ABC123/',budget:'20'};
  assert.deepEqual(checkSubmission(submission(single)),[]);
  assert.deepEqual(generate(single).postEntries,[]);
});
