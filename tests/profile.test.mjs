import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, statSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { prepareSharedProfile } from '../scripts/shared-profile.mjs';
test('desktop configuration is referenced without copying its values',t=>{
  const home=mkdtempSync(join(tmpdir(),'peko-profile-'));t.after(()=>rmSync(home,{recursive:true}));
  const source=join(home,'profiles/desktop');mkdirSync(source,{recursive:true});
  writeFileSync(join(source,'package.json'),JSON.stringify({dsh:{profile:{bundles:['test-bundle']}}}));
  writeFileSync(join(source,'cordis.patch.yml'),'[]\n');
  const target=prepareSharedProfile(home);
  assert.equal(statSync(join(source,'cordis.patch.yml')).ino,statSync(join(target,'cordis.patch.yml')).ino);
  writeFileSync(join(source,'cordis.patch.yml'),'- id: test\n  disabled: true\n');
  assert.equal(readFileSync(join(target,'cordis.patch.yml'),'utf8'),readFileSync(join(source,'cordis.patch.yml'),'utf8'));
  assert.deepEqual(JSON.parse(readFileSync(join(target,'package.json'),'utf8')).dsh.profile.bundles,['test-bundle']);
  prepareSharedProfile(home);
});
test('does not overwrite another application profile',t=>{
  const h=mkdtempSync(join(tmpdir(),'peko-owner-'));t.after(()=>rmSync(h,{recursive:true}));
  for(const p of ['desktop','peko']){mkdirSync(join(h,'profiles',p),{recursive:true});writeFileSync(join(h,'profiles',p,'package.json'),'{}');}
  assert.throws(()=>prepareSharedProfile(h),/已被其他程序/);
});
