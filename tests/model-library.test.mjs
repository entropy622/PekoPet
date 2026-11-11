import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,readFileSync,copyFileSync,existsSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {avatars,modelPath,requireModel} from '../plugin/model-path.mjs';

function fixture(t){
  const root=mkdtempSync(join(tmpdir(),'peko-model-library-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
  return {root,home:join(root,'shared home 中文')};
}
function file(path){mkdirSync(dirname(path),{recursive:true});writeFileSync(path,'fixture');return path;}

test('private library takes priority while existing cache and local import paths stay usable',t=>{
  const options=fixture(t);
  assert.equal(modelPath('yumi',options),join(options.home,'peko-pet/models/LLM_Live2D/public/live2D/yumi/yumi.model3.json'));
  assert.equal(modelPath('deepseek',options),join(options.root,'local/models/deepseek/DeepSeek/大肥鱼.model3.json'));
  for(const id of ['yumi','deepseek']){
    const privateFile=file(join(options.root,'models',avatars[id].library));
    assert.equal(modelPath(id,options),privateFile);
    assert.equal(requireModel(id,options),privateFile);
  }
});

test('private-only character requires a populated submodule and resolves Unicode paths',t=>{
  const options=fixture(t);
  assert.throws(()=>requireModel('strawberry-rabbit',options),/git submodule update --init models/);
  const privateFile=file(join(options.root,'models',avatars['strawberry-rabbit'].model));
  assert.equal(requireModel('strawberry-rabbit',options),privateFile);
  assert.throws(()=>modelPath('unknown',options),/未知角色/);
});

test('asset setup repairs an incomplete cache even when its model3 file already exists',t=>{
  const options=fixture(t);
  for(const folder of ['scripts','assets','plugin'])mkdirSync(join(options.root,folder));
  copyFileSync('scripts/fetch-models.mjs',join(options.root,'scripts/fetch-models.mjs'));
  copyFileSync('plugin/model-locations.ts',join(options.root,'plugin/model-locations.ts'));
  copyFileSync('plugin/model-path.mjs',join(options.root,'plugin/model-path.mjs'));
  copyFileSync('assets/avatars.json',join(options.root,'assets/avatars.json'));
  writeFileSync(join(options.root,'package.json'),'{"type":"module"}');
  writeFileSync(join(options.root,'assets/model-files.json'),JSON.stringify({source:'fixture/repo',ref:'test',models:{yumi:['yumi/yumi.model3.json','yumi/texture.png']}}));
  const cache=join(options.home,'peko-pet/models/LLM_Live2D/public/live2D/yumi');file(join(cache,'yumi.model3.json'));
  const run=setup=>spawnSync(process.execPath,['--input-type=module','-e',setup+";await import('./scripts/fetch-models.mjs');"],{cwd:options.root,env:{...process.env,DSH_HOME:options.home},encoding:'utf8',windowsHide:true});
  const repaired=run("globalThis.fetch=async()=>new Response('fixture texture')");
  assert.equal(repaired.status,0,repaired.stderr);
  assert.equal(readFileSync(join(cache,'texture.png'),'utf8'),'fixture texture');
  file(join(options.root,'models/yumi/yumi.model3.json'));rmSync(join(cache,'texture.png'));
  const privateLibrary=run("globalThis.fetch=async()=>{throw new Error('private model must not be downloaded')}");
  assert.equal(privateLibrary.status,0,privateLibrary.stderr);assert.equal(existsSync(join(cache,'texture.png')),false);
});

test('strawberry control catalog keeps attribution, clothing and game buttons outside emotions',()=>{
  const avatar=avatars['strawberry-rabbit'];
  assert.equal(avatar.source,'library');
  for(const name of ['水印','双马尾','上','下','左','右','加'])assert.ok(avatar.excluded.includes(name));
  assert.deepEqual(avatar.layers,['右抬手','左抬手','打游戏','比心','话筒']);
  assert.ok(avatar.author.includes('赛博撸猫人'));assert.ok(avatar.author.includes('糖糖锦鲤'));
});

test('public CI initializes only public dependencies and packaging does not copy private models',()=>{
  const workflow=readFileSync('.github/workflows/windows.yml','utf8');
  assert.ok(workflow.includes('submodules: false'));
  assert.equal(workflow.includes('git submodule update'),false);
  assert.equal(workflow.includes('submodules: recursive'),false);
  const pack=readFileSync('scripts/package-electron.mjs','utf8');
  assert.ok(pack.includes("['agent','plugin','assets']"));
  assert.ok(pack.includes("join(destination,'resources/runtime/models')"));
});
