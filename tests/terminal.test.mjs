import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

test('packaged Windows terminal backend loads and returns output', ()=>{
  const probe=`const pty=require('node-pty');const t=pty.spawn('cmd.exe',['/d','/c','echo PekoPet terminal ready'],{cols:80,rows:24,cwd:process.cwd(),env:process.env});t.onData(data=>process.stdout.write(data));t.onExit(event=>process.exit(event.exitCode));`;
  const result=spawnSync(process.execPath,['-e',probe],{encoding:'utf8',timeout:15000,windowsHide:true});
  assert.ifError(result.error);assert.equal(result.status,0,result.stderr);assert.ok(result.stdout.includes('PekoPet terminal ready'),result.stdout);
});
