import { existsSync, readFileSync, writeFileSync, mkdirSync, linkSync, unlinkSync, symlinkSync, lstatSync } from 'node:fs';
import { join } from 'node:path';

/** A supported non-reserved profile referencing the desktop patch and installed plugins. */
export function prepareSharedProfile(home) {
  const source=join(home,'profiles/desktop'),target=join(home,'profiles/peko');
  const original=JSON.parse(readFileSync(join(source,'package.json'),'utf8'));
  mkdirSync(target,{recursive:true});
  const manifest=join(target,'package.json');
  if(existsSync(manifest)&&!JSON.parse(readFileSync(manifest,'utf8')).pekoPetManaged)throw new Error('peko profile 已被其他程序使用，请重命名该 profile 后重试');
  writeFileSync(manifest,JSON.stringify({...original,name:'dsh-profile-peko',pekoPetManaged:true},null,2)+'\n');
  writeFileSync(join(target,'cordis.yml'),'[]\n');
  const patch=join(target,'cordis.patch.yml');
  if(existsSync(patch))unlinkSync(patch);
  if(existsSync(join(source,'cordis.patch.yml')))linkSync(join(source,'cordis.patch.yml'),patch);
  else writeFileSync(patch,'[]\n');
  const modules=join(target,'node_modules');
  if(existsSync(join(source,'node_modules'))&&!existsSync(modules))symlinkSync(join(source,'node_modules'),modules,'junction');
  if(existsSync(modules)&&!lstatSync(modules).isSymbolicLink())throw new Error('peko profile 的 node_modules 必须引用 desktop 安装目录');
  return target;
}
