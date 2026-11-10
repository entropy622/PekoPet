import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {resolve} from 'node:path';
import {parse} from 'yaml';
import {prepareRuntime} from '../agent/configuration.mjs';
import {runInNewContext} from 'node:vm';
import {visibleText} from '../plugin/frontend/text.mjs';
function module(){let result;runInNewContext(readFileSync('plugin/frontend/client.js','utf8'),{document:{title:''},window:{__ModuleLoader__:{load:row=>{result=row.factory(name=>name==='@deepseek-ai/dsh-client-store'?{createSnapshotStore:value=>({getSnapshot:()=>value,set:next=>{value=next;},subscribe:()=>()=>{}})}:{useEffect:fn=>fn(),createElement:(component,props,...children)=>({component,props,children})});}}}});return result;}
test('React display projection hides streaming cues, preserves code and quoted terminators',()=>{
  const cue='[[peko:{"mix":{"星星眼":0.8,"a]]b":0.2},"hold":2500}]]';
  for(let end=1;end<cue.length;end++)assert.equal(visibleText('你好'+cue.slice(0,end),true),'你好');
  assert.equal(visibleText('你好'+cue+'喜欢！'+cue),'你好喜欢！');
  assert.equal(visibleText('`'+cue+'`'),'`'+cue+'`');
  assert.equal(visibleText('```json\n'+cue+'\n```'),'```json\n'+cue+'\n```');
  assert.equal(visibleText('[[peko:{"bad":'), '');
  assert.equal(visibleText('文字 😊'),'文字 😊');
});
test('PekoPet keeps settings on demand and preserves dsh chat ownership',()=>{
  const {apply}=module(),registrations=[];
  const ctx={slots:{register:(options,component)=>{registrations.push({options,component});return()=>{};},inject:(_key,fn)=>fn()},effect:fn=>fn(),uiSession:{adapter:{current:{getSnapshot:()=>({key:undefined}),subscribe:()=>()=>{}}}}};
  apply(ctx);
  assert.ok(registrations.some(row=>row.options.name==='shell.overlay'&&row.options.id==='peko-shell'));
  assert.equal(registrations.some(row=>row.options.name.startsWith('sidebar.')),false);
  assert.equal(registrations.some(row=>row.options.name==='root'||row.options.name==='conversation.chat.node'),false);
  assert.equal(registrations.filter(row=>row.options.name==='main').length,4);
  let completed=0;
  for(const id of ['welcome-notice','deepseek-official']){
    const entry=registrations.find(row=>row.options.name==='settings.onboarding'&&row.options.id===id);
    assert.equal(entry.options.priority,-100);
    assert.equal(entry.options.children,undefined);
    assert.equal(entry.component({complete:()=>completed++}),null);
  }
  assert.equal(completed,2);
  assert.equal(registrations.find(row=>row.options.id==='current-version').component(),null);
});

test('embedded overlay removes upstream branding and feedback without disabling model settings',t=>{
  const root=mkdtempSync(resolve('work/overlay-test-'));t.after(()=>rmSync(root,{recursive:true}));
  const rows=prepareRuntime(root,{embedded:true}).rows;
  for(const id of ['ui-brand-official','ui-message-feedback','ui-settings-account','command-feedback'])assert.equal(rows.some(row=>row.id===id&&!row.disabled),false);
  for(const id of ['ui-settings-models','ui-model-selection','ui-approval','ui-user-questions'])assert.equal(rows.some(row=>row.id===id&&row.disabled),false);
});

test('history includes only managed root conversations ordered by recent activity',()=>{
  const {historyRows}=module();
  const rows=[{id:'old',updatedAt:1},{id:'new',updatedAt:8,title:'今天'},{id:'other',updatedAt:9},{id:'blank',updatedAt:10,blank:true},{id:'child',updatedAt:11,parentId:'new'},{id:'subagent',updatedAt:12,origin:'subagent'},{id:'peko-memory-test',updatedAt:13}];
  const catalog={ids:rows.map(row=>row.id),byId:Object.fromEntries(rows.map(row=>[row.id,row]))};
  assert.equal(JSON.stringify(historyRows(catalog,rows.filter(row=>row.id!=='other')).map(row=>row.id)),JSON.stringify(['new','old']));
});

test('vendored chat and composer share the browser runtime and own their CSS lifecycle',()=>{
  for(const folder of ['dsh-ui-chat','dsh-ui-conversation']){
    const text=readFileSync(`vendor/${folder}/client.js`,'utf8');
    assert.equal(text.includes('require("@deepseek-ai/dsh-token-meter/client")'),false);
    assert.ok(text.includes('const result={...module.exports,apply:ctx=>'));
    assert.ok(text.includes('return result;'));
  }
});

test('character picker is built from the shared avatar metadata',()=>{
  const source=readFileSync('plugin/frontend/client.source.jsx','utf8');
  assert.ok(source.includes('Object.entries(avatarMetadata.avatars).map'));
  assert.ok(readFileSync('plugin/frontend/client.js','utf8').includes('DeepSeek-chan'));
});
