import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { mkdirSync, writeFileSync } from 'node:fs';
const child=spawn(process.execPath,['scripts/launch-dsh.mjs'],{cwd:new URL('..',import.meta.url),stdio:['pipe','pipe','pipe'],windowsHide:true});
let stderr='',done=false;
const timeout=setTimeout(()=>{console.error('dsh readiness timeout');child.kill();process.exitCode=1;},45000);
child.stderr.on('data',b=>{stderr+=b;});
createInterface({input:child.stdout}).on('line',line=>{
  let frame;try{frame=JSON.parse(line);}catch{console.error('non-JSON stdout:',line.slice(0,160));child.kill();process.exitCode=1;return;}
  if(frame.id===1){
    if(frame.error){console.error(frame.error);process.exitCode=1;}else{console.log(JSON.stringify({profile:frame.result.profile,sharedProfile:frame.result.sharedProfile,providers:frame.result.providers.map(p=>({id:p.id,models:p.models.map(m=>m.id)})),features:frame.result.features}));done=true;}
    child.stdin.write(JSON.stringify({jsonrpc:'2.0',id:2,method:'shutdown'})+'\n');
  }
});
child.once('exit',code=>{clearTimeout(timeout);mkdirSync('work',{recursive:true});writeFileSync('work/dsh-smoke.stderr.log',stderr);if(!done||code!==0){console.error(stderr.slice(-7000));process.exitCode=1;}else console.log('dsh readiness and shutdown passed');});
child.stdin.write(JSON.stringify({jsonrpc:'2.0',id:1,method:'peko.capabilities'})+'\n');
