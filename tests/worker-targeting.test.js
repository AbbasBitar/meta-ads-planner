import test from 'node:test';
import assert from 'node:assert/strict';
import { generate } from '../worker/planner.js';

const base = {
  client:'A', page:'B', representative:'C', product:'Newborn sessions',
  description:'Photography for newborn babies', audience:'Parents', locations:'Beirut',
  channels:['Instagram Direct'], budget:'20', days:'4', minAge:'23', maxAge:'45',
  budgetType:'lifetime', goal:'profile', category:'Photography', language:'English',
  platform:'manager', post:'new', gender:'All', creative:'Single image'
};

test('newborn photography omits unrelated wedding photography interest', () => {
  const report = generate(base);
  assert.ok(report.interests.includes('Baby shower'));
  assert.ok(!report.interests.includes('Wedding photography'));
});

test('generic photography retains broad photography suggestions', () => {
  const report = generate({...base, product:'Event photos', description:'Events', audience:'Adults'});
  assert.ok(report.interests.includes('Photography'));
  assert.ok(!report.interests.includes('Wedding photography'));
});

test('explicit representative interests are preserved as unverified suggestions', () => {
  const report = generate({...base, interests:'Local parents, Family activities'});
  assert.ok(report.interests.includes('Local parents'));
  assert.ok(report.interests.includes('Family activities'));
  assert.match(report.interestNotice,/verified in Meta/i);
});

test('non-photography categories keep their own suggestions', () => {
  const report = generate({...base, category:'Baby', product:'Newborn clothing'});
  assert.ok(report.interests.includes('Baby shower'));
  assert.ok(!report.interests.includes('Wedding photography'));
});
