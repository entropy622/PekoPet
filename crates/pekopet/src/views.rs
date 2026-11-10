use super::*;
use crate::ui::surface;
use crate::ui::{self, *};

impl Tab {
    fn title(self) -> &'static str {
        match self {
            Self::Chat => "聊聊天，做点事",
            Self::Memory => "我们记得的事",
            Self::Persona => "舒服的相处方式",
            Self::Models => "连接你的工作伙伴",
            Self::Avatar => "让每个表情都刚刚好",
        }
    }
    fn detail(self) -> &'static str {
        match self {
            Self::Chat => "日常的碎碎念，和手头的小目标，都可以放在这里。",
            Self::Memory => "留住重要的小事，也随时拥有忘记的自由。",
            Self::Persona => "让 Peko 更懂你的节奏。人格与角色外观分别设置。",
            Self::Models => "沿用 dsh 的模型、工具与配置。",
            Self::Avatar => "预览表情、动作与道具，微调角色的真实参数。",
        }
    }
}

impl View {
    fn sidebar(&mut self, window: &mut Window, cx: &mut Context<Self>) -> Div {
        let mut navigation = div().flex().flex_col().gap_2();
        for (tab, name, glyph) in [
            (Tab::Chat, "聊天与工作", "chat"),
            (Tab::Memory, "共同记忆", "memory"),
            (Tab::Persona, "相处方式", "heart"),
            (Tab::Models, "模型与连接", "connect"),
            (Tab::Avatar, "角色调试", "sliders"),
        ] {
            let selected = self.tab == tab;
            navigation = navigation.child(
                ui::button(format!("nav-{name}"), name, window, cx)
                    .h(px(52.))
                    .w_full()
                    .justify_start()
                    .flex_row_reverse()
                    .justify_end()
                    .gap_3()
                    .bg(rgb(if selected { LAVENDER } else { CLOUD }))
                    .text_color(rgb(if selected { PRIMARY } else { MUTED }))
                    .child(icon(glyph))
                    .on_click(cx.listener(move |this, _, _, cx| {
                        this.tab = tab;
                        this.notice.clear();
                        if tab == Tab::Memory {
                            this.call("peko.memory", json!({}), Reply::Memories);
                        }
                        cx.notify();
                    })),
            );
        }
        let mut recent = div()
            .id("recent-sessions")
            .flex_1()
            .min_h_0()
            .overflow_y_scroll()
            .flex()
            .flex_col()
            .gap_2();
        if self.sessions.is_empty() {
            recent = recent.child(caption("新故事，从今天开始。").px_3().py_4());
        }
        for session in self.sessions.iter().take(16) {
            let id = session["id"].as_str().unwrap_or("").to_owned();
            let cwd = session["cwd"].as_str().unwrap_or("").to_owned();
            let title: String = session["title"]
                .as_str()
                .unwrap_or("新对话")
                .chars()
                .take(20)
                .collect();
            recent = recent.child(
                ui::button(id.clone(), title, window, cx)
                    .w_full()
                    .justify_start()
                    .text_size(px(12.))
                    .font_weight(FontWeight::NORMAL)
                    .bg(rgb(if self.session == id { LAVENDER } else { CLOUD }))
                    .text_color(rgb(MUTED))
                    .on_click(cx.listener(move |this, _, _, cx| {
                        if !this.busy && this.session != id {
                            this.session = id.clone();
                            this.cwd = cwd.clone();
                            this.call("peko.open", json!({"sessionId":id}), Reply::Ordinary);
                            this.call("peko.history", json!({"sessionId":id}), Reply::History);
                            this.tab = Tab::Chat;
                        }
                        cx.notify();
                    })),
            );
        }
        let dnd = self.settings["dnd"].as_bool().unwrap_or(false);
        div()
            .w(px(228.))
            .flex_none()
            .p_5()
            .rounded(px(28.))
            .bg(rgb(CLOUD))
            .flex()
            .flex_col()
            .gap_4()
            .shadow(glow(0.06, 10., 32.))
            .child(
                div()
                    .flex()
                    .items_center()
                    .gap_3()
                    .mb_3()
                    .child(mark(44.))
                    .child(
                        div()
                            .flex()
                            .flex_col()
                            .gap_1()
                            .child(
                                div()
                                    .font_family("Segoe UI")
                                    .font_weight(FontWeight::SEMIBOLD)
                                    .text_size(px(22.))
                                    .child("PekoPet"),
                            )
                            .child(caption("有表情，也有记性")),
                    ),
            )
            .child(navigation)
            .child(caption("最近的故事").mt_3().px_3())
            .child(recent)
            .child(
                div()
                    .rounded(px(20.))
                    .bg(rgb(CANVAS))
                    .p_4()
                    .flex()
                    .flex_col()
                    .gap_3()
                    .child(
                        div()
                            .flex()
                            .items_center()
                            .gap_2()
                            .text_color(rgb(PRIMARY))
                            .child(icon("moon"))
                            .child(div().text_size(px(14.)).child("留一点安静")),
                    )
                    .child(
                        ui::button("dnd", if dnd { "勿扰中" } else { "勿扰模式" }, window, cx)
                            .w_full()
                            .justify_between()
                            .bg(rgb(CLOUD))
                            .text_color(rgb(MUTED))
                            .child(toggle(dnd))
                            .on_click(cx.listener(|this, _, _, _| {
                                this.save(
                                    json!({"dnd":!this.settings["dnd"].as_bool().unwrap_or(false)}),
                                )
                            })),
                    ),
            )
    }

    fn header(&mut self, window: &mut Window, cx: &mut Context<Self>) -> Div {
        let (status_fg, status_bg) = if !self.connected {
            (AMBER, AMBER_BG)
        } else if self.busy {
            (PRIMARY, LAVENDER)
        } else {
            (MINT, MINT_BG)
        };
        div()
            .flex()
            .justify_between()
            .items_center()
            .gap_4()
            .flex_shrink_0()
            .child(
                div()
                    .flex()
                    .flex_col()
                    .gap_2()
                    .min_w_0()
                    .child(caption("PEKO / 你的桌面搭档"))
                    .child(
                        div()
                            .text_size(px(28.))
                            .font_weight(FontWeight::SEMIBOLD)
                            .child(self.tab.title()),
                    )
                    .child(
                        div()
                            .text_size(px(14.))
                            .text_color(rgb(MUTED))
                            .child(self.tab.detail()),
                    ),
            )
            .child(
                div()
                    .flex()
                    .flex_col()
                    .items_end()
                    .gap_3()
                    .flex_shrink_0()
                    .child(badge(self.status.clone(), status_fg, status_bg))
                    .child(
                        ui::primary("new", "新对话", window, cx)
                            .child(icon("plus"))
                            .when(self.busy, |s| s.opacity(0.5).cursor_default())
                            .on_click(cx.listener(|this, _, _, cx| {
                                if !this.busy {
                                    this.new_session();
                                    this.tab = Tab::Chat;
                                }
                                cx.notify();
                            })),
                    ),
            )
    }

    fn welcome(&mut self, window: &mut Window, cx: &mut Context<Self>) -> Div {
        let mut suggestions = div().flex().flex_wrap().justify_center().gap_3().mt_3();
        for (id, label, text) in [
            ("talk", "聊聊今天", "今天想和你随便聊聊。"),
            (
                "plan",
                "整理思路",
                "帮我梳理一下手头的事情，我们一步一步来。",
            ),
            (
                "work",
                "一起工作",
                "先看看当前项目，告诉我你能帮我做些什么。",
            ),
        ] {
            suggestions =
                suggestions.child(ui::button(id, label, window, cx).bg(rgb(CLOUD)).on_click(
                    cx.listener(move |this, _, window, cx| {
                        this.composer.update(cx, |i, cx| i.set(text, cx));
                        window.focus(&this.composer.focus_handle(cx));
                        cx.notify();
                    }),
                ));
        }
        div()
            .flex_1()
            .flex()
            .flex_col()
            .items_center()
            .justify_center()
            .gap_4()
            .p_6()
            .child(mark(80.))
            .child(
                div()
                    .text_size(px(28.))
                    .font_weight(FontWeight::SEMIBOLD)
                    .child("今天想一起做什么？"),
            )
            .child(
                div()
                    .text_size(px(16.))
                    .text_color(rgb(MUTED))
                    .child("我在这里。陪你聊一会儿，也陪你把事情做好。"),
            )
            .child(suggestions)
    }

    fn chat(&mut self, window: &mut Window, cx: &mut Context<Self>) -> Div {
        let mut page = div().flex_1().min_h_0().flex().flex_col().gap_5();
        let project_name = PathBuf::from(&self.cwd)
            .file_name()
            .map(|s| s.to_string_lossy().into_owned())
            .unwrap_or_else(|| self.cwd.clone());
        page = page.child(
            div()
                .flex()
                .items_center()
                .justify_between()
                .gap_4()
                .px_4()
                .py_3()
                .rounded(px(16.))
                .bg(rgb(CLOUD))
                .child(
                    div()
                        .flex()
                        .items_center()
                        .gap_3()
                        .min_w_0()
                        .text_color(rgb(MUTED))
                        .child(icon("folder"))
                        .child(
                            div()
                                .flex()
                                .flex_col()
                                .gap_1()
                                .min_w_0()
                                .child(
                                    div()
                                        .text_size(px(14.))
                                        .text_color(rgb(INK))
                                        .child(project_name),
                                )
                                .child(caption(self.cwd.clone()).truncate()),
                        ),
                )
                .child(
                    ui::button("cwd", "选择项目", window, cx).on_click(cx.listener(
                        |this, _, _, cx| {
                            this.choose_directory();
                            cx.notify();
                        },
                    )),
                ),
        );
        let mut feed = div()
            .id("feed")
            .flex_1()
            .min_h_0()
            .overflow_y_scroll()
            .flex()
            .flex_col()
            .gap_5()
            .px_1()
            .py_2();
        if self.messages.is_empty() {
            feed = feed.child(self.welcome(window, cx));
        }
        for (index, message) in self.messages.iter().enumerate() {
            let user = message.role == "user";
            let tool = message.role == "tool";
            let text = message.text.clone();
            let name = if user {
                "你"
            } else if tool {
                "工作过程"
            } else {
                "Peko"
            };
            let bubble = div()
                .max_w(relative(0.91))
                .min_w_0()
                .rounded(px(24.))
                .p_5()
                .bg(rgb(if user { LAVENDER } else { CLOUD }))
                .shadow(glow(if user { 0.03 } else { 0.05 }, 6., 24.))
                .child(
                    div()
                        .flex()
                        .items_center()
                        .justify_between()
                        .gap_4()
                        .mb_3()
                        .child(
                            div()
                                .flex()
                                .items_center()
                                .gap_2()
                                .text_color(rgb(if tool { MINT } else { PRIMARY }))
                                .child(
                                    icon(if tool {
                                        "connect"
                                    } else if user {
                                        "heart"
                                    } else {
                                        "spark"
                                    })
                                    .size(px(16.)),
                                )
                                .child(
                                    div()
                                        .text_size(px(12.))
                                        .font_weight(FontWeight::SEMIBOLD)
                                        .child(name),
                                ),
                        )
                        .child(
                            ui::button(format!("copy-{index}"), "复制", window, cx)
                                .py_1()
                                .px_2()
                                .min_h(px(28.))
                                .bg(rgb(if user { LAVENDER } else { CLOUD }))
                                .text_color(rgb(MUTED))
                                .text_size(px(12.))
                                .on_click(move |_, _, cx| {
                                    cx.write_to_clipboard(ClipboardItem::new_string(text.clone()))
                                }),
                        ),
                )
                .child(
                    div()
                        .text_size(px(if tool { 13. } else { 15. }))
                        .line_height(relative(1.65))
                        .text_color(rgb(if tool { MUTED } else { INK }))
                        .child(message.text.clone()),
                );
            feed = feed.child(
                div()
                    .flex()
                    .w_full()
                    .when(user, |s| s.justify_end())
                    .child(bubble),
            );
        }
        if self.busy {
            feed = feed.child(
                div()
                    .flex()
                    .items_center()
                    .gap_3()
                    .p_4()
                    .text_color(rgb(PRIMARY))
                    .child(icon("spark"))
                    .child(caption(self.status.clone())),
            );
        }
        page = page.child(feed);
        if !self.approvals.is_empty() {
            page = page.child(self.approval_cards(window, cx));
        }
        let send = if self.busy {
            ui::button("stop", "停止任务", window, cx)
                .bg(rgb(ROSE_BG))
                .text_color(rgb(ROSE))
                .child(icon("stop"))
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
            ui::primary("send", "发送", window, cx)
                .child(icon("send"))
                .when(!self.connected, |s| s.opacity(0.45).cursor_default())
                .on_click(cx.listener(|this, _, window, cx| this.send(&SendMessage, window, cx)))
                .into_any_element()
        };
        page.child(
            surface().p_4().gap_3().child(self.composer.clone()).child(
                div()
                    .flex()
                    .justify_between()
                    .items_center()
                    .gap_4()
                    .px_1()
                    .child(
                        div()
                            .flex()
                            .items_center()
                            .gap_2()
                            .text_color(rgb(MUTED))
                            .child(icon("connect").size(px(14.)))
                            .child(caption(if self.busy {
                                "正在工作，随时可以停下来"
                            } else {
                                "Enter 发送 · 工具与权限由 dsh 管理"
                            })),
                    )
                    .child(send),
            ),
        )
    }

    fn approval_cards(&mut self, window: &mut Window, cx: &mut Context<Self>) -> Stateful<Div> {
        let mut cards = div()
            .id("approvals")
            .max_h(px(300.))
            .overflow_y_scroll()
            .flex()
            .flex_col()
            .gap_4();
        for a in self.approvals.clone() {
            let id = a["id"].as_str().unwrap_or("").to_string();
            let mut card = div()
                .p_5()
                .flex()
                .flex_col()
                .gap_3()
                .rounded(px(24.))
                .bg(rgb(AMBER_BG))
                .child(a["reason"].as_str().unwrap_or("需要你做个决定").to_string());
            if a["kind"] == "approval" {
                let yes = id.clone();
                let no = id.clone();
                card = card.child(
                    div()
                        .flex()
                        .gap_2()
                        .mt_2()
                        .child(
                            ui::button(format!("yes{id}"), "允许这一次", window, cx).on_click(
                                cx.listener(move |this, _, _, _| {
                                    this.answer(&yes, json!("allowed-once"))
                                }),
                            ),
                        )
                        .child(ui::button(format!("no{id}"), "拒绝", window, cx).on_click(
                            cx.listener(move |this, _, _, _| this.answer(&no, json!("rejected"))),
                        )),
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
                            ui::choice(
                                format!("{key}/{label}"),
                                label.clone(),
                                selected,
                                window,
                                cx,
                            )
                            .on_click(cx.listener(
                                move |this, _, _, cx| {
                                    let choices =
                                        this.question_choices.entry(key.clone()).or_default();
                                    if multi {
                                        if let Some(i) = choices.iter().position(|s| s == &label) {
                                            choices.remove(i);
                                        } else {
                                            choices.push(label.clone());
                                        }
                                    } else {
                                        *choices = vec![label.clone()];
                                    }
                                    cx.notify();
                                },
                            )),
                        );
                    }
                    if let Some(input) = self.question_inputs.get(&key) {
                        card = card.child(input.clone());
                    }
                }
                let questions = a["questions"].as_array().cloned().unwrap_or_default();
                let id = id.clone();
                card = card.child(
                    ui::button(format!("submit{id}"), "提交回答", window, cx)
                        .mt_2()
                        .on_click(cx.listener(move |this, _, _, cx| {
                            let mut answers = Vec::new();
                            for q in &questions {
                                let qid = q["id"].as_str().unwrap_or("");
                                let key = format!("{id}/{qid}");
                                let selected =
                                    this.question_choices.get(&key).cloned().unwrap_or_default();
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
                                answers.push(json!({"id":qid,"selected":selected,"custom":custom}));
                            }
                            this.answer(&id, json!({"answers":answers}));
                        })),
                );
            }
            cards = cards.child(card);
        }
        cards
    }

    fn memory_page(&mut self, window: &mut Window, cx: &mut Context<Self>) -> Div {
        let enabled = self.settings["memoryEnabled"].as_bool().unwrap_or(true);
        let mut list = div()
            .id("memory-list")
            .flex_1()
            .min_h_0()
            .overflow_y_scroll()
            .flex()
            .flex_col()
            .gap_5()
            .px_1()
            .py_2();
        if self.memories.is_empty() {
            list = list.child(
                surface()
                    .items_center()
                    .py_8()
                    .child(
                        div()
                            .size(px(56.))
                            .rounded_full()
                            .bg(rgb(ROSE_BG))
                            .text_color(rgb(ROSE))
                            .flex()
                            .items_center()
                            .justify_center()
                            .child(icon("memory")),
                    )
                    .child(heading(
                        "慢慢了解你",
                        "明确说过的偏好与重要事项，会在这里留下来。",
                    )),
            );
        }
        for memory in self.memories.clone() {
            let id = memory["id"].as_str().unwrap_or("").to_owned();
            let edit = id.clone();
            let text = memory["text"].as_str().unwrap_or("").to_owned();
            list = list.child(
                surface()
                    .gap_3()
                    .child(
                        div()
                            .text_size(px(16.))
                            .line_height(relative(1.65))
                            .child(text.clone()),
                    )
                    .child(caption(
                        memory["created"]
                            .as_str()
                            .unwrap_or("")
                            .chars()
                            .take(10)
                            .collect::<String>(),
                    ))
                    .child(
                        div()
                            .flex()
                            .gap_3()
                            .child(
                                ui::button(format!("edit-{id}"), "编辑", window, cx).on_click(
                                    cx.listener(move |this, _, _, cx| {
                                        this.editing = Some(edit.clone());
                                        this.memory_input.update(cx, |i, cx| i.set(&text, cx));
                                        cx.notify();
                                    }),
                                ),
                            )
                            .child(
                                ui::button(format!("forget-{id}"), "忘记这件事", window, cx)
                                    .bg(rgb(ROSE_BG))
                                    .text_color(rgb(ROSE))
                                    .on_click(cx.listener(move |this, _, _, _| {
                                        this.call(
                                            "peko.memory",
                                            json!({"action":"delete","id":id}),
                                            Reply::Memories,
                                        )
                                    })),
                            ),
                    ),
            );
        }
        div().flex_1().min_h_0().flex().flex_col().gap_5()
            .child(surface().flex_row().items_center().justify_between().gap_4()
                .child(heading("自动记忆",if enabled{"记住你明确表达的偏好和重要事项"}else{"已暂停，之后的新消息暂不自动记录"}))
                .child(ui::button("memory-toggle",if enabled{"记录中"}else{"已暂停"},window,cx).child(toggle(enabled))
                    .on_click(cx.listener(|this,_,_,_|this.save(json!({"memoryEnabled":!this.settings["memoryEnabled"].as_bool().unwrap_or(true)}))))))
            .child(list)
            .child(surface().gap_3().child(caption(if self.editing.is_some(){"编辑这条记忆"}else{"也可以亲手留下一件事"})).child(self.memory_input.clone())
                .child(div().flex().justify_between().items_center().gap_3()
                    .child(ui::button("clear-memory",if self.clear_memory_armed{"确认清空全部"}else{"清空记忆"},window,cx).bg(rgb(ROSE_BG)).text_color(rgb(ROSE)).on_click(cx.listener(|this,_,_,cx|{
                        if this.clear_memory_armed{this.call("peko.memory",json!({"action":"clear"}),Reply::Memories);this.clear_memory_armed=false;}else{this.clear_memory_armed=true;}cx.notify();})))
                    .child(ui::primary("save-memory","保存记忆",window,cx).on_click(cx.listener(|this,_,_,cx|{
                        let text=this.memory_input.read(cx).content.to_string();if text.trim().is_empty(){return;}let params=if let Some(id)=this.editing.take(){json!({"action":"edit","id":id,"text":text})}else{json!({"action":"add","text":text})};this.call("peko.memory",params,Reply::Memories);this.memory_input.update(cx,|i,cx|i.set("",cx));cx.notify();})))))
    }

    fn persona_page(&mut self, window: &mut Window, cx: &mut Context<Self>) -> Stateful<Div> {
        let proactive = self.settings["proactive"].as_bool().unwrap_or(true);
        let mut frequency = div().flex().flex_wrap().gap_3();
        for (minutes, count, label) in [
            (30, 4, "多聊一点"),
            (60, 2, "适度陪伴"),
            (120, 1, "安静陪伴"),
        ] {
            frequency = frequency.child(
                ui::choice(
                    format!("frequency-{minutes}"),
                    label,
                    self.settings["idleMinutes"].as_i64() == Some(minutes),
                    window,
                    cx,
                )
                .on_click(cx.listener(move |this, _, _, _| {
                    this.save(json!({"idleMinutes":minutes,"maxDailyGreetings":count}))
                })),
            );
        }
        div().id("persona-page").flex_1().min_h_0().overflow_y_scroll().flex().flex_col().gap_6().px_1().py_2()
            .child(surface().child(heading("Peko 是怎样的伙伴？","编辑人格设定，保存后从下一轮对话生效。"))
                .child(div().rounded(px(16.)).bg(rgb(CANVAS)).p_5().text_size(px(15.)).line_height(relative(1.65)).child(self.persona.read(cx).content.clone()))
                .child(self.persona.clone())
                .child(div().flex().justify_end().child(ui::primary("persona-save","保存人格",window,cx).child(icon("check")).on_click(cx.listener(|this,_,_,cx|{let persona=this.persona.read(cx).content.to_string();this.call("peko.settings",json!({"patch":{"persona":persona}}),Reply::SettingsSaved("人格已保存，下一轮对话生效"));})))))
            .child(surface().child(div().flex().justify_between().items_center().gap_4().child(heading("陪伴，也留白","在你空闲的时候，偶尔来打个招呼。"))
                .child(ui::button("proactive",if proactive{"已开启"}else{"已关闭"},window,cx).child(toggle(proactive)).on_click(cx.listener(|this,_,_,_|this.save(json!({"proactive":!this.settings["proactive"].as_bool().unwrap_or(true)}))))))
                .child(frequency).child(caption(format!("空闲 {} 分钟后招呼 · 每日最多 {} 次 · {:02}:00—{:02}:00",
                    self.settings["idleMinutes"].as_i64().unwrap_or(60),self.settings["maxDailyGreetings"].as_i64().unwrap_or(2),self.settings["activeStart"].as_i64().unwrap_or(9),self.settings["activeEnd"].as_i64().unwrap_or(22))))
                .child(caption("开启侧栏的勿扰模式后，Peko 会保持安静。")))
    }

    fn models_page(&mut self, window: &mut Window, cx: &mut Context<Self>) -> Div {
        let mut models = div()
            .id("models")
            .flex_1()
            .min_h_0()
            .overflow_y_scroll()
            .flex()
            .flex_col()
            .gap_6()
            .px_1()
            .py_2();
        if self.providers.is_empty() {
            models = models.child(surface().child(heading(
                "还没有可用的模型",
                "在 dsh desktop 中添加提供方和模型，然后重新连接。",
            )));
        }
        for provider in self.providers.clone() {
            let mut options = div().flex().flex_wrap().gap_3();
            let provider_id = provider["id"].as_str().unwrap_or("").to_owned();
            for model in provider["models"].as_array().unwrap_or(&Vec::new()) {
                let p = provider_id.clone();
                let m = model["id"].as_str().unwrap_or("").to_owned();
                let selected = self.provider == p && self.model == m;
                options = options.child(
                    ui::choice(format!("model-{p}/{m}"), m.clone(), selected, window, cx)
                        .when(selected, |s| s.child(icon("check").size(px(16.))))
                        .on_click(cx.listener(move |this, _, _, cx| {
                            this.provider = p.clone();
                            this.model = m.clone();
                            this.save(json!({"provider":p,"model":m}));
                            cx.notify();
                        })),
                );
            }
            models = models.child(
                surface()
                    .child(
                        div()
                            .flex()
                            .items_center()
                            .gap_3()
                            .text_color(rgb(PRIMARY))
                            .child(icon("connect"))
                            .child(
                                div()
                                    .text_size(px(20.))
                                    .font_weight(FontWeight::SEMIBOLD)
                                    .text_color(rgb(INK))
                                    .child(provider_id),
                            ),
                    )
                    .child(options),
            );
        }
        let home = std::env::var("DSH_HOME").unwrap_or_else(|_| {
            format!("{}\\.dsh", std::env::var("USERPROFILE").unwrap_or_default())
        });
        div()
            .flex_1()
            .min_h_0()
            .flex()
            .flex_col()
            .gap_5()
            .child(models)
            .child(
                surface()
                    .gap_3()
                    .child(
                        div()
                            .flex()
                            .items_center()
                            .justify_between()
                            .gap_4()
                            .child(heading(
                                "共享 dsh desktop",
                                format!("{} / {}", self.provider, self.model),
                            ))
                            .child(
                                ui::primary("reconnect", "重新连接", window, cx)
                                    .child(icon("connect"))
                                    .on_click(cx.listener(|this, _, _, cx| {
                                        this.connect();
                                        cx.notify();
                                    })),
                            ),
                    )
                    .child(caption(home))
                    .child(caption(
                        "peko profile 引用 desktop 配置 · 不重复保存凭据 · 重连不会重发任务",
                    )),
            )
    }

    fn avatar_page(&mut self, window: &mut Window, cx: &mut Context<Self>) -> Div {
        let mut choices = div().flex().gap_3().flex_wrap();
        for (id, name) in [("yumi", "Yumi"), ("bingtang", "冰糖"), ("ellen", "艾莲")] {
            choices = choices.child(
                ui::choice(
                    format!("avatar-{id}"),
                    name,
                    self.settings["avatar"].as_str() == Some(id),
                    window,
                    cx,
                )
                .on_click(cx.listener(move |this, _, _, cx| {
                    this.call(
                        "peko.settings",
                        json!({"patch":{"avatar":id}}),
                        Reply::SettingsSaved("角色已保存，重启后生效。请先缓存该角色的模型文件。"),
                    );
                    cx.notify();
                })),
            );
        }
        let mut expressions = div().flex().flex_wrap().gap_3();
        for name in self.catalog.expressions.clone() {
            expressions = expressions.child(
                ui::button(format!("expression-{name}"), name.clone(), window, cx).on_click(
                    cx.listener(move |this, _, _, _| {
                        this.native_command(Command::Cue(Cue {
                            mix: BTreeMap::from([(name.clone(), 1.)]),
                            ..Default::default()
                        }));
                    }),
                ),
            );
        }
        let mut motions = div().flex().flex_wrap().gap_3();
        for name in self.catalog.motions.clone() {
            motions = motions.child(
                ui::button(format!("motion-{name}"), name.clone(), window, cx).on_click(
                    cx.listener(move |this, _, _, _| {
                        this.native_command(Command::Cue(Cue {
                            motion: Some(name.clone()),
                            ..Default::default()
                        }))
                    }),
                ),
            );
        }
        let mut layers = div().flex().flex_col().gap_4();
        for name in self.catalog.layers.clone() {
            let on = name.clone();
            let off = name.clone();
            layers = layers.child(
                div()
                    .flex()
                    .items_center()
                    .justify_between()
                    .gap_4()
                    .child(div().text_size(px(14.)).child(name.clone()))
                    .child(
                        div()
                            .flex()
                            .gap_3()
                            .child(
                                ui::button(format!("layer-on-{name}"), "开启", window, cx)
                                    .on_click(cx.listener(move |this, _, _, _| {
                                        this.native_command(Command::Cue(Cue {
                                            layers: BTreeMap::from([(on.clone(), true)]),
                                            ..Default::default()
                                        }))
                                    })),
                            )
                            .child(
                                ui::button(format!("layer-off-{name}"), "关闭", window, cx)
                                    .bg(rgb(CANVAS))
                                    .text_color(rgb(MUTED))
                                    .on_click(cx.listener(move |this, _, _, _| {
                                        this.native_command(Command::Cue(Cue {
                                            layers: BTreeMap::from([(off.clone(), false)]),
                                            ..Default::default()
                                        }))
                                    })),
                            ),
                    ),
            );
        }
        let mut parameters = div().flex().flex_col().gap_4();
        for p in self.catalog.parameters.clone() {
            let value = *self.debug_parameters.get(&p.id).unwrap_or(&p.default);
            let mut controls = div().flex().gap_3();
            for (direction, label) in [(-1., "−"), (1., "＋")] {
                let parameter = p.clone();
                controls = controls.child(
                    ui::button(format!("parameter-{}-{direction}", p.id), label, window, cx)
                        .w(px(44.))
                        .px_2()
                        .on_click(cx.listener(move |this, _, _, cx| {
                            let value = this
                                .debug_parameters
                                .entry(parameter.id.clone())
                                .or_insert(parameter.default);
                            *value = (*value + direction * (parameter.max - parameter.min) / 20.)
                                .clamp(parameter.min, parameter.max);
                            let v = *value;
                            this.native_command(Command::Cue(Cue {
                                params: BTreeMap::from([(parameter.id.clone(), v)]),
                                hold: Some(60000),
                                ..Default::default()
                            }));
                            cx.notify();
                        })),
                );
            }
            parameters = parameters.child(
                div()
                    .flex()
                    .justify_between()
                    .items_center()
                    .gap_4()
                    .child(
                        div()
                            .flex()
                            .flex_col()
                            .gap_1()
                            .child(
                                div()
                                    .text_size(px(14.))
                                    .child(format!("{}  {value:.2}", p.id)),
                            )
                            .child(caption(format!("范围 {:.2} 至 {:.2}", p.min, p.max))),
                    )
                    .child(controls),
            );
        }
        let mut list = div()
            .id("avatar-controls")
            .flex_1()
            .min_h_0()
            .overflow_y_scroll()
            .flex()
            .flex_col()
            .gap_6()
            .px_1()
            .py_2()
            .child(
                surface()
                    .child(heading("选择外观", "固定角色目录 · 更换后重启生效"))
                    .child(choices),
            )
            .child(
                surface()
                    .child(heading(
                        format!("{} 的表情", self.catalog.name),
                        "点击预览，情绪会平滑回落。",
                    ))
                    .child(expressions),
            );
        if !self.catalog.motions.is_empty() {
            list = list.child(
                surface()
                    .child(heading("小动作", "保留模型原有的动作表现。"))
                    .child(motions),
            );
        }
        if !self.catalog.layers.is_empty() {
            list = list.child(
                surface()
                    .child(heading("姿势与道具", "跨回复保留，直到你明确关闭。"))
                    .child(layers),
            );
        }
        list = list.child(
            surface()
                .child(heading(
                    "参数微调",
                    "按照模型的实际范围调整，每次变化为范围的 5%。",
                ))
                .child(parameters),
        );
        let through = self.settings["clickThrough"].as_bool().unwrap_or(false);
        let mut series = self.latencies.clone();
        series.sort_by(f64::total_cmp);
        let latency = if series.is_empty() {
            "等待流式表情采样".to_string()
        } else {
            format!(
                "本地 P95 {:.1} ms · {} 次",
                series[((series.len() as f64 * 0.95).ceil() as usize).saturating_sub(1)],
                series.len()
            )
        };
        div().flex_1().min_h_0().flex().flex_col().gap_5().child(list)
            .child(surface().p_4().gap_3().child(div().flex().justify_between().items_center().gap_3()
                .child(ui::button("pet-through",if through{"穿透已开启"}else{"鼠标穿透"},window,cx).child(toggle(through)).on_click(cx.listener(|this,_,_,_|this.save(json!({"clickThrough":!this.settings["clickThrough"].as_bool().unwrap_or(false)})))))
                .child(ui::button("clear-avatar","恢复默认表现",window,cx).on_click(cx.listener(|this,_,_,_|this.native_command(Command::Cue(Cue{clear:true,..Default::default()}))))))
                .child(caption(format!("{latency} · 首 token {}",self.first_token_ms.map(|v|format!("{v:.0} ms")).unwrap_or_else(||"等待回复".into())))))
    }
}

impl Render for View {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let sidebar = self.sidebar(window, cx);
        let mut body = div()
            .flex_1()
            .min_w_0()
            .min_h_0()
            .flex()
            .flex_col()
            .gap_6()
            .p_4()
            .child(self.header(window, cx));
        if !self.error.is_empty() {
            body = body.child(
                div()
                    .rounded(px(16.))
                    .px_5()
                    .py_4()
                    .bg(rgb(ROSE_BG))
                    .text_color(rgb(ROSE))
                    .text_size(px(14.))
                    .child(self.error.clone()),
            );
        }
        if !self.notice.is_empty() {
            body = body.child(
                div()
                    .rounded(px(16.))
                    .px_5()
                    .py_3()
                    .bg(rgb(MINT_BG))
                    .text_color(rgb(MINT))
                    .text_size(px(14.))
                    .child(self.notice.clone()),
            );
        }
        for reminder in self.reminders.clone() {
            let id = reminder["sessionId"].as_str().unwrap_or("").to_owned();
            body = body.child(
                ui::button(
                    format!("reminder-{id}"),
                    if self.busy {
                        "到期提醒 · 当前任务结束后查看"
                    } else {
                        "有一条到期提醒 · 查看对话"
                    },
                    window,
                    cx,
                )
                .bg(rgb(AMBER_BG))
                .text_color(rgb(AMBER))
                .justify_start()
                .child(icon("clock"))
                .on_click(cx.listener(move |this, _, _, cx| {
                    if this.busy {
                        return;
                    }
                    this.session = id.clone();
                    if let Some(s) = this.sessions.iter().find(|s| s["id"] == id) {
                        this.cwd = s["cwd"].as_str().unwrap_or(&this.cwd).to_owned();
                    }
                    this.call("peko.open", json!({"sessionId":id}), Reply::Ordinary);
                    this.call("peko.history", json!({"sessionId":id}), Reply::History);
                    this.reminders.retain(|r| r["sessionId"] != id);
                    this.tab = Tab::Chat;
                    cx.notify();
                })),
            );
        }
        let page = match self.tab {
            Tab::Chat => self.chat(window, cx),
            Tab::Memory => self.memory_page(window, cx),
            Tab::Persona => div()
                .flex_1()
                .min_h_0()
                .flex()
                .flex_col()
                .child(self.persona_page(window, cx)),
            Tab::Models => self.models_page(window, cx),
            Tab::Avatar => self.avatar_page(window, cx),
        };
        body = body.child(page);
        div()
            .key_context("Peko")
            .on_action(cx.listener(Self::send))
            .size_full()
            .p_4()
            .flex()
            .gap_4()
            .bg(rgb(CANVAS))
            .font_family("Microsoft YaHei UI")
            .text_size(px(14.))
            .text_color(rgb(INK))
            .child(sidebar)
            .child(body)
    }
}
