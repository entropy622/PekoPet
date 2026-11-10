import {createServer} from 'node:net';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {homedir} from 'node:os';
export const name='peko-startup';
export const inject=[];
async function frontendPort(){
  const directory=join(process.env.DSH_HOME||join(homedir(),'.dsh'),'peko-pet');
  const file=join(directory,'web-port');
  try{
    const port=Number(readFileSync(file,'utf8'));
    if(!Number.isInteger(port)||port<1||port>65535)throw new Error('PekoPet web-port 无效');
    return port;
  }catch(error){if(error.code!=='ENOENT')throw error;}
  const server=createServer();
  const port=await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',()=>resolve(server.address().port));});
  await new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
  mkdirSync(directory,{recursive:true});writeFileSync(file,String(port));
  return port;
}
/** Keep one loopback origin so dsh's browser preferences survive reconnects. */
export async function apply(ctx){
  if(process.env.PEKO_EMBEDDED_UI!=='1')return;
  const port=await frontendPort();
  ctx.provide('webStartup',{host:'127.0.0.1',port,openBrowser:false,trustedHosts:[]});
}
