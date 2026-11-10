import {chromium,webkit} from '@playwright/test';
import {spawn} from 'node:child_process';
import {mkdirSync,mkdtempSync,writeFileSync,readFileSync,copyFileSync,existsSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {homedir} from 'node:os';
import {pathToFileURL} from 'node:url';
import {createServer} from 'node:net';
import assert from 'node:assert/strict';
const root=resolve(import.meta.dirname,'..'),out=join(root,'work/ui-checks');mkdirSync(out,{recursive:true});
const home=mkdtempSync(join(root,'work/ui-home-')),desktop=join(home,'profiles/desktop'),project=join(home,'project');mkdirSync(desktop,{recursive:true});mkdirSync(project);
writeFileSync(join(project,'fixture.txt'),'before');
writeFileSync(join(desktop,'package.json'),JSON.stringify({dsh:{profile:{bundles:['@deepseek-ai/dsh-base','@deepseek-ai/dsh-web-app']}}}));
writeFileSync(join(desktop,'cordis.patch.yml'),'- id: llm-deepseek-account\n  disabled: true\n- id: agent-default-model\n  config:\n    provider: peko-test\n    model: replay\n');
const patch=join(home,'fixture.yml');writeFileSync(patch,`- insert:\n    - id: peko-test-adapter\n      name: '${pathToFileURL(join(root,'tests/replay-adapter.mjs')).href}'\n    - id: peko-ui-workspace\n      name: '${pathToFileURL(join(root,'tests/ui-workspace.mjs')).href}'\n`);
const catalog=join(home,'catalog.json');writeFileSync(catalog,JSON.stringify({name:'Yumi',expressions:['星星眼','泪汪汪','猫猫嘴','爱心眼'],layers:['拿话筒','抬手右','抬手左'],motions:['wave'],parameters:[{id:'ParamAngleX',min:-30,max:30,default:0},{id:'ParamAngleY',min:-30,max:30,default:0},{id:'ParamAngleZ',min:-30,max:30,default:0}]}));
const icons=join(home,'peko-pet/icons');mkdirSync(icons,{recursive:true});
for(const extension of ['png','ico','json']){const source=join(process.env.DSH_HOME||join(homedir(),'.dsh'),'peko-pet/icons/yumi-head.'+extension);if(existsSync(source))copyFileSync(source,join(icons,'yumi-head.'+extension));}
const port=await new Promise(resolve=>{const server=createServer();server.listen(0,'127.0.0.1',()=>{const port=server.address().port;server.close(()=>resolve(port));});});
const runtimeRoot=process.env.PEKO_UI_ROOT?resolve(process.env.PEKO_UI_ROOT):root;
const executable=process.env.PEKO_UI_EXE||join(root,'target/debug/pekopet.exe');
const app=spawn(executable,[],{cwd:runtimeRoot,windowsHide:true,env:{...process.env,PEKO_ROOT:runtimeRoot,PEKO_NODE:existsSync(join(runtimeRoot,'node.exe'))?join(runtimeRoot,'node.exe'):process.execPath,DSH_HOME:home,PEKO_UI_TEST:'1',PEKO_UI_CHECK_PORT:String(port),PEKO_DSH_PATCH:patch,PEKO_UI_FIXTURE_CATALOG:catalog},stdio:['ignore','pipe','pipe']});
let stderr='';app.stderr.on('data',v=>stderr+=v);const exited=new Promise(r=>app.once('exit',r));
writeFileSync(join(out,'process.json'),JSON.stringify({pid:app.pid,home,port,executable},null,2));
let browser,page,other;const consoleErrors=[],images=[],checks=[];
const until=async(test,timeout=30000)=>{const end=Date.now()+timeout;for(;;){if(await test())return;if(Date.now()>end)throw new Error('Timed out waiting for condition');await new Promise(r=>setTimeout(r,100));}};
const snap=async(p,name)=>{const file=name+'.png';await p.screenshot({path:join(out,file),animations:'disabled'});images.push(file);};
const tab=async(p,name)=>{await p.getByRole('button',{name,exact:true}).click();};
try{
  await until(async()=>{if(app.exitCode!==null)throw new Error('Native app exited: '+stderr);try{return(await fetch(`http://127.0.0.1:${port}/json/version`)).ok;}catch{return false;}},45000);
  browser=await chromium.connectOverCDP(`http://127.0.0.1:${port}`);page=browser.contexts()[0].pages()[0];
  page.on('pageerror',e=>consoleErrors.push(String(e)));page.on('console',m=>{if(m.type()==='error')consoleErrors.push(m.text());});
  await page.waitForSelector('[data-peko-ready]',{timeout:180000});
  const intro=page.getByRole('button',{name:'继续',exact:true});await Promise.race([intro.waitFor({state:'visible'}),page.locator('[contenteditable=true]').first().waitFor({state:'visible'})]);if(await intro.isVisible()){await intro.click();await intro.waitFor({state:'hidden'});}
  const invoke=(command,args={})=>page.evaluate(({command,args})=>window.__TAURI__.core.invoke(command,args),{command,args});
  for(const size of [{width:1120,height:800},{width:880,height:680}]){
    await page.setViewportSize(size);
    for(const [name,label]of [['chat','聊天与工作'],['memory','共同记忆'],['persona','相处方式'],['models','模型与连接'],['avatar','角色调试']]){
      await tab(page,label);
      if(name!=='chat'){const heading=page.locator('.peko-panel-content h1');await heading.waitFor();assert.ok((await heading.boundingBox()).y>=52,'Heading under titlebar at '+name);}else {await page.locator('[contenteditable=true]').first().waitFor();const sendButton=page.getByRole('button',{name:'发送',exact:true});if(await sendButton.count())assert.ok((await sendButton.boundingBox()).y+32<=size.height,'Composer outside window');}
      await page.locator('.peko-titlebar img').evaluate(image=>image.decode());
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'Horizontal overflow at '+name);
      await snap(page,`${name}-${size.width}x${size.height}`);
    }
  }
  checks.push('five React panes at 1120x800 and 880x680; decoded native model portrait; no horizontal overflow');
  await page.setViewportSize({width:1120,height:800});await tab(page,'共同记忆');
  await page.getByRole('textbox',{name:'记忆内容',exact:true}).fill('离屏测试偏好：反馈简洁清晰');await page.getByRole('button',{name:'保存记忆',exact:true}).click();
  await page.locator('.peko-memory-text').filter({hasText:'离屏测试偏好：反馈简洁清晰'}).waitFor();
  await page.getByRole('button',{name:'编辑',exact:true}).click();await page.getByRole('textbox',{name:'记忆内容',exact:true}).fill('离屏测试偏好：工作时直奔结果');await page.getByRole('button',{name:'保存记忆',exact:true}).click();
  await page.locator('.peko-memory-text').filter({hasText:'离屏测试偏好：工作时直奔结果'}).waitFor();
  await page.getByRole('button',{name:'暂停记录',exact:true}).click();await page.getByRole('button',{name:'恢复记录',exact:true}).waitFor();await snap(page,'memory-edited-paused');
  await page.getByRole('button',{name:'删除',exact:true}).click();await page.getByText('还没有共同记忆。',{exact:true}).waitFor();checks.push('memory create, edit, pause and delete through native RPC');
  await tab(page,'相处方式');await page.getByRole('textbox',{name:'人格',exact:true}).fill('你是离屏测试的 Peko，工作时简洁直接。');await page.getByRole('button',{name:'保存人格',exact:true}).click();
  await until(async()=>(await invoke('peko_state')).settings.persona==='你是离屏测试的 Peko，工作时简洁直接。');checks.push('persona save through native RPC');
  await tab(page,'聊天与工作');
  const editor=page.locator('[contenteditable=true]').first();await editor.waitFor();await editor.fill('离屏中文输入 😊');await editor.press('Enter');
  await page.getByText('你好，我是 Peko。',{exact:true}).first().waitFor({timeout:60000});
  await until(async()=>!(await invoke('peko_state')).busy);assert.equal((await page.locator('#root').innerText()).includes('[[peko:'),false);await snap(page,'dsh-chat-streamed');checks.push('original dsh composer sends Chinese and emoji; assistant displays no cue markers');
  await page.evaluate(()=>Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{window.__pekoCopied=text;}}}));await page.getByRole('button',{name:'复制',exact:true}).last().click();await until(async()=>await page.evaluate(()=>window.__pekoCopied==='你好，我是 Peko。'));checks.push('dsh assistant copy projection excludes markers; test clipboard stays inside the page');
  const selected=await invoke('peko_state');const caps=await invoke('peko_request',{method:'peko.capabilities',params:{sessionId:selected.sessionId}});assert.equal(resolve(caps.workingDirectory).toLowerCase(),project.toLowerCase(),'dsh workspace cwd');
  await editor.fill('files');await editor.press('Enter');await until(()=>readFileSync(join(project,'fixture.txt'),'utf8')==='after',60000);await until(async()=>!(await invoke('peko_state')).busy);await snap(page,'dsh-file-tools');checks.push('original dsh frontend runs real read and edit tools in isolated workspace');
  const send=async text=>{await editor.fill(text);await editor.press('Enter');};
  await send('approval');await page.getByRole('button',{name:'允许一次',exact:true}).waitFor();await snap(page,'dsh-approval');await page.getByRole('button',{name:'允许一次',exact:true}).click();await until(async()=>!(await invoke('peko_state')).busy);
  await send('approval');await page.getByRole('button',{name:'拒绝',exact:true}).waitFor();await page.getByRole('button',{name:'拒绝',exact:true}).click();await until(async()=>!(await invoke('peko_state')).busy);checks.push('original dsh approval panel allows once and rejects');
  await send('questions');await page.getByText('绿色',{exact:true}).click();await page.getByPlaceholder('输入你的答案',{exact:true}).fill('离屏回答');await snap(page,'dsh-questions');await page.getByRole('button',{name:'提交',exact:true}).click();await until(async()=>!(await invoke('peko_state')).busy);checks.push('original dsh multi-question choice and free text answers');
  await send('cancel');const stop=page.getByRole('button',{name:'停止生成',exact:true});await stop.waitFor();await page.locator('[data-chat-running]').waitFor();assert.equal(await page.locator('[data-chat-running] svg').evaluateAll(nodes=>nodes.every(n=>n.getBoundingClientRect().width<=32)),true,'Running indicator dimensions');await snap(page,'dsh-running');await stop.click();await until(async()=>!(await invoke('peko_state')).busy);await stop.waitFor({state:'hidden'});assert.equal((await page.locator('#root').innerText()).includes('[[peko:'),false);assert.equal((await invoke('peko_state')).error,'');checks.push('original dsh stop cancels streaming; interrupted markers remain hidden');
  await page.evaluate(async()=>{await window.__TAURI__.event.listen('peko-external-link',event=>{window.__pekoExternalLink=event.payload;});window.open('https://example.com/peko-link-test','_blank','noopener,noreferrer');});await until(async()=>await page.evaluate(()=>window.__pekoExternalLink==='https://example.com/peko-link-test'));checks.push('HTTP links dispatch to the native system-browser path; test mode launches no external browser');
  const url=caps.frontendUrl;other=await webkit.launch({headless:true});const wk=await other.newPage({viewport:{width:1120,height:800}});
  await wk.exposeFunction('__pekoInvoke',(command,args)=>invoke(command,args));
  await wk.addInitScript(()=>{window.__TAURI__={core:{invoke:(command,args)=>window.__pekoInvoke(command,args)},event:{listen:async()=>()=>{}}};});
  await wk.goto(url);await wk.waitForSelector('[data-peko-ready]',{timeout:60000});const wkIntro=wk.getByRole('button',{name:'继续',exact:true});if(await wkIntro.isVisible()){await wkIntro.click();await wkIntro.waitFor({state:'hidden'});}
  await snap(wk,'webkit-chat');await tab(wk,'相处方式');await wk.getByRole('textbox',{name:'人格',exact:true}).waitFor();await snap(wk,'webkit-persona');checks.push('WebKit renders the same frontend and navigates React panes, using the test native bridge');
  assert.deepEqual(consoleErrors.filter(e=>!e.includes('503')),[], 'Browser errors');
  writeFileSync(join(out,'report.json'),JSON.stringify({passed:true,mode:'offscreen native WebView2 CDP and headless WebKit; isolated DSH_HOME; no foreground activation or global input',checks,snapshots:images,consoleErrors},null,2));
  console.log('PekoPet UI checks passed: '+images.length+' screenshots');
}catch(error){if(page){try{await snap(page,'failure');writeFileSync(join(out,'failure.html'),await page.content());}catch{}}
  writeFileSync(join(out,'report.json'),JSON.stringify({passed:false,error:String(error),stderr,consoleErrors,snapshots:images,home},null,2));throw error;
}finally{
  if(other)await other.close();
  if(page){try{await page.evaluate(()=>window.__TAURI__.core.invoke('window_action',{action:'exit'}));}catch{}}
  await Promise.race([exited,new Promise(r=>setTimeout(r,5000))]);
  if(app.exitCode===null){const killer=spawn('taskkill.exe',['/PID',String(app.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});await new Promise(r=>killer.once('exit',r));}
  if(browser)await browser.close();
}
