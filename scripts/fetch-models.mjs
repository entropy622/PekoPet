import { existsSync, mkdirSync, createWriteStream, renameSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
const home=resolve(process.env.DSH_HOME||join(homedir(),'.dsh'));
const target=join(home,'peko-pet/models/LLM_Live2D/public/live2D');
const manifest=JSON.parse(readFileSync(new URL('../assets/model-files.json',import.meta.url),'utf8'));
const models=process.argv.includes('--all')?['yumi','bingtang','ellen']:['yumi'];
const files=models.flatMap(id=>manifest.models[id]);
const pending=files.filter(file=>!existsSync(join(target,file)));
async function worker(){
  for(;;){const file=pending.shift();if(!file)return;
    const url=`https://raw.githubusercontent.com/${manifest.source}/${manifest.ref}/public/live2D/${file.split('/').map(encodeURIComponent).join('/')}`;
    const response=await fetch(url);if(!response.ok)throw new Error(`下载 ${file} 失败: HTTP ${response.status}`);
    const destination=join(target,file);mkdirSync(dirname(destination),{recursive:true});
    await pipeline(Readable.fromWeb(response.body),createWriteStream(destination+'.partial'));
    renameSync(destination+'.partial',destination);
    console.log('已缓存',file);
  }
}
await Promise.all(Array.from({length:4},worker));
console.log('Models ready for local evaluation:',target);
console.log('Yumi — Erara_艾拉拉. Other model restrictions remain in their original folders.');
