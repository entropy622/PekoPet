import {spawn,spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {resolve,join} from 'node:path';
const root=resolve(import.meta.dirname,'..'),require=createRequire(import.meta.url),electron=require('electron');
const built=spawnSync(process.execPath,[join(root,'scripts/build-electron.mjs')],{cwd:root,stdio:'inherit'});if(built.status!==0)process.exit(built.status||1);
const child=spawn(electron,[root],{cwd:root,env:{...process.env,PEKO_NODE:process.execPath},stdio:'inherit',windowsHide:true});
child.once('exit',code=>process.exit(code||0));
