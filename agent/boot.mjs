import '../scripts/stdio.mjs';
import {boot,loadLayeredEnv,installFailLoud} from '@deepseek-ai/dsh-app-boot';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {prepareRuntime,root} from './configuration.mjs';
import {migrateSessions} from './migrate-sessions.mjs';
import {IpcTransport,attachDesktopHost} from './ipc-transport.mjs';
export async function startAgent({desktop=process.env.PEKO_DESKTOP==='1',extraPatches=[]}={}){
  const started=performance.now(),stage=name=>console.error('[PekoPet startup]',name,Math.round(performance.now()-started)+' ms');
  stage('agent start');
  let context,closing,pending;
  installFailLoud('PekoPet',process,async()=>{await context?.fiber.dispose();});
  const environment=loadLayeredEnv('PekoPet',root);
  const home=process.env.DSH_HOME||join(homedir(),'.dsh');
  const migration=await migrateSessions(home);
  stage('migration prepared');
  const exit=code=>closing??=(async()=>{await context?.fiber.dispose();process.exit(code);})();
  let ready;const readyPromise=new Promise(resolve=>{ready=resolve;});
  const ipc=process.send?new IpcTransport():undefined;
  try{const configuration=prepareRuntime(home,{desktop,extraPatches});stage('configuration prepared');
  if(migration.pending)configuration.rows.find(row=>row.id==='schedule').disabled=true;
  context=await boot('PekoPet',configuration.file,[{insert:configuration.rows}],ctx=>{
    context=ctx;ctx.provide('pekoReady',readyPromise);ctx.provide('pekoConfiguration',configuration);ctx.provide('launchEnvironment',environment);ctx.provide('appExit',exit);if(ipc)ctx.provide('pekoTransport',ipc);
    stage('loader prepared');
    pending=setTimeout(()=>console.error('[PekoPet startup] waiting modules', [...ctx.get('loader').entries()].filter(entry=>!entry.options.disabled&&entry.fiber?.state!==2).map(entry=>entry.options.id).join(', ')),5000);pending.unref();ctx.on('dispose',()=>clearTimeout(pending));
  },pathToFileURL(root+'/').href);
  clearTimeout(pending);console.error('[PekoPet] Loop initialized');
  stage('loop initialized');
  if(!context.get('pekoControl')||context.get('agentLoop')?.owner!=='PekoPet')throw new Error('PekoPet agent runtime did not initialize');
  await migration.copyAttachments?.(context);await migration.commit();
  console.error('[PekoPet] State migration committed');
  if(migration.pending){console.error('[PekoPet] Starting reminder scheduler');const schedule=[...context.get('loader').entries()].find(entry=>entry.options.id==='schedule');await schedule.update({...schedule.options,disabled:false});console.error('[PekoPet] Reminder scheduler activated');await context.get('loader').await();if(schedule.fiber?.state!==2)throw new Error('提醒调度器未就绪');}
  if(desktop){if(!ipc)throw new Error('桌面运行时需要私有 IPC');attachDesktopHost(context,ipc);}
  console.error('[PekoPet] Runtime ready');ready();if(ipc)await ipc.send({type:'ready'});}catch(error){clearTimeout(pending);await context?.fiber.dispose();migration.rollback();throw error;}
  if(ipc)process.once('disconnect',()=>void exit(0));else process.stdin.once('end',()=>void exit(0));
  process.once('SIGTERM',()=>void exit(0));process.once('SIGINT',()=>void exit(0));
  if(!ipc&&process.stdin.readableEnded)await exit(0);
  return context;
}
