import {_electron as electron} from '@playwright/test';
import {createRequire} from 'node:module';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {resolve,join,dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';

const root=resolve(import.meta.dirname,'..'),out=join(root,'work/avatar-behavior');mkdirSync(out,{recursive:true});
const home=mkdtempSync(join(root,'work/avatar-behavior-home-'));mkdirSync(join(home,'profiles/desktop'),{recursive:true});
writeFileSync(join(home,'profiles/desktop/cordis.patch.yml'),'- id: llm-deepseek-account\n  disabled: true\n- id: agent-default-model\n  config: {provider: peko-test, model: replay}\n');
const patch=join(home,'fixture.yml');writeFileSync(patch,`- insert:\n    - id: test-model\n      name: '${pathToFileURL(join(root,'tests/replay-adapter.mjs')).href}'\n`);
const app=await electron.launch({executablePath:createRequire(import.meta.url)('electron'),args:[root,'--peko-test'],env:{...process.env,DSH_HOME:home,PEKO_ROOT:root,PEKO_NODE:process.execPath,PEKO_USER_DATA:join(home,'user-data'),PEKO_AGENT_PATCH:patch},timeout:120000});
const report={passed:false,motions:[],recovery:[],errors:[]};
const until=async f=>{const end=Date.now()+120000;while(!await f()){if(Date.now()>end)throw Error('Timed out');await new Promise(r=>setTimeout(r,50));}};
app.on('window',page=>page.on('pageerror',error=>report.errors.push(String(error))));
try{
  await until(()=>app.windows().some(p=>p.url().startsWith('peko-app://app/')));
  const chat=app.windows().find(p=>p.url().startsWith('peko-app://app/'));await chat.waitForSelector('[data-peko-ready]',{timeout:120000});
  const invoke=(command,args={})=>chat.evaluate(({command,args})=>window.peko.invoke(command,args),{command,args});
  await chat.locator('.peko-more summary').click();await chat.getByRole('button',{name:'角色调试',exact:true}).click();
  for(const id of ['deepseek','yumi','strawberry-rabbit']){
    await chat.getByRole('combobox',{name:'角色',exact:true}).selectOption(id);
    await until(()=>app.windows().some(p=>p.url()==='peko-app://pet/?avatar='+id));const pet=app.windows().find(p=>p.url()==='peko-app://pet/?avatar='+id);
    await pet.waitForFunction(()=>window.__pekoAvatarTest,null,{timeout:90000});
    const descriptor=await pet.evaluate(()=>window.peko.invoke('avatar_descriptor'));
    for(const [name,file] of Object.entries(descriptor.motions)){
      const json=JSON.parse(readFileSync(join(dirname(join(root,'models',descriptor.avatar.library||descriptor.avatar.model)),file),'utf8'));
      const curves=json.Curves.filter(c=>c.Target==='Parameter').map(c=>c.Id);
      await pet.evaluate(()=>window.__pekoAvatarTest.release());
      const base=await pet.evaluate(()=>window.__pekoAvatarTest.inspect());
      await chat.getByRole('button',{name,exact:true}).click();
      await until(async()=>(await invoke('peko_state')).lastAvatarEvent?.cue?.motion===name);
      const result=await pet.evaluate(({base,curves,duration})=>{
        const test=window.__pekoAvatarTest,samples=[];let bestDelta=-1,bestPng='';
        for(let i=0;i<Math.ceil((duration+1)*5);i++){
          const state=test.step(.2),delta=Math.max(0,...curves.filter(id=>id in base.parameters).map(id=>Math.abs(state.parameters[id]-base.parameters[id])));
          samples.push({time:state.clock,visible:state.visiblePixels,delta,finished:state.motionFinished});
          if(delta>bestDelta){bestDelta=delta;bestPng=test.image();}
        }
        return {mapped:curves.filter(id=>id in base.parameters).length,curves:curves.length,samples,bestPng};
      },{base,curves,duration:json.Meta.Duration});
      assert.ok(result.mapped>0,'Motion must target actual model parameters');assert.ok(Math.max(...result.samples.map(s=>s.delta))>.01,'Motion must animate its own parameters');
      assert.ok(result.samples.every(s=>s.visible>1000),'Avatar must stay visible throughout the motion');assert.equal(result.samples.at(-1).finished,true,'Explicit motion must finish');
      writeFileSync(join(out,id+'-'+name+'.png'),Buffer.from(result.bestPng.split(',')[1],'base64'));delete result.bestPng;
      report.motions.push({id,name,...result});writeFileSync(join(out,'report.json'),JSON.stringify(report,null,2));console.log('Motion passed:',id,name);
      await chat.getByRole('button',{name:'恢复默认表现',exact:true}).click();await until(async()=>(await invoke('peko_state')).lastAvatarEvent?.cue?.clear===true);
    }
    const layer=descriptor.avatar.layers[0];if(layer)await invoke('peko_cue',{cue:{layers:{[layer]:true}}});
    const parameter=(await pet.evaluate(()=>window.__pekoAvatarTest.catalog.parameters)).find(p=>['AngleZ','ParamAngleZ'].includes(p.id));
    const expiry=await pet.evaluate(parameter=>{const t=window.__pekoAvatarTest;if(parameter)t.act({params:{[parameter.id]:parameter.max},hold:200});t.step(1.5);return t.inspect();},parameter);
    assert.deepEqual(expiry.mix,{});if(layer)assert.ok(expiry.layers.includes(layer));
    assert.equal(await pet.evaluate(()=>window.__pekoAvatarTest.loseContext()),true);
    await until(async()=>(await invoke('peko_state')).avatarError.includes('显卡上下文'));
    const navigation=pet.waitForEvent('domcontentloaded',{timeout:30000});await pet.evaluate(()=>window.__pekoAvatarTest.restoreContext());await navigation;
    await pet.waitForFunction(()=>window.__pekoAvatarTest,null,{timeout:90000});await until(async()=>!(await invoke('peko_state')).avatarError);
    const recovered=await pet.evaluate(()=>window.__pekoAvatarTest.step(.3));assert.ok(recovered.visiblePixels>1000);if(layer)assert.ok(recovered.layers.includes(layer));
    await (await app.browserWindow(pet)).evaluate(window=>window.setSize(420,620));await pet.waitForFunction(()=>innerWidth===420);assert.ok((await pet.evaluate(()=>window.__pekoAvatarTest.step(.1))).visiblePixels>1000);
    report.recovery.push({id,contextRestored:true,persistentLayerRestored:!!layer,resizeVisible:true});
  }
  assert.deepEqual(report.errors,[]);report.passed=true;writeFileSync(join(out,'report.json'),JSON.stringify(report,null,2));console.log('All '+report.motions.length+' motions, '+report.recovery.length+' GPU recovery/resize cases passed');
}finally{await app.close();}
