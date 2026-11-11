import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,symlinkSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {runInNewContext} from 'node:vm';
import {confinedFile} from '../desktop/model-library.ts';
import {renderIndex} from '../desktop/render-index.ts';

test('application model paths allow Unicode resources and reject traversal and junction escape',t=>{
  const home=mkdtempSync(join(tmpdir(),'peko-files-'));t.after(()=>rmSync(home,{recursive:true,force:true}));
  const model=join(home,'角色'),outside=join(home,'outside');mkdirSync(model);mkdirSync(outside);
  writeFileSync(join(model,'星星眼.json'),'{}');writeFileSync(join(outside,'private.txt'),'private');
  assert.equal(confinedFile(model,'星星眼.json'),join(model,'星星眼.json'));
  assert.throws(()=>confinedFile(model,'../outside/private.txt'),/超出/);
  symlinkSync(outside,join(model,'link'),process.platform==='win32'?'junction':'dir');
  assert.throws(()=>confinedFile(model,'link/private.txt'),/超出/);
});

test('desktop index preserves undefined and escapes global values without changing bootstrap order',()=>{
  const rows=[{kind:'script',text:'globalThis.order=[1]'},
    {kind:'global',name:'example',value:{text:'</script><p>中文'}},
    {kind:'global',name:'missing',value:undefined},
    {kind:'script',text:'globalThis.order.push(2)'},
    {kind:'script-src',src:'plugins/a.js?x="<&'},
    {kind:'html',placement:'body',html:'<div id="shell"></div>'}];
  const html=renderIndex('<html><head></head><body></body></html>',rows);
  assert.ok(html.includes('src="plugins/a.js?x=&quot;&lt;&amp;"'));
  assert.ok(html.indexOf('id="shell"')>html.indexOf('<body>'));
  assert.equal(html.includes('</script><p>中文'),false);
  const context={Promise};for(const match of html.matchAll(/<script>([\s\S]*?)<\/script>/g))runInNewContext(match[1],context);
  assert.equal(context.example.text,'</script><p>中文');assert.equal(context.missing,undefined);
  assert.equal(JSON.stringify(context.order),'[1,2]');
});
