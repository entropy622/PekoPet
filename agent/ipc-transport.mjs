import {encodePacket,decodePacket} from './wire.ts';
import {inlineModuleBootstrap} from '../plugin/frontend/bootstrap.mjs';
/** Private parent/child transport. No sockets, browser tokens or cookie store. */
export class IpcTransport {
  constructor(){this.pending=new Set();this.parentRequests=new Map();this.counter=0;this.handler=undefined;this.extra=undefined;}
  requestParent(method,params){const id=++this.counter;return new Promise((resolve,reject)=>{this.parentRequests.set(id,{resolve,reject});void this.send({type:'parent-request',id,method,params}).catch(reject);});}
  send(value){
    if(!process.connected)return Promise.reject(new Error('PekoPet 主进程已退出'));
    const pending=new Promise((resolve,reject)=>process.send(encodePacket(value),error=>error?reject(error):resolve()));
    this.pending.add(pending);pending.then(()=>this.pending.delete(pending),()=>this.pending.delete(pending));return pending;
  }
  onRequest(handler){this.handler=handler;}
  notify(method,params){void this.send({type:'event',method,params}).catch(()=>{});}
  start(){
    this.listener=async message=>{
      message=decodePacket(message);
      if(message?.type==='parent-response'){const pending=this.parentRequests.get(message.id);if(pending){this.parentRequests.delete(message.id);message.error?pending.reject(new Error(message.error)):pending.resolve(message.value);}return;}
      if(message?.type!=='request'||typeof message.id!=='number'||typeof message.method!=='string')return;
      try{const value=message.method.startsWith('host.')?await this.extra(message.method,message.params):await this.handler(message.method,message.params);
        await this.send({type:'response',id:message.id,value});
      }catch(error){await this.send({type:'response',id:message.id,error:{message:String(error?.message??error),code:error?.code,details:error?.details}}).catch(()=>{});}
    };
    process.on('message',this.listener);
  }
  async flush(){await Promise.allSettled([...this.pending]);}
  close(){if(this.listener)process.off('message',this.listener);for(const pending of this.parentRequests.values())pending.reject(new Error('运行时已关闭'));this.parentRequests.clear();}
}

class Inbox {
  values=[];ended=false;wake;
  push(value){if(this.ended)throw new Error('流已结束');this.values.push(value);this.wake?.();}
  end(){this.ended=true;this.wake?.();}
  async *[Symbol.asyncIterator](){while(!this.ended||this.values.length){if(this.values.length)yield this.values.shift();else await new Promise(resolve=>{this.wake=resolve;});}}
}

export function attachDesktopHost(ctx,transport){
  const peer=ctx.connection.createPeer({principal:{kind:'owner'},interactions:'answer'});
  const streams=new Map(),requests=new Map();
  const response=async value=>({status:value.status,headers:[...value.headers],body:new Uint8Array(await value.arrayBuffer())});
  transport.extra=async(method,p={})=>{
    await ctx.get('pekoReady');
    if(method==='host.boot'){const rows=[];ctx.emit('webserver/index-inject',rows);inlineModuleBootstrap(rows,ctx.clientModules);return {rows,transport:'ipc',httpListening:!!ctx.get('webServer')};}
    if(method==='host.bundle'){
      if(typeof p.path!=='string'||!p.path.startsWith('/plugins/'))throw new Error('无效模块路径');
      return response(await ctx.clientModules.fetchBundle(new Request('https://peko.internal'+p.path)));
    }
    if(method==='host.fetch'){
      const url=new URL(p.path,'https://peko.internal');
      if(url.origin!=='https://peko.internal'||!url.pathname.startsWith('/api/'))throw new Error('无效 API 路径');
      const controller=new AbortController();requests.set(p.id,controller);
      try{return await response(await ctx.connection.createSharedFetchHandler('/api').fetch(new Request(url,{method:p.method,headers:p.headers,body:['GET','HEAD'].includes(p.method)?undefined:p.body,signal:controller.signal}),peer));}
      finally{requests.delete(p.id);}
    }
    if(method==='host.abort'){requests.get(p.id)?.abort();return;}
    if(method==='host.stream.open'){
      if(streams.has(p.id))throw new Error('流 ID 已存在');
      const controller=new AbortController(),inbox=new Inbox();
      const iterable=await ctx.typertGateway.wireStream.open(p.endpoint,p.payload,inbox,peer,controller.signal);
      streams.set(p.id,{controller,inbox,iterator:iterable[Symbol.asyncIterator]()});return;
    }
    const stream=streams.get(p.id);
    if(method==='host.stream.cancel'){if(stream){streams.delete(p.id);stream.controller.abort();stream.inbox.end();void stream.iterator.return?.().catch(()=>{});}return;}
    if(!stream)throw new Error('流已关闭');
    if(method==='host.stream.next')return stream.iterator.next();
    if(method==='host.stream.push'){stream.inbox.push(p.value);return;}
    if(method==='host.stream.end'){stream.inbox.end();return;}
    throw new Error('未知桌面请求：'+method);
  };
  ctx.on('dispose',()=>{for(const request of requests.values())request.abort();for(const stream of streams.values()){stream.controller.abort();stream.inbox.end();}streams.clear();});
}
