use anyhow::{Context, Result, bail};
use peko_core::{AvatarState, Catalog, Cue, Parameter};
use serde_json::{Value, json};
use std::{
    collections::BTreeMap,
    ffi::{CStr, CString, c_char, c_void},
    path::{Path, PathBuf},
    sync::mpsc::{self, Sender},
    thread,
    time::{Duration, Instant},
};

#[repr(C)]
#[derive(Clone, Copy, Debug)]
struct Rect {
    x: i32,
    y: i32,
    width: i32,
    height: i32,
    scale: f32,
    topmost: i32,
    through: i32,
    visible: i32,
}
unsafe extern "C" {
    fn peko_create(path: *const c_char, state: Rect) -> *mut c_void;
    fn peko_destroy(p: *mut c_void);
    fn peko_error() -> *const c_char;
    fn peko_texture_count(p: *mut c_void) -> i32;
    fn peko_texture_name(p: *mut c_void, i: i32) -> *const c_char;
    fn peko_texture(p: *mut c_void, i: i32, pixels: *const u8, width: i32, height: i32) -> i32;
    fn peko_parameter_count(p: *mut c_void) -> i32;
    fn peko_parameter_id(p: *mut c_void, i: i32) -> *const c_char;
    fn peko_parameter_info(p: *mut c_void, i: i32, min: *mut f32, max: *mut f32, initial: *mut f32);
    fn peko_reset_targets(p: *mut c_void);
    fn peko_expression(p: *mut c_void, file: *const c_char, weight: f32) -> i32;
    fn peko_parameter(p: *mut c_void, id: *const c_char, value: f32);
    fn peko_motion(p: *mut c_void, file: *const c_char) -> i32;
    fn peko_tick(p: *mut c_void, dt: f32) -> i32;
    fn peko_window_state(p: *mut c_void) -> Rect;
    fn peko_configure(p: *mut c_void, state: Rect);
    fn peko_show_chat(hwnd: isize, show: i32);
}
fn c(s: &str) -> Result<CString> {
    Ok(CString::new(s)?)
}
unsafe fn s(p: *const c_char) -> String {
    unsafe { CStr::from_ptr(p) }.to_string_lossy().into_owned()
}
fn ffi_error() -> anyhow::Error {
    anyhow::anyhow!(unsafe { s(peko_error()) })
}
struct Handle(*mut c_void);
impl Drop for Handle {
    fn drop(&mut self) {
        unsafe { peko_destroy(self.0) }
    }
}

pub enum Command {
    Cue(Cue),
    Cancel,
    Settings(Value),
    Hide(bool),
    Quit,
}
pub struct Native {
    pub tx: Sender<Command>,
}
pub fn show_chat(hwnd: isize, show: bool) {
    unsafe { peko_show_chat(hwnd, show as i32) }
}

fn discover(
    base: &Path,
    expressions: &mut BTreeMap<String, PathBuf>,
    motions: &mut BTreeMap<String, PathBuf>,
) -> Result<()> {
    for e in std::fs::read_dir(base)? {
        let p = e?.path();
        if p.is_dir() {
            discover(&p, expressions, motions)?;
            continue;
        }
        let name = p.file_name().unwrap().to_string_lossy();
        if let Some(id) = name.strip_suffix(".exp3.json") {
            let low = id.to_lowercase();
            if ["水印", "shuiyin", "watermark", "hair", "服装", "衣服"]
                .iter()
                .any(|x| low.contains(x))
            {
                continue;
            }
            expressions.insert(id.to_owned(), p.clone());
        }
        if let Some(id) = name.strip_suffix(".motion3.json") {
            motions.insert(id.to_owned(), p);
        }
    }
    Ok(())
}
fn layer(name: &str) -> bool {
    [
        "手",
        "话筒",
        "抱枕",
        "游戏",
        "pose",
        "mic",
        "prop",
        "controller",
        "pillow",
        "特效",
        "漂浮",
    ]
    .iter()
    .any(|x| name.to_lowercase().contains(x))
}
fn allowed_parameter(id: &str) -> bool {
    [
        "ParamAngle",
        "ParamBodyAngle",
        "ParamEye",
        "ParamBrow",
        "ParamMouth",
        "ParamCheek",
        "ParamBreath",
    ]
    .iter()
    .any(|prefix| id.starts_with(prefix))
}
fn rect(settings: &Value) -> Rect {
    Rect {
        x: settings["petX"].as_i64().unwrap_or(1100) as i32,
        y: settings["petY"].as_i64().unwrap_or(400) as i32,
        width: 400,
        height: 600,
        scale: settings["petScale"].as_f64().unwrap_or(1.) as f32,
        topmost: settings["topmost"].as_bool().unwrap_or(true) as i32,
        through: settings["clickThrough"].as_bool().unwrap_or(false) as i32,
        visible: 1,
    }
}

impl Native {
    pub fn start(file: PathBuf, settings: Value, events: Sender<Value>) -> Self {
        let (tx, rx) = mpsc::channel();
        thread::spawn(move || {
            let result = (|| -> Result<()> {
                let name = c(&file.to_string_lossy())?;
                let ptr = unsafe { peko_create(name.as_ptr(), rect(&settings)) };
                if ptr.is_null() {
                    return Err(ffi_error());
                }
                let _guard = Handle(ptr);
                let base = file.parent().context("Missing model directory")?;
                for i in 0..unsafe { peko_texture_count(ptr) } {
                    let relative = unsafe { s(peko_texture_name(ptr, i)) };
                    let rgba = image::open(base.join(relative))?.to_rgba8();
                    if unsafe {
                        peko_texture(
                            ptr,
                            i,
                            rgba.as_ptr(),
                            rgba.width() as i32,
                            rgba.height() as i32,
                        )
                    } == 0
                    {
                        return Err(ffi_error());
                    }
                }
                let mut expressions = BTreeMap::new();
                let mut motions = BTreeMap::new();
                discover(base, &mut expressions, &mut motions)?;
                let mut catalog = Catalog {
                    name: "Yumi".into(),
                    expressions: expressions.keys().filter(|n| !layer(n)).cloned().collect(),
                    layers: expressions.keys().filter(|n| layer(n)).cloned().collect(),
                    motions: motions.keys().cloned().collect(),
                    parameters: Vec::new(),
                };
                for i in 0..unsafe { peko_parameter_count(ptr) } {
                    let id = unsafe { s(peko_parameter_id(ptr, i)) };
                    if !allowed_parameter(&id) {
                        continue;
                    }
                    let (mut min, mut max, mut default) = (0., 0., 0.);
                    unsafe { peko_parameter_info(ptr, i, &mut min, &mut max, &mut default) };
                    catalog.parameters.push(Parameter {
                        id,
                        min,
                        max,
                        default,
                    });
                }
                events.send(json!({"native":"catalog","catalog":catalog}))?;
                let start = Instant::now();
                let mut previous = Instant::now();
                let mut state = AvatarState::default();
                let mut active_until = Instant::now();
                let mut hidden = false;
                let mut latency = Vec::new();
                loop {
                    for command in rx.try_iter() {
                        match command {
                            Command::Quit => return Ok(()),
                            Command::Cancel => state.cancel(),
                            Command::Hide(h) => {
                                hidden = h;
                                let mut r = unsafe { peko_window_state(ptr) };
                                r.visible = (!h) as i32;
                                unsafe { peko_configure(ptr, r) };
                            }
                            Command::Settings(value) => {
                                let mut r = unsafe { peko_window_state(ptr) };
                                r.topmost =
                                    value["topmost"].as_bool().unwrap_or(r.topmost != 0) as i32;
                                r.through =
                                    value["clickThrough"].as_bool().unwrap_or(r.through != 0)
                                        as i32;
                                if let Some(v) = value["petScale"].as_f64() {
                                    r.scale = v as f32;
                                }
                                unsafe { peko_configure(ptr, r) };
                            }
                            Command::Cue(mut cue) => {
                                catalog.validate(&mut cue).map_err(anyhow::Error::msg)?;
                                let at = Instant::now();
                                state.apply(&cue, start.elapsed().as_millis() as u64);
                                if let Some(m) = &cue.motion {
                                    let p = c(&motions[m].to_string_lossy())?;
                                    if unsafe { peko_motion(ptr, p.as_ptr()) } == 0 {
                                        return Err(ffi_error());
                                    }
                                }
                                active_until = Instant::now() + Duration::from_secs(2);
                                latency.push(at);
                            }
                        }
                    }
                    state.tick(start.elapsed().as_millis() as u64);
                    unsafe { peko_reset_targets(ptr) };
                    for (name, weight) in state
                        .mix
                        .iter()
                        .map(|(n, w)| (n, *w))
                        .chain(state.layers.iter().map(|n| (n, 1.)))
                    {
                        let p = c(&expressions[name].to_string_lossy())?;
                        if unsafe { peko_expression(ptr, p.as_ptr(), weight) } == 0 {
                            return Err(ffi_error());
                        }
                    }
                    for (id, value) in &state.params {
                        let id = c(id)?;
                        unsafe { peko_parameter(ptr, id.as_ptr(), *value) };
                    }
                    let now = Instant::now();
                    let dt = now.duration_since(previous).as_secs_f32();
                    previous = now;
                    let e = unsafe { peko_tick(ptr, dt) };
                    if e < 0 {
                        return Err(ffi_error());
                    }
                    if !hidden {
                        for at in latency.drain(..) {
                            events.send(
                                json!({"native":"latency","ms":at.elapsed().as_secs_f64()*1000.}),
                            )?;
                        }
                    }
                    if e & 1 != 0 {
                        events.send(json!({"native":"show"}))?;
                        active_until = Instant::now() + Duration::from_secs(2);
                    }
                    if e & 2 != 0 {
                        events.send(json!({"native":"quit"}))?;
                        return Ok(());
                    }
                    if e & 4 != 0 {
                        let r = unsafe { peko_window_state(ptr) };
                        events.send(json!({"native":"settings","patch":{"petX":r.x,"petY":r.y,"petScale":r.scale,"topmost":r.topmost!=0,"clickThrough":r.through!=0}}))?;
                    }
                    thread::sleep(if hidden {
                        Duration::from_millis(100)
                    } else if Instant::now() < active_until {
                        Duration::from_millis(16)
                    } else {
                        Duration::from_millis(33)
                    });
                }
            })();
            if let Err(e) = result {
                let _ = events.send(json!({"native":"error","message":format!("{e:#}")}));
            }
        });
        Self { tx }
    }
}

pub fn default_model() -> PathBuf {
    let home = std::env::var_os("DSH_HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(std::env::var_os("USERPROFILE").unwrap()).join(".dsh"));
    home.join("peko-pet/models/LLM_Live2D/public/live2D/yumi/yumi.model3.json")
}
