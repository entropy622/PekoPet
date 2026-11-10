import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,utimesSync,rmSync} from 'node:fs';
import {join,basename,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';

test('portable archive preserves Unicode and dependency files with dates outside ZIP range',t=>{
  const root=mkdtempSync(join(tmpdir(),'peko-package-'));t.after(()=>rmSync(root,{recursive:true}));
  const source=join(root,'PekoPet'),zip=join(root,'portable.zip'),output=join(root,'unpacked');mkdirSync(source);
  const fixtures=[['柔和界面.txt','中文界面',new Date('1970-01-01T00:00:00Z')],['LICENSE','fixture license',new Date('2120-01-01T00:00:00Z')]];
  for(const [name,text,date] of fixtures){const file=join(source,name);writeFileSync(file,text);utimesSync(file,date,date);}
  const archived=spawnSync('powershell.exe',['-NoProfile','-File',resolve('scripts/archive.ps1'),'-Source',source,'-Destination',zip],{encoding:'utf8',windowsHide:true});assert.equal(archived.status,0,archived.stderr);
  const expand=join(root,'expand.ps1');writeFileSync(expand,'param($Zip,$Output)\n$ErrorActionPreference="Stop"\nAdd-Type -AssemblyName System.IO.Compression.FileSystem\n[IO.Compression.ZipFile]::ExtractToDirectory($Zip,$Output)');
  const expanded=spawnSync('powershell.exe',['-NoProfile','-File',expand,zip,output],{encoding:'utf8',windowsHide:true});
  assert.equal(expanded.status,0,expanded.stderr);
  for(const [name,text] of fixtures)assert.equal(readFileSync(join(output,basename(source),name),'utf8'),text);
});
