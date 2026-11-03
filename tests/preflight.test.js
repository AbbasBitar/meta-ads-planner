import test from 'node:test';
import assert from 'node:assert/strict';
import { preflightCampaign } from '../src/preflight.js';
const base={client:'Client',page:'Page',representative:'Rep',product:'Newborn photography',category:'Photography',locations:'Beirut',audience:'Parents',post:'new',postUrl:'',goal:'profile',channels:['Instagram Direct'],budget:'20',budgetType:'lifetime',days:'4',minAge:'23',maxAge:'45'};
test('valid campaign has no blocking errors and retains Meta verification',()=>{
 const result=preflightCampaign(base);
 assert.deepEqual(result.blocking,[]);
 assert.match(result.checks.join(' '),/Meta/);
 assert.match(result.checks.join(' '),/consent/);
});
test('low budget guidance is advisory',()=>{
 const result=preflightCampaign({...base,budget:'4',days:'4'});
 assert.deepEqual(result.blocking,[]);
 assert.match(result.warnings.join(' '),/below \$5/);
});
test('multiple posts require lifetime allocation and valid total',()=>{
 const data={...base,post:'multiple',budgetType:'daily',budget:'45',postEntries:'https://www.instagram.com/p/Abcd1/ | 20\nhttps://www.instagram.com/p/Abcd2/ | 25'};
 assert.match(preflightCampaign(data).blocking.join(' '),/Lifetime/);
 assert.deepEqual(preflightCampaign({...data,budgetType:'lifetime'}).blocking,[]);
 assert.match(preflightCampaign({...data,budget:'44',budgetType:'lifetime'}).blocking.join(' '),/sum/);
});
test('message goal warns about missing messaging destinations',()=>{
 assert.match(preflightCampaign({...base,goal:'messages',channels:['Phone']}).warnings.join(' '),/messaging destination/);
});
test('sales without website does not invent purchase tracking',()=>{
 assert.match(preflightCampaign({...base,goal:'sales'}).warnings.join(' '),/objective clarification/);
});
