import {existsSync,readFileSync,readdirSync,realpathSync} from 'node:fs';
import {dirname,join,resolve,relative,isAbsolute} from 'node:path';
import {resolveModelFile} from '../plugin/model-locations.ts';

export function modelFile(root:string,home:string,id:string){
  const avatars=JSON.parse(readFileSync(join(root,'assets/avatars.json'),'utf8')).avatars;
  const file=resolveModelFile(root,home,id,avatars);
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
  const settings=JSON.parse(readFileSync(file,'utf8')),refs=settings.FileReferences||{},jsonAssets:Record<string,string>={};
  for(const name of new Set([refs.Physics,refs.Pose,...Object.values(expressions),...Object.values(motions)].filter((name):name is string=>typeof name==='string'&&!!name)))jsonAssets[name]=readFileSync(confinedFile(base,name),'utf8');
  return {id,avatar,metadata,settings,expressions,motions,jsonAssets,baseUrl:'peko-app://pet/model/'+encodeURIComponent(id)+'/'};
}
