import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,existsSync,copyFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';
import {importDeepseek} from '../scripts/import-deepseek.mjs';

function fixture(t){
  const root=mkdtempSync(join(tmpdir(),'peko-model-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
  const source=join(root,'解压目录/DeepSeek免费公皮'),model=join(source,'DeepSeek');mkdirSync(join(model,'纹理'),{recursive:true});
  writeFileSync(join(source,'DeepSeek免费 Live2D 模型使用须知.txt'),'保留作者及使用规范');
  writeFileSync(join(model,'大肥鱼.model3.json'),JSON.stringify({Version:3,FileReferences:{Moc:'大肥鱼.moc3',Textures:['纹理/texture.png']}}));
  writeFileSync(join(model,'大肥鱼.moc3'),'fixture moc');writeFileSync(join(model,'纹理/texture.png'),'fixture texture');
  return {root,source,model,target:join(root,'PekoPet 中文 空格')};
}
test('fixed local import preserves names, textures and usage notice without copying authoring PSD',t=>{
  const f=fixture(t);mkdirSync(join(f.source,'psd'));writeFileSync(join(f.source,'psd/source.psd'),'not a runtime asset');
  const result=importDeepseek(f.source,f.target);
  assert.equal(readFileSync(result,'utf8'),readFileSync(join(f.model,'大肥鱼.model3.json'),'utf8'));
  assert.equal(readFileSync(join(f.target,'local/models/deepseek/DeepSeek/纹理/texture.png'),'utf8'),'fixture texture');
  assert.equal(readFileSync(join(f.target,'local/models/deepseek/DeepSeek免费 Live2D 模型使用须知.txt'),'utf8'),'保留作者及使用规范');
  assert.equal(existsSync(join(f.target,'local/models/deepseek/psd')),false);
  assert.throws(()=>importDeepseek(f.source,f.target),/未覆盖/);
});
test('missing resources and escaping references are rejected before import',t=>{
  const f=fixture(t);rmSync(join(f.model,'纹理/texture.png'));
  assert.throws(()=>importDeepseek(f.source,f.target),/缺少模型引用文件/);
  writeFileSync(join(f.model,'大肥鱼.model3.json'),JSON.stringify({FileReferences:{Moc:'../outside.moc3',Textures:['纹理/texture.png']}}));
  assert.throws(()=>importDeepseek(f.source,f.target),/必须位于模型目录内/);
  assert.equal(existsSync(join(f.target,'local/models/deepseek')),false);
});

test('local character selection requires its import and preserves existing character settings',async t=>{
  const f=fixture(t),previousHome=process.env.DSH_HOME;process.env.DSH_HOME=join(f.root,'isolated home');t.after(()=>{if(previousHome===undefined)delete process.env.DSH_HOME;else process.env.DSH_HOME=previousHome;});mkdirSync(join(f.target,'plugin'),{recursive:true});mkdirSync(join(f.target,'assets'));
  for(const file of ['state.mjs','model-path.mjs','model-locations.ts'])copyFileSync('plugin/'+file,join(f.target,'plugin',file));copyFileSync('assets/avatars.json',join(f.target,'assets/avatars.json'));
  const {State}=await import(pathToFileURL(join(f.target,'plugin/state.mjs')).href);
  const state=new State(join(f.target,'state.sqlite3'));
  try{
    assert.equal(state.updateSettings({avatar:'yumi'}).avatar,'yumi');
    assert.throws(()=>state.updateSettings({avatar:'deepseek'}),/资源未安装/);
    assert.equal(state.settings().avatar,'yumi');
    importDeepseek(f.source,f.target);
    assert.equal(state.updateSettings({avatar:'deepseek'}).avatar,'deepseek');
    assert.equal(state.updateSettings({dnd:true}).avatar,'deepseek');
    assert.throws(()=>state.updateSettings({avatar:'toString'}),/固定目录/);
  }finally{state.close();}
});
