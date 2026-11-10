import {startAgent} from '../agent/boot.mjs';
const extraPatches=process.env.PEKO_AGENT_PATCH?[process.env.PEKO_AGENT_PATCH]:[];
for(let i=2;i<process.argv.length;i++){if(process.argv[i]!=='--patch'||!process.argv[i+1])throw new Error('用法：start-agent.mjs [--patch 文件]');extraPatches.push(process.argv[++i]);}
try{await startAgent({extraPatches});}catch(error){console.error('[PekoPet runtime]',error);process.exit(1);}
