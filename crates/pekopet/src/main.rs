#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
mod input;
mod native;
mod rpc;
mod ui;
mod views;
use gpui::{actions, prelude::*, *};
use input::TextInput;
use native::{Command, Native};
use peko_core::{Catalog, Cue, Output, Parser, StreamCursor, visible_text};
use serde_json::{Value, json};
use std::{
    collections::{BTreeMap, HashMap},
    path::PathBuf,
    sync::mpsc::{self, Receiver, Sender},
    time::{Duration, Instant},
};

actions!(peko, [SendMessage]);
#[derive(Clone, Copy, PartialEq)]
enum Tab {
    Chat,
    Memory,
    Persona,
    Models,
    Avatar,
}
enum Reply {
    Capabilities,
    Initialized,
    Settings,
    Memories,
    History,
    Sessions,
    Ordinary,
}
struct Message {
    role: String,
    text: String,
}
struct View {
    rpc: Option<rpc::Rpc>,
    tx: Sender<Value>,
    rx: Receiver<Value>,
    root: PathBuf,
    pending: HashMap<u64, Reply>,
    session: String,
    cwd: String,
    status: String,
    error: String,
    connected: bool,
    busy: bool,
    tab: Tab,
    messages: Vec<Message>,
    sessions: Vec<Value>,
    approvals: Vec<Value>,
    reminders: Vec<Value>,
    memories: Vec<Value>,
    settings: Value,
    providers: Vec<Value>,
    provider: String,
    model: String,
    composer: Entity<TextInput>,
    persona: Entity<TextInput>,
    memory_input: Entity<TextInput>,
    editing: Option<String>,
    catalog: Catalog,
    native: Option<Native>,
    parsers: HashMap<u64, Parser>,
    cursor: StreamCursor,
    current_text: Option<usize>,
    chat_hwnd: isize,
    latencies: Vec<f64>,
    sent_at: Option<Instant>,
    first_token_ms: Option<f64>,
    generation: u64,
    question_inputs: HashMap<String, Entity<TextInput>>,
    question_choices: HashMap<String, Vec<String>>,
    debug_parameters: BTreeMap<String, f32>,
    clear_memory_armed: bool,
    final_reconciled: bool,
    semantic_cues: bool,
}
impl View {
    fn new(root: PathBuf, hwnd: isize, cx: &mut Context<Self>) -> Self {
        let (tx, rx) = mpsc::channel();
        let mut this = Self {
            rpc: None,
            tx,
            rx,
            root,
            pending: HashMap::new(),
            session: uuid::Uuid::new_v4().to_string(),
            cwd: std::env::current_dir()
                .unwrap()
                .to_string_lossy()
                .into_owned(),
            status: "正在连接 dsh".into(),
            error: String::new(),
            connected: false,
            busy: false,
            tab: Tab::Chat,
            messages: Vec::new(),
            sessions: Vec::new(),
            approvals: Vec::new(),
            reminders: Vec::new(),
            memories: Vec::new(),
            settings: json!({}),
            providers: Vec::new(),
            provider: String::new(),
            model: String::new(),
            composer: cx.new(|cx| TextInput::new("和 Peko 说点什么 · Enter 发送", cx)),
            persona: cx.new(|cx| TextInput::new("人格与相处方式", cx)),
            memory_input: cx.new(|cx| TextInput::new("添加或编辑一条记忆", cx)),
            editing: None,
            catalog: Catalog::default(),
            native: None,
            parsers: HashMap::new(),
            cursor: StreamCursor::default(),
            current_text: None,
            chat_hwnd: hwnd,
            latencies: Vec::new(),
            sent_at: None,
            first_token_ms: None,
            generation: 0,
            question_inputs: HashMap::new(),
            question_choices: HashMap::new(),
            debug_parameters: BTreeMap::new(),
            clear_memory_armed: false,
            final_reconciled: false,
            semantic_cues: false,
        };
        this.connect();
        cx.spawn(async move |weak, cx| {
            loop {
                cx.background_executor()
                    .timer(Duration::from_millis(16))
                    .await;
                if weak
                    .update(cx, |this, cx| {
                        this.drain(cx);
                    })
                    .is_err()
                {
                    break;
                }
            }
        })
        .detach();
        this
    }
    fn connect(&mut self) {
        self.generation += 1;
        self.rpc.take();
        self.connected = false;
        self.busy = false;
        self.pending.clear();
        self.approvals.clear();
        self.error.clear();
        match rpc::Rpc::start(self.root.clone(), self.tx.clone(), self.generation) {
            Ok(rpc) => {
                self.rpc = Some(rpc);
                self.call("peko.capabilities", json!({}), Reply::Capabilities);
            }
            Err(e) => {
                self.error = format!("{e:#}");
                self.status = "连接失败".into();
            }
        }
    }
    fn call(&mut self, method: &str, p: Value, reply: Reply) {
        if let Some(rpc) = &mut self.rpc {
            let id = rpc.call(method, p);
            self.pending.insert(id, reply);
        }
    }
    fn save(&mut self, patch: Value) {
        self.call("peko.settings", json!({"patch":patch}), Reply::Settings);
    }
    fn initialize(&mut self) {
        if self.provider.is_empty() || self.model.is_empty() {
            self.tab = Tab::Models;
            self.error = "请选择 dsh 中已配置的模型".into();
            return;
        }
        self.call(
            "initialize",
            json!({"cwd":self.cwd,"provider":self.provider,"model":self.model}),
            Reply::Initialized,
        );
    }
    fn native_command(&self, command: Command) {
        if let Some(p) = &self.native {
            let _ = p.tx.send((command, None));
        }
    }
    fn local_state(&self, state: &str) {
        if let Some(p) = self
            .catalog
            .parameters
            .iter()
            .find(|p| p.id == "ParamAngleZ")
        {
            let offset = match state {
                "thinking" => 6.,
                "working" => 3.,
                "waiting" => -6.,
                _ => 0.,
            };
            self.native_command(Command::Cue(Cue {
                params: BTreeMap::from([(p.id.clone(), (p.default + offset).clamp(p.min, p.max))]),
                hold: Some(1200),
                ..Default::default()
            }));
        }
    }
    fn send(&mut self, _: &SendMessage, _: &mut Window, cx: &mut Context<Self>) {
        if self.tab != Tab::Chat || !self.connected || self.busy {
            return;
        }
        if self.composer.read(cx).is_composing() {
            return;
        }
        let text = self.composer.read(cx).content.to_string();
        if text.trim().is_empty() {
            return;
        }
        self.composer.update(cx, |input, cx| input.set("", cx));
        self.messages.push(Message {
            role: "user".into(),
            text: text.clone(),
        });
        self.busy = true;
        self.status = "正在思考".into();
        self.sent_at = Some(Instant::now());
        self.first_token_ms = None;
        self.current_text = None;
        self.error.clear();
        self.semantic_cues = false;
        self.local_state("thinking");
        self.call("session/prompt",json!({"sessionId":self.session,"contentBlocks":[{"type":"text","text":text}],"avatar":self.catalog}),Reply::Ordinary);
        cx.notify();
    }
    fn outputs(&mut self, out: Vec<Output>, received_at: Option<Instant>) {
        for item in out {
            match item {
                Output::Text(text) => {
                    if self.first_token_ms.is_none() {
                        self.first_token_ms =
                            self.sent_at.map(|t| t.elapsed().as_secs_f64() * 1000.);
                    }
                    let i = *self.current_text.get_or_insert_with(|| {
                        let i = self.messages.len();
                        self.messages.push(Message {
                            role: "assistant".into(),
                            text: String::new(),
                        });
                        i
                    });
                    self.messages[i].text.push_str(&text);
                }
                Output::Cue(mut cue) => match self.catalog.validate(&mut cue) {
                    Ok(()) => {
                        self.semantic_cues = true;
                        if let Some(p) = &self.native {
                            let _ = p.tx.send((
                                Command::Cue(cue),
                                Some(received_at.unwrap_or_else(Instant::now)),
                            ));
                        }
                    }
                    Err(e) => self.error = e,
                },
                Output::Invalid(e) => self.error = e,
            }
        }
    }
    fn drain(&mut self, cx: &mut Context<Self>) {
        let events: Vec<_> = self.rx.try_iter().collect();
        if events.is_empty() {
            return;
        }
        for e in events {
            self.event(e, cx);
        }
        cx.notify();
    }
    fn event(&mut self, e: Value, cx: &mut Context<Self>) {
        if e["connectionGeneration"]
            .as_u64()
            .is_some_and(|g| g != self.generation)
        {
            return;
        }
        if let Some(kind) = e["native"].as_str() {
            match kind {
                "catalog" => {
                    if let Ok(c) = serde_json::from_value(e["catalog"].clone()) {
                        self.catalog = c;
                        self.call(
                            "peko.avatar",
                            json!({"sessionId":self.session,"catalog":self.catalog}),
                            Reply::Ordinary,
                        );
                    }
                }
                "show" => {
                    self.tab = Tab::Chat;
                    native::show_chat(self.chat_hwnd, true);
                }
                "quit" => {
                    self.rpc.take();
                    cx.quit();
                }
                "settings" => self.save(e["patch"].clone()),
                "state" => self.call(
                    "peko.avatar",
                    json!({"sessionId":self.session,"state":e["state"]}),
                    Reply::Ordinary,
                ),
                "latency" => {
                    if let Some(ms) = e["ms"].as_f64() {
                        self.latencies.push(ms);
                    }
                }
                "error" => self.error = e["message"].as_str().unwrap_or("角色渲染失败").into(),
                _ => {}
            }
            return;
        }
        if let Some(err) = e["transportError"].as_str() {
            self.error = err.into();
            self.connected = false;
            self.busy = false;
            self.status = "连接已断开".into();
            self.native_command(Command::Cancel);
            return;
        }
        if let Some(id) = e["id"].as_u64() {
            let Some(reply) = self.pending.remove(&id) else {
                return;
            };
            if !e["error"].is_null() {
                self.error = e["error"]["message"].as_str().unwrap_or("请求失败").into();
                self.busy = false;
                return;
            }
            let r = &e["result"];
            match reply {
                Reply::Capabilities => {
                    self.providers = r["providers"].as_array().cloned().unwrap_or_default();
                    self.sessions = r["sessions"].as_array().cloned().unwrap_or_default();
                    self.settings = r["settings"].clone();
                    self.provider = self.settings["provider"]
                        .as_str()
                        .filter(|x| !x.is_empty())
                        .or(r["defaultModel"]["provider"].as_str())
                        .unwrap_or("")
                        .into();
                    self.model = self.settings["model"]
                        .as_str()
                        .filter(|x| !x.is_empty())
                        .or(r["defaultModel"]["model"].as_str())
                        .unwrap_or("")
                        .into();
                    self.persona.update(cx, |input, cx| {
                        input.set(self.settings["persona"].as_str().unwrap_or(""), cx)
                    });
                    if self.native.is_none() {
                        self.native = Some(Native::start(
                            native::model_path(self.settings["avatar"].as_str().unwrap_or("yumi")),
                            self.settings.clone(),
                            self.tx.clone(),
                        ));
                    }
                    self.initialize();
                }
                Reply::Initialized => {
                    self.connected = true;
                    self.status = "在你身边".into();
                    self.call("peko.memory", json!({}), Reply::Memories);
                    if self.sessions.iter().any(|s| s["id"] == self.session) {
                        self.call(
                            "peko.open",
                            json!({"sessionId":self.session}),
                            Reply::Ordinary,
                        );
                        self.call(
                            "peko.history",
                            json!({"sessionId":self.session}),
                            Reply::History,
                        );
                    }
                }
                Reply::Settings => {
                    self.settings = r.clone();
                    self.native_command(Command::Settings(r.clone()));
                }
                Reply::Memories => {
                    self.memories = r["memories"].as_array().cloned().unwrap_or_default()
                }
                Reply::Sessions => {
                    self.sessions = r["sessions"].as_array().cloned().unwrap_or_default()
                }
                Reply::History => {
                    self.messages = r["messages"]
                        .as_array()
                        .unwrap_or(&Vec::new())
                        .iter()
                        .map(|m| Message {
                            role: m["role"].as_str().unwrap_or("assistant").into(),
                            text: if m["role"] == "assistant" {
                                visible_text(m["text"].as_str().unwrap_or(""))
                            } else {
                                m["text"].as_str().unwrap_or("").to_string()
                            },
                        })
                        .collect();
                    if let Ok(cue) = serde_json::from_value::<Cue>(r["avatarState"].clone()) {
                        self.native_command(Command::Cue(cue));
                    }
                }
                Reply::Ordinary => {}
            }
            return;
        }
        let p = &e["params"];
        match e["method"].as_str().unwrap_or("") {
            "peko.stream" if p["sessionId"].as_str() == Some(&self.session) => {
                let f = &p["frame"];
                let received_at = e["receivedMicros"].as_u64().map(rpc::arrival);
                let attempt = f["attemptId"].as_str().unwrap_or("");
                let rev = f["revision"].as_u64().unwrap_or(0);
                match f["type"].as_str().unwrap_or("") {
                    "start" => {
                        if self.cursor.start(attempt, rev) {
                            self.parsers.clear();
                            self.current_text = None;
                            self.final_reconciled = false;
                        }
                    }
                    "chunk" => {
                        match self
                            .cursor
                            .accept(attempt, rev, f["index"].as_u64().unwrap_or(0))
                        {
                            Ok(true) => {
                                let c = &f["chunk"];
                                let token = match c["type"].as_str().unwrap_or("") {
                                    "text-delta" | "reasoning-delta" => {
                                        c["text"].as_str().is_some_and(|s| !s.is_empty())
                                    }
                                    "tool-call-delta" => {
                                        c["name"].is_string()
                                            || c["argumentsDelta"]
                                                .as_str()
                                                .is_some_and(|s| !s.is_empty())
                                    }
                                    _ => false,
                                };
                                if token && self.first_token_ms.is_none() {
                                    self.first_token_ms = self.sent_at.map(|sent| {
                                        received_at
                                            .unwrap_or_else(Instant::now)
                                            .saturating_duration_since(sent)
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
                                        self.outputs(out, received_at);
                                    }
                                    "tool-call-delta" => {
                                        if let Some(name) = c["name"].as_str() {
                                            self.status = format!("正在工作 · {name}");
                                            self.local_state("working");
                                        }
                                    }
                                    _ => {}
                                }
                            }
                            Ok(false) => {}
                            Err(err) => {
                                self.error = err.into();
                                self.parsers.clear();
                                self.native_command(Command::Cancel);
                            }
                        }
                    }
                    "end" => {
                        let mut out: Vec<_> =
                            self.parsers.values_mut().flat_map(|p| p.finish()).collect();
                        if self.final_reconciled {
                            out.retain(|o| !matches!(o, Output::Text(_)));
                        }
                        self.outputs(out, received_at);
                        self.parsers.clear();
                        if f["outcome"]["eventType"] == "assistant/attempt"
                            || f["outcome"]["kind"] == "abandoned"
                        {
                            self.native_command(Command::Cancel);
                        }
                    }
                    _ => {}
                }
            }
            "session.event" if p["sessionId"].as_str() == Some(&self.session) => {
                let event = &p["event"];
                if event["type"] == "assistant/message" {
                    self.final_reconciled = true;
                    let raw: String = event["data"]["message"]["content"]
                        .as_array()
                        .unwrap_or(&Vec::new())
                        .iter()
                        .filter(|b| b["type"] == "text")
                        .filter_map(|b| b["text"].as_str())
                        .collect();
                    if !raw.is_empty() {
                        let text = visible_text(&raw);
                        if let Some(i) = self.current_text {
                            self.messages[i].text = text;
                        } else {
                            self.messages.push(Message {
                                role: "assistant".into(),
                                text,
                            });
                            self.current_text = Some(self.messages.len() - 1);
                        }
                    }
                }
            }
            "peko.work" if p["sessionId"].as_str() == Some(&self.session) => {
                self.status = "正在处理工具结果".into();
                let message = &p["event"]["data"]["message"];
                let raw: String = message["content"]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .filter(|b| b["type"] == "text")
                    .filter_map(|b| b["text"].as_str())
                    .collect();
                self.messages.push(Message {
                    role: "tool".into(),
                    text: format!(
                        "{}\n{}",
                        if message["isError"] == true {
                            "工具失败"
                        } else {
                            "工具结果"
                        },
                        raw.chars().take(1600).collect::<String>()
                    ),
                });
            }
            "session.status" if p["sessionId"].as_str() == Some(&self.session) => {
                let was_busy = self.busy;
                self.busy = p["status"] == "running";
                if !self.busy {
                    if was_busy {
                        if !self.semantic_cues {
                            self.local_state("done");
                        }
                        if !self.settings["dnd"].as_bool().unwrap_or(false) {
                            self.native_command(Command::Notify("这件事处理好了，点我查看。"));
                        }
                    }
                    self.status = "在你身边".into();
                    self.call("peko.sessions", json!({}), Reply::Sessions);
                }
            }
            "peko.approval" => {
                if let Some(questions) = p["questions"].as_array() {
                    for q in questions {
                        let key = format!(
                            "{}/{}",
                            p["id"].as_str().unwrap_or(""),
                            q["id"].as_str().unwrap_or("")
                        );
                        self.question_inputs
                            .insert(key, cx.new(|cx| TextInput::new("也可以填写自己的回答", cx)));
                    }
                }
                self.approvals.push(p.clone());
                self.tab = Tab::Chat;
                self.status = "等你决定".into();
                self.local_state("waiting");
                native::show_chat_quiet(self.chat_hwnd);
                if !self.settings["dnd"].as_bool().unwrap_or(false) {
                    self.native_command(Command::Notify("需要你做个决定，点我查看。"));
                }
            }
            "peko.withdraw" => {
                self.approvals.retain(|a| a["id"] != p["id"]);
                let prefix = format!("{}/", p["id"].as_str().unwrap_or(""));
                self.question_inputs.retain(|k, _| !k.starts_with(&prefix));
                self.question_choices.retain(|k, _| !k.starts_with(&prefix));
            }
            "peko.memory.changed" => {
                self.memories = p["memories"].as_array().cloned().unwrap_or_default()
            }
            "peko.reminder" => {
                self.reminders.push(p.clone());
                if !self.settings["dnd"].as_bool().unwrap_or(false) {
                    self.native_command(Command::Notify("提醒到了，点我查看。"));
                }
            }
            "peko.error" => self.error = p["message"].as_str().unwrap_or("dsh 故障").into(),
            _ => {}
        }
    }
    fn choose_directory(&mut self) {
        if self.busy {
            return;
        }
        if let Some(dir) = rfd::FileDialog::new()
            .set_title("选择工作项目")
            .pick_folder()
        {
            self.cwd = dir.to_string_lossy().into_owned();
            self.call(
                "session/working-directory/set",
                json!({"sessionId":self.session,"path":self.cwd}),
                Reply::Ordinary,
            );
        }
    }
    fn new_session(&mut self) {
        if self.busy {
            return;
        }
        self.session = uuid::Uuid::new_v4().to_string();
        self.messages.clear();
        self.current_text = None;
        self.parsers.clear();
        self.call(
            "session/working-directory/set",
            json!({"sessionId":self.session,"path":self.cwd}),
            Reply::Ordinary,
        );
    }
    fn answer(&mut self, id: &str, answer: Value) {
        self.call(
            "peko.answer",
            json!({"id":id,"answer":answer}),
            Reply::Ordinary,
        );
    }
}

impl Drop for View {
    fn drop(&mut self) {
        self.native_command(Command::Quit);
    }
}
fn main() {
    let root = std::env::var_os("PEKO_ROOT")
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            let exe = std::env::current_exe().unwrap();
            let parent = exe.parent().unwrap();
            if parent.join("package.json").exists() {
                parent.to_owned()
            } else {
                PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                    .join("../..")
                    .canonicalize()
                    .unwrap()
            }
        });
    Application::new()
        .with_assets(ui::Assets)
        .run(move |cx: &mut App| {
            input::bind(cx);
            cx.bind_keys([KeyBinding::new("enter", SendMessage, Some("Peko"))]);
            let bounds = Bounds::centered(None, size(px(1120.), px(800.)), cx);
            cx.open_window(
                WindowOptions {
                    focus: false,
                    window_min_size: Some(size(px(880.), px(680.))),
                    window_bounds: Some(WindowBounds::Windowed(bounds)),
                    titlebar: Some(TitlebarOptions {
                        title: Some("PekoPet · 你的桌面搭档".into()),
                        ..Default::default()
                    }),
                    ..Default::default()
                },
                move |window, cx| {
                    let hwnd = match raw_window_handle::HasWindowHandle::window_handle(window)
                        .unwrap()
                        .as_raw()
                    {
                        raw_window_handle::RawWindowHandle::Win32(h) => h.hwnd.get(),
                        _ => 0,
                    };
                    window.on_window_should_close(cx, move |_, _| {
                        if !native::is_alive() {
                            return true;
                        }
                        native::show_chat(hwnd, false);
                        false
                    });
                    cx.new(|cx| View::new(root, hwnd, cx))
                },
            )
            .expect("打开 GPUI 窗口失败");
        });
}
