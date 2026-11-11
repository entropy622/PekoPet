import {existsSync,mkdirSync,readFileSync,realpathSync,renameSync,writeFileSync,unlinkSync,statSync} from 'node:fs';
import {basename,dirname,isAbsolute,join,relative,resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
type Avatar={model:string;library?:string;source?:string};
type Avatars=Record<string,Avatar>;
export function readModelLocations(home:string):Record<string,string>{
  const file=join(home,'peko-pet/model-paths.json');if(!existsSync(file))return {};
  const values=JSON.parse(readFileSync(file,'utf8'));
  if(!values||typeof values!=='object'||Array.isArray(values)||Object.values(values).some(value=>typeof value!=='string'))throw new Error('model-paths.json 必须是角色 ID 到文件路径的对象');
  return values;
}
export function resolveModelFile(root:string,home:string,id:string,avatars:Avatars){
  const avatar=avatars[id];if(!Object.hasOwn(avatars,id))throw new Error('未知角色：'+id);
  const custom=readModelLocations(home)[id];if(custom)return custom;
  const library=join(root,'models',avatar.library||avatar.model);
  if(avatar.source==='library'||existsSync(library))return library;
  return avatar.source==='local'?join(root,'local/models',avatar.model):join(home,'peko-pet/models/LLM_Live2D/public/live2D',avatar.model);
}
export function setModelLocation(home:string,id:string,input:string,avatars:Avatars){
  const avatar=avatars[id];if(!Object.hasOwn(avatars,id))throw new Error('角色必须选自固定目录');
  if(typeof input!=='string')throw new Error('模型路径必须为文本');
  const locations=readModelLocations(home),path=input.trim();
  if(path){
    if(!isAbsolute(path))throw new Error('请选择模型文件的完整路径');
    const file=realpathSync(path);
    if(basename(file).toLocaleLowerCase()!==basename(avatar.model).toLocaleLowerCase())throw new Error('此角色请选择 '+basename(avatar.model));
    const settings=JSON.parse(readFileSync(file,'utf8')),refs=settings.FileReferences;
    if(typeof refs?.Moc!=='string'||!Array.isArray(refs.Textures)||!refs.Textures.length)throw new Error('模型缺少 Moc 或纹理引用');
    const files=[refs.Moc,...refs.Textures,refs.Physics,refs.Pose,refs.DisplayInfo,...(refs.Expressions||[]).map((row:any)=>row.File),...Object.values(refs.Motions||{}).flatMap((rows:any)=>rows.map((row:any)=>row.File))].filter(value=>value!==undefined);
    for(const name of files){
      if(typeof name!=='string'||!name)throw new Error('模型资源引用须为非空路径');
      const resource=resolve(dirname(file),name);
      if(!existsSync(resource))throw new Error('缺少模型资源：'+name);
      const actual=realpathSync(resource),rel=relative(dirname(file),actual);
      if(isAbsolute(rel)||rel==='..'||rel.startsWith('..\\')||rel.startsWith('../'))throw new Error('模型资源必须位于模型文件所在目录内：'+name);
      if(!statSync(actual).isFile())throw new Error('模型资源须为文件：'+name);
    }
    locations[id]=file;
  }else delete locations[id];
  const file=join(home,'peko-pet/model-paths.json'),temporary=file+'.'+randomUUID()+'.tmp';mkdirSync(dirname(file),{recursive:true});
  try{writeFileSync(temporary,JSON.stringify(locations,null,2)+'\n');renameSync(temporary,file);}finally{if(existsSync(temporary))unlinkSync(temporary);}
  return locations;
}
