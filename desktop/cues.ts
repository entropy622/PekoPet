export interface Cue {mix?:Record<string,number>;params?:Record<string,number>;layers?:Record<string,boolean>;motion?:string;hold?:number;clear?:boolean}
export interface Catalog {name:string;expressions:string[];layers:string[];motions:string[];parameters:{id:string;min:number;max:number;default:number}[]}
const prefix='[[peko:';
export class CueParser {
  pending='';ticks=0;run=0;
  push(text:string,finish=false):Cue[]{
    this.pending+=text;const cues:Cue[]=[];
    while(this.pending){
      if(this.pending.startsWith('`')){this.pending=this.pending.slice(1);this.run++;continue;}
      if(this.run){if(!this.ticks)this.ticks=this.run;else if(this.ticks===this.run)this.ticks=0;this.run=0;}
      if(!this.ticks&&this.pending.startsWith(prefix)){
        let quoted=false,escaped=false,end=-1;
        for(let i=prefix.length;i<this.pending.length;i++){const ch=this.pending[i];if(escaped){escaped=false;continue;}if(quoted&&ch==='\\'){escaped=true;continue;}if(ch==='"')quoted=!quoted;if(!quoted&&this.pending.startsWith(']]',i)){end=i;break;}}
        if(end<0){if(finish)this.pending='';break;}
        const raw=this.pending.slice(prefix.length,end);this.pending=this.pending.slice(end+2);
        if(new TextEncoder().encode(raw).length<=8192){try{cues.push(JSON.parse(raw));}catch{}}
        continue;
      }
      if(!this.ticks&&!finish&&prefix.startsWith(this.pending))break;
      this.pending=this.pending.slice(String.fromCodePoint(this.pending.codePointAt(0)!).length);
    }
    return cues;
  }
}
export function validateCue(input:Cue,catalog:Catalog):Cue{
  if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!['mix','params','layers','motion','hold','clear'].includes(k)))throw new Error('角色标记字段无效');
  const cue:Cue={};
  for(const field of ['mix','params','layers'] as const){
    const values=input[field];if(values===undefined)continue;
    if(!values||typeof values!=='object'||Array.isArray(values))throw new Error('角色标记字段无效：'+field);
    const target:Record<string,any>={};
    for(const [name,value] of Object.entries(values)){
      if(field==='layers'){if(!catalog.layers.includes(name)||typeof value!=='boolean')throw new Error('未知持久层或无效开关：'+name);target[name]=value;}
      else if(field==='mix'){if(!catalog.expressions.includes(name)||typeof value!=='number'||!Number.isFinite(value))throw new Error('未知表情或无效权重：'+name);target[name]=Math.max(0,Math.min(1,value));}
      else {const parameter=catalog.parameters.find(p=>p.id===name);if(!parameter||typeof value!=='number'||!Number.isFinite(value))throw new Error('未知参数或无效值：'+name);target[name]=Math.max(parameter.min,Math.min(parameter.max,value));}
    }
    (cue as any)[field]=target;
  }
  if(input.motion!==undefined){if(!catalog.motions.includes(input.motion))throw new Error('未知动作：'+input.motion);cue.motion=input.motion;}
  if(input.hold!==undefined&&(!Number.isFinite(input.hold)||typeof input.hold!=='number'))throw new Error('表情时长无效');
  if(input.clear!==undefined&&typeof input.clear!=='boolean')throw new Error('清除开关无效');
  cue.hold=Math.max(100,Math.min(60000,input.hold??2500));cue.clear=input.clear;return cue;
}
export class StreamCues {
  attempt='';revision=-1;next=0;parsers=new Map<number,CueParser>();
  reset(){this.parsers.clear();this.attempt='';this.revision=-1;this.next=0;}
  accept(frame:any):Cue[]{
    // Revision increases on every frame; attemptId identifies a model attempt.
    if(frame.revision<=this.revision)return [];
    if(frame.type==='start'){this.parsers.clear();this.attempt=frame.attemptId;this.revision=frame.revision;this.next=0;return [];}
    if(frame.attemptId!==this.attempt)return [];
    this.revision=frame.revision;
    if(frame.type==='chunk'){
      if(frame.index<this.next)return [];if(frame.index!==this.next){this.parsers.clear();throw new Error('流式输出缺失，已停止角色控制');}this.next++;
      const chunk=frame.chunk;if(chunk.type!=='text-delta')return [];
      const parser=this.parsers.get(chunk.index)||new CueParser();this.parsers.set(chunk.index,parser);return parser.push(chunk.text);
    }
    if(frame.type==='end'){const out=frame.outcome?.eventType==='assistant/attempt'||frame.outcome?.kind==='abandoned'?[]:[...this.parsers.values()].flatMap(p=>p.push('',true));this.parsers.clear();this.attempt='';return out;}
    return [];
  }
}
