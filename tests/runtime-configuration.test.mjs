import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';
import {boot} from '@deepseek-ai/dsh-app-boot';
import {prepareRuntime,root} from '../agent/configuration.mjs';
function fixture(t){const home=mkdtempSync(join(tmpdir(),'peko-configuration-'));t.after(()=>rmSync(home,{recursive:true,force:true}));mkdirSync(join(home,'profiles/desktop'),{recursive:true});return home;}

test('owned runtime shares only model, MCP and skill configuration without loading desktop plugins',t=>{
  const home=fixture(t),file=join(home,'profiles/desktop/cordis.patch.yml');
  const text=`# Keep my desktop settings\n- id: agent-default-model\n  config: {provider: shared-test, model: first}\n- id: agent-loop\n  config: {agents: [{id: unexpected}]}\n- insert:\n    - id: unrelated\n      name: file:///must-not-load.mjs\n    - id: shared-mcp\n      name: '@deepseek-ai/dsh-mcp-client'\n      config: {serverName: shared, transport: stdio, command: fixture}\n`;
  writeFileSync(file,text);
  assert.equal(JSON.parse(readFileSync(join(root,'package.json'),'utf8')).dependencies['@deepseek-ai/dsh'],undefined);
  assert.equal(existsSync(join(root,'node_modules/@deepseek-ai/dsh/package.json')),false);
  writeFileSync(file,readFileSync(file,'utf8')+'- id: preset-standard\n  config:\n    plugins:\n      - id: skill-filesystem\n        name: \'@deepseek-ai/dsh-skill-filesystem\'\n        config: {customSkillDirs: [custom-root]}\n      - id: must-not-load\n        name: file:///not-a-skill-or-mcp.mjs\n');
  const value=prepareRuntime(home,{embedded:true});
  assert.match(value.rows.find(row=>row.id==='agent-loop').name,/vendor\/peko-agent-loop\/index.mjs$/);
  assert.deepEqual(value.rows.find(row=>row.id==='agent-loop').config.agents,[]);
  assert.equal(value.rows.some(row=>row.id==='unrelated'),false);
  assert.equal(value.rows.find(row=>row.id==='shared-mcp').config.serverName,'shared');
  assert.equal(value.rows.find(row=>row.id==='agent-default-model').config.model,'first');
  assert.equal(readFileSync(value.file,'utf8'),'[]\n');
  assert.equal(existsSync(join(home,'profiles/peko')),false);
  assert.ok(readFileSync(file,'utf8').startsWith(text));
  const preset=value.rows.find(row=>row.id==='preset-standard');assert.deepEqual(preset.config.plugins.find(p=>p.id==='skill-filesystem').config.customSkillDirs,['custom-root']);assert.equal(preset.config.plugins.some(p=>p.id==='must-not-load'),false);
  writeFileSync(file,text.replace('model: first','model: second'));
  assert.equal(prepareRuntime(home).rows.find(row=>row.id==='agent-default-model').config.model,'second');
});

test('provider settings edits use the shared source and leave unrelated desktop configuration intact',async t=>{
  const home=fixture(t),file=join(home,'profiles/desktop/cordis.patch.yml');
  writeFileSync(file,'# desktop comment\n- id: agent-default-model\n  config: {provider: peko-test, model: first}\n- id: desktop-only\n  config: {keep: yes}\n');
  const configuration=prepareRuntime(home);
  const ctx=await boot('PekoPet test',configuration.file,[{insert:configuration.rows.filter(row=>row.id!=='peko-bridge').map(row=>row.id==='schedule'?{...row,disabled:true}:row)}],ctx=>{ctx.provide('pekoConfiguration',configuration);ctx.provide('pekoReady',Promise.resolve());ctx.provide('appExit',()=>{});},pathToFileURL(root+'/').href);
  try{
    assert.equal(ctx.get('agentLoop').owner,'PekoPet');
    const editor=ctx.get('configEditor'),entry=editor.entries().find(row=>row.options.id==='agent-default-model');
    await editor.edit(entry,current=>({...current,model:'second'}));
    const text=readFileSync(file,'utf8');assert.ok(text.includes('# desktop comment'));assert.ok(text.includes('desktop-only'));assert.ok(text.includes('keep: yes'));assert.match(text,/model: second/);
    assert.equal(ctx.get('agentDefaultModel').currentSelection().model,'second');
    await assert.rejects(editor.edit(entry,()=>({provider:4,model:'bad'})));
    assert.equal(readFileSync(file,'utf8'),text);
    const external=text.replace('model: second','model: third');writeFileSync(file,external);
    await assert.rejects(editor.edit(entry,current=>({...current,model:'fourth'})),/已被其他应用修改/);
    assert.equal(readFileSync(file,'utf8'),external);
  }finally{await ctx.fiber.dispose();}
});
