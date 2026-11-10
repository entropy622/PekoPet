import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const cwd=resolve('work/real-work-'+randomUUID());mkdirSync(cwd,{recursive:true});
writeFileSync(resolve(cwd,'fixture.txt'),'before\n');
const child=spawn(process.execPath,['scripts/start-agent.mjs'],{stdio:['pipe','pipe','pipe'],windowsHide:true});
const exited=new Promise(r=>child.once('exit',r));
const events=[],pending=new Map();let next=1,stderr='',settings,activeSession;
child.stderr.on('data',data=>stderr+=data);
function call(method,params={}){
  const id=next++;return new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{pending.delete(id);reject(new Error(`RPC timeout: ${method}`));},90000);
    pending.set(id,{resolve,reject,timer});child.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method,params})+'\n');
  });
}
createInterface({input:child.stdout}).on('line',line=>{
  const event=JSON.parse(line);events.push(event);
  if(event.id){const p=pending.get(event.id);if(p){clearTimeout(p.timer);pending.delete(event.id);event.error?p.reject(new Error(event.error.message)):p.resolve(event.result);}}
  if(event.method==='peko.approval'&&event.params.kind==='approval'){
    const request=event.params;
    const block=events.filter(e=>e.method==='session.event'&&e.params.sessionId===request.sessionId).flatMap(e=>e.params.event.data?.message?.content??[]).find(b=>b.type==='tool-call'&&b.id===request.callId);
    let allowed=false;
    if(block&&['read','edit'].includes(block.name)){
      const args=JSON.parse(block.arguments);allowed=resolve(cwd,args.file_path)===resolve(cwd,'fixture.txt');
    }
    void call('peko.answer',{id:request.id,answer:allowed?'allowed-once':'rejected'}).catch(e=>console.error(e.message));
  }
});
async function until(predicate){
  const deadline=Date.now()+90000;
  while(Date.now()<deadline){const found=events.find(predicate);if(found)return found;if(child.exitCode!==null)throw new Error('dsh exited');await new Promise(r=>setTimeout(r,25));}
  throw new Error('Expected interaction did not arrive');
}
try{
  const caps=await call('peko.capabilities');settings=caps.settings;
  const route=process.env.PEKO_TEST_PROVIDER?{provider:process.env.PEKO_TEST_PROVIDER,model:process.env.PEKO_TEST_MODEL}:caps.defaultModel;
  await call('initialize',{cwd,...route,maxTokens:1500});
  await call('peko.settings',{patch:{memoryEnabled:false,proactive:false}});
  activeSession='peko-files-'+randomUUID();
  await call('session/prompt',{sessionId:activeSession,contentBlocks:[{type:'text',text:'这是限定目录的文件工具测试。当前工作目录中 fixture.txt 已存在。用 read 读取，再用 edit 把 before 改为 after，保留换行。只操作这一个文件，不使用 shell。最后简短报告完成。'}]});
  await call('session/wait',{sessionId:activeSession});
  assert.equal(readFileSync(resolve(cwd,'fixture.txt'),'utf8'),'after\n');
  assert.ok(events.some(e=>e.method==='peko.work'&&e.params.sessionId===activeSession));
  activeSession='peko-stop-'+randomUUID();
  await call('session/prompt',{sessionId:activeSession,contentBlocks:[{type:'text',text:'这是停止任务测试。必须先调用 ask_user_question 提问“是否继续创建文件”，选项为“继续”和“取消”，等我回答后再行动。只有我回答继续才可用 write 创建当前目录的 cancelled.txt，内容为 unwanted。现在先提问，不创建文件。'}]});
  await until(e=>e.method==='peko.approval'&&e.params.sessionId===activeSession&&e.params.kind==='questions');
  await call('peko.cancel',{sessionId:activeSession});
  await call('session/wait',{sessionId:activeSession}).catch(e=>{if(!/cancel|abort/i.test(e.message))throw e;});
  assert.equal(existsSync(resolve(cwd,'cancelled.txt')),false);
  console.log(JSON.stringify({provider:route.provider,model:route.model,fileReadAndEdit:true,cancelWhileWaiting:true,createdAfterCancel:false}));
}finally{
  try{if(activeSession)await call('peko.cancel',{sessionId:activeSession});if(settings)await call('peko.settings',{patch:{memoryEnabled:settings.memoryEnabled,proactive:settings.proactive}});await call('shutdown');}
  finally{
    await exited;writeFileSync(resolve(cwd,'events.json'),JSON.stringify(events,null,2));writeFileSync(resolve(cwd,'stderr.log'),stderr);
    for(const p of pending.values()){clearTimeout(p.timer);p.reject(new Error('dsh closed'));}
  }
}
