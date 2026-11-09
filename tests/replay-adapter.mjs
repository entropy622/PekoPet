import { LlmAdapter } from '@deepseek-ai/dsh-llm';
import { setTimeout } from 'node:timers/promises';
export const name='peko-test-adapter';
export const inject=['llm','approval','userQuestions'];
export function apply(ctx){
  const prompts=new Map();
  ctx.on('agent/inbox/claimed',({agent,message})=>{if(message.source?.kind==='user')prompts.set(String(agent.session.id),message.content.filter(b=>b.type==='text').map(b=>b.text).join(''));});
  ctx.on('agent/request',async({agent,signal},next)=>{
    if(prompts.get(String(agent.session.id))==='approval'){
      const outcome=await ctx.approval.request({agent,toolName:'peko_test_write',reason:'写入测试工作目录',signal});
      if(outcome!=='allowed-once')throw new Error(`test approval ${outcome}`);
    }
    if(prompts.get(String(agent.session.id))==='questions'){
      await ctx.userQuestions.ask({agent,signal,questions:[{id:'color',question:'选择颜色',options:[{label:'蓝色'},{label:'绿色'}]},{id:'note',question:'补充说明'}]});
    }
    return next();
  });
  class Replay extends LlmAdapter{
    providerInfo(){return {id:'peko-test',name:'Peko test'};}
    async listModels(){return [{provider:'peko-test',id:'replay',name:'Replay'}];}
    async resolveModel(provider,model){return {provider,id:model,name:model,defaultMaxTokens:2000};}
    async *stream(options){
      const system=options.messages.filter(m=>m.role==='system').map(m=>m.content.filter(b=>b.type==='text').map(b=>b.text).join('')).join('');
      const last=options.messages.filter(m=>m.role==='user'&&m.source?.kind==='user').at(-1)?.content.filter(b=>b.type==='text').map(b=>b.text).join('')??'';
      const extraction=system.includes('sourceSeq')&&system.includes('提取');
      let text;
      if(extraction){
        if(options.tools?.length)throw new Error('memory extractor received tools');
        const data=options.messages.filter(m=>m.role==='user').map(m=>m.content.filter(b=>b.type==='text').map(b=>b.text).join('')).find(s=>s.startsWith('{"messages":'));
        const payload=JSON.parse(data);text=JSON.stringify([{text:'用户喜欢兔子',sourceSeq:payload.messages.at(-1).seq}]);
      }else{
        if(!options.tools?.length)throw new Error('desktop preset tools missing');
        text='[[peko:{"mix":{"星星眼":0.8},"hold":1000}]]你好，我是 Peko。';
      }
      yield {type:'block-start',index:0,blockType:'text'};
      for(const char of text){if(last==='cancel')await setTimeout(80,undefined,{signal:options.signal});yield{type:'text-delta',index:0,text:char};}
      yield{type:'block-end',index:0,block:{type:'text',text}};
      yield{type:'finish',reason:{kind:'stop'}};
    }
  }
  ctx.llm.registerAdapter(['peko-test'],new Replay());
}
