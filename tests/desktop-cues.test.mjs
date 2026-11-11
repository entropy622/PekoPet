import {test} from 'node:test';
import assert from 'node:assert/strict';
import {CueParser,StreamCues,validateCue} from '../desktop/cues.ts';
import {encodeWire,decodeWire,encodePacket,decodePacket} from '../agent/wire.ts';

test('TypeScript cue parser preserves all chunk boundaries, Chinese names and quoted delimiters',()=>{
  const input='你好[[peko:{"mix":{"星星眼":0.8}}]]今天[[peko:{"motion":"x]]y"}]]开心';
  for(let split=0;split<=input.length;split++){const parser=new CueParser(),cues=[...parser.push(input.slice(0,split)),...parser.push(input.slice(split)),...parser.push('',true)];assert.deepEqual(cues,[{mix:{星星眼:.8}},{motion:'x]]y'}]);}
  const parser=new CueParser();assert.equal([...input].flatMap(ch=>parser.push(ch)).length,2);
  assert.deepEqual(new CueParser().push('[[peko:bad]][[peko:{"clear":true}]][[peko:{"hold":500}]]'),[{clear:true},{hold:500}]);
});
test('code, incomplete markers, non-prose chunks, duplicate chunks and stale attempts do not animate',()=>{
  const parser=new CueParser();assert.deepEqual(parser.push('`[[peko:{"clear":true}]]`\n```json\n[[peko:{"clear":true}]]\n```'),[]);assert.deepEqual(new CueParser().push('[[peko:{',true),[]);
  const cursor=new StreamCues(),start={type:'start',attemptId:'a',revision:1};cursor.accept(start);
  const chunk={type:'chunk',attemptId:'a',revision:2,index:0,chunk:{type:'text-delta',index:0,text:'[[peko:{"clear":true}]]'}};
  assert.equal(cursor.accept(chunk).length,1);assert.equal(cursor.accept(chunk).length,0);assert.equal(cursor.accept({...chunk,attemptId:'b'}).length,0);
  assert.deepEqual(cursor.accept({...chunk,revision:3,index:1,chunk:{type:'reasoning-delta',text:'[[peko:{"clear":true}]]'}}),[]);
  assert.throws(()=>cursor.accept({...chunk,revision:4,index:3}),/缺失/);
  cursor.accept({type:'start',attemptId:'b',revision:5});assert.deepEqual(cursor.accept(chunk),[]);
  assert.equal(cursor.accept({...chunk,attemptId:'b',revision:6}).length,1);
  assert.deepEqual(cursor.accept({type:'end',attemptId:'b',revision:7,outcome:{kind:'abandoned'}}),[]);
});
test('model catalog clamps ranges and rejects unknown controls and malformed values',()=>{
  const catalog={name:'test',expressions:['开心'],layers:['话筒'],motions:['wave'],parameters:[{id:'x',min:-1,max:1,default:0}]};
  assert.deepEqual(validateCue({mix:{开心:2},params:{x:4},hold:0},catalog),{mix:{开心:1},params:{x:1},hold:100,clear:undefined});
  for(const cue of [{motion:'missing'},{params:{x:NaN}},{layers:{话筒:1}},{mix:{不存在:.5}},{unknown:true}])assert.throws(()=>validateCue(cue,catalog));
});
test('IPC JSON codec preserves bytes, undefined and user objects without reserved-key collisions',()=>{
  const data={body:new Uint8Array([0,255,128]),array:[undefined,'中文',null],user:{t:'bytes',v:'plain user value'}};
  assert.deepEqual(decodeWire(JSON.parse(JSON.stringify(encodeWire(data)))),data);
  assert.deepEqual(decodePacket(JSON.parse(JSON.stringify(encodePacket(data)))),data);
  assert.throws(()=>decodePacket({version:2,payload:null}),/协议版本/);
});

test('real per-frame revision semantics dispatch a split marker immediately and deduplicate its replay',()=>{
  const stream=new StreamCues();stream.accept({type:'start',attemptId:'root:1',revision:21});
  const marker='[[peko:{"mix":{"开心":0.8},"hold":5000}]]',events=[];
  for(let index=0;index<marker.length;index++){const frame={type:'chunk',attemptId:'root:1',revision:22+index,index,chunk:{type:'text-delta',index:0,text:marker[index]}};events.push(...stream.accept(frame));assert.deepEqual(stream.accept(frame),[]);}
  assert.deepEqual(events,[{mix:{开心:.8},hold:5000}]);
  assert.deepEqual(stream.accept({type:'end',attemptId:'root:1',revision:22+marker.length,outcome:{kind:'committed',eventType:'assistant/message'}}),[]);
});
