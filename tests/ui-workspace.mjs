import {join} from 'node:path';
export const name='peko-ui-workspace';
export const inject=['workspaceRegistry'];
export async function apply(ctx){await ctx.workspaceRegistry.create(join(process.env.DSH_HOME,'project'),'PekoPet 离屏测试');}
