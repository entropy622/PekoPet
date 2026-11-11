import {homedir} from 'node:os';
import {join} from 'node:path';
import {readBootstrap} from '../agent/bootstrap.mjs';
import {encodePacket} from '../agent/wire.ts';
const extraPatches=process.env.PEKO_AGENT_PATCH?[process.env.PEKO_AGENT_PATCH]:[];
for(let i=2;i<process.argv.length;i++){if(process.argv[i]!=='--patch'||!process.argv[i+1])throw new Error('用法：start-agent.mjs [--patch 文件]');extraPatches.push(process.argv[++i]);}
try{
  if(process.send&&process.env.PEKO_DESKTOP==='1')process.send(encodePacket({type:'bootstrap',settings:readBootstrap(process.env.DSH_HOME||join(homedir(),'.dsh'))}));
  const {startAgent}=await import('../agent/boot.mjs');
  await startAgent({extraPatches});
}catch(error){console.error('[PekoPet runtime]',error);process.exit(1);}
