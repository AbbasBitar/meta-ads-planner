import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { LEGACY_CAMPAIGN_PAYLOAD, LEGACY_FORM_ENTRIES } from './fixtures/legacy-campaign-payload.js';

const html=readFileSync('index.html','utf8');
const app=readFileSync('app.js','utf8');

test('representative page contains no smart objective preview or technical recommendation output',()=>{
  assert.doesNotMatch(html,/objectivePreview|previewMessageDestination|previewSalesOutcome|candidateMetaObjective|performanceGoal|verificationRequirements/i);
  assert.doesNotMatch(app,/adaptLegacyObjective|recommendCampaignObjective|candidateMetaObjective|verificationRequirements|objectivePreview/i);
  assert.match(app,/import\s*\{validate,calculateBudget\}\s*from\s*['"]\.\/src\/intake\.js['"]/);
});

test('representative intake preserves legacy form fields and exact payload serialization',()=>{
  for(const [name] of LEGACY_FORM_ENTRIES){
    if(name==='channels')assert.match(html,/name="channels"/);
    else assert.match(html,new RegExp(`name="${name}"`),`missing representative field ${name}`);
  }
  const start=app.indexOf('function getData()'),end=app.indexOf('function money(',start);
  assert.ok(start>=0&&end>start,'legacy getData function must exist');
  class MockFormData{
    constructor(){this.entries=LEGACY_FORM_ENTRIES.map(([key,value])=>[key,value]);}
    delete(key){this.entries=this.entries.filter(([name])=>name!==key);}
    *keys(){for(const [key] of this.entries)yield key;}
    get(key){return this.entries.find(([name])=>name===key)?.[1]??null;}
    getAll(key){return this.entries.filter(([name])=>name===key).map(([,value])=>value);}
  }
  const context=vm.createContext({FormData:MockFormData,form:{}});
  const payload=JSON.parse(JSON.stringify(vm.runInContext(`${app.slice(start,end)}\ngetData()`,context)));
  assert.deepEqual(payload,LEGACY_CAMPAIGN_PAYLOAD);
  assert.equal(JSON.stringify(payload),JSON.stringify(LEGACY_CAMPAIGN_PAYLOAD));
});

test('build publishes frontend-required modules without copying private planning modules',()=>{
  const build=readFileSync('scripts/build.mjs','utf8');
  assert.match(build,/copyFile\("src\/intake\.js",\s*"dist\/src\/intake\.js"\)/);
  assert.match(build,/writeFile\("dist\/src\/planner\.js"/);
  assert.doesNotMatch(build,/cp\("src"|recommendation\.js|legacy-objective-adapter\.js/);
});
