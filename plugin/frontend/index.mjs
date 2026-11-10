import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {homedir} from 'node:os';
export const name='peko-frontend';
export const inject=['webServer'];
/** Apply PekoPet's palette without replacing dsh's conversation components. */
export function apply(ctx){
  const css=readFileSync(new URL('./soft.css',import.meta.url),'utf8');
  ctx.effect(()=>ctx.webServer.register({kind:'exact',path:'/peko/portrait.png',handler:(_req,res)=>{
    const home=process.env.DSH_HOME||join(homedir(),'.dsh');
    const avatar=ctx.get('pekoAvatarId')?.()||'yumi';
    try {const image=readFileSync(join(home,'peko-pet/icons',avatar+'-head.png'));res.writeHead(200,{'Content-Type':'image/png','Cache-Control':'no-cache'});res.end(image);}
    catch(error){if(error.code==='ENOENT'){res.writeHead(503);res.end();return;}throw error;}
  }}),'peko.portrait');
  ctx.on('webserver/index-inject',rows=>{rows.push({kind:'style',text:css},{kind:'html',placement:'head',html:'<link rel="icon" href="/peko/portrait.png">'});});
}
