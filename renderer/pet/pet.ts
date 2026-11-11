import {CubismFramework,Option} from '../../vendor/cubism-web-framework/src/live2dcubismframework';
import {CubismUserModel} from '../../vendor/cubism-web-framework/src/model/cubismusermodel';
import {CubismModelSettingJson} from '../../vendor/cubism-web-framework/src/cubismmodelsettingjson';
import {CubismMatrix44} from '../../vendor/cubism-web-framework/src/math/cubismmatrix44';
import {CubismShaderManager_WebGL} from '../../vendor/cubism-web-framework/src/rendering/cubismshader_webgl';
import {CubismEyeBlink} from '../../vendor/cubism-web-framework/src/effect/cubismeyeblink';
import {CubismBreath,BreathParameterData} from '../../vendor/cubism-web-framework/src/effect/cubismbreath';
import type {Cue} from '../../desktop/cues';
declare const window:any;

class Avatar extends CubismUserModel {
  expressions=new Map<string,{parameters:any[];weight:number;target:number}>();
  motions=new Map<string,any>();overrides=new Map<string,{value:number;weight:number;target:number}>();
  layers=new Set<string>();mix:Record<string,number>={};params:Record<string,number>={};expires=0;
  scale=1;gaze={x:0,y:0};visible=true;activeUntil=0;last=performance.now();clock=0;
  settings:any;descriptor:any;gl:WebGLRenderingContext;canvas:HTMLCanvasElement;
  catalog:any;
  async initialize(descriptor:any,canvas:HTMLCanvasElement){
    this.descriptor=descriptor;this.canvas=canvas;
    const gl=canvas.getContext('webgl',{alpha:true,premultipliedAlpha:true,preserveDrawingBuffer:true,antialias:true});if(!gl)throw new Error('当前设备无法初始化 WebGL');this.gl=gl;
    const buffer=new TextEncoder().encode(JSON.stringify(descriptor.settings)).buffer;
    const settings=new CubismModelSettingJson(buffer,buffer.byteLength);this.settings=settings;
    const bytes=async(file:string)=>{const response=await fetch(descriptor.baseUrl+file.split('/').map(encodeURIComponent).join('/'));if(!response.ok)throw new Error('无法读取角色资源：'+file);return response.arrayBuffer();};
    const moc=await bytes(settings.getModelFileName());this.loadModel(moc,true);
    if(settings.getPhysicsFileName()){const data=await bytes(settings.getPhysicsFileName());this.loadPhysics(data,data.byteLength);}
    if(settings.getPoseFileName()){const data=await bytes(settings.getPoseFileName());this.loadPose(data,data.byteLength);}
    this._eyeBlink=CubismEyeBlink.create(settings);this._breath=CubismBreath.create();
    this._breath.setParameters([new BreathParameterData(CubismFramework.getIdManager().getId('ParamBreath'),.5,.5,3.2,1)]);
    const layout=new Map<string,number>();settings.getLayoutMap(layout);this._modelMatrix.setupFromLayout(layout);
    this._physics?.stabilization(this._model);this._model.saveParameters();
    const groups=new Set(this._model.getDrawableMasks().filter(mask=>mask.length).map(mask=>[...mask].sort((a,b)=>a-b).join(',')));
    const buffers=groups.size<=36?1:Math.ceil(groups.size/32);
    this.createRenderer(canvas.width,canvas.height,buffers);const renderer=this.getRenderer();renderer.startUp(gl);renderer.setIsPremultipliedAlpha(true);
    renderer.loadShaders('peko-app://pet/shaders/');
    await new Promise<void>((resolve,reject)=>{const shader=CubismShaderManager_WebGL.getInstance().getShader(gl);const check=()=>shader._isShaderLoaded?resolve():!shader._isShaderLoading?reject(new Error('Live2D 着色器加载失败')):requestAnimationFrame(check);check();});
    for(let i=0;i<settings.getTextureCount();i++){
      const image=new Image();image.src=descriptor.baseUrl+settings.getTextureFileName(i).split('/').map(encodeURIComponent).join('/');await image.decode();
      const texture=gl.createTexture();if(!texture)throw new Error('纹理分配失败');gl.bindTexture(gl.TEXTURE_2D,texture);gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL,1);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,image);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);renderer.bindTexture(i,texture);
    }
    for(const [name,file]of Object.entries(descriptor.expressions)){const data=JSON.parse(new TextDecoder().decode(await bytes(file as string)));this.expressions.set(name,{parameters:data.Parameters||[],weight:0,target:0});}
    const eyeIds=Array.from({length:settings.getEyeBlinkParameterCount()},(_,i)=>settings.getEyeBlinkParameterId(i)),lipIds=Array.from({length:settings.getLipSyncParameterCount()},(_,i)=>settings.getLipSyncParameterId(i));
    for(const [name,file]of Object.entries(descriptor.motions)){const data=await bytes(file as string),motion=this.loadMotion(data,data.byteLength,name);if(!motion)throw new Error('无法加载动作：'+name);motion.setEffectIds(eyeIds,lipIds);this.motions.set(name,motion);}
    const parameters=[];
    for(let i=0;i<this._model.getParameterCount();i++){const id=this._model.getParameterId(i).getString();if(!descriptor.avatar.excludedParameters?.includes(id)&&(descriptor.metadata.parameters.includes(id)||descriptor.avatar.parameters?.includes(id)))parameters.push({id,min:this._model.getParameterMinimumValue(i),max:this._model.getParameterMaximumValue(i),default:this._model.getParameterDefaultValue(i)});}
    const layers=Object.keys(descriptor.expressions).filter(name=>descriptor.avatar.layers.includes(name));
    this.catalog={name:descriptor.avatar.name,expressions:Object.keys(descriptor.expressions).filter(name=>!layers.includes(name)),layers,motions:Object.keys(descriptor.motions),parameters};
    this.resize();for(let i=0;i<60;i++)this.update(1/60);this.draw();
    return {parameters:this._model.getParameterCount(),drawables:this._model.getDrawableCount(),clippingGroups:groups.size,maskBuffers:buffers};
  }
  inspect(){const parameters:Record<string,number>={};for(let i=0;i<this._model.getParameterCount();i++)parameters[this._model.getParameterId(i).getString()]=this._model.getParameterValueByIndex(i);return {parameters,clock:this.clock,mix:this.mix,layers:[...this.layers],visible:this.visible,scale:this.scale,weights:Object.fromEntries([...this.expressions].map(([name,value])=>[name,value.weight])),motionFinished:this._motionManager.isFinished(),contextLost:this.gl.isContextLost()};}
  step(seconds:number){for(let i=0;i<Math.ceil(seconds*60);i++)this.update(1/60);this.draw();const pixels=new Uint8Array(this.canvas.width*this.canvas.height*4);this.gl.readPixels(0,0,this.canvas.width,this.canvas.height,this.gl.RGBA,this.gl.UNSIGNED_BYTE,pixels);let visible=0;for(let i=3;i<pixels.length;i+=4)if(pixels[i]>20)visible++;return {...this.inspect(),visiblePixels:visible};}
  resize(){this.canvas.width=Math.round(innerWidth*devicePixelRatio);this.canvas.height=Math.round(innerHeight*devicePixelRatio);this.setRenderTargetSize(this.canvas.width,this.canvas.height);}
  cue(cue:Cue){
    if(cue.clear){this.layers.clear();this.mix={};this.params={};this._motionManager.stopAllMotions();this.defaults();}
    if(Object.keys(cue.mix||{}).length)this.mix={...cue.mix};this.params={...cue.params};
    for(const [name,on]of Object.entries(cue.layers||{}))on?this.layers.add(name):this.layers.delete(name);
    this.expires=this.clock+(cue.hold??2500);this.activeUntil=performance.now()+2000;
    if(cue.motion){const motion=this.motions.get(cue.motion);if(motion)this._motionManager.startMotionPriority(motion,false,3);}
  }
  defaults(){for(let i=0;i<this._model.getParameterCount();i++)this._model.setParameterValueByIndex(i,this._model.getParameterDefaultValue(i));this._model.saveParameters();}
  cancel(){this.mix={};this.params={};this._motionManager.stopAllMotions();this.defaults();}
  restore(layers:Record<string,boolean>){this.cancel();this.layers=new Set(Object.keys(layers).filter(name=>layers[name]&&this.catalog.layers.includes(name)));}
  update(dt:number){
    this.clock+=dt*1000;if(this.clock>=this.expires){this.mix={};this.params={};}
    const model=this._model;model.loadParameters();this._motionManager.updateMotion(model,dt);model.saveParameters();this._eyeBlink?.updateParameters(model,dt);this._breath?.updateParameters(model,dt);
    const manager=CubismFramework.getIdManager(),tracking=this.descriptor.avatar.tracking||{};
    model.addParameterValueById(manager.getId(tracking.x||'ParamAngleX'),this.gaze.x*15);model.addParameterValueById(manager.getId(tracking.y||'ParamAngleY'),this.gaze.y*10);
    model.setParameterValueById(manager.getId('ParamEyeBallX'),this.gaze.x);model.setParameterValueById(manager.getId('ParamEyeBallY'),this.gaze.y);
    const ease=1-Math.exp(-dt/.12),blend=new Map<string,{add:number;multiply:number;overwrite:number;weight:number}>();
    for(const [name,expression]of this.expressions){expression.target=this.layers.has(name)?1:(this.mix[name]||0);expression.weight+=(expression.target-expression.weight)*ease;if(expression.weight<.0001)continue;
      for(const parameter of expression.parameters){const value=blend.get(parameter.Id)||{add:0,multiply:1,overwrite:0,weight:0};if(parameter.Blend==='Multiply')value.multiply*=1+(parameter.Value-1)*expression.weight;else if(parameter.Blend==='Overwrite'){value.overwrite+=parameter.Value*expression.weight;value.weight+=expression.weight;}else value.add+=parameter.Value*expression.weight;blend.set(parameter.Id,value);}
    }
    for(const [name,b]of blend){const id=manager.getId(name);let value=(model.getParameterValueById(id)+b.add)*b.multiply;if(b.weight){const weight=Math.min(b.weight,1);value=value*(1-weight)+(b.overwrite/b.weight)*weight;}model.setParameterValueById(id,value);}
    for(const [name,value]of Object.entries(this.params)){const parameter=this.overrides.get(name)||{value,weight:0,target:1};parameter.value=value;this.overrides.set(name,parameter);}
    for(const [name,p]of this.overrides){p.target=Object.hasOwn(this.params,name)?1:0;p.weight+=(p.target-p.weight)*ease;if(p.weight>.0001)model.setParameterValueById(manager.getId(name),p.value,p.weight);}
    this._physics?.evaluate(model,dt);this._pose?.updateParameters(model,dt);model.update();
  }
  draw(head=false){
    const gl=this.gl,canvas=this.canvas;gl.viewport(0,0,canvas.width,canvas.height);gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);const matrix=new CubismMatrix44();
    matrix.scale(head?(this.descriptor.avatar.portrait?.scale||3.6):canvas.height/canvas.width*this.scale*.925,head?(this.descriptor.avatar.portrait?.scale||3.6):this.scale*.925);matrix.multiplyByMatrix(this._modelMatrix);if(head)matrix.translateY(this.descriptor.avatar.portrait?.y??-1.95);
    const renderer=this.getRenderer();renderer.setRenderState(null,[0,0,canvas.width,canvas.height]);renderer.setMvpMatrix(matrix);renderer.drawModel();
  }
  portrait(){const width=this.canvas.width,height=this.canvas.height;this.canvas.width=512;this.canvas.height=512;this.setRenderTargetSize(512,512);this.draw(true);const image=this.canvas.toDataURL('image/png');this.canvas.width=width;this.canvas.height=height;this.setRenderTargetSize(width,height);this.draw();return image;}
}

async function start(){
  const option=new Option();option.logFunction=message=>console.info('[Cubism]',message);CubismFramework.startUp(option);CubismFramework.initialize();
  const descriptor=await window.peko.invoke('avatar_descriptor');const avatar=new Avatar(),canvas=document.querySelector<HTMLCanvasElement>('#pet')!;
  const stats=await avatar.initialize(descriptor,canvas);
  const failure=(error:unknown)=>{avatar.cancel();void window.peko.invoke('avatar_error',{message:'角色渲染失败：'+String(error instanceof Error?error.message:error)});};
  await window.peko.listen('avatar-cue',({payload})=>{try{avatar.cue(payload.cue);avatar.update(1/60);avatar.draw();void window.peko.invoke('avatar_applied',{sentAt:payload.sentAt,source:payload.source,cue:payload.cue});}catch(error){failure(error);}});
  canvas.addEventListener('webglcontextlost',event=>{event.preventDefault();void window.peko.invoke('avatar_error',{message:'显卡上下文已丢失，正在恢复角色',recovering:true});});
  canvas.addEventListener('webglcontextrestored',()=>location.reload());
  await window.peko.listen('avatar-state',({payload})=>payload.cancel?avatar.cancel():avatar.restore(payload.layers||{}));
  await window.peko.listen('avatar-settings',({payload})=>{avatar.scale=payload.scale||1;avatar.activeUntil=performance.now()+2000;});
  await window.peko.listen('avatar-gaze',({payload})=>{if(Math.abs(payload.x-avatar.gaze.x)+Math.abs(payload.y-avatar.gaze.y)>.02)avatar.activeUntil=performance.now()+250;avatar.gaze=payload;avatar.visible=payload.visible;});
  await window.peko.invoke('avatar_ready',{id:descriptor.id,catalog:avatar.catalog});
  await window.peko.invoke('avatar_portrait',{id:descriptor.id,png:avatar.portrait()});
  let pointer:any,moved=false;
  canvas.addEventListener('pointerdown',event=>{if(event.button!==0)return;pointer={x:event.screenX,y:event.screenY};moved=false;canvas.setPointerCapture(event.pointerId);});
  canvas.addEventListener('pointermove',event=>{if(!pointer)return;const x=event.screenX-pointer.x,y=event.screenY-pointer.y;if(Math.abs(x)+Math.abs(y)>3){moved=true;pointer={x:event.screenX,y:event.screenY};void window.peko.invoke('pet_move',{x,y});}});
  canvas.addEventListener('pointerup',()=>{if(pointer&&!moved)void window.peko.invoke('pet_click');pointer=null;});
  canvas.addEventListener('wheel',event=>{event.preventDefault();void window.peko.invoke('pet_scale',{delta:event.deltaY});},{passive:false});
  window.addEventListener('resize',()=>avatar.resize());
  const frame=(now:number)=>{requestAnimationFrame(frame);if(avatar.gl.isContextLost())return;try{const interval=now<avatar.activeUntil?1000/60:1000/30;if((avatar.visible||descriptor.test)&&now-avatar.last>=interval){avatar.update(Math.min(.1,(now-avatar.last)/1000));avatar.last=now;avatar.draw();}else if(!avatar.visible)avatar.last=now;}catch(error){failure(error);}};requestAnimationFrame(frame);
  window.addEventListener('beforeunload',()=>{avatar.release();CubismFramework.dispose();CubismFramework.cleanUp();});
  const contextControl=descriptor.test?avatar.gl.getExtension('WEBGL_lose_context'):null;
  if(descriptor.test)window.__pekoAvatarTest={stats,catalog:avatar.catalog,inspect:()=>avatar.inspect(),image:()=>canvas.toDataURL('image/png'),step:(seconds:number)=>avatar.step(seconds),act:(cue:Cue)=>avatar.cue(cue),loseContext:()=>{contextControl?.loseContext();return !!contextControl;},restoreContext:()=>contextControl?.restoreContext(),debug:()=>({matrix:[...avatar.getModelMatrix().getArray()],glError:avatar.gl.getError(),opacity:avatar.getOpacity()}),capture:(cue:Cue={},steps=90)=>{avatar.cue({...cue,hold:60000});for(let i=0;i<steps;i++)avatar.update(1/60);avatar.draw();return canvas.toDataURL('image/png');},portrait:()=>avatar.portrait(),release:()=>{avatar.cancel();avatar.restore({});for(let i=0;i<90;i++)avatar.update(1/60);avatar.draw();return canvas.toDataURL('image/png');}};
}
void start().catch(error=>{console.error(error);const box=document.querySelector<HTMLElement>('#error')!;box.style.display='block';box.textContent=String(error);void window.peko.invoke('avatar_error',{message:String(error)});});
