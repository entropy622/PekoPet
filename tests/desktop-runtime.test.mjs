import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';
import {Runtime} from '../desktop/runtime.ts';

test('desktop runtime serves bootstrap, binary bundles and cancellable streams over IPC without an HTTP listener',{timeout:120000},async t=>{
  const home=mkdtempSync(join(tmpdir(),'peko-ipc-'));
  mkdirSync(join(home,'profiles/desktop'),{recursive:true});writeFileSync(join(home,'profiles/desktop/cordis.patch.yml'),'- id: llm-deepseek-account\n  disabled: true\n');
  const patch=join(home,'fixture.yml');writeFileSync(patch,`- insert:\n    - id: fixture-model\n      name: '${pathToFileURL(resolve('tests/replay-adapter.mjs')).href}'\n`);
  process.env.DSH_HOME=home;process.env.PEKO_AGENT_PATCH=patch;process.env.PEKO_NODE=process.execPath;
  const runtime=new Runtime(resolve('.'),async()=>null);t.after(async()=>{await runtime.stop();rmSync(home,{recursive:true,force:true});});
  await runtime.ready;
  const boot=await runtime.call('host.boot');assert.equal(boot.transport,'ipc');assert.equal(boot.httpListening,false);assert.ok(boot.rows.some(r=>r.kind==='global'&&r.name==='__DSH_BOOT__'));
  const graph=boot.rows.find(r=>r.name==='__DSH_BOOT__').value;
  const bundle=await runtime.call('host.bundle',{path:'/'+graph.batches[0].url});assert.equal(bundle.status,200);assert.ok(bundle.body instanceof Uint8Array);assert.ok(bundle.body.length>1000);
  const caps=await runtime.call('peko.capabilities');assert.equal(caps.runtime.transport,'ipc');assert.equal(caps.frontendUrl,undefined);
  await runtime.call('host.stream.open',{id:'events',endpoint:'$events',payload:{args:{}}});
  const first=await runtime.call('host.stream.next',{id:'events'});assert.equal(first.value.type,'ready');
  await runtime.call('host.stream.cancel',{id:'events'});
  await runtime.stop();assert.equal(runtime.child.exitCode,0);
});
