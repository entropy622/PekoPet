import '../scripts/stdio.mjs';
import {boot,loadLayeredEnv,installFailLoud} from '@deepseek-ai/dsh-app-boot';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {prepareRuntime,root} from './configuration.mjs';
import {migrateSessions} from './migrate-sessions.mjs';
export async function startAgent({embedded=process.env.PEKO_EMBEDDED_UI==='1',extraPatches=[]}={}){
  let context,closing;
  installFailLoud('PekoPet',process,async()=>{await context?.fiber.dispose();});
  const environment=loadLayeredEnv('PekoPet',root);
  const home=process.env.DSH_HOME||join(homedir(),'.dsh');
  const migration=await migrateSessions(home);
  const exit=code=>closing??=(async()=>{await context?.fiber.dispose();process.exit(code);})();
  let ready;const readyPromise=new Promise(resolve=>{ready=resolve;});
  try{const configuration=prepareRuntime(home,{embedded,extraPatches});
  if(migration.pending)configuration.rows.find(row=>row.id==='schedule').disabled=true;
  context=await boot('PekoPet',configuration.file,[{insert:configuration.rows}],ctx=>{
    context=ctx;ctx.provide('pekoReady',readyPromise);ctx.provide('pekoConfiguration',configuration);ctx.provide('launchEnvironment',environment);ctx.provide('appExit',exit);
  },pathToFileURL(root+'/').href);
  console.error('[PekoPet] Loop initialized');
  if(!context.get('pekoControl')||context.get('agentLoop')?.owner!=='PekoPet')throw new Error('PekoPet agent runtime did not initialize');
  await migration.copyAttachments?.(context);await migration.commit();
  console.error('[PekoPet] State migration committed');
  if(migration.pending){console.error('[PekoPet] Starting reminder scheduler');const schedule=[...context.get('loader').entries()].find(entry=>entry.options.id==='schedule');await schedule.update({...schedule.options,disabled:false});console.error('[PekoPet] Reminder scheduler activated');await context.get('loader').await();if(schedule.fiber?.state!==2)throw new Error('提醒调度器未就绪');}
  console.error('[PekoPet] Runtime ready');ready();}catch(error){await context?.fiber.dispose();migration.rollback();throw error;}
  process.stdin.once('end',()=>void exit(0));
  process.once('SIGTERM',()=>void exit(0));process.once('SIGINT',()=>void exit(0));
  if(process.stdin.readableEnded)await exit(0);
  return context;
}
