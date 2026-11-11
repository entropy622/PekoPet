import {app,BrowserWindow,Tray,Menu,globalShortcut,ipcMain,protocol,screen,shell,Notification,nativeImage,dialog} from 'electron';
import {readFileSync,writeFileSync,existsSync,mkdirSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {homedir} from 'node:os';
import {Runtime} from '../desktop/runtime.ts';
import {modelDescriptor,modelFile,confinedFile} from '../desktop/model-library.ts';
import {StreamCues,validateCue,type Catalog,type Cue} from '../desktop/cues.ts';
import {renderIndex} from '../desktop/render-index.ts';

const test=process.argv.includes('--peko-test');
const root=process.env.PEKO_ROOT||(app.isPackaged?join(process.resourcesPath,'runtime'):resolve(__dirname,'../..'));
const built=app.isPackaged?join(app.getAppPath(),'build'):join(root,'build');
const home=process.env.DSH_HOME||join(homedir(),'.dsh');
if(process.env.PEKO_USER_DATA)app.setPath('userData',process.env.PEKO_USER_DATA);
app.setName('PekoPet');
protocol.registerSchemesAsPrivileged([{scheme:'peko-app',privileges:{standard:true,secure:true,supportFetchAPI:true,corsEnabled:true,stream:true}}]);
const state:any={status:'正在启动助手',connected:false,home,runtime:'PekoPet',settings:{},catalog:{name:'',expressions:[],layers:[],motions:[],parameters:[]},avatarState:{layers:{}},sessionId:'',busy:false,error:'',avatarError:'',latencies:[]};
let chat:BrowserWindow,pet:BrowserWindow,runtime:Runtime,tray:Tray|undefined,quitting=false,stopping:Promise<void>|undefined;
let activeAvatar='',petReady=false,generation=0,firstTokenAt=0,semantic=false;
const streams=new StreamCues();
const send=(name:string,payload:unknown)=>{for(const window of [chat,pet])if(window&&!window.isDestroyed())window.webContents.send(name,payload);};
function publish(){send('peko-state',state);}
function fail(error:unknown){state.error=String(error instanceof Error?error.message:error);publish();}
function iconPath(){return join(home,'peko-pet/icons',activeAvatar+'-head.png');}
function refreshIcon(){const file=iconPath();if(!existsSync(file))return;const icon=nativeImage.createFromPath(file);chat.setIcon(icon);tray?.setImage(icon.resize({width:24,height:24}));send('peko-portrait',{});}
function notify(body:string){if(!test&&!state.settings.dnd&&Notification.isSupported()){const notification=new Notification({title:'PekoPet',body,icon:existsSync(iconPath())?iconPath():undefined});notification.on('click',()=>showChat());notification.show();}}
function showChat(){if(!chat||chat.isDestroyed())return;if(!test){chat.show();chat.focus();}}
function applyCue(value:Cue){
  const cue=validateCue(value,state.catalog as Catalog);semantic=true;
  if(cue.clear)state.avatarState.layers={};for(const [name,on]of Object.entries(cue.layers||{}))state.avatarState.layers[name]=on;
  if(state.sessionId&&(cue.clear||cue.layers))void runtime.call('peko.avatar',{sessionId:state.sessionId,catalog:state.catalog,state:state.avatarState}).catch(fail);
  if(petReady)pet.webContents.send('avatar-cue',{cue,sentAt:Date.now()});publish();
}
function local(status:string){const parameter=state.catalog.parameters.find((p:any)=>['ParamAngleZ','AngleZ'].includes(p.id));if(parameter&&petReady)pet.webContents.send('avatar-cue',{cue:{params:{[parameter.id]:parameter.default+({thinking:6,working:3,waiting:-6}[status]||0)},hold:10000},sentAt:Date.now()});}
function onRuntimeEvent(method:string,p:any){
  if(method==='peko.stream'&&p.sessionId===state.sessionId){try{if(p.frame.type==='chunk'&&!state.firstTokenMs)state.firstTokenMs=Date.now()-firstTokenAt;for(const cue of streams.accept(p.frame))applyCue(cue);if(p.frame.type==='end'&&(p.frame.outcome?.kind==='abandoned'||p.frame.outcome?.eventType==='assistant/attempt'))send('avatar-state',{cancel:true});}catch(error){streams.reset();send('avatar-state',{cancel:true});fail(error);}}
  if(method==='session.status'&&p.sessionId===state.sessionId){const before=state.busy;state.busy=p.status==='running';if(state.busy&&!before){state.error='';state.status='正在思考';firstTokenAt=Date.now();state.firstTokenMs=0;semantic=false;local('thinking');}else if(!state.busy){streams.reset();state.status='在你身边';if(before){if(!semantic)local('done');notify('这件事处理好了，点我查看。');}}}
  if(method==='peko.waiting'&&p.sessionId===state.sessionId){state.status='等你决定';local('waiting');notify('需要你做个决定，点我查看。');}
  if(method==='peko.memory.changed')send('peko-memory',p);
  if(method==='peko.reminder'){send('peko-reminder',p);notify(p.text||'提醒到了，点我查看。');}
  if(method==='peko.error')state.error=p.message;
  publish();
}
async function startRuntime(){
  state.connected=false;state.status='正在启动助手';publish();
  const current=++generation;
  runtime=new Runtime(root,async(method)=>{
    if(method!=='directory.pick')throw new Error('未知主进程交互');
    if(test)return process.env.PEKO_TEST_PROJECT||null;
    const result=await dialog.showOpenDialog(chat,{properties:['openDirectory'],title:'选择项目目录'});return result.canceled?null:result.filePaths[0];
  });
  runtime.on('event',(method,p)=>{if(current===generation)onRuntimeEvent(method,p);});
  runtime.on('stopped',(error)=>{if(current===generation&&!quitting&&!runtime.closing){state.connected=false;state.busy=false;state.status='助手已停止';send('avatar-state',{cancel:true});fail(error);}});
  await runtime.ready;state.settings=await runtime.call('peko.settings');state.connected=true;state.error='';state.status='在你身边';publish();
  if(petReady)await runtime.call('peko.avatar',{sessionId:state.sessionId||'peko-catalog',catalog:state.catalog,state:state.avatarState});applyWindowSettings();await chat.loadURL('peko-app://app/');void loadPet(state.settings.avatar||'yumi').catch(error=>{state.avatarError=String(error.message||error);publish();});
}
async function loadPet(id:string){
  if(activeAvatar===id&&petReady)return;
  modelFile(root,home,id);if(activeAvatar&&activeAvatar!==id){state.avatarState={layers:{}};if(state.sessionId)await runtime.call('peko.avatar',{sessionId:state.sessionId,catalog:state.catalog,state:state.avatarState});}activeAvatar=id;petReady=false;
  await pet.loadURL('peko-app://pet/?avatar='+encodeURIComponent(id));refreshIcon();
}
function visibleBounds(bounds:any){const display=screen.getDisplayMatching(bounds),area=display.workArea;return {...bounds,x:Math.max(area.x,Math.min(bounds.x,area.x+area.width-bounds.width)),y:Math.max(area.y,Math.min(bounds.y,area.y+area.height-bounds.height))};}
function refreshTray(){if(tray)tray.setContextMenu(Menu.buildFromTemplate([{label:'打开聊天',click:showChat},{label:'显示／隐藏桌宠',click:()=>pet.isVisible()?pet.hide():pet.showInactive()},{label:'鼠标穿透',type:'checkbox',checked:!!state.settings.clickThrough,click:item=>{void runtime.call('peko.settings',{patch:{clickThrough:item.checked}}).then(value=>{state.settings=value;applyWindowSettings();publish();}).catch(fail);}},{label:'置顶',type:'checkbox',checked:!!state.settings.topmost,click:item=>{void runtime.call('peko.settings',{patch:{topmost:item.checked}}).then(value=>{state.settings=value;applyWindowSettings();publish();}).catch(fail);}},{type:'separator'},{label:'退出 PekoPet',click:()=>void quit()}]));}
function applyWindowSettings(){refreshTray();if(!pet||pet.isDestroyed())return;pet.setAlwaysOnTop(!!state.settings.topmost,'floating');pet.setIgnoreMouseEvents(!!state.settings.clickThrough,{forward:true});const old=pet.getBounds();pet.setBounds(visibleBounds({...old,x:Math.round(state.settings.petX??old.x),y:Math.round(state.settings.petY??old.y),width:Math.round(state.settings.petWidth||400),height:Math.round(state.settings.petHeight||600)}));if(!test)pet.showInactive();send('avatar-settings',{scale:state.settings.petScale||1});}
function allowSender(event:Electron.IpcMainInvokeEvent,host:'app'|'pet'){
  const window=host==='app'?chat:pet;if(!window||window.isDestroyed()||event.sender.isDestroyed()||event.sender!==window.webContents||event.senderFrame!==event.sender.mainFrame)throw new Error('拒绝非主框架 IPC');
  const url=new URL(event.senderFrame!.url);if(url.protocol!=='peko-app:'||url.hostname!==host)throw new Error('拒绝外部页面 IPC');
}
const hostMethods=new Set(['host.fetch','host.abort','host.stream.open','host.stream.next','host.stream.push','host.stream.end','host.stream.cancel']);
ipcMain.handle('peko:host',(event,method:string,p:any)=>{if(quitting)return;allowSender(event,'app');if(!hostMethods.has(method))throw new Error('未知桌面通道');return runtime.call(method,p).catch(error=>{if(!quitting)throw error;});});
ipcMain.handle('peko:invoke',async(event,command:string,args:any={})=>{
  const isPet=event.sender===pet?.webContents;allowSender(event,isPet?'pet':'app');
  if(command==='avatar_descriptor'&&isPet)return {...modelDescriptor(root,home,activeAvatar),test};
  if(command==='avatar_ready'&&isPet){if(args.id!==activeAvatar)return;state.catalog=args.catalog;state.avatarError='';petReady=true;await runtime.call('peko.avatar',{sessionId:state.sessionId||'peko-catalog',catalog:state.catalog});send('avatar-settings',{scale:state.settings.petScale||1});send('avatar-state',{layers:state.avatarState.layers});publish();return;}
  if(command==='avatar_portrait'&&isPet){if(args.id!==activeAvatar)return;const data=Buffer.from(args.png.split(',')[1],'base64');if(data.length>4*1024*1024)throw new Error('头像过大');mkdirSync(dirname(iconPath()),{recursive:true});writeFileSync(iconPath(),data);writeFileSync(iconPath().replace(/\.png$/,'.json'),JSON.stringify({avatar:activeAvatar,author:modelDescriptor(root,home,activeAvatar).avatar.author,source:'Local Cubism Web portrait'}));refreshIcon();return;}
  if(command==='avatar_applied'&&isPet){state.latencies.push(Math.max(0,Date.now()-args.sentAt));state.latencies=state.latencies.slice(-200);publish();return;}
  if(command==='avatar_error'&&isPet){state.avatarError=args.message;publish();return;}
  if(command==='pet_click'&&isPet){showChat();return;}
  if(command==='pet_move'&&isPet){const position=pet.getPosition(),bounds=visibleBounds({...pet.getBounds(),x:position[0]+Math.round(args.x),y:position[1]+Math.round(args.y)});pet.setBounds(bounds);state.settings={...state.settings,petX:bounds.x,petY:bounds.y};await runtime.call('peko.settings',{patch:{petX:bounds.x,petY:bounds.y}});return;}
  if(command==='pet_scale'&&isPet){const scale=Math.max(.1,Math.min(4,(state.settings.petScale||1)*Math.exp(-args.delta*.001)));state.settings=await runtime.call('peko.settings',{patch:{petScale:scale}});send('avatar-settings',{scale});publish();return;}
  if(isPet)throw new Error('桌宠无权访问此操作');
  if(command==='peko_state')return state;
  if(command==='peko_cue'){applyCue(args.cue);return;}
  if(command==='peko_activate'){state.sessionId=args.sessionId;streams.reset();const result=await runtime.call('peko.open',{sessionId:args.sessionId});const saved=(await runtime.call('peko.history',{sessionId:args.sessionId})).avatarState;state.avatarState={...saved,layers:saved.layers||{}};await runtime.call('peko.avatar',{sessionId:args.sessionId,catalog:state.catalog,state:state.avatarState});send('avatar-state',{layers:state.avatarState.layers});publish();return result;}
  if(command==='peko_reload_config'){if(state.busy)throw new Error('请先停止任务再重新加载配置');setImmediate(()=>{void (async()=>{await runtime?.stop();await startRuntime();})().catch(fail);});return;}
  if(command==='peko_request'){
    if(typeof args.method!=='string'||!args.method.startsWith('peko.'))throw new Error('无效助手请求');
    const result=await runtime.call(args.method,args.params);
    if(args.method==='peko.settings'&&args.params?.patch){const avatar=state.settings.avatar;state.settings=result;applyWindowSettings();if(avatar!==result.avatar)await loadPet(result.avatar);publish();}return result;
  }
  if(command==='window_action'){if(args.action==='minimize')chat.minimize();else if(args.action==='maximize')chat.isMaximized()?chat.unmaximize():chat.maximize();else if(args.action==='close')chat.close();else if(args.action==='exit')void quit();return;}
  throw new Error('未知操作：'+command);
});
function staticResponse(file:string){const ext=file.split('.').pop();const types:any={html:'text/html',js:'text/javascript',css:'text/css',json:'application/json',png:'image/png',ico:'image/x-icon',svg:'image/svg+xml',webp:'image/webp',wasm:'application/wasm'};return new Response(readFileSync(file),{headers:{'Content-Type':types[ext!]||'application/octet-stream'}});}
async function resource(request:Request){
  try{const url=new URL(request.url),path=decodeURIComponent(url.pathname);
    if(url.hostname==='app'){
      if(path==='/starting.html')return staticResponse(join(built,'electron/loading.html'));
      if(path==='/'||path==='/index.html'){
        await runtime.ready;const {rows}=await runtime.call('host.boot');rows.push({kind:'script-src',placement:'head',src:'/desktop/transport.js'});
        const raw=readFileSync(join(root,'node_modules/@deepseek-ai/dsh-web-frontend/dist/index.html'),'utf8');
        return new Response(renderIndex(raw,rows),{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'}});
      }
      if(path.startsWith('/plugins/')){const r=await runtime.call('host.bundle',{path:url.pathname+url.search});return new Response(r.body,{status:r.status,headers:r.headers});}
      if(path.startsWith('/api/')){const r=await runtime.call('host.fetch',{id:'protocol-'+Date.now(),path:url.pathname+url.search,method:request.method,headers:[...request.headers],body:request.body?new Uint8Array(await request.arrayBuffer()):undefined});return new Response(r.body,{status:r.status,headers:r.headers});}
      if(path==='/peko/portrait.png')return staticResponse(existsSync(iconPath())?iconPath():join(root,'assets/icon.ico'));
      if(path==='/desktop/transport.js')return staticResponse(join(built,'renderer/transport.js'));
      return staticResponse(confinedFile(join(root,'node_modules/@deepseek-ai/dsh-web-frontend/dist'),path.slice(1)));
    }
    if(url.hostname==='pet'){
      if(path==='/'||path==='/index.html')return staticResponse(join(built,'pet/index.html'));
      if(path==='/pet.js')return staticResponse(join(built,'pet/pet.js'));
      if(path==='/core.js')return staticResponse(join(root,'vendor/cubism-web-core/live2dcubismcore.min.js'));
      if(path.startsWith('/shaders/'))return staticResponse(confinedFile(join(root,'vendor/cubism-web-framework/Shaders/WebGL'),path.slice('/shaders/'.length)));
      if(path.startsWith('/model/')){const match=/^\/model\/([^/]+)\/(.*)$/.exec(path);if(!match||match[1]!==activeAvatar)return new Response(null,{status:403});return staticResponse(confinedFile(dirname(modelFile(root,home,activeAvatar)),match[2]));}
    }
    return new Response(null,{status:404});
  }catch(error){console.error('[PekoPet resource]',error);return new Response('资源不可用',{status:404});}
}
async function quit(){
  if(stopping)return stopping;quitting=true;globalShortcut.unregisterAll();
  stopping=(async()=>{for(const window of BrowserWindow.getAllWindows())await window.webContents.executeJavaScript('window.__pekoClosing = true').catch(()=>{});for(const window of BrowserWindow.getAllWindows())window.destroy();await runtime?.stop();tray?.destroy();app.exit(0);})();return stopping;
}
if(!app.requestSingleInstanceLock())app.quit();else{
  app.on('second-instance',showChat);app.on('before-quit',event=>{if(!quitting){event.preventDefault();void quit();}});app.on('window-all-closed',()=>{});
  void app.whenReady().then(async()=>{
    protocol.handle('peko-app',resource);
    const preload=join(built,'electron/preload.cjs'),icon=join(root,'assets/icon.ico');
    const options={preload,contextIsolation:true,nodeIntegration:false,sandbox:true,backgroundThrottling:false,offscreen:test};
    chat=new BrowserWindow({width:720,height:760,minWidth:600,minHeight:620,show:!test,frame:false,backgroundColor:'#f1f5f9',icon,webPreferences:options});
    pet=new BrowserWindow({width:400,height:600,show:false,frame:false,transparent:true,hasShadow:false,resizable:false,skipTaskbar:true,focusable:false,webPreferences:options});
    for(const window of [chat,pet]){
      window.webContents.setWindowOpenHandler(({url})=>{if(/^https?:/.test(url)){if(test)send('peko-external-link',url);else void shell.openExternal(url);}return {action:'deny'};});
      window.webContents.on('will-navigate',(event,url)=>{const target=new URL(url);if(target.protocol!=='peko-app:'||!['app','pet'].includes(target.hostname))event.preventDefault();});
      window.webContents.session.setPermissionRequestHandler((_contents,_permission,callback)=>callback(false));
    }
    chat.on('close',event=>{if(!quitting){event.preventDefault();chat.hide();}});
    if(!test){tray=new Tray(icon);tray.setToolTip('PekoPet');tray.on('click',showChat);refreshTray();globalShortcut.register('CommandOrControl+Alt+P',showChat);globalShortcut.register('CommandOrControl+Alt+Shift+P',()=>{void runtime.call('peko.settings',{patch:{clickThrough:!state.settings.clickThrough}}).then(value=>{state.settings=value;applyWindowSettings();publish();}).catch(fail);});}
    screen.on('display-removed',()=>applyWindowSettings());screen.on('display-metrics-changed',()=>applyWindowSettings());
    setInterval(()=>{if(petReady&&(!test||process.env.PEKO_TEST_GAZE)){const point=screen.getCursorScreenPoint(),bounds=pet.getBounds();pet.webContents.send('avatar-gaze',{x:Math.max(-1,Math.min(1,(point.x-bounds.x-bounds.width/2)/(bounds.width/2))),y:Math.max(-1,Math.min(1,-(point.y-bounds.y-bounds.height/2)/(bounds.height/2))),visible:pet.isVisible()||test});}},33).unref();
    await pet.loadURL('about:blank');
    await chat.loadURL('peko-app://app/starting.html');
    await startRuntime();
  }).catch(async error=>{fail(error);console.error(error);if(chat&&!chat.isDestroyed()){await chat.loadURL('peko-app://app/starting.html');publish();}});
}
