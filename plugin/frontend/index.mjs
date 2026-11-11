import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {homedir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {inlineModuleBootstrap} from './bootstrap.mjs';
export const name='peko-frontend';
export const inject=['webServer','clientModules','connection'];
/** Apply PekoPet's palette without replacing dsh's conversation components. */
export function apply(ctx){
  const css=readFileSync(new URL('./soft.css',import.meta.url),'utf8');
  const index=fileURLToPath(import.meta.resolve('@deepseek-ai/dsh-web-frontend/dist/index.html'));
  for(const path of ['/','/index.html'])ctx.effect(()=>ctx.webServer.register({kind:'exact',path,handler:(req,res)=>{
    res.setHeader('Cache-Control','no-store');
    if(!['GET','HEAD'].includes(req.method)){res.writeHead(405);res.end();return;}
    if(!ctx.connection.authorizeIndex(req,res))return;
    const html=ctx.webServer.renderIndex(readFileSync(index,'utf8')).replace(/<head(?:\s[^>]*)?>/i,open=>open+'<base href="./">');
    res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end(req.method==='HEAD'?undefined:html);
  }}),'peko.index'+path);
  ctx.effect(()=>ctx.webServer.register({kind:'exact',path:'/peko/portrait.png',handler:(_req,res)=>{
    const home=process.env.DSH_HOME||join(homedir(),'.dsh');
    const avatar=ctx.get('pekoAvatarId')?.()||'yumi';
    try {const image=readFileSync(join(home,'peko-pet/icons',avatar+'-head.png'));res.writeHead(200,{'Content-Type':'image/png','Cache-Control':'no-cache'});res.end(image);}
    catch(error){if(error.code==='ENOENT'){res.writeHead(503);res.end();return;}throw error;}
  }}),'peko.portrait');
  ctx.on('webserver/index-inject',rows=>{inlineModuleBootstrap(rows,ctx.clientModules);rows.push({kind:'style',text:css},{kind:'html',placement:'head',html:'<link rel="icon" href="/peko/portrait.png">'});});
}
