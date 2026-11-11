declare const window:any;
export {};
const bridge=window.peko;
let sequence=0;
window.__DSH_TRANSPORT__={
  ownsHost:true,
  fetch:async(input:string|URL,init:RequestInit={})=>{
    const request=new Request(new URL(input,'https://peko.internal'),init),id='fetch-'+(++sequence);
    const abort=()=>{void bridge.host('host.abort',{id});};init.signal?.addEventListener('abort',abort,{once:true});
    try{const value=await bridge.host('host.fetch',{id,path:new URL(request.url).pathname+new URL(request.url).search,method:request.method,headers:[...request.headers],body:request.body?new Uint8Array(await request.arrayBuffer()):undefined});return new Response(['HEAD'].includes(request.method)||[204,205,304].includes(value.status)?null:value.body,{status:value.status,headers:value.headers});}
    finally{init.signal?.removeEventListener('abort',abort);}
  },
  openStream:async function*(endpoint:string,payload:unknown,signal:AbortSignal,uplink?:AsyncIterable<unknown>){
    const id='stream-'+(++sequence);await bridge.host('host.stream.open',{id,endpoint,payload});
    let closed=false;const cancel=()=>{closed=true;void bridge.host('host.stream.cancel',{id}).catch(()=>{});};
    signal.addEventListener('abort',cancel,{once:true});if(signal.aborted)cancel();
    const feed=(async()=>{try{if(uplink)for await(const value of uplink){if(closed)break;await bridge.host('host.stream.push',{id,value});}if(!closed)await bridge.host('host.stream.end',{id});}catch{cancel();}})();
    try{while(!closed){const item=await bridge.host('host.stream.next',{id});if(item.done)break;yield item.value;}}
    finally{signal.removeEventListener('abort',cancel);cancel();void feed;}
  },
};
