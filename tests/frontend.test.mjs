import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {visibleText} from '../plugin/frontend/text.mjs';
function module(){let result;runInNewContext(readFileSync('plugin/frontend/client.js','utf8'),{window:{__ModuleLoader__:{load:row=>{result=row.factory(()=>({createElement:(component,props,...children)=>({component,props,children})}));}}}});return result;}
test('React display projection hides streaming cues, preserves code and quoted terminators',()=>{
  const cue='[[peko:{"mix":{"星星眼":0.8,"a]]b":0.2},"hold":2500}]]';
  for(let end=1;end<cue.length;end++)assert.equal(visibleText('你好'+cue.slice(0,end),true),'你好');
  assert.equal(visibleText('你好'+cue+'喜欢！'+cue),'你好喜欢！');
  assert.equal(visibleText('`'+cue+'`'),'`'+cue+'`');
  assert.equal(visibleText('```json\n'+cue+'\n```'),'```json\n'+cue+'\n```');
  assert.equal(visibleText('[[peko:{"bad":'), '');
  assert.equal(visibleText('文字 😊'),'文字 😊');
});
test('PekoPet uses public overlay and brand slots without replacing dsh node ownership',()=>{
  const {apply}=module(),registrations=[];
  const ctx={slots:{register:(options,component)=>{registrations.push({options,component});return()=>{};},inject:(_key,fn)=>fn()},effect:fn=>fn(),uiSession:{adapter:{current:{getSnapshot:()=>({key:undefined}),subscribe:()=>()=>{}}}}};
  apply(ctx);
  assert.ok(registrations.some(row=>row.options.name==='shell.overlay'&&row.options.id==='peko-shell'));
  assert.ok(registrations.some(row=>row.options.name==='sidebar.brand.mark'));
  assert.equal(registrations.some(row=>row.options.name==='root'||row.options.name==='conversation.chat.node'),false);
  assert.equal(registrations.filter(row=>row.options.name==='main').length,4);
});

test('vendored Chat bundles browser utilities and returns its CSS-owning apply wrapper',()=>{
  const text=readFileSync('vendor/dsh-ui-chat/client.js','utf8');
  assert.equal(text.includes('require("@deepseek-ai/dsh-token-meter/client")'),false);
  assert.ok(text.includes('const result={...module.exports,apply:ctx=>'));
  assert.ok(text.includes('return result;'));
});
