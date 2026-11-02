import test from 'node:test';import assert from 'node:assert/strict';import {checkSubmission} from '../worker/index.js';
const data={client:'A',page:'B',representative:'C',product:'Baby photos',locations:'Beirut',audience:'Parents',channels:['Instagram Direct'],budget:'20',days:'4',minAge:'23',maxAge:'45',budgetType:'lifetime',goal:'profile',category:'Photography',language:'English',platform:'manager',post:'new',gender:'All',creative:'Single image'};
const body={data,turnstileToken:'test-token',submissionId:'123e4567-e89b-42d3-a456-426614174000'};
test('accepts valid submission',()=>assert.deepEqual(checkSubmission(body),[]));
test('rejects missing challenge',()=>assert.ok(checkSubmission({...body,turnstileToken:''}).length));
test('rejects unexpected fields',()=>assert.ok(checkSubmission({...body,data:{...data,admin:true}}).length));
test('rejects oversized input',()=>assert.ok(checkSubmission({...body,data:{...data,notes:'x'.repeat(1001)}}).length));
test('rejects invalid enum',()=>assert.ok(checkSubmission({...body,data:{...data,goal:'hack'}}).length));
test('rejects invalid budget',()=>assert.ok(checkSubmission({...body,data:{...data,budget:'-2'}}).length));

test('accepts business description and destination together', () => {
  const submission = {
    ...body,
    data: {
      ...data,
      description: 'Photography services for families in Lebanon',
      destination: 'https://example.com'
    }
  };

  assert.deepEqual(checkSubmission(submission), []);
});
