import {existsSync} from 'node:fs';
import {join} from 'node:path';
import {setTimeout} from 'node:timers/promises';
export const name='peko-startup-gate';
export async function apply(){while(!existsSync(join(process.env.DSH_HOME,'startup-release')))await setTimeout(25);}
