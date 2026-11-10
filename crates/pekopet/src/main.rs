#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
mod native;
mod rpc;
use native::{Command, Native};
use peko_core::{Catalog, Cue, Output, Parser, StreamCursor};
use serde_json::{Value, json};
use std::{
    collections::HashMap,
    path::PathBuf,
    sync::{Arc, Mutex, mpsc},
    thread,
    time::{Duration, Instant},
};
use tauri::{Emitter, Manager};
use tauri_plugin_opener::OpenerExt;

type Answer = mpsc::Sender<Result<Value, String>>;
enum Control {
    Request(String, Value, Answer),
    Activate(String),
    Cue(Cue, Answer),
    Reconnect,
    Quit,
}
struct Bridge {
    tx: mpsc::Sender<Control>,
    snapshot: Arc<Mutex<Value>>,
}
#[tauri::command]
async fn peko_request(
    method: String,
    params: Value,
    bridge: tauri::State<'_, Bridge>,
) -> Result<Value, String> {
    if !matches!(
        method.as_str(),
        "peko.capabilities" | "peko.memory" | "peko.settings" | "peko.cancel" | "peko.sessions"
    ) {
        return Err("该接口未向陪伴设置开放".into());
    }
    let (tx, rx) = mpsc::channel();
    bridge
        .tx
        .send(Control::Request(method, params, tx))
        .map_err(|_| "dsh 连接已关闭")?;
    tauri::async_runtime::spawn_blocking(move || {
        rx.recv_timeout(Duration::from_secs(60))
            .map_err(|_| "dsh 请求超时，请重新连接".to_string())?
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
fn peko_state(bridge: tauri::State<'_, Bridge>) -> Value {
    bridge.snapshot.lock().unwrap().clone()
}
#[tauri::command]
fn peko_activate(session_id: String, bridge: tauri::State<'_, Bridge>) -> Result<(), String> {
    bridge
        .tx
        .send(Control::Activate(session_id))
        .map_err(|e| e.to_string())
}
#[tauri::command]
async fn peko_cue(cue: Cue, bridge: tauri::State<'_, Bridge>) -> Result<Value, String> {
    let (tx, rx) = mpsc::channel();
    bridge
        .tx
        .send(Control::Cue(cue, tx))
        .map_err(|e| e.to_string())?;
    tauri::async_runtime::spawn_blocking(move || {
        rx.recv_timeout(Duration::from_secs(5))
            .map_err(|e| e.to_string())?
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
fn peko_reconnect(bridge: tauri::State<'_, Bridge>) -> Result<(), String> {
    bridge
        .tx
        .send(Control::Reconnect)
        .map_err(|e| e.to_string())
}
#[tauri::command]
fn window_action(action: String, window: tauri::WebviewWindow) -> Result<(), String> {
    match action.as_str() {
        "drag" => window.start_dragging(),
        "minimize" => window.minimize(),
        "maximize" => window.is_maximized().and_then(|max| {
            if max {
                window.unmaximize()
            } else {
                window.maximize()
            }
        }),
        "close" => window.close(),
        "exit" => {
            window.app_handle().exit(0);
            Ok(())
        }
        _ => return Err("未知窗口操作".into()),
    }
    .map_err(|e| e.to_string())
}

enum Pending {
    Capabilities,
    Activate(String),
    Frontend(Answer),
    Ordinary,
}
struct Companion {
    app: tauri::AppHandle,
    root: PathBuf,
    rpc: Option<rpc::Rpc>,
    events: mpsc::Sender<Value>,
    generation: u64,
    pending: HashMap<u64, Pending>,
    native: Option<Native>,
    catalog: Catalog,
    session: String,
    settings: Value,
    avatar_state: Value,
    home: String,
    origin: Arc<Mutex<Option<String>>>,
    snapshot: Arc<Mutex<Value>>,
    cursor: StreamCursor,
    parsers: HashMap<u64, Parser>,
    busy: bool,
    semantic: bool,
    latencies: Vec<f64>,
    status: String,
    error: String,
    sent_at: Option<Instant>,
    first_token: Option<f64>,
    test: bool,
}
impl Companion {
    fn command(&self, c: Command, at: Option<Instant>) {
        if let Some(p) = &self.native {
            let _ = p.tx.send((c, at));
        }
    }
    fn call(&mut self, method: &str, p: Value, reply: Pending) {
        if let Some(rpc) = &mut self.rpc {
            let id = rpc.call(method, p);
            self.pending.insert(id, reply);
        } else if let Pending::Frontend(answer) = reply {
            let _ = answer.send(Err("dsh 尚未连接".into()));
        }
    }
    fn publish(&self) {
        let value = json!({"status":self.status,"error":self.error,"connected":self.rpc.is_some()&&self.origin.lock().unwrap().is_some(),"settings":self.settings,"catalog":self.catalog,"avatarState":self.avatar_state,"home":self.home,"profile":"desktop → peko","sessionId":self.session,"busy":self.busy,"latencies":self.latencies,"firstTokenMs":self.first_token});
        let mut current = self.snapshot.lock().unwrap();
        if *current == value {
            return;
        }
        *current = value.clone();
        drop(current);
        let _ = self.app.emit("peko-state", value);
    }
    fn connect(&mut self) {
        self.generation += 1;
        self.rpc.take();
        for (_, pending) in self.pending.drain() {
            if let Pending::Frontend(answer) = pending {
                let _ = answer.send(Err("dsh 已重新连接，未重发操作".into()));
            }
        }
        *self.origin.lock().unwrap() = None;
        self.busy = false;
        self.parsers.clear();
        self.command(Command::Cancel, None);
        self.status = "正在连接 dsh".into();
        self.error.clear();
        match rpc::Rpc::start(self.root.clone(), self.events.clone(), self.generation) {
            Ok(rpc) => {
                self.rpc = Some(rpc);
                self.call("peko.capabilities", json!({}), Pending::Capabilities);
            }
            Err(e) => self.error = format!("{e:#}"),
        }
        self.publish();
    }
    fn local(&self, status: &str) {
        if let Some(p) = self
            .catalog
            .parameters
            .iter()
            .find(|p| p.id == "ParamAngleZ")
        {
            let offset = match status {
                "thinking" => 6.,
                "working" => 3.,
                "waiting" => -6.,
                _ => 0.,
            };
            self.command(
                Command::Cue(Cue {
                    params: std::collections::BTreeMap::from([(
                        p.id.clone(),
                        (p.default + offset).clamp(p.min, p.max),
                    )]),
                    hold: Some(1200),
                    ..Default::default()
                }),
                None,
            );
        }
    }
    fn outputs(&mut self, out: Vec<Output>, at: Option<Instant>) {
        for item in out {
            match item {
                Output::Cue(mut cue) => match self.catalog.validate(&mut cue) {
                    Ok(()) => {
                        self.semantic = true;
                        self.command(Command::Cue(cue), Some(at.unwrap_or_else(Instant::now)));
                    }
                    Err(e) => self.error = e,
                },
                Output::Invalid(e) => self.error = e,
                Output::Text(_) => {}
            }
        }
    }
    fn event(&mut self, e: Value) {
        if e["connectionGeneration"]
            .as_u64()
            .is_some_and(|g| g != self.generation)
        {
            return;
        }
        if let Some(kind) = e["native"].as_str() {
            match kind {
                "portrait" => {
                    if let (Some(file), Some(window)) =
                        (e["path"].as_str(), self.app.get_webview_window("main"))
                    {
                        if let Ok(icon) = tauri::image::Image::from_path(file) {
                            let _ = window.set_icon(icon);
                        }
                        let _ = self.app.emit("peko-portrait", json!({}));
                    }
                }
                "catalog" => {
                    if let Ok(c) = serde_json::from_value(e["catalog"].clone()) {
                        self.catalog = c;
                        self.call("peko.avatar",json!({"sessionId":if self.session.is_empty(){"peko-catalog"}else{&self.session},"catalog":self.catalog}),Pending::Ordinary);
                    }
                }
                "state" => {
                    if let Some(id) = e["sessionId"].as_str().filter(|s| !s.is_empty()) {
                        if id == self.session {
                            self.avatar_state = e["state"].clone();
                        }
                        self.call(
                            "peko.avatar",
                            json!({"sessionId":id,"state":e["state"]}),
                            Pending::Ordinary,
                        );
                    }
                }
                "show" => {
                    if !self.test {
                        if let Some(w) = self.app.get_webview_window("main") {
                            let _ = w.show();
                            let _ = w.set_focus();
                        }
                    }
                }
                "quit" => {
                    self.rpc.take();
                    self.command(Command::Quit, None);
                    self.app.exit(0);
                }
                "settings" => self.call(
                    "peko.settings",
                    json!({"patch":e["patch"]}),
                    Pending::Ordinary,
                ),
                "latency" => {
                    if let Some(ms) = e["ms"].as_f64() {
                        self.latencies.push(ms);
                        if self.latencies.len() > 500 {
                            self.latencies.remove(0);
                        }
                    }
                }
                "error" => self.error = e["message"].as_str().unwrap_or("角色渲染失败").into(),
                _ => {}
            }
            self.publish();
            return;
        }
        if let Some(error) = e["transportError"].as_str() {
            self.error = error.into();
            *self.origin.lock().unwrap() = None;
            self.status = "连接已断开".into();
            self.busy = false;
            self.parsers.clear();
            self.command(Command::Cancel, None);
            self.publish();
            return;
        }
        if let Some(id) = e["id"].as_u64() {
            let Some(reply) = self.pending.remove(&id) else {
                return;
            };
            if let Pending::Frontend(answer) = reply {
                let result = if e["error"].is_null() {
                    Ok(e["result"].clone())
                } else {
                    Err(e["error"]["message"].as_str().unwrap_or("请求失败").into())
                };
                if let Ok(value) = &result {
                    if value["persona"].is_string() {
                        self.settings = value.clone();
                        self.command(Command::Settings(value.clone()), None);
                    }
                }
                let _ = answer.send(result);
                self.publish();
                return;
            }
            if !e["error"].is_null() {
                self.error = e["error"]["message"].as_str().unwrap_or("请求失败").into();
                self.publish();
                return;
            }
            let r = &e["result"];
            match reply {
                Pending::Capabilities => {
                    self.settings = r["settings"].clone();
                    self.home = r["home"].as_str().unwrap_or("").into();
                    if self.native.is_none() && !self.test {
                        self.native = Some(Native::start(
                            native::model_path(self.settings["avatar"].as_str().unwrap_or("yumi")),
                            self.settings.clone(),
                            self.events.clone(),
                        ));
                    }
                    if let Some(url) = r["frontendUrl"].as_str() {
                        match tauri::Url::parse(url) {
                            Ok(url)
                                if url.scheme() == "http"
                                    && url.host_str() == Some("127.0.0.1") =>
                            {
                                *self.origin.lock().unwrap() =
                                    Some(url.origin().ascii_serialization());
                                if let Some(window) = self.app.get_webview_window("main") {
                                    if let Err(e) = window.navigate(url) {
                                        self.error = e.to_string();
                                    }
                                }
                                self.status = "在你身边".into();
                            }
                            _ => self.error = "dsh 前端未提供有效的本机地址".into(),
                        }
                    } else {
                        self.error = "dsh 未启用嵌入式前端".into();
                    }
                }
                Pending::Activate(id) => {
                    if self.session == id {
                        self.avatar_state = r["avatarState"].clone();
                        let cue = serde_json::from_value::<Cue>(r["avatarState"].clone())
                            .unwrap_or_default();
                        self.command(Command::Session(id, cue), None);
                    }
                }
                Pending::Ordinary => {}
                Pending::Frontend(_) => unreachable!(),
            }
            self.publish();
            return;
        }
        let p = &e["params"];
        match e["method"].as_str().unwrap_or("") {
            "peko.stream" if p["sessionId"].as_str() == Some(&self.session) => {
                let f = &p["frame"];
                let at = e["receivedMicros"].as_u64().map(rpc::arrival);
                let attempt = f["attemptId"].as_str().unwrap_or("");
                let revision = f["revision"].as_u64().unwrap_or(0);
                match f["type"].as_str().unwrap_or("") {
                    "start" => {
                        if self.cursor.start(attempt, revision) {
                            self.parsers.clear();
                        }
                    }
                    "chunk" => match self.cursor.accept(
                        attempt,
                        revision,
                        f["index"].as_u64().unwrap_or(0),
                    ) {
                        Ok(true) => {
                            let c = &f["chunk"];
                            if self.first_token.is_none() {
                                self.first_token = self.sent_at.map(|t| {
                                    at.unwrap_or_else(Instant::now)
                                        .saturating_duration_since(t)
                                        .as_secs_f64()
                                        * 1000.
                                });
                            }
                            match c["type"].as_str().unwrap_or("") {
                                "text-delta" => {
                                    let out = self
                                        .parsers
                                        .entry(c["index"].as_u64().unwrap_or(0))
                                        .or_default()
                                        .push(c["text"].as_str().unwrap_or(""));
                                    self.outputs(out, at);
                                }
                                "tool-call-delta" => {
                                    if c["name"].is_string() {
                                        self.status = "正在工作".into();
                                        self.local("working");
                                    }
                                }
                                _ => {}
                            }
                        }
                        Ok(false) => {}
                        Err(error) => {
                            self.error = error.into();
                            self.parsers.clear();
                            self.command(Command::Cancel, None);
                        }
                    },
                    "end" => {
                        if f["outcome"]["eventType"] == "assistant/attempt"
                            || f["outcome"]["kind"] == "abandoned"
                        {
                            self.command(Command::Cancel, None);
                        } else {
                            let out = self.parsers.values_mut().flat_map(|p| p.finish()).collect();
                            self.outputs(out, at);
                        }
                        self.parsers.clear();
                    }
                    _ => {}
                }
            }
            "session.status" if p["sessionId"].as_str() == Some(&self.session) => {
                let before = self.busy;
                self.busy = p["status"] == "running";
                if self.busy && !before {
                    self.error.clear();
                    self.sent_at = Some(Instant::now());
                    self.first_token = None;
                    self.semantic = false;
                    self.status = "正在思考".into();
                    self.local("thinking");
                } else if !self.busy {
                    self.parsers.clear();
                    self.status = "在你身边".into();
                    if before {
                        if !self.semantic {
                            self.local("done");
                        }
                        if self.settings["dnd"] != true {
                            self.command(Command::Notify("这件事处理好了，点我查看。"), None);
                        }
                    }
                }
            }
            "peko.waiting" if p["sessionId"].as_str() == Some(&self.session) => {
                self.status = "等你决定".into();
                self.local("waiting");
                if self.settings["dnd"] != true {
                    self.command(Command::Notify("需要你做个决定，点我查看。"), None);
                }
            }
            "peko.memory.changed" => {
                let _ = self.app.emit("peko-memory", p.clone());
            }
            "peko.reminder" => {
                let _ = self.app.emit("peko-reminder", p.clone());
                if self.settings["dnd"] != true {
                    self.command(Command::Notify("提醒到了，点我查看。"), None);
                }
            }
            "peko.error" => self.error = p["message"].as_str().unwrap_or("dsh 故障").into(),
            _ => {}
        }
        self.publish();
    }
}
fn root() -> PathBuf {
    if let Some(root) = std::env::var_os("PEKO_ROOT") {
        return root.into();
    }
    let exe = std::env::current_exe().unwrap();
    let parent = exe.parent().unwrap();
    if parent.join("package.json").exists() {
        parent.into()
    } else {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../..")
            .canonicalize()
            .unwrap()
    }
}
fn main() {
    let root = root();
    let args: Vec<_> = std::env::args_os().collect();
    if args.get(1).is_some_and(|s| s == "--render-portrait") {
        match native::render_portrait(args.get(2).and_then(|s| s.to_str()).unwrap_or("yumi")) {
            Ok(file) => println!("{}", file.display()),
            Err(e) => {
                eprintln!("{e:#}");
                std::process::exit(1);
            }
        }
        return;
    }
    let (tx, rx) = mpsc::channel();
    let snapshot = Arc::new(Mutex::new(json!({"status":"正在连接 dsh"})));
    let shared = snapshot.clone();
    let control = tx.clone();
    let origin = Arc::new(Mutex::new(None::<String>));
    let trusted = origin.clone();
    let test = std::env::var_os("PEKO_UI_TEST").is_some();
    let worker: Arc<Mutex<Option<thread::JoinHandle<()>>>> = Arc::new(Mutex::new(None));
    let setup_worker = worker.clone();
    let app=tauri::Builder::default().plugin(tauri_plugin_opener::Builder::new().open_js_links_on_click(false).build()).manage(Bridge{tx,snapshot})
        .invoke_handler(tauri::generate_handler![peko_request,peko_state,peko_activate,peko_cue,peko_reconnect,window_action])
        .setup(move|app|{
            let opener=app.handle().clone();
            let mut builder=tauri::WebviewWindowBuilder::new(app,"main",tauri::WebviewUrl::App("index.html".into()))
                .title("PekoPet · 你的桌面搭档").inner_size(720.,760.).min_inner_size(600.,620.).decorations(false).focused(false).visible(!test)
                .on_new_window(move|url,_|{
                    if matches!(url.scheme(),"http"|"https") {
                        if test {let _=opener.emit("peko-external-link",url.as_str());}
                        else if let Err(error)=opener.opener().open_url(url.as_str(),None::<&str>){eprintln!("打开浏览器失败: {error}");}
                    }
                    tauri::webview::NewWindowResponse::Deny
                })
                .on_navigation(move|url|url.scheme()=="tauri"||url.host_str()==Some("tauri.localhost")||trusted.lock().unwrap().as_ref().is_some_and(|origin|url.origin().ascii_serialization()==*origin));
            if let Some(port)=std::env::var_os("PEKO_UI_CHECK_PORT"){builder=builder.additional_browser_args(&format!("--remote-debugging-port={} --disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection",port.to_string_lossy()));}
            if test{builder=builder.data_directory(root.join("work/test-webview"));}
            let portrait=native::portrait_path("yumi");
            if portrait.exists(){builder=builder.icon(tauri::image::Image::from_path(&portrait)?)?;}
            let window=builder.build()?;
            if test {native::test_window(window.hwnd()?.0 as isize);}
            let app_handle=app.handle().clone();
            window.on_window_event(move|event|{if let tauri::WindowEvent::CloseRequested{api,..}=event{if native::is_alive(){api.prevent_close();if let Some(w)=app_handle.get_webview_window("main"){let _=w.hide();}}}});
            let app=app.handle().clone();let(events,event_rx)=mpsc::channel();
            let handle=thread::spawn(move||{
                let mut state=Companion{app,root,rpc:None,events,generation:0,pending:HashMap::new(),native:None,catalog:Catalog::default(),session:String::new(),settings:json!({}),avatar_state:json!({}),home:String::new(),origin,snapshot:shared,cursor:StreamCursor::default(),parsers:HashMap::new(),busy:false,semantic:false,latencies:Vec::new(),status:String::new(),error:String::new(),sent_at:None,first_token:None,test};
                if test {if let Some(file)=std::env::var_os("PEKO_UI_FIXTURE_CATALOG") {state.catalog=serde_json::from_slice(&std::fs::read(file).expect("Read UI catalog")).expect("UI fixture catalog");}}
                state.connect();
                'main:loop{
                    for command in rx.try_iter(){match command{
                        Control::Quit=>break 'main,Control::Reconnect=>state.connect(),
                        Control::Request(method,p,answer)=>state.call(&method,p,Pending::Frontend(answer)),
                        Control::Activate(id)=>{state.session=id.clone();state.parsers.clear();state.cursor=StreamCursor::default();state.call("peko.activate",json!({"sessionId":id}),Pending::Activate(id.clone()));state.call("peko.avatar",json!({"sessionId":id,"catalog":state.catalog}),Pending::Ordinary);},
                        Control::Cue(mut cue,answer)=>{let result=state.catalog.validate(&mut cue).map(|_|{state.command(Command::Cue(cue),None);json!({})});let _=answer.send(result);},
                    }}
                    match event_rx.recv_timeout(Duration::from_millis(16)){Ok(event)=>state.event(event),Err(mpsc::RecvTimeoutError::Timeout)=>{},Err(_)=>break,}
                }
                state.rpc.take();state.command(Command::Quit,None);
            });*setup_worker.lock().unwrap()=Some(handle);Ok(())
        }).build(tauri::generate_context!()).expect("创建 PekoPet 窗口失败");
    app.run(move |_, event| {
        if let tauri::RunEvent::Exit = event {
            let _ = control.send(Control::Quit);
            if let Some(handle) = worker.lock().unwrap().take() {
                let _ = handle.join();
            }
        }
    });
}
