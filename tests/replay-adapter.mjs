import { LlmAdapter } from '@deepseek-ai/dsh-llm';
import { setTimeout } from 'node:timers/promises';
export const name='peko-test-adapter';
export const inject=['llm','approval','userQuestions'];
function* toolCall(id,name,args){
  const block={type:'tool-call',id,name,arguments:JSON.stringify(args)};
  yield {type:'block-start',index:0,blockType:'tool-call'};
  yield {type:'tool-call-delta',index:0,id,name,argumentsDelta:block.arguments};
  yield {type:'block-end',index:0,block};yield {type:'finish',reason:{kind:'tool-calls'}};
}
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
      const reminder=options.messages.filter(m=>m.role==='user').at(-1)?.source?.kind==='schedule';
      if(last==='avatar-context-check'){
        const context=options.messages.flatMap(message=>message.content.filter(block=>block.type==='text').map(block=>block.text)).join('\n');
        if(!context.includes('日常聊天的大多数回复')||!context.includes('星星眼')||!context.includes('4000—6000'))throw new Error('Active avatar guidance missing from the model request');
      }
      let text;
      if(extraction){
        if(options.tools?.length)throw new Error('memory extractor received tools');
        const data=options.messages.filter(m=>m.role==='user').map(m=>m.content.filter(b=>b.type==='text').map(b=>b.text).join('')).find(s=>s.startsWith('{"messages":'));
        const payload=JSON.parse(data),facts=new Map([['我喜欢兔子','用户喜欢兔子'],['我喜欢 Rust','用户喜欢 Rust'],['我喜欢 GPUI','用户喜欢 GPUI']]);
        await setTimeout(200,undefined,{signal:options.signal});
        text=JSON.stringify(payload.messages.flatMap(m=>facts.has(m.text)?[{text:facts.get(m.text),sourceSeq:m.seq}]:[]));
      }else{
        if(!options.tools?.length)throw new Error('desktop preset tools missing');
        if(last==='mcp'&&!options.messages.some(m=>m.role==='tool'&&m.toolCallId==='fixture-echo')){
          yield* toolCall('fixture-echo','mcp__fixture__echo',{text:'MCP shared configuration round trip'});return;
        }
        if(last==='mcp'&&!options.messages.filter(m=>m.role==='tool').some(m=>JSON.stringify(m.content).includes('MCP shared configuration round trip')))throw new Error('MCP result missing');
        if(last==='files'){
          const results=options.messages.filter(m=>m.role==='tool');
          if(results.some(m=>m.isError))throw new Error('Filesystem tool failed: '+JSON.stringify(results));
          if(!results.some(m=>m.toolCallId==='fixture-read')){yield* toolCall('fixture-read','read',{file_path:'fixture.txt'});return;}
          if(!results.some(m=>m.toolCallId==='fixture-edit')){yield* toolCall('fixture-edit','edit',{file_path:'fixture.txt',old_string:'before',new_string:'after'});return;}
        }
        if(last==='schedule-later'&&!options.messages.some(m=>m.role==='tool'&&m.toolCallId==='fixture-schedule-later')){yield* toolCall('fixture-schedule-later','schedule_create',{title:'稍后提醒',prompt:'保留跨版本提醒',after_seconds:3600});return;}
        if(last==='schedule'&&!options.messages.some(m=>m.role==='tool'&&m.toolCallId==='fixture-schedule')){yield* toolCall('fixture-schedule','schedule_create',{title:'喝水提醒',prompt:'提醒用户喝水',after_seconds:2});return;}
        text=reminder?'提醒到了，喝点水吧。':'[[peko:{"mix":{"星星眼":0.8},"hold":1000}]]你好，我是 Peko。';
      }
      yield {type:'block-start',index:0,blockType:'text'};
      for(const char of text){if(last==='cancel')await setTimeout(80,undefined,{signal:options.signal});yield{type:'text-delta',index:0,text:char};}
      yield{type:'block-end',index:0,block:{type:'text',text}};
      yield{type:'finish',reason:{kind:'stop'}};
    }
  }
  ctx.llm.registerAdapter(['peko-test'],new Replay());
}
