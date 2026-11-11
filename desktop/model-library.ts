import {existsSync,readFileSync,readdirSync,realpathSync} from 'node:fs';
import {dirname,join,resolve,relative,isAbsolute} from 'node:path';

export function modelFile(root:string,home:string,id:string){
  const avatar=JSON.parse(readFileSync(join(root,'assets/avatars.json'),'utf8')).avatars[id];
  if(!avatar)throw new Error('未知角色');
  const library=join(root,'models',avatar.library||avatar.model);
  const file=avatar.source==='library'||existsSync(library)?library:avatar.source==='local'?join(root,'local/models',avatar.model):join(home,'peko-pet/models/LLM_Live2D/public/live2D',avatar.model);
  if(!existsSync(file))throw new Error('角色资源未安装。请运行 npm run assets，或获取私有 models submodule。');
  return file;
}
export function confinedFile(directory:string,path:string){
  const file=realpathSync(resolve(directory,path)),root=realpathSync(directory),rel=relative(root,file);
  if(isAbsolute(rel)||rel==='..'||rel.startsWith('..\\')||rel.startsWith('../'))throw new Error('资源路径超出角色目录');
  return file;
}
export function modelDescriptor(root:string,home:string,id:string){
  const metadata=JSON.parse(readFileSync(join(root,'assets/avatars.json'),'utf8'));
  const file=modelFile(root,home,id),base=dirname(file),avatar=metadata.avatars[id],expressions:Record<string,string>={},motions:Record<string,string>={};
  function walk(directory:string){for(const entry of readdirSync(directory,{withFileTypes:true})){const path=join(directory,entry.name);if(entry.isDirectory())walk(path);else if(entry.name.endsWith('.exp3.json')){const name=entry.name.slice(0,-10);if(!avatar.excluded.includes(name))expressions[name]=relative(base,path).replaceAll('\\','/');}else if(entry.name.endsWith('.motion3.json'))motions[entry.name.slice(0,-13)]=relative(base,path).replaceAll('\\','/');}}
  walk(base);
  return {id,avatar,metadata,settings:JSON.parse(readFileSync(file,'utf8')),expressions,motions,baseUrl:'peko-app://pet/model/'+encodeURIComponent(id)+'/'};
}
