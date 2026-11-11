import {app,BrowserWindow,Tray,Menu,globalShortcut,ipcMain,protocol,screen,shell,Notification,nativeImage,dialog} from 'electron';
import {readFileSync,writeFileSync,existsSync,mkdirSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {homedir} from 'node:os';
import {Runtime} from '../desktop/runtime.ts';
import {modelDescriptor,modelFile,confinedFile} from '../desktop/model-library.ts';
import {StreamCues,validateCue,type Catalog,type Cue} from '../desktop/cues.ts';
import {readModelLocations,setModelLocation} from '../plugin/model-locations.ts';
import {constrainPet,petSize,zoomPet,restorePet,recoverPet,PetWheelZoom} from '../desktop/pet-geometry.ts';
import {renderIndex} from '../desktop/render-index.ts';
import {portraitIcon} from '../desktop/portrait-icon.ts';

const startedAt=Date.now();
const test=process.argv.includes('--peko-test');
const root=resolve(process.env.PEKO_ROOT||(app.isPackaged?join(process.resourcesPath,'runtime'):resolve(__dirname,'../..')));
const built=app.isPackaged?join(app.getAppPath(),'build'):join(root,'build');
const home=process.env.DSH_HOME||join(homedir(),'.dsh');
if(process.env.PEKO_USER_DATA)app.setPath('userData',process.env.PEKO_USER_DATA);
app.setName('PekoPet');
if(process.platform==='win32')app.setAppUserModelId('com.entropy622.pekopet');
protocol.registerSchemesAsPrivileged([{scheme:'peko-app',privileges:{standard:true,secure:true,supportFetchAPI:true,corsEnabled:true,stream:true}}]);
const state:any={status:'正在启动助手',connected:false,home,runtime:'PekoPet',settings:{},catalog:{name:'',expressions:[],layers:[],motions:[],parameters:[]},avatarState:{layers:{}},sessionId:'',busy:false,error:'',avatarError:'',latencies:[],modelPaths:{},modelFile:'',semanticApplied:0,lastAvatarEvent:null,iconAvatar:'',startup:{}};
let chat:BrowserWindow,pet:BrowserWindow,runtime:Runtime,tray:Tray|undefined,quitting=false,stopping:Promise<void>|undefined;
let activeAvatar='',petReady=false,generation=0,firstTokenAt=0,semantic=false;
let refreshPortrait=false;
let gazeTimer:ReturnType<typeof setInterval>|undefined;
const onDisplayChange=()=>{if(!quitting)applyWindowSettings();};
const streams=new StreamCues();
let petHit=false,petDragging=false,petIgnoring:boolean|undefined;
let pendingGeometry:Record<string,unknown>|undefined;
const wheelZoom=new PetWheelZoom();
function startupStage(name:string){if(state.startup[name]!==undefined)return;state.startup[name]=Date.now()-startedAt;console.info('[PekoPet startup]',name,state.startup[name]+' ms');}
const geometryKeys=['petX','petY','petWidth','petHeight','petScale','petMonitor','petDpi'] as const;
function geometryPatch(){return Object.fromEntries(geometryKeys.filter(key=>state.settings[key]!==undefined).map(key=>[key,state.settings[key]]));}
const send=(name:string,payload:unknown)=>{for(const window of [chat,pet])if(window&&!window.isDestroyed())window.webContents.send(name,payload);};
function publish(){send('peko-state',state);}
function fail(error:unknown){state.error=String(error instanceof Error?error.message:error);publish();}
function iconPath(){return join(home,'peko-pet/icons',(state.settings.avatar||activeAvatar||'deepseek')+'-head.png');}
function refreshIcon(regenerate=false){
  const file=iconPath();if(!existsSync(file))return;const icon=nativeImage.createFromPath(file);if(icon.isEmpty())return;
  const ico=file.replace(/\.png$/,'.ico');if(regenerate||!existsSync(ico))writeFileSync(ico,portraitIcon(icon.resize({width:256,height:256,quality:'best'}).toPNG()));
  chat.setIcon(icon);tray?.setImage(icon.resize({width:24,height:24}));
  if(process.platform==='win32')chat.setAppDetails({appId:'com.entropy622.pekopet',appIconPath:ico,appIconIndex:0,relaunchCommand:'"'+app.getPath('exe')+'"'+(app.isPackaged?'':' "'+root+'"'),relaunchDisplayName:'PekoPet'});
  state.iconAvatar=state.settings.avatar||activeAvatar||'deepseek';startupStage('iconMs');send('peko-portrait',{});
}
function notify(body:string){if(!test&&!state.settings.dnd&&Notification.isSupported()){const notification=new Notification({title:'PekoPet',body,icon:existsSync(iconPath())?iconPath():undefined});notification.on('click',()=>showChat());notification.show();}}
function showChat(){if(quitting||!chat||chat.isDestroyed())return;if(!test){chat.show();chat.focus();}}
function applyCue(value:Cue,source='debug'){
  const cue=validateCue(value,state.catalog as Catalog);if(petReady)state.avatarError='';if(source==='assistant')semantic=true;
  if(cue.clear)state.avatarState.layers={};for(const [name,on]of Object.entries(cue.layers||{}))state.avatarState.layers[name]=on;
  if(state.sessionId&&(cue.clear||cue.layers))void runtime.call('peko.avatar',{sessionId:state.sessionId,catalog:state.catalog,state:state.avatarState}).catch(fail);
  if(petReady)pet.webContents.send('avatar-cue',{cue,sentAt:Date.now(),source});publish();
}
function local(status:string){const parameter=state.catalog.parameters.find((p:any)=>['ParamAngleZ','AngleZ'].includes(p.id));if(parameter&&petReady)pet.webContents.send('avatar-cue',{cue:{params:{[parameter.id]:parameter.default+({thinking:6,working:3,waiting:-6}[status]||0)},hold:10000},sentAt:Date.now(),source:'status'});}
function onRuntimeEvent(method:string,p:any){
  if(quitting)return;
  if(method==='peko.stream'&&p.sessionId===state.sessionId){
    if(p.frame.type==='chunk'&&!state.firstTokenMs)state.firstTokenMs=Date.now()-firstTokenAt;
    let cues:Cue[]=[];try{cues=streams.accept(p.frame);}catch(error){streams.reset();send('avatar-state',{cancel:true});fail(error);}
    for(const cue of cues){try{applyCue(cue,'assistant');}catch(error){state.avatarError=String((error as Error).message||error);}}
    if(p.frame.type==='end'&&(p.frame.outcome?.kind==='abandoned'||p.frame.outcome?.eventType==='assistant/attempt'))send('avatar-state',{cancel:true});
  }
  if(method==='session.status'&&p.sessionId===state.sessionId){const before=state.busy;state.busy=p.status==='running';if(state.busy&&!before){state.error='';state.status='正在思考';firstTokenAt=Date.now();state.firstTokenMs=0;semantic=false;local('thinking');}else if(!state.busy){streams.reset();state.status='在你身边';if(before){if(!semantic)local('done');notify('这件事处理好了，点我查看。');}}}
  if(method==='peko.waiting'&&p.sessionId===state.sessionId){state.status='等你决定';local('waiting');notify('需要你做个决定，点我查看。');}
  if(method==='peko.memory.changed')send('peko-memory',p);
  if(method==='peko.reminder'){send('peko-reminder',p);notify(p.text||'提醒到了，点我查看。');}
  if(method==='peko.error')state.error=p.message;
  publish();
}
async function startRuntime(){
  if(quitting)return;
  state.connected=false;state.status='正在启动助手';publish();
  const current=++generation;
  runtime=new Runtime(root,async(method)=>{
    if(method!=='directory.pick')throw new Error('未知主进程交互');
    if(test)return process.env.PEKO_TEST_PROJECT||null;
    const result=await dialog.showOpenDialog(chat,{properties:['openDirectory'],title:'选择项目目录'});return result.canceled?null:result.filePaths[0];
  });
  runtime.on('event',(method,p)=>{if(current===generation)onRuntimeEvent(method,p);});
  runtime.on('bootstrap',settings=>{
    if(quitting||current!==generation)return;
    state.settings={...settings,...pendingGeometry};state.modelPaths=readModelLocations(home);startupStage('preferencesMs');refreshIcon();applyWindowSettings();
    void loadPet(state.settings.avatar||'deepseek').catch(error=>{state.avatarError=String(error.message||error);publish();});
  });
  runtime.on('stopped',(error)=>{if(current===generation&&!quitting&&!runtime.closing){state.connected=false;state.busy=false;state.status='助手已停止';send('avatar-state',{cancel:true});fail(error);}});
  await runtime.ready;if(quitting)return;state.settings={...await runtime.call('peko.settings'),...pendingGeometry};if(quitting)return;state.connected=true;startupStage('agentMs');state.error='';state.status='在你身边';publish();
  if(pendingGeometry){const patch=pendingGeometry;pendingGeometry=undefined;void runtime.call('peko.settings',{patch}).catch(fail);}
  if(petReady)await runtime.call('peko.avatar',{sessionId:state.sessionId||'peko-catalog',catalog:state.catalog,state:state.avatarState});if(quitting)return;applyWindowSettings();await chat.loadURL('peko-app://app/');if(quitting)return;startupStage('chatMs');publish();
}
async function loadPet(id:string,force=false){
  if(activeAvatar===id&&petReady&&!force)return;
  state.modelFile=modelFile(root,home,id);if(activeAvatar&&activeAvatar!==id){state.avatarState={layers:{}};if(state.sessionId)await runtime.call('peko.avatar',{sessionId:state.sessionId,catalog:state.catalog,state:state.avatarState});}activeAvatar=id;petReady=false;
  refreshPortrait=force;
  await pet.loadURL('peko-app://pet/?avatar='+encodeURIComponent(id));refreshIcon();
}
function updatePetHit(){
  const ignoring=!!state.settings.clickThrough||(!petDragging&&!petHit);
  if(ignoring!==petIgnoring){pet.setIgnoreMouseEvents(ignoring,{forward:true});petIgnoring=ignoring;}
  state.petWindow={...pet.getBounds(),scale:state.settings.petScale||1,ignoringMouse:ignoring,dragging:petDragging};
}
function placePet(value:{x:number;y:number;width:number;height:number;scale:number},persist=true){
  const bounds={x:value.x,y:value.y,width:value.width,height:value.height},old=pet.getBounds();
  if(old.width===bounds.width&&old.height===bounds.height)pet.setPosition(bounds.x,bounds.y);else pet.setBounds(bounds);
  let actual=pet.getBounds();const display=screen.getDisplayMatching(actual),clamped=constrainPet(actual,display.bounds);
  if(actual.x!==clamped.x||actual.y!==clamped.y){pet.setPosition(clamped.x,clamped.y);actual=pet.getBounds();}
  const patch={petX:actual.x,petY:actual.y,petWidth:actual.width,petHeight:actual.height,petScale:value.scale,petMonitor:String(display.id),petDpi:Math.round(display.scaleFactor*96)};
  state.settings={...state.settings,...patch};updatePetHit();send('avatar-settings',{scale:value.scale});publish();
  if(persist){if(state.connected)void runtime.call('peko.settings',{patch}).catch(fail);else pendingGeometry=patch;}
}
function resizePet(scale:number,anchor={x:.5,y:1}){
  const bounds=pet.getBounds(),display=screen.getDisplayMatching(bounds);placePet(zoomPet(bounds,scale,display.bounds,anchor));
}
function petAction(action:string){
  if(action==='zoom-in')resizePet((state.settings.petScale||1)*1.2);
  else if(action==='zoom-out')resizePet((state.settings.petScale||1)/1.2);
  else if(action==='reset-size')resizePet(1);
  else if(action==='recover'){const bounds=pet.getBounds(),display=screen.getDisplayMatching(bounds);placePet(recoverPet(bounds,state.settings.petScale||1,display.workArea));}
  else throw new Error('未知桌宠操作');
}
function petMenu(){return Menu.buildFromTemplate([{label:'打开聊天',click:showChat},{type:'separator'},{label:'放大',click:()=>petAction('zoom-in')},{label:'缩小',click:()=>petAction('zoom-out')},{label:'恢复默认大小',click:()=>petAction('reset-size')},{label:'移回屏幕内',click:()=>petAction('recover')}]);}
function refreshTray(){if(tray)tray.setContextMenu(Menu.buildFromTemplate([{label:'打开聊天',click:showChat},{label:'显示／隐藏桌宠',click:()=>pet.isVisible()?pet.hide():pet.showInactive()},{label:'移回屏幕内',click:()=>petAction('recover')},{label:'鼠标穿透',type:'checkbox',checked:!!state.settings.clickThrough,click:item=>{void runtime.call('peko.settings',{patch:{clickThrough:item.checked}}).then(value=>{state.settings={...value,...geometryPatch()};applyWindowSettings();publish();}).catch(fail);}},{label:'置顶',type:'checkbox',checked:!!state.settings.topmost,click:item=>{void runtime.call('peko.settings',{patch:{topmost:item.checked}}).then(value=>{state.settings={...value,...geometryPatch()};applyWindowSettings();publish();}).catch(fail);}},{type:'separator'},{label:'退出 PekoPet',click:()=>void quit()}]));}
function applyWindowSettings(){
  if(quitting)return;
  refreshTray();if(!pet||pet.isDestroyed())return;pet.setAlwaysOnTop(!!state.settings.topmost,'floating');
  const requested={...pet.getBounds(),x:Math.round(state.settings.petX??pet.getBounds().x),y:Math.round(state.settings.petY??pet.getBounds().y),width:state.settings.petWidth||pet.getBounds().width,height:state.settings.petHeight||pet.getBounds().height},display=screen.getDisplayMatching(requested);
  placePet(restorePet(state.settings,display.bounds),false);if(!test)pet.showInactive();
}
function allowSender(event:Electron.IpcMainInvokeEvent,host:'app'|'pet'){
  const window=host==='app'?chat:pet;if(!window||window.isDestroyed()||event.sender.isDestroyed()||event.sender!==window.webContents||event.senderFrame!==event.sender.mainFrame)throw new Error('拒绝非主框架 IPC');
  const url=new URL(event.senderFrame!.url);if(url.protocol!=='peko-app:'||url.hostname!==host)throw new Error('拒绝外部页面 IPC');
}
const hostMethods=new Set(['host.fetch','host.abort','host.stream.open','host.stream.next','host.stream.push','host.stream.end','host.stream.cancel']);
ipcMain.handle('peko:host',(event,method:string,p:any)=>{if(quitting)return;allowSender(event,'app');if(!hostMethods.has(method))throw new Error('未知桌面通道');return runtime.call(method,p).catch(error=>{if(!quitting)throw error;});});
ipcMain.handle('peko:invoke',async(event,command:string,args:any={})=>{
  if(quitting)return;
  const isPet=event.sender===pet?.webContents;allowSender(event,isPet?'pet':'app');
  if(command==='avatar_descriptor'&&isPet)return {...modelDescriptor(root,home,activeAvatar),portraitCached:!refreshPortrait&&state.iconAvatar===activeAvatar,test};
  if(command==='avatar_ready'&&isPet){if(args.id!==activeAvatar)return;state.catalog=args.catalog;state.avatarError='';petReady=true;startupStage('petMs');if(state.connected)void runtime.call('peko.avatar',{sessionId:state.sessionId||'peko-catalog',catalog:state.catalog,state:state.avatarState}).catch(fail);send('avatar-settings',{scale:state.settings.petScale||1});send('avatar-state',{layers:state.avatarState.layers});publish();return;}
  if(command==='avatar_portrait'&&isPet){if(args.id!==activeAvatar)return;const data=Buffer.from(args.png.split(',')[1],'base64');if(data.length>4*1024*1024)throw new Error('头像过大');mkdirSync(dirname(iconPath()),{recursive:true});writeFileSync(iconPath(),data);writeFileSync(iconPath().replace(/\.png$/,'.json'),JSON.stringify({avatar:activeAvatar,author:JSON.parse(readFileSync(join(root,'assets/avatars.json'),'utf8')).avatars[activeAvatar].author,source:'Local Cubism Web portrait'}));refreshIcon(true);publish();return;}
  if(command==='avatar_applied'&&isPet){state.lastAvatarEvent={source:args.source,cue:args.cue};if(args.source==='assistant')state.semanticApplied++;state.latencies.push(Math.max(0,Date.now()-args.sentAt));state.latencies=state.latencies.slice(-200);publish();return;}
  if(command==='avatar_error'&&isPet){if(args.recovering)petReady=false;state.avatarError=args.message;publish();return;}
  if(command==='pet_click'&&isPet){showChat();return;}
  if(command==='pet_hit'&&isPet){petHit=!!args.hit;updatePetHit();return;}
  if(command==='pet_drag'&&isPet){petDragging=!!args.active;updatePetHit();return;}
  if(command==='pet_context_menu'&&isPet){if(!test)petMenu().popup({window:pet});return ['放大','缩小','恢复默认大小','移回屏幕内'];}
  if(command==='pet_action'&&isPet){petAction(args.action);return;}
  if(command==='pet_move'&&isPet){
    if(!Number.isFinite(args.x)||!Number.isFinite(args.y))throw new Error('移动距离须为有效数值');
    const old=pet.getBounds(),requested={...old,x:old.x+args.x,y:old.y+args.y},display=screen.getDisplayMatching(requested),size=petSize(state.settings.petScale||1,display.bounds);
    const dimensions=size.scale===(state.settings.petScale||1)?{width:old.width,height:old.height}:size;
    placePet({...constrainPet({...requested,...dimensions},display.bounds),scale:size.scale});return;
  }
  if(command==='pet_scale'&&isPet){
    if(!Number.isFinite(args.delta))throw new Error('缩放距离须为有效数值');
    if(Number.isFinite(args.screenX)&&Number.isFinite(args.screenY)){
      const bounds=pet.getBounds(),display=screen.getDisplayMatching(bounds);
      placePet(wheelZoom.next(bounds,state.settings.petScale||1,args.delta,display.bounds,{x:args.screenX,y:args.screenY},performance.now()));return;
    }
    const anchor={x:Number.isFinite(args.anchorX)?args.anchorX:.5,y:Number.isFinite(args.anchorY)?args.anchorY:1};resizePet((state.settings.petScale||1)*Math.exp(-args.delta*.001),anchor);return;
  }
  if(isPet)throw new Error('桌宠无权访问此操作');
  if(command==='avatar_pick'){
    const avatars=JSON.parse(readFileSync(join(root,'assets/avatars.json'),'utf8')).avatars;if(!avatars[args.id])throw new Error('未知角色');
    if(test)return process.env.PEKO_TEST_MODEL||null;
    const result=await dialog.showOpenDialog(chat,{title:'选择 '+avatars[args.id].name+' 的 model3.json',properties:['openFile'],filters:[{name:'Live2D 模型',extensions:['json']}]});return result.canceled?null:result.filePaths[0];
  }
  if(command==='avatar_location'){
    state.modelPaths=setModelLocation(home,args.id,args.path,JSON.parse(readFileSync(join(root,'assets/avatars.json'),'utf8')).avatars);
    try{if(args.id===state.settings.avatar)await loadPet(args.id,true);}catch(error){state.avatarError=String((error as Error).message||error);publish();throw error;}
    publish();return state.modelPaths;
  }
  if(command==='peko_state')return state;
  if(command==='peko_cue'){applyCue(args.cue);return;}
  if(command==='peko_activate'){state.sessionId=args.sessionId;streams.reset();const result=await runtime.call('peko.open',{sessionId:args.sessionId});const saved=(await runtime.call('peko.history',{sessionId:args.sessionId})).avatarState;state.avatarState={...saved,layers:saved.layers||{}};await runtime.call('peko.avatar',{sessionId:args.sessionId,catalog:state.catalog,state:state.avatarState});send('avatar-state',{layers:state.avatarState.layers});publish();return result;}
  if(command==='peko_reload_config'){if(state.busy)throw new Error('请先停止任务再重新加载配置');setImmediate(()=>{void (async()=>{await runtime?.stop();await startRuntime();})().catch(fail);});return;}
  if(command==='peko_request'){
    if(typeof args.method!=='string'||!args.method.startsWith('peko.'))throw new Error('无效助手请求');
    const result=await runtime.call(args.method,args.params);
    if(args.method==='peko.settings'&&args.params?.patch){const avatar=state.settings.avatar;state.settings=geometryKeys.some(key=>Object.hasOwn(args.params.patch,key))?result:{...result,...geometryPatch()};applyWindowSettings();if(avatar!==result.avatar)await loadPet(result.avatar);publish();}return result;
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
  if(stopping)return stopping;quitting=true;petReady=false;clearInterval(gazeTimer);gazeTimer=undefined;screen.off('display-removed',onDisplayChange);screen.off('display-metrics-changed',onDisplayChange);globalShortcut.unregisterAll();
  stopping=(async()=>{for(const window of BrowserWindow.getAllWindows())await window.webContents.executeJavaScript('window.__pekoClosing = true').catch(()=>{});for(const window of BrowserWindow.getAllWindows())window.destroy();await runtime?.stop();tray?.destroy();app.exit(0);})();return stopping;
}
if(!app.requestSingleInstanceLock())app.quit();else{
  app.on('second-instance',showChat);app.on('before-quit',event=>{if(!quitting){event.preventDefault();void quit();}});app.on('window-all-closed',()=>{});
  void app.whenReady().then(async()=>{
    protocol.handle('peko-app',resource);
    const preload=join(built,'electron/preload.cjs'),icon=join(root,'assets/icon.ico');
    const options={preload,contextIsolation:true,nodeIntegration:false,sandbox:true,backgroundThrottling:false,offscreen:test};
    chat=new BrowserWindow({width:720,height:760,minWidth:600,minHeight:620,show:!test,frame:false,backgroundColor:'#f1f5f9',icon,webPreferences:options});
    pet=new BrowserWindow({width:400,height:600,show:false,frame:false,transparent:true,backgroundColor:'#00000000',thickFrame:false,hasShadow:false,resizable:false,skipTaskbar:true,focusable:false,webPreferences:options});
    for(const window of [chat,pet]){
      window.webContents.setWindowOpenHandler(({url})=>{if(/^https?:/.test(url)){if(test)send('peko-external-link',url);else void shell.openExternal(url);}return {action:'deny'};});
      window.webContents.on('will-navigate',(event,url)=>{const target=new URL(url);if(target.protocol!=='peko-app:'||!['app','pet'].includes(target.hostname))event.preventDefault();});
      window.webContents.session.setPermissionRequestHandler((_contents,_permission,callback)=>callback(false));
    }
    chat.on('close',event=>{if(!quitting){event.preventDefault();chat.hide();}});
    if(!test){tray=new Tray(icon);tray.setToolTip('PekoPet');tray.on('click',showChat);refreshTray();globalShortcut.register('CommandOrControl+Alt+P',showChat);globalShortcut.register('CommandOrControl+Alt+Shift+P',()=>{void runtime.call('peko.settings',{patch:{clickThrough:!state.settings.clickThrough}}).then(value=>{state.settings={...value,...geometryPatch()};applyWindowSettings();publish();}).catch(fail);});}
    screen.on('display-removed',onDisplayChange);screen.on('display-metrics-changed',onDisplayChange);
    gazeTimer=setInterval(()=>{if(!quitting&&petReady&&!pet.isDestroyed()&&!pet.webContents.isDestroyed()&&(!test||process.env.PEKO_TEST_GAZE)){const point=screen.getCursorScreenPoint(),bounds=pet.getBounds();pet.webContents.send('avatar-gaze',{x:Math.max(-1,Math.min(1,(point.x-bounds.x-bounds.width/2)/(bounds.width/2))),y:Math.max(-1,Math.min(1,-(point.y-bounds.y-bounds.height/2)/(bounds.height/2))),visible:pet.isVisible()||test,clientX:point.x-bounds.x,clientY:point.y-bounds.y,inside:point.x>=bounds.x&&point.x<bounds.x+bounds.width&&point.y>=bounds.y&&point.y<bounds.y+bounds.height});}},33);gazeTimer.unref();
    await pet.loadURL('about:blank');
    await chat.loadURL('peko-app://app/starting.html');
    startupStage('shellMs');
    await startRuntime();
  }).catch(async error=>{if(quitting)return;fail(error);console.error(error);if(chat&&!chat.isDestroyed()){await chat.loadURL('peko-app://app/starting.html');publish();}});
}
