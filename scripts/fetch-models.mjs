import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
const home=resolve(process.env.DSH_HOME||join(homedir(),'.dsh'));
const target=join(home,'peko-pet/models/LLM_Live2D');
mkdirSync(join(home,'peko-pet/models'),{recursive:true});
function git(args){const r=spawnSync('git',args,{stdio:'inherit',windowsHide:true});if(r.error)throw r.error;if(r.status)throw new Error(`git exited ${r.status}`);}
if(!existsSync(join(target,'.git')))git(['clone','--depth','1','--filter=blob:none','--sparse','https://github.com/entropy622/LLM_Live2D.git',target]);
const folders=['public/live2D/yumi'];
if(process.argv.includes('--all'))folders.push('public/live2D/免费模型冰糖','public/live2D/免费模型艾莲');
git(['-C',target,'sparse-checkout','set',...folders]);
console.log('Models cached for local evaluation:',target);
console.log('Yumi — Erara_艾拉拉. Other model restrictions remain in their original folders.');
