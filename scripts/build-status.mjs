import {existsSync,readdirSync,statSync} from 'node:fs';
import {join} from 'node:path';

const outputs=['build/electron/main.cjs','build/electron/preload.cjs','build/electron/loading.html','build/renderer/transport.js','build/pet/pet.js','build/pet/index.html','plugin/frontend/client.js','vendor/dsh-ui-chat/client.js','vendor/dsh-ui-chat/index.mjs','vendor/dsh-ui-conversation/client.js','vendor/dsh-ui-conversation/index.mjs','vendor/peko-agent-loop/index.mjs'];
const sources=['desktop','electron','renderer','agent','plugin','vendor/dsh-ui-chat/src','vendor/dsh-ui-conversation/src','vendor/peko-agent-loop/src','vendor/cubism-web-framework/src'];
export function needsBuild(root){
  const stamp=join(root,'build/.stamp');
  if(!existsSync(stamp)||outputs.some(file=>!existsSync(join(root,file))))return true;
  const built=statSync(stamp).mtimeMs;
  function changed(directory){return readdirSync(directory,{withFileTypes:true}).some(entry=>{
    const file=join(directory,entry.name);if(entry.isSymbolicLink()||file===join(root,'plugin/frontend/client.js'))return false;
    return entry.isDirectory()?changed(file):statSync(file).mtimeMs>built;
  });}
  return sources.some(folder=>changed(join(root,folder)))||['package.json','package-lock.json','scripts/build-electron.mjs','scripts/build-frontend.mjs'].some(file=>statSync(join(root,file)).mtimeMs>built);
}
