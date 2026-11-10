import { exitOnStdinEnd } from '@deepseek-ai/dsh-cmdline';
export const name='peko-startup';
export const inject=['cmdlineArgs'];
/** One runtime serves the embedded frontend and the native companion protocol. */
export function apply(ctx){
  exitOnStdinEnd(ctx,'peko.stdin');
  ctx.provide('sdkAppStartup',{accepted:true});
  ctx.provide('webStartup',{host:'127.0.0.1',port:0,openBrowser:false,trustedHosts:[]});
}
