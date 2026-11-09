#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
mod input;
mod native;
mod rpc;
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
fn button(id: impl Into<SharedString>, text: impl Into<SharedString>) -> Stateful<Div> {
    div()
        .id(ElementId::Name(id.into()))
        .px_3()
        .py_2()
        .rounded_md()
        .bg(rgb(0x29333f))
        .text_color(rgb(0xe8eef3))
        .text_sm()
        .cursor_pointer()
        .hover(|s| s.bg(rgb(0x3b4858)))
        .child(text.into())
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
            messages: vec![Message {
                role: "assistant".into(),
                text: "我在这里。聊聊今天，或者选一个项目，我们一起做点事情。".into(),
            }],
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
        if !self.connected || self.busy {
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
                "show" => native::show_chat(self.chat_hwnd, true),
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
                            self.native_command(Command::Notify);
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
                self.status = "等你决定".into();
                self.local_state("waiting");
                native::show_chat(self.chat_hwnd, true);
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
                    self.native_command(Command::Notify);
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

impl Render for View {
    fn render(&mut self, _window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let mut sidebar = div()
            .w(px(198.))
            .flex_none()
            .p_4()
            .flex()
            .flex_col()
            .gap_2()
            .bg(rgb(0x19212b))
            .child(div().text_xl().text_color(rgb(0xffb9a5)).child("PekoPet"))
            .child(
                div()
                    .text_xs()
                    .mb_4()
                    .text_color(rgb(0x93a5b7))
                    .child("有表情，也有记性。"),
            );
        for (tab, label) in [
            (Tab::Chat, "聊天与工作"),
            (Tab::Memory, "共同记忆"),
            (Tab::Persona, "相处方式"),
            (Tab::Models, "模型与连接"),
            (Tab::Avatar, "角色调试"),
        ] {
            sidebar = sidebar.child(
                button(label, label)
                    .when(self.tab == tab, |s| s.bg(rgb(0x45524f)))
                    .on_click(cx.listener(move |this, _, _, cx| {
                        this.tab = tab;
                        if tab == Tab::Memory {
                            this.call("peko.memory", json!({}), Reply::Memories);
                        }
                        cx.notify();
                    })),
            );
        }
        sidebar = sidebar.child(
            div()
                .mt_5()
                .text_xs()
                .text_color(rgb(0x93a5b7))
                .child("最近对话"),
        );
        for s in self.sessions.iter().take(12) {
            let id = s["id"].as_str().unwrap_or("").to_string();
            let title = s["title"].as_str().unwrap_or("对话").to_string();
            let cwd = s["cwd"].as_str().unwrap_or("").to_string();
            sidebar = sidebar.child(button(id.clone(), title).on_click(cx.listener(
                move |this, _, _, cx| {
                    if !this.busy && this.session != id {
                        this.session = id.clone();
                        this.cwd = cwd.clone();
                        this.call("peko.open", json!({"sessionId":id}), Reply::Ordinary);
                        this.call("peko.history", json!({"sessionId":id}), Reply::History);
                        this.tab = Tab::Chat;
                    }
                    cx.notify();
                },
            )));
        }
        sidebar = sidebar.child(div().flex_1()).child(
            button(
                "dnd",
                if self.settings["dnd"].as_bool().unwrap_or(false) {
                    "勿扰已开启"
                } else {
                    "开启勿扰"
                },
            )
            .on_click(cx.listener(|this, _, _, cx| {
                this.save(json!({"dnd":!this.settings["dnd"].as_bool().unwrap_or(false)}));
                cx.notify();
            })),
        );
        let mut body = div()
            .flex()
            .flex_col()
            .flex_1()
            .min_w_0()
            .min_h_0()
            .gap_3()
            .p_5();
        body = body.child(
            div()
                .flex()
                .justify_between()
                .items_center()
                .child(
                    div()
                        .flex()
                        .flex_col()
                        .child(div().text_lg().child(self.status.clone()))
                        .child(
                            div()
                                .text_xs()
                                .text_color(rgb(0x93a5b7))
                                .child(format!("{} / {}", self.provider, self.model)),
                        ),
                )
                .child(
                    button("new", "新对话").on_click(cx.listener(|this, _, _, cx| {
                        this.new_session();
                        cx.notify();
                    })),
                ),
        );
        if !self.error.is_empty() {
            body = body.child(
                div()
                    .rounded_md()
                    .p_3()
                    .bg(rgb(0x4a2e34))
                    .text_sm()
                    .child(self.error.clone()),
            );
        }
        for reminder in self.reminders.clone() {
            let id = reminder["sessionId"].as_str().unwrap_or("").to_string();
            let label = if self.busy {
                "有一条到期提醒 · 当前任务结束后查看"
            } else {
                "有一条到期提醒 · 查看对话"
            };
            body = body.child(
                button(format!("reminder-{id}"), label).on_click(cx.listener(
                    move |this, _, _, cx| {
                        if this.busy {
                            return;
                        }
                        this.session = id.clone();
                        if let Some(s) = this.sessions.iter().find(|s| s["id"] == id) {
                            this.cwd = s["cwd"].as_str().unwrap_or(&this.cwd).to_string();
                        }
                        this.call("peko.open", json!({"sessionId":id}), Reply::Ordinary);
                        this.call("peko.history", json!({"sessionId":id}), Reply::History);
                        this.reminders.retain(|r| r["sessionId"] != id);
                        this.tab = Tab::Chat;
                        cx.notify();
                    },
                )),
            );
        }
        match self.tab {
            Tab::Chat => {
                body = body.child(button("cwd", format!("项目  {}", self.cwd)).on_click(
                    cx.listener(|this, _, _, cx| {
                        this.choose_directory();
                        cx.notify();
                    }),
                ));
                let mut feed = div()
                    .id("feed")
                    .flex_1()
                    .min_h_0()
                    .overflow_y_scroll()
                    .flex()
                    .flex_col()
                    .gap_3();
                for (i, m) in self.messages.iter().enumerate() {
                    let text = m.text.clone();
                    feed = feed.child(
                        div()
                            .rounded_lg()
                            .p_4()
                            .bg(rgb(if m.role == "user" { 0x2b3c42 } else { 0x202a35 }))
                            .child(div().mb_2().text_xs().text_color(rgb(0xb1c4be)).child(
                                match m.role.as_str() {
                                    "user" => "你",
                                    "tool" => "工作过程",
                                    _ => "Peko",
                                },
                            ))
                            .child(div().text_sm().child(m.text.clone()))
                            .child(button(format!("copy{i}"), "复制").mt_2().on_click(
                                move |_, _, cx| {
                                    cx.write_to_clipboard(ClipboardItem::new_string(text.clone()))
                                },
                            )),
                    );
                }
                body = body.child(feed);
                for a in self.approvals.clone() {
                    let id = a["id"].as_str().unwrap_or("").to_string();
                    let mut card = div()
                        .p_3()
                        .rounded_lg()
                        .bg(rgb(0x3c3b2d))
                        .child(a["reason"].as_str().unwrap_or("需要你做个决定").to_string());
                    if a["kind"] == "approval" {
                        let yes = id.clone();
                        let no = id.clone();
                        card = card.child(
                            div()
                                .flex()
                                .gap_2()
                                .mt_2()
                                .child(button(format!("yes{id}"), "允许这一次").on_click(
                                    cx.listener(move |this, _, _, _| {
                                        this.answer(&yes, json!("allowed-once"))
                                    }),
                                ))
                                .child(button(format!("no{id}"), "拒绝").on_click(cx.listener(
                                    move |this, _, _, _| this.answer(&no, json!("rejected")),
                                ))),
                        );
                    } else {
                        for q in a["questions"].as_array().unwrap_or(&Vec::new()) {
                            let question = q["id"].as_str().unwrap_or("").to_string();
                            let key = format!("{id}/{question}");
                            let multi = q["multiSelect"].as_bool().unwrap_or(false);
                            card = card.child(q["question"].as_str().unwrap_or("").to_string());
                            if let Some(detail) = q["detail"].as_str() {
                                card = card.child(div().text_sm().child(detail.to_string()));
                            }
                            for o in q["options"].as_array().unwrap_or(&Vec::new()) {
                                let label = o["label"].as_str().unwrap_or("").to_string();
                                let key = key.clone();
                                let selected = self
                                    .question_choices
                                    .get(&key)
                                    .is_some_and(|v| v.contains(&label));
                                card = card.child(
                                    button(format!("{key}/{label}"), label.clone())
                                        .when(selected, |s| s.bg(rgb(0x526e62)))
                                        .on_click(cx.listener(move |this, _, _, cx| {
                                            let choices = this
                                                .question_choices
                                                .entry(key.clone())
                                                .or_default();
                                            if multi {
                                                if let Some(i) =
                                                    choices.iter().position(|s| s == &label)
                                                {
                                                    choices.remove(i);
                                                } else {
                                                    choices.push(label.clone());
                                                }
                                            } else {
                                                *choices = vec![label.clone()];
                                            }
                                            cx.notify();
                                        })),
                                );
                            }
                            if let Some(input) = self.question_inputs.get(&key) {
                                card = card.child(input.clone());
                            }
                        }
                        let questions = a["questions"].as_array().cloned().unwrap_or_default();
                        let id = id.clone();
                        card =
                            card.child(button(format!("submit{id}"), "提交回答").mt_2().on_click(
                                cx.listener(move |this, _, _, cx| {
                                    let mut answers = Vec::new();
                                    for q in &questions {
                                        let qid = q["id"].as_str().unwrap_or("");
                                        let key = format!("{id}/{qid}");
                                        let selected = this
                                            .question_choices
                                            .get(&key)
                                            .cloned()
                                            .unwrap_or_default();
                                        let custom = this
                                            .question_inputs
                                            .get(&key)
                                            .map(|i| i.read(cx).content.to_string())
                                            .unwrap_or_default();
                                        if selected.is_empty() && custom.trim().is_empty() {
                                            this.error = "请回答每个问题后再提交".into();
                                            cx.notify();
                                            return;
                                        }
                                        answers.push(
                                            json!({"id":qid,"selected":selected,"custom":custom}),
                                        );
                                    }
                                    this.answer(&id, json!({"answers":answers}));
                                }),
                            ));
                    }
                    body = body.child(card);
                }
                body = body.child(self.composer.clone()).child(
                    div()
                        .flex()
                        .justify_between()
                        .child(
                            div()
                                .text_xs()
                                .text_color(rgb(0x93a5b7))
                                .child(if self.busy {
                                    "正在处理，可随时停止"
                                } else {
                                    "配置与工具来自 dsh desktop"
                                }),
                        )
                        .child(if self.busy {
                            button("stop", "停止")
                                .on_click(cx.listener(|this, _, _, _| {
                                    this.call(
                                        "peko.cancel",
                                        json!({"sessionId":this.session}),
                                        Reply::Ordinary,
                                    );
                                    this.native_command(Command::Cancel);
                                }))
                                .into_any_element()
                        } else {
                            button("send", "发送 ↵")
                                .bg(rgb(0x526e62))
                                .on_click(cx.listener(|this, _, window, cx| {
                                    this.send(&SendMessage, window, cx)
                                }))
                                .into_any_element()
                        }),
                );
            }
            Tab::Memory => {
                body = body.child(
                    button(
                        "clear-memory",
                        if self.clear_memory_armed {
                            "确认忘记所有记忆"
                        } else {
                            "清空所有记忆"
                        },
                    )
                    .on_click(cx.listener(|this, _, _, cx| {
                        if this.clear_memory_armed {
                            this.call("peko.memory", json!({"action":"clear"}), Reply::Memories);
                            this.clear_memory_armed = false;
                        } else {
                            this.clear_memory_armed = true;
                        }
                        cx.notify();
                    })),
                );
                body = body.child(
                    div()
                        .text_sm()
                        .child("只记住明确表达的稳定偏好和重要事项。你随时可以修改或忘记。"),
                );
                body=body.child(button("pause-memory",if self.settings["memoryEnabled"].as_bool().unwrap_or(true){"暂停自动记忆"}else{"恢复自动记忆"}).on_click(cx.listener(|this,_,_,_|this.save(json!({"memoryEnabled":!this.settings["memoryEnabled"].as_bool().unwrap_or(true)})))));
                let mut list = div()
                    .id("memory-list")
                    .flex_1()
                    .min_h_0()
                    .overflow_y_scroll()
                    .flex()
                    .flex_col()
                    .gap_3();
                for m in self.memories.clone() {
                    let id = m["id"].as_str().unwrap_or("").to_string();
                    let edit = id.clone();
                    let text = m["text"].as_str().unwrap_or("").to_string();
                    list = list.child(
                        div()
                            .p_3()
                            .rounded_md()
                            .bg(rgb(0x202a35))
                            .child(text.clone())
                            .child(
                                div()
                                    .text_xs()
                                    .text_color(rgb(0x93a5b7))
                                    .child(m["created"].as_str().unwrap_or("").to_string()),
                            )
                            .child(
                                div()
                                    .flex()
                                    .gap_2()
                                    .mt_2()
                                    .child(button(format!("edit{id}"), "编辑").on_click(
                                        cx.listener(move |this, _, _, cx| {
                                            this.editing = Some(edit.clone());
                                            this.memory_input.update(cx, |i, cx| i.set(&text, cx));
                                        }),
                                    ))
                                    .child(button(format!("forget{id}"), "忘记").on_click(
                                        cx.listener(move |this, _, _, _| {
                                            this.call(
                                                "peko.memory",
                                                json!({"action":"delete","id":id}),
                                                Reply::Memories,
                                            )
                                        }),
                                    )),
                            ),
                    );
                }
                body = body.child(list).child(self.memory_input.clone()).child(
                    button("save-memory", "保存记忆").on_click(cx.listener(|this, _, _, cx| {
                        let text = this.memory_input.read(cx).content.to_string();
                        let p = if let Some(id) = this.editing.take() {
                            json!({"action":"edit","id":id,"text":text})
                        } else {
                            json!({"action":"add","text":text})
                        };
                        this.call("peko.memory", p, Reply::Memories);
                        this.memory_input.update(cx, |i, cx| i.set("", cx));
                    })),
                );
            }
            Tab::Persona => {
                body = body
                    .child(div().text_lg().child("我们怎样相处"))
                    .child(
                        div()
                            .text_sm()
                            .child("人格独立于角色外观。可以粘贴你的完整设定，保存后下一轮生效。"),
                    )
                    .child(self.persona.clone())
                    .child(button("persona-save", "保存人格").on_click(cx.listener(
                        |this, _, _, cx| {
                            let persona = this.persona.read(cx).content.to_string();
                            this.save(json!({"persona":persona}));
                        },
                    )));
                body=body.child(button("proactive",if self.settings["proactive"].as_bool().unwrap_or(true){"主动陪伴已开启 · 点击关闭"}else{"开启适度主动陪伴"}).on_click(cx.listener(|this,_,_,_|this.save(json!({"proactive":!this.settings["proactive"].as_bool().unwrap_or(true)})))));
                let mut frequency = div().flex().gap_2();
                for (minutes, count, label) in [
                    (30, 4, "多聊一点"),
                    (60, 2, "适度陪伴"),
                    (120, 1, "安静陪伴"),
                ] {
                    frequency = frequency.child(
                        button(format!("frequency-{minutes}"), label)
                            .when(
                                self.settings["idleMinutes"].as_i64() == Some(minutes),
                                |s| s.bg(rgb(0x45524f)),
                            )
                            .on_click(cx.listener(move |this, _, _, _| {
                                this.save(json!({"idleMinutes":minutes,"maxDailyGreetings":count}))
                            })),
                    );
                }
                body =
                    body.child(frequency)
                        .child(div().text_sm().text_color(rgb(0x93a5b7)).child(format!(
                        "空闲 {} 分钟后招呼，每日最多 {} 次，{:02}:00—{:02}:00。勿扰期间保持安静。",
                        self.settings["idleMinutes"].as_i64().unwrap_or(60),
                        self.settings["maxDailyGreetings"].as_i64().unwrap_or(2),
                        self.settings["activeStart"].as_i64().unwrap_or(9),
                        self.settings["activeEnd"].as_i64().unwrap_or(22)
                    )));
            }
            Tab::Models => {
                body = body.child(div().text_sm().child(
                    "使用 dsh 已配置的提供方与凭据。选择模型后重新连接，不会重发未完成任务。",
                ));
                for p in self.providers.clone() {
                    body = body.child(
                        div()
                            .mt_3()
                            .text_color(rgb(0xb1c4be))
                            .child(p["id"].as_str().unwrap_or("").to_string()),
                    );
                    for m in p["models"].as_array().unwrap_or(&Vec::new()) {
                        let provider = p["id"].as_str().unwrap_or("").to_string();
                        let model = m["id"].as_str().unwrap_or("").to_string();
                        body = body.child(
                            button(format!("{provider}/{model}"), model.clone()).on_click(
                                cx.listener(move |this, _, _, cx| {
                                    this.provider = provider.clone();
                                    this.model = model.clone();
                                    this.save(json!({"provider":provider,"model":model}));
                                    cx.notify();
                                }),
                            ),
                        );
                    }
                }
                body = body
                    .child(
                        button("reconnect", "重新连接 dsh")
                            .mt_4()
                            .on_click(cx.listener(|this, _, _, cx| {
                                this.connect();
                                cx.notify();
                            })),
                    )
                    .child(div().text_xs().text_color(rgb(0x93a5b7)).child(
                        "同一个 DSH_HOME · peko profile 引用 desktop 配置 · 不存储第二份 API Key",
                    ));
            }
            Tab::Avatar => {
                let mut choices = div().flex().gap_2();
                for (id, label) in [("yumi", "Yumi"), ("bingtang", "冰糖"), ("ellen", "艾莲")] {
                    choices=choices.child(button(format!("avatar-{id}"),label).on_click(cx.listener(move|this,_,_,cx|{this.save(json!({"avatar":id}));this.error="角色选择已保存，重启 PekoPet 后生效；请先运行 npm run assets -- --all 缓存模型。".into();cx.notify();})));
                }
                body = body.child(choices);
                body = body.child(
                    div()
                        .text_lg()
                        .child(format!("{} · 表情预览", self.catalog.name)),
                );
                let mut list = div()
                    .id("avatar-controls")
                    .flex_1()
                    .min_h_0()
                    .overflow_y_scroll()
                    .flex()
                    .flex_col()
                    .gap_2();
                for name in &self.catalog.expressions {
                    let name = name.clone();
                    list = list.child(button(name.clone(), name.clone()).on_click(cx.listener(
                        move |this, _, _, _| {
                            let mut mix = BTreeMap::new();
                            mix.insert(name.clone(), 1.);
                            this.native_command(Command::Cue(Cue {
                                mix,
                                ..Default::default()
                            }));
                        },
                    )));
                }
                for name in &self.catalog.motions {
                    let name = name.clone();
                    list = list.child(
                        button(format!("motion{name}"), format!("动作 · {name}")).on_click(
                            cx.listener(move |this, _, _, _| {
                                this.native_command(Command::Cue(Cue {
                                    motion: Some(name.clone()),
                                    ..Default::default()
                                }))
                            }),
                        ),
                    );
                }
                for name in &self.catalog.layers {
                    let on = name.clone();
                    let off = name.clone();
                    list = list.child(
                        div()
                            .flex()
                            .gap_2()
                            .child(
                                button(format!("on{name}"), format!("开启 · {name}")).on_click(
                                    cx.listener(move |this, _, _, _| {
                                        this.native_command(Command::Cue(Cue {
                                            layers: BTreeMap::from([(on.clone(), true)]),
                                            ..Default::default()
                                        }))
                                    }),
                                ),
                            )
                            .child(button(format!("off{name}"), "关闭").on_click(cx.listener(
                                move |this, _, _, _| {
                                    this.native_command(Command::Cue(Cue {
                                        layers: BTreeMap::from([(off.clone(), false)]),
                                        ..Default::default()
                                    }))
                                },
                            ))),
                    );
                }
                for p in self.catalog.parameters.clone() {
                    let value = *self.debug_parameters.get(&p.id).unwrap_or(&p.default);
                    let minus = p.clone();
                    let plus = p.clone();
                    list = list.child(
                        div()
                            .flex()
                            .items_center()
                            .justify_between()
                            .child(div().text_xs().child(format!(
                                "{}  {:.2}  [{:.2}, {:.2}]",
                                p.id, value, p.min, p.max
                            )))
                            .child(
                                div()
                                    .flex()
                                    .gap_2()
                                    .child(button(format!("minus{}", p.id), "−").on_click(
                                        cx.listener(move |this, _, _, cx| {
                                            let v = this
                                                .debug_parameters
                                                .entry(minus.id.clone())
                                                .or_insert(minus.default);
                                            *v =
                                                (*v - (minus.max - minus.min) / 20.).max(minus.min);
                                            let value = *v;
                                            this.native_command(Command::Cue(Cue {
                                                params: BTreeMap::from([(minus.id.clone(), value)]),
                                                hold: Some(60000),
                                                ..Default::default()
                                            }));
                                            cx.notify();
                                        }),
                                    ))
                                    .child(button(format!("plus{}", p.id), "＋").on_click(
                                        cx.listener(move |this, _, _, cx| {
                                            let v = this
                                                .debug_parameters
                                                .entry(plus.id.clone())
                                                .or_insert(plus.default);
                                            *v = (*v + (plus.max - plus.min) / 20.).min(plus.max);
                                            let value = *v;
                                            this.native_command(Command::Cue(Cue {
                                                params: BTreeMap::from([(plus.id.clone(), value)]),
                                                hold: Some(60000),
                                                ..Default::default()
                                            }));
                                            cx.notify();
                                        }),
                                    )),
                            ),
                    );
                }
                list = list.child(button("clear-avatar", "恢复默认表现").on_click(cx.listener(
                    |this, _, _, _| {
                        this.native_command(Command::Cue(Cue {
                            clear: true,
                            ..Default::default()
                        }))
                    },
                )));
                body=body.child(list).child(button("pet-through","切换鼠标穿透").on_click(cx.listener(|this,_,_,_|this.save(json!({"clickThrough":!this.settings["clickThrough"].as_bool().unwrap_or(false)})))));
                let mut series = self.latencies.clone();
                series.sort_by(f64::total_cmp);
                let p95 = if series.is_empty() {
                    0.
                } else {
                    series[((series.len() as f64 * 0.95).ceil() as usize).saturating_sub(1)]
                };
                body = body.child(div().text_xs().child(format!(
                    "表情处理到帧提交 P95 {p95:.1} ms · {} 次 · 首正文 {:.0} ms",
                    series.len(),
                    self.first_token_ms.unwrap_or(0.)
                )));
            }
        }
        div()
            .key_context("Peko")
            .on_action(cx.listener(Self::send))
            .size_full()
            .flex()
            .bg(rgb(0x151b23))
            .text_color(rgb(0xe8eef3))
            .font_family("Microsoft YaHei UI")
            .child(sidebar)
            .child(body)
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
    Application::new().run(move |cx: &mut App| {
        input::bind(cx);
        cx.bind_keys([KeyBinding::new("enter", SendMessage, Some("Peko"))]);
        let bounds = Bounds::centered(None, size(px(1000.), px(760.)), cx);
        cx.open_window(
            WindowOptions {
                focus: false,
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
