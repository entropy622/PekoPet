import {readFileSync} from 'node:fs';

const core='@deepseek-ai/dsh-client-modules';

/** Keep the module loader in the document, ahead of the application shell. */
export function inlineModuleBootstrap(rows,modules){
  const batch=modules.graph().batches.find(batch=>batch.phase==='bootstrap'&&batch.entries.includes(core));
  const index=rows.findIndex(row=>row.kind==='script-src'&&row.src===batch?.url);
  const file=modules.clientPath(core);
  if(index<0||!file||batch.entries.length!==1)throw new Error('PekoPet 模块引导未就绪');
  const text=readFileSync(file,'utf8').replace(/^\/\/# sourceMappingURL=.*$/gm,'').replace(/<\/script/gi,close=>close.replace('/','\\/'));
  rows.splice(index,1,{kind:'script',placement:'head',text});
}
