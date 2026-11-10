import {withFileLock,writeFileAtomic} from '@deepseek-ai/dsh-atomic-write';
import {Context} from '@deepseek-ai/cordis';
import * as Jsonl from '@deepseek-ai/dsh-session-persistence-jsonl';
import {existsSync,readdirSync,cpSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {join,relative,resolve,sep,dirname} from 'node:path';
import {State} from '../plugin/state.mjs';
/** Copy PekoPet-indexed legacy sessions and reminders; commit only after successful boot. */
export async function migrateSessions(home){
  const data=join(home,'peko-pet'),marker=join(data,'session-migration.json');
  if(existsSync(marker))return {pending:false,async commit(){},rollback(){}};
  const source=join(home,'sessions'),destination=join(data,'sessions'),ids=new Set(),created=[],copied=[],reminderSources=[];
  let committed=false;
  if(existsSync(join(data,'state.sqlite3'))){const state=new State(join(data,'state.sqlite3'));try{for(const row of state.sessions())ids.add(row.id);}finally{state.close();}}
  if(ids.size&&existsSync(source)){
    const reader=new Context();
    try{await reader.plugin(Jsonl,{root:source});const snapshots=await reader.get('sessionPersistence').list();let added;
      do{added=false;for(const {header} of snapshots)if(header.parentSession&&ids.has(header.parentSession)&&!ids.has(header.id)){ids.add(header.id);added=true;}}while(added);
    }finally{await reader.fiber.dispose();}
  }
  function walk(directory){for(const entry of readdirSync(directory,{withFileTypes:true})){if(!entry.isDirectory()||entry.isSymbolicLink())continue;const path=join(directory,entry.name);if(ids.has(entry.name)){const target=join(destination,relative(source,path));if(!existsSync(target)){mkdirSync(target,{recursive:true});created.push(target);cpSync(path,target,{recursive:true,force:false,errorOnExist:true});copied.push(entry.name);}}else walk(path);}}
  try{
    if(ids.size&&existsSync(source))walk(source);
    const store=join(data,'storages'),legacy=join(home,'storages/schedule.json'),tasks=join(home,'storages/schedule/tasks');
    if(existsSync(legacy)&&!existsSync(join(store,'schedule.json'))){
      const value=JSON.parse(readFileSync(legacy,'utf8'));value.tables.tasks=Object.fromEntries(Object.entries(value.tables?.tasks??{}).filter(([,task])=>ids.has(task.sessionId)));
      if(Object.keys(value.tables.tasks).length){mkdirSync(store,{recursive:true});const file=join(store,'schedule.json');writeFileSync(file,JSON.stringify(value,null,2),{flag:'wx',mode:0o600});created.push(file);reminderSources.push({path:legacy,kind:'single',ids:Object.keys(value.tables.tasks)});}
    }
    if(existsSync(tasks))for(const entry of readdirSync(tasks,{withFileTypes:true})){if(!entry.isFile()||!entry.name.endsWith('.json'))continue;const file=join(tasks,entry.name),value=JSON.parse(readFileSync(file,'utf8'));
      const target=join(store,'schedule/tasks',entry.name);if(ids.has(value.record?.sessionId)&&!existsSync(target)){mkdirSync(join(store,'schedule/tasks'),{recursive:true});cpSync(file,target,{force:false,errorOnExist:true});created.push(target);reminderSources.push({path:file,kind:'record'});}
    }
  }catch(error){rollback();throw error;}
  function rollback(){if(committed)return;for(const path of created.reverse()){if(!resolve(path).startsWith(resolve(data)+sep))throw new Error('迁移目标超出应用数据目录');rmSync(path,{recursive:true,force:true});}}
  return {pending:true,async copyAttachments(ctx){
    const persistence=ctx.get('sessionPersistence');
    const copyReference=value=>{
      if(!value||typeof value!=='object')return;
      const match=typeof value.attachmentId==='string'&&/^sha256:([a-f0-9]{64})$/.exec(value.attachmentId);
      if(match){const digest=match[1],prefix=digest.slice(0,2),paths=value.mediaType?[join('objects',prefix,digest)]:[join('file-objects',prefix,digest),join('files',prefix,digest)];
        for(const suffix of paths){const old=join(home,'attachments/v1',suffix),target=join(data,'attachments/v1',suffix);if(existsSync(old)&&!existsSync(target)){mkdirSync(dirname(target),{recursive:true});created.push(target);cpSync(old,target,{recursive:true,force:false,errorOnExist:true});}}
      }
      for(const child of Object.values(value))if(child&&typeof child==='object')copyReference(child);
    };
    for(const id of copied){const handle=await persistence.open(id,'read');try{const result=await handle.read(0);for(const event of result.events)copyReference(event);}finally{await handle.close();}}

  },async commit(){
    const undo=[],recovery=[];
    try{
      for(const source of reminderSources)await withFileLock(source.path,async()=>{
        const before=readFileSync(source.path,'utf8'),value=JSON.parse(before);
        const previous=source.kind==='single'?Object.fromEntries(source.ids.filter(id=>value.tables.tasks[id]&&ids.has(value.tables.tasks[id].sessionId)).map(id=>[id,value.tables.tasks[id]])):value.record;
        const tasks=source.kind==='single'?Object.values(previous):[previous];
        if(tasks.every(task=>!task||task.status==='inactive'))return;
        recovery.push({path:source.path,kind:source.kind,previous:structuredClone(previous)});
        if(source.kind==='single'){for(const id of source.ids)if(value.tables.tasks[id]&&ids.has(value.tables.tasks[id].sessionId))value.tables.tasks[id].status='inactive';}
        else if(ids.has(value.record?.sessionId))value.record.status='inactive';
        await writeFileAtomic(source.path,JSON.stringify(value,null,2),{mode:0o600});undo.push({path:source.path,before});
      });
      mkdirSync(data,{recursive:true});writeFileSync(marker,JSON.stringify({version:1,created:new Date().toISOString(),copied,reminderHandoff:recovery},null,2),{flag:'wx',mode:0o600});
      committed=true;
    }catch(error){for(const item of undo.reverse())await writeFileAtomic(item.path,item.before,{mode:0o600});throw error;}
  },rollback};
}
