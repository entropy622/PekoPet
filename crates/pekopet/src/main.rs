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
        self.rpc.take();
        self.connected = false;
        self.busy = false;
        self.pending.clear();
        self.approvals.clear();
        self.error.clear();
        match rpc::Rpc::start(self.root.clone(), self.tx.clone()) {
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
            let _ = p.tx.send(command);
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
        self.call("session/prompt",json!({"sessionId":self.session,"contentBlocks":[{"type":"text","text":text}],"avatar":self.catalog}),Reply::Ordinary);
        cx.notify();
    }
    fn outputs(&mut self, out: Vec<Output>) {
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
                    Ok(()) => self.native_command(Command::Cue(cue)),
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
                            native::default_model(),
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
                            text: visible_text(m["text"].as_str().unwrap_or("")),
                        })
                        .collect();
                }
                Reply::Ordinary => {}
            }
            return;
        }
        let p = &e["params"];
        match e["method"].as_str().unwrap_or("") {
            "peko.stream" if p["sessionId"].as_str() == Some(&self.session) => {
                let f = &p["frame"];
                let attempt = f["attemptId"].as_str().unwrap_or("");
                let rev = f["revision"].as_u64().unwrap_or(0);
                match f["type"].as_str().unwrap_or("") {
                    "start" => {
                        if self.cursor.start(attempt, rev) {
                            self.parsers.clear();
                            self.current_text = None;
                        }
                    }
                    "chunk" => {
                        match self
                            .cursor
                            .accept(attempt, rev, f["index"].as_u64().unwrap_or(0))
                        {
                            Ok(true) => {
                                let c = &f["chunk"];
                                match c["type"].as_str().unwrap_or("") {
                                    "text-delta" => {
                                        let out = self
                                            .parsers
                                            .entry(c["index"].as_u64().unwrap_or(0))
                                            .or_default()
                                            .push(c["text"].as_str().unwrap_or(""));
                                        self.outputs(out);
                                    }
                                    "tool-call-delta" => {
                                        self.status = format!(
                                            "正在工作 · {}",
                                            c["name"].as_str().unwrap_or("工具")
                                        )
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
                        let out: Vec<_> =
                            self.parsers.values_mut().flat_map(|p| p.finish()).collect();
                        self.outputs(out);
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
            }
            "session.status" if p["sessionId"].as_str() == Some(&self.session) => {
                self.busy = p["status"] == "running";
                if !self.busy {
                    self.status = "在你身边".into();
                    self.call("peko.sessions", json!({}), Reply::Sessions);
                }
            }
            "peko.approval" => {
                self.approvals.push(p.clone());
                self.status = "等你决定".into();
                native::show_chat(self.chat_hwnd, true);
            }
            "peko.withdraw" => self.approvals.retain(|a| a["id"] != p["id"]),
            "peko.memory.changed" => {
                self.memories = p["memories"].as_array().cloned().unwrap_or_default()
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
                        this.call("session/resume", json!({"sessionId":id}), Reply::Ordinary);
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
                            .child(
                                div()
                                    .mb_2()
                                    .text_xs()
                                    .text_color(rgb(0xb1c4be))
                                    .child(if m.role == "user" { "你" } else { "Peko" }),
                            )
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
                            card = card.child(q["question"].as_str().unwrap_or("").to_string());
                            for o in q["options"].as_array().unwrap_or(&Vec::new()) {
                                let label = o["label"].as_str().unwrap_or("").to_string();
                                let question = q["id"].as_str().unwrap_or("").to_string();
                                let id = id.clone();
                                card = card.child(
                                    button(format!("{id}{question}{label}"), label.clone())
                                        .on_click(cx.listener(move |this, _, _, _| {
                                            this.answer(
                                            &id,
                                            json!({"answers":[{"id":question,"selected":[label]}]}),
                                        )
                                        })),
                                );
                            }
                        }
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
                body=body.child(button("proactive",if self.settings["proactive"].as_bool().unwrap_or(true){"主动陪伴已开启 · 点击关闭"}else{"开启适度主动陪伴"}).on_click(cx.listener(|this,_,_,_|this.save(json!({"proactive":!this.settings["proactive"].as_bool().unwrap_or(true)}))))).child(div().text_sm().text_color(rgb(0x93a5b7)).child("默认空闲 60 分钟后轻声招呼，每日最多两次，09:00—22:00。勿扰期间保持安静。"));
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
                    native::show_chat(hwnd, false);
                    false
                });
                cx.new(|cx| View::new(root, hwnd, cx))
            },
        )
        .expect("打开 GPUI 窗口失败");
    });
}
