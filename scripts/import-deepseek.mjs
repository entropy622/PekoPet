import {cpSync,copyFileSync,existsSync,mkdirSync,readFileSync,readdirSync,statSync} from 'node:fs';
import {dirname,isAbsolute,join,relative,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const project=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const modelName='大肥鱼.model3.json',noticeName='DeepSeek免费 Live2D 模型使用须知.txt';

/** Import this fixed character for local use; its assets stay outside source and release packages. */
export function importDeepseek(source,root=project){
  source=resolve(source);
  const found=[];
  function find(directory){for(const entry of readdirSync(directory,{withFileTypes:true})){const path=join(directory,entry.name);if(entry.isDirectory())find(path);else if(entry.name===modelName)found.push(path);}}
  find(source);
  if(found.length!==1)throw new Error('请选择包含一份大肥鱼.model3.json 的完整模型解压目录。');
  const model=found[0],directory=dirname(model),notice=join(dirname(directory),noticeName);
  if(!existsSync(notice))throw new Error('缺少模型使用须知，请使用作者提供的完整解压目录。');
  const settings=JSON.parse(readFileSync(model,'utf8')),refs=settings.FileReferences;
  if(typeof refs?.Moc!=='string'||!Array.isArray(refs.Textures)||!refs.Textures.length)throw new Error('模型缺少 Moc 或纹理引用。');
  const files=[refs.Moc,...refs.Textures,refs.Physics,refs.Pose,refs.DisplayInfo].filter(Boolean);
  for(const name of files){
    const file=resolve(directory,name),path=relative(directory,file);
    if(isAbsolute(path)||path==='..'||path.startsWith('..\\')||path.startsWith('../'))throw new Error('模型引用必须位于模型目录内：'+name);
    if(!existsSync(file)||!statSync(file).isFile())throw new Error('缺少模型引用文件：'+name);
  }
  const destination=join(resolve(root),'local/models/deepseek');
  if(existsSync(destination))throw new Error('本机模型目录已存在，未覆盖：'+destination);
  mkdirSync(destination,{recursive:true});
  cpSync(directory,join(destination,'DeepSeek'),{recursive:true,force:false,errorOnExist:true});
  copyFileSync(notice,join(destination,noticeName));
  return join(destination,'DeepSeek',modelName);
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    if(!process.argv[2])throw new Error('用法：node scripts/import-deepseek.mjs "模型压缩包解压目录"');
    console.log('已导入本机模型：'+importDeepseek(process.argv[2]));
    console.log('原画及拆分：神宫凉子；Live2D 建模：霓虹猫_NeonNeko。');
    console.log('模型禁止擅自重新分发，资源保存在忽略的 local/models 目录，不进入公开仓库或便携包。');
  }catch(error){console.error(error.message);process.exitCode=1;}
}
