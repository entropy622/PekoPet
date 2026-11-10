  /** Display projection only; raw sessions and native cue parsing retain the original text. */
export function visibleText(text,streaming=false){
    const prefix='[[peko:';let out='',i=0,code=0;
    while(i<text.length){
      if(text[i]==='`'){let end=i;while(text[end]==='`')end++;const count=end-i;if(!code)code=count;else if(code===count)code=0;out+=text.slice(i,end);i=end;continue;}
      if(!code&&text.startsWith(prefix,i)){
        let quoted=false,escaped=false,end=-1;
        for(let j=i+prefix.length;j<text.length;j++){
          const ch=text[j];if(escaped){escaped=false;continue;}if(quoted&&ch==='\\'){escaped=true;continue;}if(ch==='"')quoted=!quoted;
          if(!quoted&&text.startsWith(']]',j)){end=j+2;break;}
        }
        if(end<0)break;i=end;continue;
      }
      if(!code&&streaming&&prefix.startsWith(text.slice(i)))break;
      out+=text[i++];
    }return out;
  }
