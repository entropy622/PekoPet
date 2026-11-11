import {spawn,type ChildProcess} from 'node:child_process';
import {createWriteStream,existsSync,mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {EventEmitter} from 'node:events';
import {homedir} from 'node:os';
import {encodePacket,decodePacket} from '../agent/wire.ts';

export class Runtime extends EventEmitter {
  child:ChildProcess;
  pending=new Map<number,{resolve:(value:any)=>void;reject:(error:Error)=>void}>();
  sequence=0;
  ready:Promise<void>;
  closing=false;
  root:string;
  constructor(root:string,parentRequest:(method:string,params:any)=>Promise<unknown>){
    super();this.root=root;const logs=join(process.env.DSH_HOME||join(homedir(),'.dsh'),'peko-pet/logs');mkdirSync(logs,{recursive:true});const logPath=join(logs,'agent.log'),log=createWriteStream(logPath,{flags:'a'});
    const node=process.env.PEKO_NODE||(existsSync(join(root,'node.exe'))?join(root,'node.exe'):'node');
    this.child=spawn(node,[join(root,'scripts/start-agent.mjs')],{cwd:root,env:{...process.env,PEKO_DESKTOP:'1'},stdio:['ignore','pipe','pipe','ipc'],serialization:'json',windowsHide:true});
    this.child.stdout?.pipe(log,{end:false});this.child.stderr?.pipe(log,{end:false});
    this.ready=new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(new Error('助手启动超时，日志：'+logPath)),120000);
      this.child.on('message',async(message:any)=>{
        message=decodePacket(message);
        if(message?.type==='bootstrap')this.emit('bootstrap',message.settings);
        if(message?.type==='ready'){clearTimeout(timer);resolve();}
        if(message?.type==='response'){const pending=this.pending.get(message.id);if(pending){this.pending.delete(message.id);if(message.error){const error=Object.assign(new Error(message.error.message),message.error);pending.reject(error);}else pending.resolve(message.value);}}
        if(message?.type==='event')this.emit('event',message.method,message.params);
        if(message?.type==='parent-request'){try{const value=await parentRequest(message.method,message.params);this.child.send(encodePacket({type:'parent-response',id:message.id,value}));}catch(error){if(this.child.connected)this.child.send(encodePacket({type:'parent-response',id:message.id,error:String(error)}));}}
      });
      const fail=(error:Error)=>{clearTimeout(timer);reject(error);for(const pending of this.pending.values())pending.reject(error);this.pending.clear();this.emit('stopped',error);log.end();};
      this.child.once('error',fail);this.child.once('exit',(code,signal)=>fail(new Error(`助手运行时已退出（${signal||code}），未重发工作操作`)));
    });
  }
  async call(method:string,params:any={}){await this.ready;const id=++this.sequence;return new Promise<any>((resolve,reject)=>{this.pending.set(id,{resolve,reject});this.child.send(encodePacket({type:'request',id,method,params}),error=>{if(error){this.pending.delete(id);reject(error);}});});}
  async stop(){
    if(this.closing)return;this.closing=true;
    const exited=new Promise<void>(resolve=>{if(this.child.exitCode!==null||this.child.signalCode!==null)resolve();else this.child.once('exit',()=>resolve());});
    await Promise.race([this.call('shutdown').catch(()=>{}),new Promise(resolve=>setTimeout(resolve,3000))]);
    if(this.child.connected)this.child.disconnect();
    await Promise.race([exited,new Promise(resolve=>setTimeout(resolve,3000))]);
    if(this.child.exitCode===null&&this.child.signalCode===null){
      if(process.platform==='win32'&&this.child.pid){await new Promise<void>(resolve=>{const killer=spawn('taskkill',['/PID',String(this.child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});killer.once('error',()=>{this.child.kill();resolve();});killer.once('exit',()=>resolve());});}
      else this.child.kill();
    }
    await exited;
  }
}
