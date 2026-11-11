import {existsSync,readFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {homedir} from 'node:os';

const project=resolve(import.meta.dirname,'..');
export const avatars=JSON.parse(readFileSync(new URL('../assets/avatars.json',import.meta.url),'utf8')).avatars;

export function modelPath(id,{root=project,home=process.env.DSH_HOME||join(homedir(),'.dsh')}={}){
  const avatar=avatars[id];if(!avatar)throw new Error('未知角色：'+id);
  const library=join(root,'models',avatar.library||avatar.model);
  if(avatar.source==='library'||existsSync(library))return library;
  return avatar.source==='local'?join(root,'local/models',avatar.model):join(home,'peko-pet/models/LLM_Live2D/public/live2D',avatar.model);
}

export function requireModel(id,options){
  const file=modelPath(id,options);
  if(!existsSync(file))throw new Error(avatars[id].source==='library'
    ?'请先获取私有模型库（需要仓库访问权）：git submodule update --init models'
    :'角色资源未安装。可获取私有模型库：git submodule update --init models；DeepSeek-chan 也可使用 scripts/import-deepseek.mjs 导入。');
  return file;
}
