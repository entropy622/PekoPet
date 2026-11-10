import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Context} from '@deepseek-ai/cordis';
import * as Jsonl from '@deepseek-ai/dsh-session-persistence-jsonl';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,readdirSync,existsSync,rmSync} from 'node:fs';
import {join,relative} from 'node:path';
import {tmpdir} from 'node:os';
import {createUserMessage} from '@deepseek-ai/dsh-llm';
import {Session,SESSION_FORMAT_VERSION} from '@deepseek-ai/dsh-session';
import {State} from '../plugin/state.mjs';
import {migrateSessions} from '../agent/migrate-sessions.mjs';
function files(root){return Object.fromEntries(readdirSync(root,{recursive:true,withFileTypes:true}).filter(e=>e.isFile()).map(e=>{const p=join(e.parentPath,e.name);return[relative(root,p),readFileSync(p).toString('base64')];}));}

test('migration copies owned roots and child sessions, keeps foreign history, and rolls back an uncommitted copy',async()=>{
  const home=mkdtempSync(join(tmpdir(),'peko-migration-')),ctx=new Context();
  try{
    const source=join(home,'sessions');await ctx.plugin(Jsonl,{root:source});
    for(const [id,parent] of [['root',null],['child','root'],['foreign',null]]){const h=await ctx.get('sessionPersistence').create({id,version:SESSION_FORMAT_VERSION,isSeeded:false,createdAt:1,cwd:home,...parent?{parentSession:parent}:{}});if(id==='root'){const session=Session.create(id,[],h.header);session.append('user/message',createUserMessage({content:[{type:'image',attachment:{attachmentId:'sha256:'+'a'.repeat(64),mediaType:'image/png',bytes:7,width:1,height:1}}],source:{kind:'user'}}),{surfaceOp:'append'});await h.append(session.snapshotEvents());}await h.flush();await h.close();}
    const state=new State(join(home,'peko-pet/state.sqlite3'));state.rememberSession('root',home);state.close();
    mkdirSync(join(home,'storages'),{recursive:true});writeFileSync(join(home,'storages/schedule.json'),JSON.stringify({unit:{name:'schedule',version:1},global:null,tables:{tasks:{ours:{sessionId:'root',record:{}},theirs:{sessionId:'foreign',record:{}}}}}));
    const image=join(home,'attachments/v1/objects/aa', 'a'.repeat(64));mkdirSync(join(home,'attachments/v1/objects/aa'),{recursive:true});writeFileSync(image,'fixture');
    const before=files(source),migration=await migrateSessions(home);
    assert.deepEqual(files(source),before);
    assert.deepEqual(Object.keys(files(join(home,'peko-pet/sessions'))).length,Object.keys(before).length-1);
    const reminders=JSON.parse(readFileSync(join(home,'peko-pet/storages/schedule.json'),'utf8'));assert.deepEqual(Object.keys(reminders.tables.tasks),['ours']);
    migration.rollback();assert.equal(Object.keys(files(join(home,'peko-pet/sessions'))).length,0);
    const retry=await migrateSessions(home);const targetReader=new Context();try{await targetReader.plugin(Jsonl,{root:join(home,'peko-pet/sessions')});await retry.copyAttachments(targetReader);}finally{await targetReader.fiber.dispose();}assert.equal(readFileSync(join(home,'peko-pet/attachments/v1/objects/aa','a'.repeat(64)),'utf8'),'fixture');await retry.commit();assert.equal(existsSync(join(home,'peko-pet/session-migration.json')),true);assert.deepEqual(files(source),before);const handed=JSON.parse(readFileSync(join(home,'storages/schedule.json'),'utf8'));assert.equal(handed.tables.tasks.ours.status,'inactive');assert.equal(handed.tables.tasks.theirs.status,undefined);
    const again=await migrateSessions(home);await again.commit();
  }finally{await ctx.fiber.dispose();rmSync(home,{recursive:true,force:true});}
});
