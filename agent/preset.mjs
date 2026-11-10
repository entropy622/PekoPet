import AgentPreset from '@deepseek-ai/dsh-agent-preset';
/** Preset declarations retain this application's package root for later scoped mounts. */
export default class Preset extends AgentPreset{
  constructor(ctx,config){ctx.baseUrl=new URL('../',import.meta.url).href;super(ctx,config);}
}
