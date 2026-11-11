import {readFileSync,existsSync,mkdirSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import yaml from 'js-yaml';
import {entryListSchema} from '@deepseek-ai/cordis-plugin-include';
import {composeEntries} from '@deepseek-ai/dsh-app-boot';

export const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const read=path=>existsSync(path)?yaml.load(readFileSync(path,'utf8'),{schema:entryListSchema})??[]:[];
export const flatten=rows=>rows.flatMap(row=>[row,...row.group&&Array.isArray(row.config)?flatten(row.config):[]]);
const sharedModule=name=>typeof name==='string'&&(
  ['@deepseek-ai/dsh-mcp-client','@deepseek-ai/dsh-skill-filesystem','@deepseek-ai/dsh-agent-default-model'].includes(name)
  ||name.startsWith('@deepseek-ai/dsh-llm-')&&!['@deepseek-ai/dsh-llm-retry'].includes(name));
const disabled=new Set(['plugin-manager','tool-plugin-manager','hmr','desktop-product-telemetry','product-analytics','harness-dev-context','client-hmr','web-startup','web-runtime','open-in-app','ui-open-in-app','ui-brand-official','ui-message-feedback','ui-settings-account','command-feedback','telemetry','telemetry-otlp','session-log-deepseek','plugin-package-inventory-deepseek']);
const headless=new Set(['webserver','modules','connection','file-upload','api-remotes','cordis-host-runner','cordis-client-runner','directory-picker','account-controller','settings-controller','workspace-controller','session-controller','job-controller','terminal-controller','workspace-files','session-log-download','cordis-inspect-providers']);
export function sharedLayers(home,base){
  const known=new Map(flatten(base).map(row=>[row.id,row]));
  const files=[join(home,'profiles/desktop/cordis.patch.yml'),join(home,'cordis.patch.yml')];
  const layers=[],sources=new Map(),presetConfigs=new Map();
  for(const file of files){
    const rows=read(file);if(!Array.isArray(rows))throw new Error('共享配置须为 YAML 条目列表：'+file);
    const patches=[];
    function accept(rows,insert=false){for(const row of rows){
      if(row.insert){accept(row.insert,true);continue;}
      if(row.group&&Array.isArray(row.config)){accept(row.config,true);continue;}
      if(Array.isArray(row.config?.plugins)){
        const values=row.config.plugins.filter(plugin=>['@deepseek-ai/dsh-skill-filesystem','@deepseek-ai/dsh-mcp-client'].includes(plugin.name));
        if(values.length)presetConfigs.set(row.id,[...(presetConfigs.get(row.id)??[]),...structuredClone(values)]);
        continue;
      }
      const original=known.get(row.id),name=original?.name??row.name;
      if(!sharedModule(name)||row.name&&original&&row.name!==original.name)continue;
      if(!original&&!insert)continue;
      const value={id:row.id,...Object.hasOwn(row,'config')?{config:structuredClone(row.config)}:{},...Object.hasOwn(row,'disabled')?{disabled:row.disabled}:{}};
      if(!original){value.name=name;patches.push({insert:[value]});known.set(row.id,value);}else patches.push(value);
      sources.set(row.id,file);
    }}
    accept(rows);layers.push(patches);
  }
  return {layers,sources,presetConfigs,defaultSharedFile:files[0]};
}
export function prepareRuntime(home,{desktop=false,extraPatches=[]}={}){
  home=resolve(home);const data=join(home,'peko-pet');mkdirSync(data,{recursive:true});
  let base=read(join(root,'agent/composition.yml'));
  function rewrite(rows){return rows.filter(row=>!disabled.has(row.id)).map(row=>{
    row=structuredClone(row);
    if(row.id==='agent-loop')row.name=pathToFileURL(join(root,'vendor/peko-agent-loop/index.mjs')).href;
    if(row.name==='@deepseek-ai/dsh-agent-preset')row.name=pathToFileURL(join(root,'agent/preset.mjs')).href;
    if(row.id==='settings'){row.name=pathToFileURL(join(root,'agent/settings.mjs')).href;delete row.disabled;}
    if(row.id==='config-editor'){row.name=pathToFileURL(join(root,'agent/config-editor.mjs')).href;delete row.disabled;}
    if(row.id==='directory-picker'){row.name=pathToFileURL(join(root,'agent/directory-picker.mjs')).href;delete row.inject;}
    if(row.group&&Array.isArray(row.config))row.config=rewrite(row.config);
    if(row.id==='session-persistence-jsonl')row.config={...row.config,root:join(data,'sessions')};
    if(row.id==='attachment-local')row.config={...row.config,dshHome:data};
    if(row.id==='storage-json')row.config={...row.config,root:join(data,'storages')};
    if(row.id==='webserver')row.disabled=true;
    if(row.id==='connection'){delete row.inject;row.config={};}
    if(!desktop&&(headless.has(row.id)||row.id.startsWith('ui-')||row.name?.startsWith('@deepseek-ai/dsh-client-')))row.disabled=true;
    return row;
  });}
  base=rewrite(base);


  const shared=sharedLayers(home,base);
  const own=join(data,'config.patch.yml');
  const ownedPatches=read(own);
  const extras=extraPatches.map(file=>{const rows=read(resolve(file));if(!Array.isArray(rows))throw new Error('测试补丁必须为列表');return rows;});
  const rows=composeEntries([[{insert:base}],...shared.layers,[{insert:[{id:'peko-bridge',name:pathToFileURL(join(root,'plugin/index.mjs')).href},...desktop?[{id:'peko-frontend',name:pathToFileURL(join(root,'plugin/frontend/index.mjs')).href},{id:'peko-directory-ui',name:'@deepseek-ai/dsh-client-ui-directory-picker-native'}]:[]]}],ownedPatches,...extras]);
  const sharedSkill=shared.sources.has('skill-filesystem')?rows.find(row=>row.id==='skill-filesystem')?.config:undefined;
  for(const row of rows)if(Array.isArray(row.config?.plugins)){
    const plugins=row.config.plugins;
    if(sharedSkill)for(const plugin of plugins)if(plugin.name==='@deepseek-ai/dsh-skill-filesystem')plugin.config=structuredClone(sharedSkill);
    for(const value of shared.presetConfigs.get(row.id)??[]){
      const existing=plugins.find(plugin=>plugin.id===value.id);
      if(existing){if(existing.name===value.name){if(Object.hasOwn(value,'config'))existing.config=value.config;if(Object.hasOwn(value,'disabled'))existing.disabled=value.disabled;}}
      else plugins.push(value);
    }
  }
  const file=join(root,'agent/entry.yml');
  return {file,home,data,own,rows,base,sources:shared.sources,defaultSharedFile:shared.defaultSharedFile};
}
