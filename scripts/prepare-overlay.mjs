import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';
import { createRequire } from 'node:module';

export function prepareOverlay(root=resolve(dirname(fileURLToPath(import.meta.url)),'..')) {
  const require=createRequire(resolve(root,'package.json'));
  const bundle=require.resolve('@deepseek-ai/dsh-web-app/cordis.patch.yml');
  const text=readFileSync(bundle,'utf8');
  const rows=text.split(/(?=^    - id:)/m).slice(1);
  const disable=new Set(['desktop-product-telemetry','product-analytics','harness-dev-context','client-hmr','web-startup','webserver','web-runtime','modules','connection','file-upload','api-remotes','cordis-host-runner','cordis-client-runner','directory-picker','account-controller','settings-controller','workspace-controller','session-controller','job-controller','terminal-controller','workspace-files','open-in-app','ui-open-in-app']);
  for(const row of rows) {
    const id=row.match(/^    - id:\s*(\S+)/)?.[1];
    if(id?.startsWith('ui-')||/name:\s*['"]?@deepseek-ai\/dsh-client-/.test(row)) disable.add(id);
  }
  disable.add('session-log-download');
  disable.add('cordis-inspect-providers');
  const overlay=[...disable].filter(Boolean).map(id=>`- id: ${id}\n  disabled: true`).join('\n\n')+
    `\n\n- id: hmr\n  disabled: true\n\n- insert:\n    - id: peko-sdk-startup\n      name: '@deepseek-ai/dsh-sdk-app'\n      config:\n        profile: peko\n    - id: peko-bridge\n      name: '${pathToFileURL(resolve(root,'plugin/index.mjs')).href}'\n`;
  const out=resolve(root,'runtime/peko.overlay.yml'); mkdirSync(dirname(out),{recursive:true}); writeFileSync(out,overlay); return out;
}
if(process.argv[1]===fileURLToPath(import.meta.url)) console.log(prepareOverlay());
