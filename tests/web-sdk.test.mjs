import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync,existsSync} from 'node:fs';
import {join} from 'node:path';
test('Cubism Web Core contains only the listed runtime files and original notices',()=>{
  const root='vendor/cubism-web-core',manifest=readFileSync(join(root,'RedistributableFiles.txt'),'utf8');
  const allowed=new Set([...manifest.matchAll(/^- (.+)$/gm)].map(m=>m[1].trim()));
  for(const file of readdirSync(root))if(!['LICENSE.md','RedistributableFiles.txt','SOURCES.md'].includes(file))assert.ok(allowed.has(file),'Unlisted SDK file '+file);
  assert.ok(existsSync(join(root,'live2dcubismcore.min.js')));
  assert.ok(existsSync('vendor/cubism-web-framework/Shaders/WebGL/fragshadersrcpremultipliedalpha.frag'));
});
