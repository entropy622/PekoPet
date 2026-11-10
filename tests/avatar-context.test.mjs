import {test} from 'node:test';
import assert from 'node:assert/strict';
import {avatarContext} from '../plugin/avatar-context.mjs';

function examples(text){return [...text.matchAll(/\[\[peko:(\{[^\n]*?\})\]\]/g)].map(match=>JSON.parse(match[1]));}
test('avatar prompt examples use the active character names and actual parameter range',()=>{
  const avatar={catalog:{name:'Yumi',expressions:['猫猫嘴'],layers:[],motions:[],parameters:[{id:'ParamMouthForm',min:-0.2,max:0.3,default:0.1}]},state:{layers:{}}};
  const cues=examples(avatarContext(avatar));
  assert.deepEqual(cues[0],{mix:{猫猫嘴:0.65},hold:5000});
  assert.equal(cues[1].params.ParamMouthForm,0.2);
  assert.equal(cues[1].hold,5000);
  assert.ok(avatarContext(avatar).includes(JSON.stringify(avatar)));
});
test('characters without mouth parameters get only their supported expression example',()=>{
  const text=avatarContext({catalog:{expressions:['开心'],parameters:[]},state:{}});
  assert.deepEqual(examples(text),[{mix:{开心:0.65},hold:5000}]);
});
test('loading and empty catalogs do not advertise invented expression names',()=>{
  assert.equal(examples(avatarContext()).length,0);
  assert.equal(examples(avatarContext({state:{}})).length,0);
  assert.equal(examples(avatarContext({catalog:{expressions:[],parameters:[]},state:{}})).length,0);
});
