import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {runInNewContext} from 'node:vm';
import {inlineModuleBootstrap} from '../plugin/frontend/bootstrap.mjs';

const core='@deepseek-ai/dsh-client-modules';
test('bootstrap becomes an ordered inline registration without changing application preloads',t=>{
  const root=mkdtempSync(join(tmpdir(),'peko-bootstrap-'));t.after(()=>rmSync(root,{recursive:true}));
  const file=join(root,'client.js');writeFileSync(file,`window.__ModuleLoader__.load({id:${JSON.stringify(core)},text:"</script>"});\n//# sourceMappingURL=client.js.map`);
  const queue={kind:'script',placement:'head',text:'window.__ModuleLoader__={pendingQueue:[],load(row){this.pendingQueue.push(row)}};'};
  const preload={kind:'script-preload',src:'plugins/application.js'},graph={kind:'global',name:'__DSH_BOOT__',value:{}};
  const rows=[queue,preload,{kind:'script-src',placement:'head',src:'plugins/core.js'},graph];
  inlineModuleBootstrap(rows,{graph:()=>({batches:[{phase:'bootstrap',entries:[core],url:'plugins/core.js'}]}),clientPath:()=>file});
  assert.equal(rows[0],queue);assert.equal(rows[1],preload);assert.equal(rows[3],graph);
  assert.equal(rows[2].kind,'script');assert.equal(rows[2].text.includes('</script>'),false);assert.equal(rows[2].text.includes('sourceMappingURL'),false);
  const window={};for(const row of rows)if(row.kind==='script')runInNewContext(row.text,{window});
  assert.equal(window.__ModuleLoader__.pendingQueue[0].id,core);assert.equal(window.__ModuleLoader__.pendingQueue[0].text,'</script>');
});

test('incomplete module graph fails before serving a broken shell',()=>{
  assert.throws(()=>inlineModuleBootstrap([],{graph:()=>({batches:[]}),clientPath:()=>undefined}),/模块引导未就绪/);
});
