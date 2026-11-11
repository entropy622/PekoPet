import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,copyFileSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {join,dirname,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
const recorder=`import {appendFileSync}from'node:fs';const kind=process.argv[2]||'models';appendFileSync(process.env.PEKO_BAT_TEST_LOG,JSON.stringify({kind,args:process.argv.slice(3),cwd:process.cwd(),root:process.env.PEKO_ROOT,node:process.env.PEKO_NODE})+'\\n');if(kind==='models')process.exit(Number(process.env.PEKO_BAT_TEST_EXIT||0));`;
function fixture(portable=false,fail=false){
  const base=mkdtempSync(join(tmpdir(),'peko-launch-')),root=join(base,'PekoPet 中文 空格'),bin=join(base,'bin'),log=join(base,'calls.jsonl');
  mkdirSync(join(root,'scripts'),{recursive:true});mkdirSync(bin);copyFileSync(resolve('start.bat'),join(root,'start.bat'));
  writeFileSync(join(root,'record.mjs'),recorder.replaceAll('\\\\n','\\n'));
  writeFileSync(join(root,'scripts/fetch-models.mjs'),recorder.replaceAll('\\\\n','\\n'));
  writeFileSync(join(bin,'npm.cmd'),'@echo off\r\nnode.exe "%PEKO_ROOT%record.mjs" npm %*\r\nexit /b %errorlevel%\r\n');
  if(portable){writeFileSync(join(root,'pekopet.exe'),'test routing marker');writeFileSync(join(root,'PekoPet.cmd'),'@echo off\r\nnode.exe "%~dp0record.mjs" portable\r\nexit /b %errorlevel%\r\n');}
  const env={...process.env,Path:bin+';'+dirname(process.execPath)+';'+process.env.Path,PEKO_ROOT:'old-project',PEKO_NODE:'old-node',PEKO_BAT_TEST_LOG:log,PEKO_BAT_TEST_EXIT:fail?'9':'0'};
  const result=spawnSync('cmd.exe',['/d','/c',join(root,'start.bat')],{cwd:base,env,input:'\r\n',encoding:'utf8',windowsHide:true,timeout:15000});
  return{base,root,result,events:()=>readFileSync(log,'utf8').trim().split('\n').map(line=>JSON.parse(line))};
}
for(const portable of [false,true])test(`BAT locates the ${portable?'portable':'source'} project from its own Chinese/spaced path`,{skip:process.platform!=='win32'},()=>{
  const f=fixture(portable);try{assert.equal(f.result.status,0,f.result.stdout+f.result.stderr);const events=f.events();assert.deepEqual(events.map(e=>e.kind),portable?['portable']:['npm']);for(const e of events){assert.equal(resolve(e.cwd),f.root);assert.equal(resolve(e.root),f.root);assert.equal(e.node,'node.exe');}if(!portable)assert.deepEqual(events[0].args,['start']);}finally{rmSync(f.base,{recursive:true,force:true});}
});
test('BAT starts offline without fetching evaluation models',{skip:process.platform!=='win32'},()=>{
  const f=fixture(false,true);try{assert.equal(f.result.status,0,f.result.stdout+f.result.stderr);assert.deepEqual(f.events().map(e=>e.kind),['npm']);}finally{rmSync(f.base,{recursive:true,force:true});}
});
