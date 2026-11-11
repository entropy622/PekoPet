import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,utimesSync,rmSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
test('portable ZIP excludes generated state and retains nested runtime assets and old files',{skip:process.platform!=='win32'},()=>{
  const directory=mkdtempSync(join(tmpdir(),'peko-archive-')),source=join(directory,'PekoPet'),zip=join(directory,'pet.zip');
  try{
    for(const folder of ['work','runtime','local/models','models/strawberry-rabbit','peko-pet','node_modules/pkg/runtime'])mkdirSync(join(source,folder),{recursive:true});
    writeFileSync(join(source,'app.txt'),'payload');utimesSync(join(source,'app.txt'),new Date(0),new Date(0));
    writeFileSync(join(source,'models/strawberry-rabbit/private.moc3'),'private submodule model');
    writeFileSync(join(source,'work/private.txt'),'test state');writeFileSync(join(source,'runtime/overlay.yml'),'generated');writeFileSync(join(source,'node_modules/pkg/runtime/needed.txt'),'needed');
    writeFileSync(join(source,'local/models/private.moc3'),'private model');writeFileSync(join(source,'peko-pet/state.sqlite3'),'private state');writeFileSync(join(source,'.env'),'PRIVATE_TEST_VALUE=fixture');writeFileSync(join(source,'.credentials.yaml'),'fixture: private');
    const built=spawnSync('powershell.exe',['-NoProfile','-File',resolve('scripts/archive.ps1'),'-Source',source,'-Destination',zip],{encoding:'utf8',windowsHide:true});assert.equal(built.status,0,built.stderr);
    const reader=join(directory,'read.ps1');writeFileSync(reader,"Add-Type -AssemblyName System.IO.Compression.FileSystem\n$zip=[IO.Compression.ZipFile]::OpenRead($args[0])\ntry{@($zip.Entries|ForEach-Object{[pscustomobject]@{name=$_.FullName;year=$_.LastWriteTime.Year}})|ConvertTo-Json -Compress}finally{$zip.Dispose()}\n");
    const read=spawnSync('powershell.exe',['-NoProfile','-File',reader,zip],{encoding:'utf8',windowsHide:true});assert.equal(read.status,0,read.stderr);
    const entries=JSON.parse(read.stdout);assert.deepEqual(entries.map(e=>e.name).sort(),['PekoPet/app.txt','PekoPet/node_modules/pkg/runtime/needed.txt']);assert.equal(entries.find(e=>e.name.endsWith('/app.txt')).year,1980);
  }finally{rmSync(directory,{recursive:true,force:true});}
});
