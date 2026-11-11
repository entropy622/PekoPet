import {readFileSync} from 'node:fs';
export const name='peko-frontend';
export const inject=['clientModules'];
export function apply(ctx){
  const css=readFileSync(new URL('./soft.css',import.meta.url),'utf8');
  ctx.on('webserver/index-inject',rows=>{
    rows.push({kind:'style',text:css},{kind:'html',placement:'head',html:'<link rel="icon" href="/peko/portrait.png">'});
  });
}
