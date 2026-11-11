import {_electron as electron} from '@playwright/test';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,cpSync} from 'node:fs';
import {join,resolve,dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
import {modelPath} from '../plugin/model-path.mjs';
import {State} from '../plugin/state.mjs';
const root=resolve(import.meta.dirname,'..'),out=resolve(process.env.PEKO_UI_OUT||join(root,'work/electron-checks'));mkdirSync(out,{recursive:true});
const home=mkdtempSync(join(root,'work/electron-check-home-')),project=join(home,'project'),profile=join(home,'profiles/desktop');mkdirSync(project);mkdirSync(profile,{recursive:true});
const cached=join(home,'peko-pet/models/LLM_Live2D/public/live2D/yumi');mkdirSync(dirname(cached),{recursive:true});cpSync(dirname(modelPath('yumi')),cached,{recursive:true});
writeFileSync(join(project,'fixture.txt'),'before');
writeFileSync(join(profile,'cordis.patch.yml'),'- id: llm-deepseek-account\n  disabled: true\n- id: agent-default-model\n  config:\n    provider: peko-test\n    model: replay\n');
const patch=join(home,'fixture.yml');writeFileSync(patch,`- insert:\n    - id: peko-test-adapter\n      name: '${pathToFileURL(join(root,'tests/replay-adapter.mjs')).href}'\n    - id: peko-ui-workspace\n      name: '${pathToFileURL(join(root,'tests/ui-workspace.mjs')).href}'\n`);
const runtimeRoot=process.env.PEKO_UI_ROOT||root,executable=process.env.PEKO_UI_EXE||createRequire(import.meta.url)('electron');
const args=process.env.PEKO_UI_EXE?['--peko-test']:[root,'--peko-test'];
{const seed=new State(join(home,'peko-pet/state.sqlite3'));if(process.env.PEKO_UI_EXE)seed.db.prepare('INSERT OR REPLACE INTO settings VALUES(1,?)').run(JSON.stringify({avatar:'deepseek'}));else seed.updateSettings({avatar:'yumi'});seed.close();}
const checks=[],snapshots=[],errors=[],runs=[];let app,page,pet,closing=false;
const until=async(test,timeout=45000)=>{const end=Date.now()+timeout;for(;;){if(await test())return;if(Date.now()>end)throw new Error('Condition timed out');await new Promise(r=>setTimeout(r,50));}};
async function launch(){
  closing=false;app=await electron.launch({executablePath:executable,args,env:{...process.env,DSH_HOME:home,PEKO_USER_DATA:join(home,'user-data'),PEKO_NODE:existsSync(join(runtimeRoot,'node.exe'))?join(runtimeRoot,'node.exe'):process.execPath,PEKO_ROOT:runtimeRoot,PEKO_AGENT_PATCH:patch,PEKO_TEST_PROJECT:project},timeout:120000});
  app.on('window',p=>{p.on('pageerror',error=>{if(!closing)errors.push(String(error));});});
  await until(()=>app.windows().some(p=>p.url().startsWith('peko-app://app/')));page=app.windows().find(p=>p.url().startsWith('peko-app://app/'));page.on('pageerror',error=>{if(!closing)errors.push(String(error));});
  await page.waitForSelector('[data-peko-ready]',{timeout:120000});
  await page.locator('[contenteditable=true]').first().waitFor();
  if(process.env.PEKO_UI_EXE&&!runs.length){await until(async()=>!!(await invoke('peko_state')).avatarError);assert.equal((await invoke('peko_state')).connected,true);await invoke('peko_request',{method:'peko.settings',params:{patch:{avatar:'yumi'}}});checks.push('missing saved private model leaves chat usable; selecting cached Yumi recovers the pet');}
  await until(()=>app.windows().some(p=>p.url().startsWith('peko-app://pet')));pet=app.windows().find(p=>p.url().startsWith('peko-app://pet'));
  assert.ok(pet);await pet.waitForFunction(()=>window.__pekoAvatarTest,null,{timeout:90000});
  await until(async()=>await page.locator('.peko-titlebar img').evaluate(image=>image.complete&&image.naturalWidth>0));
  assert.equal(new URL(page.url()).protocol,'peko-app:');assert.equal(await page.getByText('预览版说明',{exact:true}).count(),0);
  const caps=await invoke('peko_request',{method:'peko.capabilities'});assert.equal(caps.runtime.owner,'PekoPet');assert.equal(caps.runtime.transport,'ipc');assert.equal(caps.frontendUrl,undefined);
  await assert.rejects(()=>pet.evaluate(()=>window.peko.invoke('peko_state')),/无权/);
  await assert.rejects(()=>pet.evaluate(()=>window.peko.host('host.fetch',{path:'/api/'})),/IPC/);
  await assert.rejects(()=>invoke('peko_request',{method:'host.boot'}),/无效/);
  const windows=await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().map(w=>({visible:w.isVisible(),focused:w.isFocused()})));assert.ok(windows.every(w=>!w.visible&&!w.focused));
  runs.push({pid:app.process().pid,protocol:new URL(page.url()).protocol,transport:caps.runtime.transport});
}
const invoke=(command,args={})=>page.evaluate(({command,args})=>window.peko.invoke(command,args),{command,args});
async function stop(){closing=true;if(app){await app.close();app=undefined;}}
const snap=async(p,name)=>{const image=await (await app.browserWindow(p)).evaluate(async window=>await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Offscreen paint timed out')),15000);window.webContents.once('paint',(_event,_rect,image)=>{clearTimeout(timer);resolve(image.toPNG().toString('base64'));});window.webContents.invalidate();}));writeFileSync(join(out,name+'.png'),Buffer.from(image,'base64'));snapshots.push(name+'.png');};
async function pane(name){const back=page.getByRole('button',{name:'返回聊天',exact:true});if(name==='聊天与工作'){if(await back.isVisible())await back.click();return;}const nav=page.locator('.peko-settings-nav');if(await nav.isVisible())await nav.getByRole('button',{name,exact:true}).click();else{await page.locator('.peko-more summary').click();await page.locator('.peko-more-menu').getByRole('button',{name,exact:true}).click();}}
let selected;
try{
  await launch();checks.push('hidden Electron launches through local application protocol and private Node IPC, without browser authentication');
  for(const size of [{width:720,height:760},{width:600,height:620}]){
    await page.setViewportSize(size);
    for(const [key,label]of [['chat','聊天与工作'],['memory','共同记忆'],['persona','相处方式'],['models','模型与配置'],['avatar','角色调试']]){await pane(label);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await snap(page,key+'-'+size.width+'x'+size.height);}
  }
  checks.push('minimal conversation and every settings pane at 720x760 and 600x620');
  await page.setViewportSize({width:720,height:760});await pane('相处方式');await page.getByRole('textbox',{name:'人格',exact:true}).fill('你是离屏测试的 Peko，工作时简洁直接。');await page.getByRole('button',{name:'保存人格',exact:true}).click();
  await until(async()=>(await invoke('peko_state')).settings.persona==='你是离屏测试的 Peko，工作时简洁直接。');
  await pane('聊天与工作');const editor=page.locator('[contenteditable=true]').first();await editor.fill('离屏中文输入 😊');await editor.press('Enter');await page.getByText('你好，我是 Peko。',{exact:true}).first().waitFor({timeout:60000});await until(async()=>!(await invoke('peko_state')).busy);
  assert.equal((await page.locator('body').innerText()).includes('[[peko:'),false);await snap(page,'chat-streamed');selected=(await invoke('peko_state')).sessionId;
  await page.evaluate(()=>Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{window.__pekoCopied=text;}}}));await page.getByRole('button',{name:'复制',exact:true}).last().click();await until(async()=>await page.evaluate(()=>window.__pekoCopied==='你好，我是 Peko。'));
  checks.push('original editor sends Chinese and emoji; streamed display and copy exclude avatar markers');
  const send=async text=>{await editor.fill(text);await editor.press('Enter');};
  await send('files');await until(()=>readFileSync(join(project,'fixture.txt'),'utf8')==='after',60000);await until(async()=>!(await invoke('peko_state')).busy);await snap(page,'file-tools');
  await send('approval');await page.getByRole('button',{name:'允许一次',exact:true}).waitFor();await snap(page,'approval');await page.getByRole('button',{name:'允许一次',exact:true}).click();await until(async()=>!(await invoke('peko_state')).busy);
  await send('approval');await page.getByRole('button',{name:'拒绝',exact:true}).waitFor();await page.getByRole('button',{name:'拒绝',exact:true}).click();await until(async()=>!(await invoke('peko_state')).busy);
  await send('questions');await page.getByText('绿色',{exact:true}).click();await page.getByPlaceholder('输入你的答案',{exact:true}).fill('离屏回答');await snap(page,'questions');await page.getByRole('button',{name:'提交',exact:true}).click();await until(async()=>!(await invoke('peko_state')).busy);
  await send('cancel');const cancel=page.getByRole('button',{name:'停止生成',exact:true});await cancel.waitFor();await cancel.click();await until(async()=>!(await invoke('peko_state')).busy);await cancel.waitFor({state:'hidden'});assert.equal((await page.locator('body').innerText()).includes('[[peko:'),false);
  checks.push('real file tools, approval allow/reject, choice and free-text questions, and Stop over the IPC Remote streams');
  const before=(await invoke('peko_state')).semanticApplied;await send('avatar-live');await until(async()=>(await invoke('peko_state')).semanticApplied>before);assert.equal((await invoke('peko_state')).busy,true,'Expression must begin before the reply finishes');assert.equal((await invoke('peko_state')).lastAvatarEvent.source,'assistant');await until(async()=>await pet.evaluate(()=>window.__pekoAvatarTest.inspect().weights['星星眼']>.1));await until(async()=>!(await invoke('peko_state')).busy);
  checks.push('real root assistant marker changes the avatar before reply completion');
  const validBefore=(await invoke('peko_state')).semanticApplied;await send('avatar-invalid-then-valid');await until(async()=>(await invoke('peko_state')).semanticApplied>validBefore);await until(async()=>!(await invoke('peko_state')).busy);assert.equal((await invoke('peko_state')).avatarError,'');checks.push('an unsupported cue does not suppress later valid cues in the same real stream');
  await invoke('peko_request',{method:'peko.memory',params:{action:'add',text:'用户喜欢草莓兔兔'}});
  await pane('共同记忆');await page.getByText('用户喜欢草莓兔兔',{exact:true}).waitFor();await snap(page,'memory-saved');
  await pane('角色调试');
  const picker=page.getByRole('combobox',{name:'角色',exact:true});
  const {PNG}=createRequire(import.meta.url)('pngjs');
  for(const id of ['yumi','deepseek','strawberry-rabbit']){
    if(id!=='yumi'&&!existsSync(join(runtimeRoot,'models',id==='deepseek'?'deepseek/DeepSeek/大肥鱼.model3.json':'strawberry-rabbit/草莓兔兔1/草莓兔兔.model3.json')))continue;
    await picker.selectOption(id);await pet.waitForURL('peko-app://pet/?avatar='+id);await until(async()=>(await invoke('peko_state')).settings.avatar===id);const nameById={yumi:'Yumi',deepseek:'DeepSeek-chan（大肥鱼）','strawberry-rabbit':'草莓兔兔 DLC'};await pet.waitForFunction(name=>window.__pekoAvatarTest?.catalog.name===name,nameById[id],{timeout:90000});await until(async()=>(await invoke('peko_state')).catalog.name===nameById[id]);
    const data=await pet.evaluate(()=>({stats:window.__pekoAvatarTest.stats,catalog:window.__pekoAvatarTest.catalog,png:window.__pekoAvatarTest.release()}));
    const png=PNG.sync.read(Buffer.from(data.png.split(',')[1],'base64'));assert.equal(png.data[3],0,'Canvas corner must be transparent');let visible=0;for(let i=3;i<png.data.length;i+=4)if(png.data[i]>20)visible++;assert.ok(visible>png.width*png.height*.03,'Model must render visible pixels');
    writeFileSync(join(out,id+'-neutral.png'),Buffer.from(data.png.split(',')[1],'base64'));snapshots.push(id+'-neutral.png');
    const name=data.catalog.expressions.find(n=>n.includes('星星'))||data.catalog.expressions[0];
    const expression=await pet.evaluate(name=>window.__pekoAvatarTest.capture({mix:{[name]:1}}),name);const changed=PNG.sync.read(Buffer.from(expression.split(',')[1],'base64'));let difference=0;for(let i=0;i<png.data.length;i++)if(Math.abs(png.data[i]-changed.data[i])>10)difference++;assert.ok(difference>100,'Expression must change real model pixels');
    writeFileSync(join(out,id+'-expression.png'),Buffer.from(expression.split(',')[1],'base64'));snapshots.push(id+'-expression.png');
    if(data.catalog.layers.length){await invoke('peko_cue',{cue:{layers:{[data.catalog.layers[0]]:true}}});await until(async()=>(await invoke('peko_state')).avatarState.layers[data.catalog.layers[0]]===true);await snap(pet,id+'-layer');await invoke('peko_cue',{cue:{clear:true}});}
    checks.push(id+': real WebGL render, transparent pixels, visible expression change, persistent layer and '+data.stats.maskBuffers+' mask buffers');
  }
  await picker.selectOption('yumi');await until(async()=>(await invoke('peko_state')).settings.avatar==='yumi');
  await pet.waitForFunction(()=>window.__pekoAvatarTest?.catalog.name==='Yumi',null,{timeout:90000});await page.getByRole('heading',{name:'Yumi',exact:true}).waitFor();
  const selectedFile=modelPath('yumi');await page.getByRole('textbox',{name:'模型文件路径',exact:true}).fill(selectedFile);await page.getByRole('button',{name:'应用路径',exact:true}).click();
  await until(async()=>(await invoke('peko_state')).modelPaths.yumi===selectedFile);await pet.waitForFunction(()=>window.__pekoAvatarTest?.catalog.name==='Yumi',null,{timeout:90000});
  await page.getByText('当前文件：'+selectedFile,{exact:true}).waitFor();await snap(page,'model-location');
  await assert.rejects(()=>invoke('avatar_location',{id:'yumi',path:selectedFile.replace('yumi.model3.json','missing.model3.json')}));assert.equal((await invoke('peko_state')).modelPaths.yumi,selectedFile);
  checks.push('fixed-character model path is saved, hot-reloaded, validated and retained without copying resources');
  await picker.selectOption('yumi');await until(async()=>(await invoke('peko_state')).settings.avatar==='yumi');await pet.waitForFunction(()=>window.__pekoAvatarTest?.catalog.name==='Yumi',null,{timeout:90000});
  const previous=(await invoke('peko_state')).latencies.length;
  for(let i=0;i<20;i++){await invoke('peko_cue',{cue:{params:{ParamAngleZ:i%2?3:-3},hold:500}});await until(async()=>(await invoke('peko_state')).latencies.length>previous+i);}
  const latencies=(await invoke('peko_state')).latencies.slice(-20).sort((a,b)=>a-b),p95=latencies[Math.ceil(latencies.length*.95)-1];assert.ok(p95<=100,'Avatar local latency P95 '+p95+' ms');checks.push('20 local avatar events P95 '+p95+' ms');
  await pane('聊天与工作');
  const navigation=page.waitForEvent('domcontentloaded',{timeout:120000});await invoke('peko_reload_config');await navigation;await page.waitForSelector('[data-peko-ready]',{timeout:120000});await page.getByText('你好，我是 Peko。',{exact:true}).first().waitFor({timeout:30000});
  assert.equal((await invoke('peko_state')).settings.persona,'你是离屏测试的 Peko，工作时简洁直接。');assert.equal(readFileSync(join(project,'fixture.txt'),'utf8'),'after');checks.push('configuration reload rebuilds the owned runtime and preserves completed work');
  await invoke('window_action',{action:'close'});assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().length),2);checks.push('closing chat preserves pet and agent runtime');
  await stop();
  for(let i=0;i<2;i++){
    await launch();assert.equal((await invoke('peko_state')).modelPaths.yumi,selectedFile);await pane('共同记忆');await page.getByText('用户喜欢草莓兔兔',{exact:true}).waitFor();assert.equal((await invoke('peko_state')).settings.persona,'你是离屏测试的 Peko，工作时简洁直接。');
    await pane('聊天与工作');await page.getByRole('button',{name:'聊天记录',exact:true}).click();const history=page.getByRole('dialog',{name:'聊天记录',exact:true});await history.locator('.peko-history-list button').first().waitFor();await history.locator('.peko-history-list button').first().click();await page.getByText('你好，我是 Peko。',{exact:true}).first().waitFor();await snap(page,'restart-'+(i+1));await stop();
  }
  checks.push('three consecutive launches using the same persistent Electron userData retain history, persona and memory without authentication');
  assert.deepEqual(errors,[]);
  writeFileSync(join(out,'report.json'),JSON.stringify({passed:true,home,checks,snapshots,runs,errors},null,2));console.log('Electron checks passed: '+snapshots.length+' screenshots; '+runs.length+' persistent launches; P95 '+p95+' ms');
}catch(error){if(page&&!page.isClosed()){try{await snap(page,'failure');writeFileSync(join(out,'failure.html'),await page.content());}catch{}}writeFileSync(join(out,'report.json'),JSON.stringify({passed:false,error:String(error),home,checks,snapshots,errors},null,2));throw error;}finally{await stop();}
