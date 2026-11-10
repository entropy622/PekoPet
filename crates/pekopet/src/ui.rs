use gpui::{prelude::*, *};
use std::{
    borrow::Cow,
    time::{Duration, Instant},
};

pub const CANVAS: u32 = 0xf1f5f9;
pub const CLOUD: u32 = 0xffffff;
pub const INK: u32 = 0x1f2937;
pub const MUTED: u32 = 0x64748b;
pub const PRIMARY: u32 = 0x6366f1;
pub const LAVENDER: u32 = 0xeeeeff;
pub const MINT: u32 = 0x168467;
pub const MINT_BG: u32 = 0xe6f5ee;
pub const ROSE: u32 = 0xb94b78;
pub const ROSE_BG: u32 = 0xfcecf2;
pub const AMBER: u32 = 0x98621d;
pub const AMBER_BG: u32 = 0xfff5df;

pub struct Assets;
impl AssetSource for Assets {
    fn load(&self, name: &str) -> anyhow::Result<Option<Cow<'static, [u8]>>> {
        let paths = match name {
            "chat" => {
                "<path d='M21 11.5a8.5 8.5 0 0 1-8.5 8.5H4l-1 2V11.5A8.5 8.5 0 0 1 11.5 3h1A8.5 8.5 0 0 1 21 11.5Z'/><path d='M8 9h8M8 13h5'/>"
            }
            "memory" => {
                "<rect x='4' y='4' width='16' height='17' rx='4'/><path d='M8 2v4m8-4v4M8 11h8m-8 4h5'/>"
            }
            "heart" => {
                "<path d='M20.5 5.5a5 5 0 0 0-7 0L12 7l-1.5-1.5a5 5 0 0 0-7 7L12 21l8.5-8.5a5 5 0 0 0 0-7Z'/>"
            }
            "connect" => "<path d='M8 3v5m8-5v5M6 8h12v3a6 6 0 0 1-12 0V8Zm6 9v5'/>",
            "sliders" => {
                "<path d='M4 6h4m4 0h8M4 12h10m4 0h2M4 18h3m4 0h9'/><circle cx='10' cy='6' r='2'/><circle cx='16' cy='12' r='2'/><circle cx='9' cy='18' r='2'/>"
            }
            "plus" => "<path d='M12 5v14M5 12h14'/>",
            "send" => "<path d='m21 3-7 18-4-7-7-4 18-7ZM10 14 21 3'/>",
            "folder" => {
                "<path d='M3 8V6a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8Z'/>"
            }
            "moon" => "<path d='M20.5 14A9 9 0 0 1 10 3.5 9 9 0 1 0 20.5 14Z'/>",
            "spark" => "<path d='m12 3 2.7 6.3L21 12l-6.3 2.7L12 21l-2.7-6.3L3 12l6.3-2.7L12 3Z'/>",
            "copy" => {
                "<rect x='8' y='8' width='13' height='13' rx='3'/><path d='M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3'/>"
            }
            "check" => "<path d='m5 12 4 4L19 6'/>",
            "clock" => "<circle cx='12' cy='12' r='9'/><path d='M12 7v5l3 2'/>",
            "arrow" => "<path d='m9 5 7 7-7 7'/>",
            "stop" => "<rect x='6' y='6' width='12' height='12' rx='3'/>",
            "peko" => {
                "<path d='M4 11 3 3l6 4a12 12 0 0 1 6 0l6-4-1 8c3 8-1 11-8 11S1 19 4 11Z'/><path d='M7 13h1m8 0h1m-8 4q3 3 6 0'/>"
            }
            _ => return Ok(None),
        };
        Ok(Some(Cow::Owned(format!("<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='1.7' stroke-linecap='round' stroke-linejoin='round'>{paths}</svg>").into_bytes())))
    }
    fn list(&self, _: &str) -> anyhow::Result<Vec<SharedString>> {
        Ok(Vec::new())
    }
}

pub fn icon(name: &'static str) -> Svg {
    svg().path(name).size(px(20.)).flex_shrink_0()
}
pub fn glow(alpha: f32, offset: f32, blur: f32) -> Vec<BoxShadow> {
    vec![BoxShadow {
        color: Hsla::from(rgb(PRIMARY)).opacity(alpha),
        offset: point(px(0.), px(offset)),
        blur_radius: px(blur),
        spread_radius: px(0.),
    }]
}
pub fn surface() -> Div {
    div()
        .flex()
        .flex_col()
        .gap_4()
        .p_6()
        .rounded(px(24.))
        .bg(rgb(CLOUD))
        .shadow(vec![BoxShadow {
            color: rgba(0x94a3b82e).into(),
            offset: point(px(0.), px(10.)),
            blur_radius: px(32.),
            spread_radius: px(0.),
        }])
}
pub fn caption(text: impl Into<SharedString>) -> Div {
    div()
        .text_size(px(12.))
        .text_color(rgb(MUTED))
        .child(text.into())
}
pub fn heading(title: impl Into<SharedString>, detail: impl Into<SharedString>) -> Div {
    div()
        .flex()
        .flex_col()
        .gap_2()
        .child(
            div()
                .text_size(px(20.))
                .font_weight(FontWeight::SEMIBOLD)
                .child(title.into()),
        )
        .child(
            div()
                .text_size(px(14.))
                .line_height(relative(1.65))
                .text_color(rgb(MUTED))
                .child(detail.into()),
        )
}
pub fn badge(text: impl Into<SharedString>, foreground: u32, background: u32) -> Div {
    div()
        .flex()
        .items_center()
        .gap_2()
        .rounded_full()
        .px_3()
        .py_2()
        .bg(rgb(background))
        .text_color(rgb(foreground))
        .text_size(px(12.))
        .child(text.into())
}
pub fn mark(size: f32) -> Div {
    div()
        .size(px(size))
        .flex_none()
        .rounded(px(size * 0.32))
        .bg(rgb(PRIMARY))
        .text_color(rgb(CLOUD))
        .flex()
        .items_center()
        .justify_center()
        .shadow(glow(0.22, 8., 24.))
        .child(icon("peko").size(px(size * 0.60)))
}
pub fn toggle(on: bool) -> Div {
    div()
        .w(px(44.))
        .h(px(26.))
        .p(px(3.))
        .rounded_full()
        .flex()
        .items_center()
        .bg(rgb(if on { PRIMARY } else { 0xcbd5e1 }))
        .when(on, |s| s.justify_end())
        .child(div().size(px(20.)).rounded_full().bg(rgb(CLOUD)))
}

#[derive(Default)]
struct Hover {
    value: f32,
    generation: u64,
}
fn styled_button(
    id: impl Into<SharedString>,
    label: impl Into<SharedString>,
    filled: bool,
    window: &mut Window,
    cx: &mut App,
) -> Stateful<Div> {
    let id: SharedString = id.into();
    let state = window.use_keyed_state(SharedString::from(format!("hover-{id}")), cx, |_, _| {
        Hover::default()
    });
    let lift = state.read(cx).value;
    div()
        .id(ElementId::Name(id))
        .relative()
        .top(px(-4. * lift))
        .flex()
        .items_center()
        .justify_center()
        .gap_2()
        .px_4()
        .py_3()
        .min_h(px(44.))
        .flex_shrink_0()
        .rounded(px(16.))
        .bg(rgb(if filled { PRIMARY } else { LAVENDER }))
        .text_color(rgb(if filled { CLOUD } else { PRIMARY }))
        .text_size(px(14.))
        .font_weight(FontWeight::MEDIUM)
        .cursor_pointer()
        .shadow(glow(
            if filled {
                0.25 + lift * 0.10
            } else {
                lift * 0.17
            },
            8. + lift * 8.,
            24. + lift * 8.,
        ))
        .hover(move |s| s.bg(rgb(if filled { 0x5558de } else { 0xe4e4ff })))
        .active(move |s| {
            s.top(px(0.))
                .bg(rgb(if filled { 0x4f46c8 } else { 0xd9d9fb }))
                .shadow(glow(0.16, 3., 12.))
        })
        .on_hover(move |hovered, _, cx| {
            let target = if *hovered { 1. } else { 0. };
            state.update(cx, |s, cx| {
                s.generation += 1;
                if crate::native::reduced_motion() {
                    s.value = 0.;
                    cx.notify();
                    return;
                }
                let from = s.value;
                let generation = s.generation;
                cx.spawn(async move |weak, cx| {
                    let started = Instant::now();
                    loop {
                        cx.background_executor()
                            .timer(Duration::from_millis(16))
                            .await;
                        let t = (started.elapsed().as_secs_f32() / 0.3).min(1.);
                        let value = from + (target - from) * ease_in_out(t);
                        if weak
                            .update(cx, |s, cx| {
                                if s.generation != generation {
                                    return false;
                                }
                                s.value = value;
                                cx.notify();
                                true
                            })
                            .unwrap_or(false)
                            == false
                            || t >= 1.
                        {
                            break;
                        }
                    }
                })
                .detach();
            });
        })
        .child(label.into())
}
pub fn primary(
    id: impl Into<SharedString>,
    label: impl Into<SharedString>,
    window: &mut Window,
    cx: &mut App,
) -> Stateful<Div> {
    styled_button(id, label, true, window, cx)
}
pub fn button(
    id: impl Into<SharedString>,
    label: impl Into<SharedString>,
    window: &mut Window,
    cx: &mut App,
) -> Stateful<Div> {
    styled_button(id, label, false, window, cx)
}
pub fn choice(
    id: impl Into<SharedString>,
    label: impl Into<SharedString>,
    selected: bool,
    window: &mut Window,
    cx: &mut App,
) -> Stateful<Div> {
    styled_button(id, label, selected, window, cx)
}
