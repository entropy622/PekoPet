import DirectoryPicker from '@deepseek-ai/dsh-host-directory-picker';
export default class DesktopDirectoryPicker extends DirectoryPicker {
  constructor(ctx){super(ctx);this.native={kind:'native',pick:()=>ctx.get('pekoTransport').requestParent('directory.pick',{})};}
  capability(){return this.native;}
}
