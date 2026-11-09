import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { State, containsSecret } from '../plugin/state.mjs';
function fixture(t){const dir=mkdtempSync(join(tmpdir(),'peko-state-'));const s=new State(join(dir,'state.sqlite3'));t.after(()=>{s.close();rmSync(dir,{recursive:true});});return s;}
test('settings persist and reject invalid fields',t=>{const s=fixture(t);s.updateSettings({dnd:true,persona:'Peko'});assert.equal(s.settings().persona,'Peko');assert.throws(()=>s.updateSettings({apiKey:'secret'}));assert.throws(()=>s.updateSettings({petScale:0}));});
test('deleted memories stay forgotten during automatic extraction',t=>{const s=fixture(t);const m=s.addMemory('喜欢简洁的回答','a',1);assert.ok(m);s.deleteMemory(m.id);assert.equal(s.addMemory('喜欢简洁的回答！','a',1),null);assert.equal(s.memories().length,0);assert.ok(s.addMemory('喜欢简洁的回答','a',2,true));});
test('pause, edit, clear and credential filtering',t=>{const s=fixture(t);s.updateSettings({memoryEnabled:false});assert.equal(s.addMemory('喜欢猫','a',1),null);s.updateSettings({memoryEnabled:true});const m=s.addMemory('喜欢猫','a',1);s.editMemory(m.id,'喜欢兔子');assert.equal(s.memories()[0].text,'喜欢兔子');assert.throws(()=>s.addMemory('api_key=sk-abcdefghijklmnop','a',1));s.clearMemories();assert.equal(s.memories().length,0);assert.equal(s.addMemory('喜欢兔子','a',2),null);});
test('user facts processed once, tool and assistant text excluded',t=>{const s=fixture(t);s.rememberSession('a','D:/Git');s.message('a',1,'user','我喜欢兔子');s.message('a',2,'assistant','用户喜欢猫');assert.equal(s.pendingUserFacts('a').length,1);s.advanceMemory('a',1);assert.equal(s.pendingUserFacts('a').length,0);assert.equal(s.sessions()[0].title,'我喜欢兔子');});
test('daily proactive limit and do-not-disturb',t=>{const s=fixture(t),now=new Date(2026,10,9,12);assert.equal(s.greetingAllowed(now,61),true);s.markGreeting(now);s.markGreeting(now);assert.equal(s.greetingAllowed(now,61),false);assert.equal(s.greetingAllowed(new Date(2026,10,10,2),61),false);s.updateSettings({dnd:true});assert.equal(s.greetingAllowed(new Date(2026,10,10,12),61),false);});
test('state survives close and reopen',()=>{const d=mkdtempSync(join(tmpdir(),'peko-reopen-')),p=join(d,'state.sqlite3');let s=new State(p);s.addMemory('喜欢 Rust','a',1);s.close();s=new State(p);assert.equal(s.memories()[0].text,'喜欢 Rust');s.close();rmSync(d,{recursive:true});});
test('recognizes credential formats',()=>{assert.equal(containsSecret('github_pat_1234567890123456'),true);assert.equal(containsSecret('喜欢 Rust'),false);});
test('avatar state persists without replaying a motion',t=>{const s=fixture(t);s.setAvatarState('a',{layers:{'拿话筒':true}});assert.deepEqual(s.avatarState('a'),{layers:{'拿话筒':true}});assert.deepEqual(s.avatarState('missing'),{});});
test('resuming memory does not extract statements made while paused',t=>{
  const s=fixture(t);s.updateSettings({memoryEnabled:false});s.message('a',1,'user','暂停时的偏好');s.updateSettings({memoryEnabled:true});assert.deepEqual(s.pendingUserFacts('a'),[]);s.message('a',2,'user','恢复后的偏好');assert.deepEqual(s.pendingUserFacts('a').map(f=>f.seq),[2]);
});
test('clearing memory retires unprocessed source messages',t=>{
  const s=fixture(t);s.message('a',1,'user','旧偏好');s.message('b',4,'user','另一条旧偏好');s.clearMemories();assert.deepEqual(s.pendingUserFacts('a'),[]);assert.deepEqual(s.pendingUserFacts('b'),[]);s.message('a',2,'user','新偏好');assert.deepEqual(s.pendingUserFacts('a').map(f=>f.seq),[2]);
});
