const {contextBridge,ipcRenderer}=require('electron');
const channels=new Set(['peko-state','peko-memory','peko-portrait','peko-reminder','peko-external-link','avatar-cue','avatar-state','avatar-gaze','avatar-settings']);
contextBridge.exposeInMainWorld('peko',{
  invoke:(command,args={})=>ipcRenderer.invoke('peko:invoke',command,args),
  host:(method,params={})=>ipcRenderer.invoke('peko:host',method,params),
  listen:async(name,callback)=>{if(!channels.has(name))throw new Error('未知事件');const listener=(_event,payload)=>callback({payload});ipcRenderer.on(name,listener);return()=>ipcRenderer.removeListener(name,listener);},
});
