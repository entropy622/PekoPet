import {cpSync,mkdirSync,mkdtempSync,copyFileSync,existsSync,readFileSync,writeFileSync,lstatSync,unlinkSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {parse} from 'yaml';
const root=resolve(import.meta.dirname,'..'),require=createRequire(import.meta.url);
function run(command,args,options={}){const result=spawnSync(command,args,{cwd:root,stdio:'inherit',windowsHide:true,...options});if(result.status!==0)throw new Error(command+' 执行失败：'+result.status);}
function copyTree(from,to){
  if(process.platform!=='win32'){cpSync(from,to,{recursive:true});return;}
  const result=spawnSync('robocopy.exe',[from,to,'/E','/MT:16','/R:1','/W:1','/NFL','/NDL','/NJH','/NJS','/NP'],{stdio:'inherit',windowsHide:true});
  if(result.error||result.status===null||result.status>=8)throw result.error||new Error('目录复制失败：'+from);
}
run(process.execPath,[join(root,'scripts/build-electron.mjs')]);
const args=process.argv.slice(2),reuse=args.indexOf('--runtime-dir');
const runtime=reuse>=0?resolve(args[reuse+1]):mkdtempSync(join(root,'work/package-runtime-'));
if(!runtime.startsWith(join(root,'work')+'\\')||!existsSync(runtime))throw new Error('运行时暂存目录须位于项目 work 目录');
for(const file of ['package.json','package-lock.json','LICENSE','THIRD_PARTY.md'])copyFileSync(join(root,file),join(runtime,file));
for(const folder of ['agent','plugin','assets'])copyTree(join(root,folder),join(runtime,folder));
for(const folder of ['dsh-ui-chat','dsh-ui-conversation','peko-agent-loop','cubism-web-core','cubism-web-framework'])copyTree(join(root,'vendor',folder),join(runtime,'vendor',folder));
mkdirSync(join(runtime,'scripts'),{recursive:true});
copyFileSync(join(root,'scripts/start-agent.mjs'),join(runtime,'scripts/start-agent.mjs'));
copyFileSync(join(root,'scripts/stdio.mjs'),join(runtime,'scripts/stdio.mjs'));
copyFileSync(join(root,'scripts/fetch-models.mjs'),join(runtime,'scripts/fetch-models.mjs'));
copyFileSync(process.execPath,join(runtime,'node.exe'));
if(reuse<0){
run(process.env.ComSpec||'cmd.exe',['/d','/s','/c','npm ci --omit=dev --ignore-scripts --no-audit --no-fund'],{cwd:runtime});
run(process.env.ComSpec||'cmd.exe',['/d','/s','/c','npm rebuild @deepseek-ai/dsh-subprocess-local koffi node-pty protobufjs'],{cwd:runtime});
}
for(const folder of ['dsh-ui-chat','dsh-ui-conversation']){
  const target=join(runtime,'node_modules/@deepseek-ai',folder.replace('dsh-','dsh-client-'));
  if(lstatSync(target).isSymbolicLink())unlinkSync(target);
  copyTree(join(runtime,'vendor',folder),target);
}
const destinationFlag=args.indexOf('--destination'),destination=resolve(destinationFlag>=0?args[destinationFlag+1]:join(root,'dist/PekoPet-windows-x64'));
if(existsSync(destination))throw new Error('输出目录已存在，请使用新的路径：'+destination);
const builder=require.resolve('electron-builder/cli.js');
const shell=mkdtempSync(join(root,'work/package-shell-'));copyTree(join(root,'build'),join(shell,'build'));
const metadata=JSON.parse(readFileSync(join(root,'package.json'),'utf8'));writeFileSync(join(shell,'package.json'),JSON.stringify(Object.fromEntries(['name','version','description','author','license','main'].map(key=>[key,metadata[key]]))));
const config=parse(readFileSync(join(root,'electron-builder.yml'),'utf8'));config.directories.app=shell;config.electronVersion=metadata.devDependencies.electron;config.extraResources=[{from:runtime,to:'runtime'}];const configPath=join(root,'work/electron-package-config.json');writeFileSync(configPath,JSON.stringify(config));
run(process.execPath,[builder,'--config',configPath,'--win','--x64','--dir','--publish','never']);
const unpacked=join(root,'dist/electron/win-unpacked');
copyTree(join(runtime,'node_modules'),join(unpacked,'resources/runtime/node_modules'));
if(!existsSync(join(unpacked,'resources/runtime/node_modules/@deepseek-ai/dsh-web-frontend/dist/index.html')))throw new Error('运行时依赖未打包');
mkdirSync(destination,{recursive:true});copyTree(unpacked,destination);
for(const file of ['README.md','LICENSE','THIRD_PARTY.md','start.bat'])copyFileSync(join(root,file),join(destination,file));
copyFileSync(join(root,'scripts/PekoPet.cmd'),join(destination,'PekoPet.cmd'));
const nodeVersion=process.version,license=join(root,'local/node-licenses',nodeVersion,'LICENSE');
if(!existsSync(license)){mkdirSync(join(root,'local/node-licenses',nodeVersion),{recursive:true});const result=await fetch(`https://raw.githubusercontent.com/nodejs/node/${nodeVersion}/LICENSE`);if(!result.ok)throw new Error('Node 许可下载失败');const {writeFileSync}=await import('node:fs');writeFileSync(license,await result.text());}
copyFileSync(license,join(destination,'LICENSE-NODE'));
if(existsSync(join(destination,'models'))||existsSync(join(destination,'resources/runtime/models')))throw new Error('便携目录包含私有模型，请使用新的输出目录');
if(!args.includes('--no-zip'))run('powershell.exe',['-NoProfile','-File',join(root,'scripts/archive.ps1'),'-Source',destination,'-Destination',destination+'.zip']);
console.log('Electron 便携目录：'+destination);
