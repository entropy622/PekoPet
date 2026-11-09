import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
const sessionId=`peko-e2e-${randomUUID()}`,cwd=resolve('work/e2e');mkdirSync(cwd,{recursive:true});
const child=spawn(process.execPath,['scripts/launch-dsh.mjs'],{stdio:['pipe','pipe','pipe'],windowsHide:true});
let next=1,stderr='',streamed=false,final=false,failed=false,steps=0,originalSettings;
const pending=new Map();
function call(method,params){const id=next++;child.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method,params})+'\n');return new Promise((resolve,reject)=>pending.set(id,{resolve,reject}));}
child.stderr.on('data',b=>stderr+=b);
const timer=setTimeout(()=>{failed=true;console.error('real model e2e timed out');void call('shutdown',{});},90000);
const frames=[];
createInterface({input:child.stdout}).on('line',line=>{
  let f;try{f=JSON.parse(line);}catch{failed=true;console.error('non-protocol stdout');return;}frames.push(f);
  if(f.id){const p=pending.get(f.id);if(p){pending.delete(f.id);if(f.error)p.reject(new Error(f.error.message));else p.resolve(f.result);}}
  if(f.method==='peko.stream'&&f.params.sessionId===sessionId&&f.params.frame.type==='chunk'&&f.params.frame.chunk.type==='text-delta')streamed=true;
  if(f.method==='peko.error'){failed=true;console.error(f.params.message);}
  if(f.method==='session.event'&&f.params.sessionId===sessionId&&f.params.event.type==='assistant/message'){final=true;steps++;}
});
try{
  const caps=await call('peko.capabilities',{});
  originalSettings=caps.settings;
  const choice=process.env.PEKO_TEST_PROVIDER?{provider:process.env.PEKO_TEST_PROVIDER,model:process.env.PEKO_TEST_MODEL}:caps.defaultModel;
  if(!choice?.provider||!choice?.model)throw new Error('dsh desktop 没有默认模型');
  await call('initialize',{cwd,provider:choice.provider,model:choice.model,maxTokens:512});
  await call('peko.settings',{patch:{memoryEnabled:false,proactive:false}});
  await call('session/prompt',{sessionId,contentBlocks:[{type:'text',text:'这是 PekoPet 的短测试。只回复“你好，我是 Peko。”，在正文前加上 [[peko:{"mix":{"星星眼":0.8},"hold":1000}]]。不要调用工具。'}],avatar:{name:'Yumi',expressions:['星星眼'],layers:[],motions:['wave'],parameters:[]}});
  await call('session/wait',{sessionId});
  const history=await call('peko.history',{sessionId});
  if(!streamed||!final||!history.messages.some(m=>m.role==='assistant'&&m.text.includes('[[peko:')))throw new Error('缺少实时文本、最终消息或持久化角色标记');
  console.log(JSON.stringify({provider:choice.provider,model:choice.model,streamed,steps,history:history.messages.length}));
  await call('peko.settings',{patch:{memoryEnabled:caps.settings.memoryEnabled,proactive:caps.settings.proactive}});
  await call('shutdown',{});
}catch(e){failed=true;console.error(e.message);try{if(originalSettings)await call('peko.settings',{patch:{memoryEnabled:originalSettings.memoryEnabled,proactive:originalSettings.proactive}});await call('shutdown',{});}catch{child.kill();}}
child.once('exit',code=>{clearTimeout(timer);mkdirSync('work',{recursive:true});writeFileSync('work/e2e-dsh.stderr.log',stderr);writeFileSync('work/e2e-dsh.frames.json',JSON.stringify(frames,null,2));if(failed||code!==0){console.error(stderr.slice(-8000));process.exitCode=1;}else console.log('real dsh streaming e2e passed');});
