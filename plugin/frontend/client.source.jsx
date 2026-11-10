import React from 'react';
import {createPortal} from 'react-dom';
import {createSnapshotStore} from '@deepseek-ai/dsh-client-store';
import avatarMetadata from '../../assets/avatars.json';
const h=React.createElement,{useState,useEffect,useRef,useSyncExternalStore,useCallback}=React;
  const invoke=(command,args={})=>window.__TAURI__.core.invoke(command,args);
  const request=(method,params={})=>invoke('peko_request',{method,params});
  const paths={minimize:'M5 12h14',maximize:'M5 5h14v14H5Z',close:'m6 6 12 12M6 18 18 6',chat:'M4 4h16v13H9l-5 4Z',memory:'M5 4h14v17H5ZM8 9h8m-8 4h8',heart:'M12 21 3 12C-2 4 7 0 12 7c5-7 14-3 9 5Z',connect:'M8 3v5m8-5v5M6 8h12v3a6 6 0 0 1-12 0ZM12 17v5',sliders:'M3 6h18M3 12h18M3 18h18M8 3v6m8 0v6M9 15v6',moon:'M20 14A9 9 0 0 1 10 4a9 9 0 1 0 10 10Z',history:'M3 12a9 9 0 1 0 3-6M3 3v6h6M12 7v5l3 2',plus:'M12 5v14M5 12h14',more:'M5 12h.01M12 12h.01M19 12h.01',back:'m14 6-6 6 6 6'};
  const Icon=({name})=>h('svg',{viewBox:'0 0 24 24',width:18,height:18,fill:'none',stroke:'currentColor',strokeWidth:1.6,strokeLinecap:'round',strokeLinejoin:'round','aria-hidden':true},h('path',{d:paths[name]}));
  const Button=({children,primary=false,...props})=>h('button',{type:'button',...props,className:'peko-button'+(primary?' peko-primary':'')+(props.className?' '+props.className:'')},children);
  const Card=({children,...props})=>h('section',{...props,className:'peko-card'+(props.className?' '+props.className:'')},children);
  const Field=({label,...props})=>h('label',{className:'peko-field'},h('span',null,label),h('input',props));
  function Portrait({size=36,rev=0}){const [fresh,setFresh]=useState(rev);useEffect(()=>{let live=true,off;window.__TAURI__.event.listen('peko-portrait',()=>setFresh(Date.now())).then(fn=>{if(live)off=fn;else fn();});return()=>{live=false;off?.();};},[]);return h('img',{className:'peko-portrait',src:'/peko/portrait.png?v='+fresh,alt:'角色头像',draggable:false,width:size,height:size});}
  function CompanionPanel({tab,state,run,onChat}){
    const [memories,setMemories]=useState([]),[draft,setDraft]=useState(''),[editing,setEditing]=useState(null),[persona,setPersona]=useState(state.settings?.persona||''),[mix,setMix]=useState({}),[params,setParams]=useState({}),[clearing,setClearing]=useState(false);
    const settings=state.settings||{},catalog=state.catalog||{};
    useEffect(()=>{
      if(tab!=='memory')return;
      let live=true,off;
      const refresh=async()=>{const value=await request('peko.memory');if(live)setMemories(value.memories);};
      run(refresh);
      window.__TAURI__.event.listen('peko-memory',()=>run(refresh)).then(fn=>{if(live)off=fn;else fn();});
      return()=>{live=false;off?.();};
    },[tab]);
    const update=patch=>run(()=>request('peko.settings',{patch}),'设置已保存');
    const cue=value=>run(()=>invoke('peko_cue',{cue:value}));
    const memory=async(action,extra={})=>{const result=await request('peko.memory',{action,...extra});setMemories(result.memories);};
    if(tab==='memory')return h('div',{className:'peko-panel-content'},
      h('header',null,h('h1',null,'我们记得的事'),h('p',null,'保留重要的小事，也随时拥有忘记的自由。')),
      h(Card,null,h('div',{className:'peko-row'},h('div',null,h('h2',null,'自动记忆'),h('p',null,settings.memoryEnabled?'记录你明确表达的稳定偏好与重要事项。':'已暂停记录新的长期记忆。')),h(Button,{'aria-pressed':!!settings.memoryEnabled,onClick:()=>update({memoryEnabled:!settings.memoryEnabled})},settings.memoryEnabled?'暂停记录':'恢复记录'))),
      h(Card,null,h('h2',null,editing?'编辑记忆':'添加记忆'),h('textarea',{'aria-label':'记忆内容',value:draft,onChange:e=>setDraft(e.target.value),rows:3}),h('div',{className:'peko-row'},h(Button,{primary:true,disabled:!draft.trim(),onClick:()=>run(async()=>{await memory(editing?'edit':'add',editing?{id:editing,text:draft}:{text:draft});setDraft('');setEditing(null);})},'保存记忆'),editing?h(Button,{onClick:()=>{setEditing(null);setDraft('');}},'取消编辑'):null)),
      memories.length?memories.map(item=>h(Card,{key:item.id},h('p',{className:'peko-memory-text'},item.text),h('p',{className:'peko-meta'},[item.sourceSession,item.created].filter(Boolean).join(' · ')),h('div',{className:'peko-actions'},h(Button,{onClick:()=>{setEditing(item.id);setDraft(item.text);}},'编辑'),h(Button,{onClick:()=>run(()=>memory('delete',{id:item.id}))},'删除')))):h(Card,null,h('p',null,'还没有共同记忆。')),
      clearing?h(Card,null,h('p',null,'清空全部长期记忆？已删除的内容不会从旧消息中自动重新生成。'),h('div',{className:'peko-actions'},h(Button,{className:'peko-danger',onClick:()=>run(async()=>{await memory('clear');setClearing(false);})},'确认清空'),h(Button,{onClick:()=>setClearing(false)},'取消'))):h(Button,{className:'peko-danger',onClick:()=>setClearing(true)},'清空全部记忆'));
    if(tab==='persona')return h('div',{className:'peko-panel-content'},
      h('header',null,h('h1',null,'舒服的相处方式'),h('p',null,'人格与 Live2D 外观分别设置。')),
      h(Card,null,h('h2',null,'Peko 的人格'),h('textarea',{'aria-label':'人格',value:persona,onChange:e=>setPersona(e.target.value),rows:8}),h(Button,{primary:true,onClick:()=>update({persona})},'保存人格')),
      h(Card,null,h('div',{className:'peko-row'},h('div',null,h('h2',null,'主动陪伴'),h('p',null,'仅在设定时段问候，不观察屏幕或前台应用。')),h(Button,{'aria-pressed':!!settings.proactive,onClick:()=>update({proactive:!settings.proactive})},settings.proactive?'已开启':'已关闭')),
        h('div',{className:'peko-grid'},h(Field,{label:'空闲多少分钟后问候',type:'number',min:15,max:1440,value:settings.idleMinutes||60,onChange:e=>update({idleMinutes:Number(e.target.value)})}),h(Field,{label:'每日最多问候次数',type:'number',min:0,max:10,value:settings.maxDailyGreetings??2,onChange:e=>update({maxDailyGreetings:Number(e.target.value)})}),h(Field,{label:'开始时间（本地小时）',type:'number',min:0,max:23,value:settings.activeStart??9,onChange:e=>update({activeStart:Number(e.target.value)})}),h(Field,{label:'结束时间（本地小时）',type:'number',min:1,max:24,value:settings.activeEnd??22,onChange:e=>update({activeEnd:Number(e.target.value)})}))));
    if(tab==='models')return h('div',{className:'peko-panel-content'},
      h('header',null,h('h1',null,'模型与连接'),h('p',null,'模型、工具与凭据继续复用 dsh。')),
      h(Card,null,h('h2',null,'共享 dsh 配置'),h('dl',null,h('dt',null,'DSH_HOME'),h('dd',null,state.home||'正在连接'),h('dt',null,'Profile'),h('dd',null,state.profile||'desktop → peko'),h('dt',null,'连接状态'),h('dd',null,state.connected?'已连接':'连接已断开')),h('div',{className:'peko-actions'},h(Button,{primary:true,onClick:()=>run(()=>invoke('peko_reconnect'))},'重新连接 dsh'),h(Button,{onClick:onChat},'选择聊天模型'))),
      h(Card,null,h('h2',null,'修改配置后重新连接'),h('p',null,'继续使用原有 desktop 配置目录、MCP、skills 与凭据。重新连接会恢复界面，不会重复提交工作操作。')),
      h(Button,{className:'peko-danger',onClick:()=>invoke('window_action',{action:'exit'})},'退出 PekoPet'));
    const latency=state.latencies||[],sorted=[...latency].sort((a,b)=>a-b),p95=sorted.length?sorted[Math.ceil(sorted.length*.95)-1].toFixed(1)+' ms':'等待角色事件';
    return h('div',{className:'peko-panel-content'},
      h('header',null,h('h1',null,'让每个表情都刚刚好'),h('p',null,'表情可混合，姿势与道具会延续到明确关闭。')),
      h(Card,null,h('div',{className:'peko-row'},h('h2',null,catalog.name||'正在加载角色'),h('label',null,'角色 ',h('select',{'aria-label':'角色',value:settings.avatar||'yumi',onChange:e=>update({avatar:e.target.value})},Object.entries(avatarMetadata.avatars).map(([id,avatar])=>h('option',{key:id,value:id},avatar.name))))),h('p',{className:'peko-meta'},'切换角色后重启应用生效。'),h('div',{className:'peko-grid'},(catalog.expressions||[]).map(name=>h('label',{key:name,className:'peko-range'},h('span',null,name),h('input',{type:'range',min:0,max:1,step:.05,value:mix[name]||0,'aria-label':name,onChange:e=>setMix({...mix,[name]:Number(e.target.value)})}),h('output',null,(mix[name]||0).toFixed(2))))),h(Button,{primary:true,onClick:()=>cue({mix,hold:2500})},'预览混合表情')),
      h(Card,null,h('h2',null,'持续姿势与道具'),h('div',{className:'peko-actions'},(catalog.layers||[]).map(name=>{const active=state.avatarState?.layers?.[name]===true;return h(Button,{key:name,'aria-pressed':active,onClick:()=>cue({layers:{[name]:!active}})},name);}))),
      h(Card,null,h('h2',null,'动作'),h('div',{className:'peko-actions'},(catalog.motions||[]).map(name=>h(Button,{key:name,onClick:()=>cue({motion:name})},name)))),
      h(Card,null,h('h2',null,'模型参数'),h('div',{className:'peko-grid'},(catalog.parameters||[]).map(p=>h('label',{key:p.id,className:'peko-range'},h('span',null,p.id),h('input',{type:'range',min:p.min,max:p.max,step:(p.max-p.min)/100||.01,value:params[p.id]??p.default,'aria-label':p.id,onChange:e=>{const value=Number(e.target.value);setParams({...params,[p.id]:value});cue({params:{[p.id]:value},hold:1200});}}),h('output',null,(params[p.id]??p.default).toFixed(2)))))),
      h(Card,null,h('div',{className:'peko-row'},h('p',null,'本地角色响应 P95 · '+p95),h(Button,{onClick:()=>{setMix({});setParams({});cue({clear:true});}},'恢复默认表现'))));
  }
  function useNativeState(){
    const [state,setState]=useState({}),[error,setError]=useState(''),[notice,setNotice]=useState('');
    useEffect(()=>{let live=true;const off=[];invoke('peko_state').then(value=>{if(live)setState(value);}).catch(e=>setError(String(e)));
      window.__TAURI__.event.listen('peko-state',e=>setState(e.payload)).then(unlisten=>{if(live)off.push(unlisten);else unlisten();});
      return()=>{live=false;for(const unlisten of off)unlisten();};
    },[]);
    const run=async(action,message='')=>{setError('');setNotice('');try{await action();setNotice(message);}catch(e){setError(String(e));}};
    return {state,error,notice,run};
  }
const sections=[['memory','共同记忆'],['persona','相处方式'],['models','模型与连接'],['avatar','角色调试']];
function useSnapshot(source){
  const subscribe=useCallback(listener=>source.subscribe(listener),[source]);
  const read=useCallback(()=>source.getSnapshot(),[source]);
  return useSyncExternalStore(subscribe,read,read);
}
function historyRows(catalog,managed){
  const ids=new Set(managed.map(row=>row.id));
  return catalog.ids.map(id=>catalog.byId[id])
    .filter(row=>row&&!row.blank&&!row.parentId&&row.origin!=='subagent'&&!row.id.startsWith('peko-memory-')&&ids.has(row.id))
    .sort((a,b)=>b.updatedAt-a.updatedAt);
}
function SkipProductOnboarding({complete}){useEffect(()=>{complete();},[complete]);return null;}
function NoProductChrome(){return null;}
function History({catalog,current,onOpen,onClose}){
  const dialog=useRef(null),[managed,setManaged]=useState(null),[error,setError]=useState('');
  const load=()=>{setError('');request('peko.sessions').then(result=>setManaged(result.sessions)).catch(reason=>setError(String(reason)));};
  useEffect(()=>{dialog.current.showModal();load();},[]);
  const rows=managed===null?[]:historyRows(catalog,managed);
  return createPortal(<dialog ref={dialog} className="peko-history" aria-label="聊天记录" onCancel={onClose} onClick={event=>{if(event.target===dialog.current)onClose();}}>
    <header><h2>聊天记录</h2><button type="button" aria-label="关闭聊天记录" onClick={onClose}><Icon name="close"/></button></header>
    {error?<div role="alert"><p>{error}</p><Button onClick={load}>重新加载</Button></div>:managed===null?<p className="peko-muted">正在加载…</p>:rows.length===0?<p className="peko-muted">还没有聊天记录。</p>:<div className="peko-history-list">{rows.map(row=><button key={row.id} type="button" aria-current={row.id===current?'page':undefined} onClick={()=>onOpen(row.id)}><span>{row.title||'未命名的对话'}</span><small>{row.running?'进行中':new Date(row.updatedAt).toLocaleDateString('zh-CN',{month:'short',day:'numeric'})}</small></button>)}</div>}
  </dialog>,document.body);
}
function Pane({tab,navigate}){
  const {state,error,notice,run}=useNativeState();
  if(!state.settings)return <main className="peko-companion-main">正在载入陪伴设置…</main>;
  return <main className="peko-companion-main">
    <nav className="peko-settings-nav" aria-label="陪伴设置">{sections.map(([id,label])=><button key={id} type="button" aria-current={tab===id?'page':undefined} onClick={()=>navigate('peko-'+id)}>{label}</button>)}</nav>
    {(error||state.error)&&<div role="alert" className="peko-error">{error||state.error}</div>}
    {notice&&<div role="status" className="peko-notice">{notice}</div>}
    <CompanionPanel tab={tab} state={state} run={run} onChat={()=>navigate(null,true)}/>
  </main>;
}
function Shell({navigate,layout,sessions,current,view,onStart,onOpen}){
  const {state,error,run}=useNativeState();
  const panel=useSnapshot(layout.panelInfo),catalog=useSnapshot(sessions.list),selection=useSnapshot(current),surface=useSnapshot(view);
  const [history,setHistory]=useState(false),menu=useRef(null);
  const conversationTitle=panel.activePanelId?undefined:catalog.byId[selection.key]?.title;
  useEffect(()=>{document.title=conversationTitle?conversationTitle+' — PekoPet':'PekoPet';},[conversationTitle,selection.key,panel.activePanelId]);
  const action=value=>invoke('window_action',{action:value});
  const closeMenu=()=>{if(menu.current)menu.current.open=false;};
  const openPanel=id=>{closeMenu();navigate(id);};
  useEffect(()=>{
    document.documentElement.toggleAttribute('data-peko-work-options',surface.workOptions);
    return()=>document.documentElement.removeAttribute('data-peko-work-options');
  },[surface.workOptions]);
  useEffect(()=>{
    const outside=event=>{if(menu.current&&!menu.current.contains(event.target))closeMenu();};
    const escape=event=>{if(event.key==='Escape'&&menu.current?.open){closeMenu();menu.current.querySelector('summary').focus();}};
    document.addEventListener('pointerdown',outside);document.addEventListener('keydown',escape);
    return()=>{document.removeEventListener('pointerdown',outside);document.removeEventListener('keydown',escape);};
  },[]);
  const busy=state.busy||state.status==='等你决定';
  return createPortal(<>
    <header className="peko-titlebar peko-chrome" data-peko-ready>
      {panel.activePanelId&&<button type="button" className="peko-icon-button" aria-label="返回聊天" onClick={()=>navigate(null)}><Icon name="back"/></button>}
      <div className="peko-titlebar-drag" onPointerDown={event=>{if(event.button===0)action('drag');}} onDoubleClick={()=>action('maximize')}>
        <Portrait size={28}/><strong>Peko</strong>
        {!state.error&&<span className={'peko-presence'+(busy?' is-busy':'')} role="status"><i/>{busy?state.status:''}</span>}
      </div>
      {state.error&&<button type="button" className="peko-connection-error" title={state.error} onClick={()=>openPanel('peko-models')}>查看提示</button>}
      <div className="peko-chat-actions">
        <button type="button" className="peko-icon-button" aria-label="聊天记录" title="聊天记录" onClick={()=>setHistory(true)}><Icon name="history"/></button>
        <button type="button" className="peko-icon-button" aria-label="新对话" title="新对话" onClick={()=>{navigate(null,false);onStart();}}><Icon name="plus"/></button>
        <details ref={menu} className="peko-more"><summary aria-label="更多选项" title="更多选项"><Icon name="more"/></summary>
          <div className="peko-more-menu" role="group" aria-label="更多选项">
            {sections.map(([id,label])=><button key={id} type="button" onClick={()=>openPanel('peko-'+id)}>{label}</button>)}
            <hr/>
            <button type="button" aria-pressed={surface.workOptions} onClick={()=>{view.set({workOptions:!surface.workOptions});navigate(null);closeMenu();}}>工作选项<span>{surface.workOptions?'已展开':''}</span></button>
            <button type="button" aria-pressed={!!state.settings?.dnd} onClick={()=>{closeMenu();run(()=>request('peko.settings',{patch:{dnd:!state.settings?.dnd}}));}}>勿扰模式<span>{state.settings?.dnd?'已开启':'已关闭'}</span></button>
          </div>
        </details>
      </div>
      <div className="peko-window-controls">{['minimize','maximize','close'].map((value,i)=><button key={value} type="button" aria-label={['最小化','最大化或还原','关闭聊天'][i]} onClick={()=>action(value)}><Icon name={value}/></button>)}</div>
    </header>
    {error&&<div role="alert" className="peko-shell-error">{error}</div>}
    {history&&<History catalog={catalog} current={selection.key} onClose={()=>setHistory(false)} onOpen={id=>run(async()=>{onOpen(id);setHistory(false);})}/>}
  </>,document.body);
}
function apply(ctx){
  const view=createSnapshotStore({workOptions:false});
  const navigate=(id,workOptions)=>{if(workOptions!==undefined)view.set({workOptions});ctx.layout.selectPanel(id);};
  ctx.slots.inject('settings.onboarding',()=>{
    const dispose=['welcome-notice','deepseek-official'].map(id=>ctx.slots.register({name:'settings.onboarding',id,priority:-100},SkipProductOnboarding));
    return()=>{for(const off of dispose)off();};
  });
  ctx.slots.inject('settings.general.item',()=>ctx.slots.register({name:'settings.general.item',id:'current-version',priority:-100},NoProductChrome));
  ctx.slots.inject('shell.overlay',()=>ctx.slots.register({name:'shell.overlay',id:'peko-shell'},()=>h(Shell,{navigate,layout:ctx.layout,sessions:ctx.sessions,current:ctx.uiSession.adapter.current,view,onStart:()=>ctx.uiWorkspace.startSession(),onOpen:id=>ctx.uiWorkspace.openSession(id)})));
  for(const [tab]of sections)ctx.slots.inject('main',()=>ctx.slots.register({name:'main',key:'peko-'+tab},()=>h(Pane,{tab,navigate})));
  ctx.effect(()=>{
    let current;const source=ctx.uiSession.adapter.current;
    const update=()=>{const id=source.getSnapshot().key;if(typeof id==='string'&&id!==current){current=id;invoke('peko_activate',{sessionId:id}).catch(reason=>console.error('[PekoPet]',reason));}};
    const off=source.subscribe(update);update();return off;
  },'peko.active-session');
}
export {apply,historyRows};
export const inject=['slots','uiSession','layout','sessions','uiWorkspace'];
