import {isDeepStrictEqual} from 'node:util';
import yaml from 'js-yaml';
import {entryListSchema} from '@deepseek-ai/cordis-plugin-include';
import {Service,resolveConfig} from '@deepseek-ai/cordis';
import {readFileSync,existsSync,mkdirSync} from 'node:fs';
import {dirname} from 'node:path';
import {parseDocument,isSeq,isMap} from 'yaml';
import {withFileLock,writeFileAtomic} from '@deepseek-ai/dsh-atomic-write';
import {flatten} from './configuration.mjs';
export default class ConfigEditor extends Service{
  static inject=['loader','pekoConfiguration'];
  constructor(ctx){super(ctx,'configEditor');this.owner=ctx;this.queue=Promise.resolve();}
  get documentPath(){return this.owner.pekoConfiguration.own;}
  entries(){return [...this.owner.loader.entries()].filter(e=>e.parent.tree.ctx.fiber.entry?.id==='include');}
  configuration(){const base=new Map(flatten(this.owner.pekoConfiguration.base).map(e=>[e.id,e.config??{}]));return this.entries().map(entry=>({entry,inherited:structuredClone(base.get(entry.options.id)??{}),override:structuredClone(entry.options.config??{})}));}
  edit(entry,change){
    const run=async()=>{
      if(!this.entries().includes(entry)||!entry.fiber)throw new Error('配置项已关闭，请重新加载配置');
      const configuration=this.owner.pekoConfiguration;
      const shared=configuration.sources.has(entry.options.id)||['llm-pi-ai','agent-default-model'].includes(entry.options.id);
      const path=shared?(configuration.sources.get(entry.options.id)??configuration.defaultSharedFile):this.documentPath;
      mkdirSync(dirname(path),{recursive:true});
      await withFileLock(path,async()=>{
        const before=existsSync(path)?readFileSync(path,'utf8'):'[]\n';
        const document=parseDocument(before,{customTags:[{tag:'tag:yaml.org,2002:js',resolve:v=>v}]});
        if(document.errors.length)throw document.errors[0];if(!isSeq(document.contents))throw new Error('配置须为 YAML 条目列表');
        const current=structuredClone(entry.options.config??{});
        if(shared){
          let disk;
          const find=rows=>{for(const row of rows){if(row.id===entry.options.id&&Object.hasOwn(row,'config'))disk=row.config;if(row.insert)find(row.insert);}};
          find(yaml.load(before,{schema:entryListSchema})??[]);
          if(disk!==undefined&&!isDeepStrictEqual(disk,current))throw new Error('共享配置已被其他应用修改，请重新加载配置后重试');
        }
        const next=change(current,this.configuration().find(row=>row.entry===entry)?.inherited??{});
        const fiber=entry.fiber;resolveConfig(fiber.runtime,fiber.ctx.waterfall(fiber,'internal/config',next,()=>next));
        let found=false;
        function replace(sequence){for(const item of sequence.items){if(!isMap(item))continue;if(item.get('id')===entry.options.id&&!item.has('insert')){item.set('config',document.createNode(next));found=true;}const inserted=item.get('insert',true);if(isSeq(inserted))replace(inserted);}}
        replace(document.contents);if(!found)document.add({id:entry.options.id,...shared?{name:entry.options.name}:{},config:next});
        await writeFileAtomic(path,String(document),{mode:0o600});
        try{await entry.update({...entry.options,config:next});await this.owner.loader.await();if(entry.fiber?.state!==2)throw new Error('配置更新后组件未就绪');}
        catch(error){await writeFileAtomic(path,before,{mode:0o600});await entry.update({...entry.options,config:current});throw error;}
        this.owner.emit('app-boot/config-reload');
      });
    };
    const task=this.queue.then(run,run);this.queue=task.catch(()=>{});return task;
  }
}
