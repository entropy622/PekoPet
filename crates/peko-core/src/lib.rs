//! Streaming avatar cues. Raw transcripts remain owned by dsh.
pub mod text;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};

const PREFIX: &str = "[[peko:";
const MAX_CUE_BYTES: usize = 8192;

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct Cue {
    #[serde(default)]
    pub mix: BTreeMap<String, f32>,
    #[serde(default)]
    pub params: BTreeMap<String, f32>,
    #[serde(default)]
    pub layers: BTreeMap<String, bool>,
    pub motion: Option<String>,
    pub hold: Option<u64>,
    #[serde(default)]
    pub clear: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Parameter {
    pub id: String,
    pub min: f32,
    pub max: f32,
    pub default: f32,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct Catalog {
    pub name: String,
    pub expressions: BTreeSet<String>,
    pub layers: BTreeSet<String>,
    pub motions: BTreeSet<String>,
    pub parameters: Vec<Parameter>,
}

impl Catalog {
    pub fn validate(&self, cue: &mut Cue) -> Result<(), String> {
        for (name, weight) in &mut cue.mix {
            if !self.expressions.contains(name) {
                return Err(format!("未知表情 {name}"));
            }
            if !weight.is_finite() {
                return Err("表情权重无效".into());
            }
            *weight = weight.clamp(0.0, 1.0);
        }
        for name in cue.layers.keys() {
            if !self.layers.contains(name) {
                return Err(format!("未知持久层 {name}"));
            }
        }
        for (id, value) in &mut cue.params {
            let p = self
                .parameters
                .iter()
                .find(|p| &p.id == id)
                .ok_or_else(|| format!("未知参数 {id}"))?;
            if !value.is_finite() {
                return Err("参数值无效".into());
            }
            *value = value.clamp(p.min, p.max);
        }
        if let Some(name) = &cue.motion {
            if !self.motions.contains(name) {
                return Err(format!("未知动作 {name}"));
            }
        }
        cue.hold = Some(cue.hold.unwrap_or(2500).clamp(100, 60_000));
        Ok(())
    }
}

#[derive(Debug, PartialEq)]
pub enum Output {
    Text(String),
    Cue(Cue),
    Invalid(String),
}

/// Only feed root assistant text deltas. Each instance belongs to one text block.
#[derive(Default)]
pub struct Parser {
    pending: String,
    code_ticks: usize,
    tick_run: usize,
}

impl Parser {
    pub fn push(&mut self, text: &str) -> Vec<Output> {
        self.pending.push_str(text);
        self.drain(false)
    }

    pub fn finish(&mut self) -> Vec<Output> {
        self.drain(true)
    }

    fn drain(&mut self, finish: bool) -> Vec<Output> {
        let mut out = Vec::new();
        let mut visible = String::new();
        while !self.pending.is_empty() {
            if self.pending.starts_with('`') {
                self.pending.remove(0);
                self.tick_run += 1;
                visible.push('`');
                continue;
            }
            if self.tick_run > 0 {
                if self.code_ticks == 0 {
                    self.code_ticks = self.tick_run;
                } else if self.code_ticks == self.tick_run {
                    self.code_ticks = 0;
                }
                self.tick_run = 0;
            }
            if self.code_ticks == 0 && self.pending.starts_with(PREFIX) {
                if let Some(end) = marker_end(&self.pending[PREFIX.len()..]) {
                    if !visible.is_empty() {
                        out.push(Output::Text(std::mem::take(&mut visible)));
                    }
                    let end = PREFIX.len() + end;
                    let raw = self.pending[PREFIX.len()..end].to_owned();
                    self.pending.drain(..end + 2);
                    if raw.len() > MAX_CUE_BYTES {
                        out.push(Output::Invalid("角色标记过长".into()));
                    } else {
                        match serde_json::from_str::<Cue>(&raw) {
                            Ok(cue) => out.push(Output::Cue(cue)),
                            Err(e) => out.push(Output::Invalid(format!("角色标记格式错误: {e}"))),
                        }
                    }
                    continue;
                }
                if finish {
                    self.pending.clear();
                    out.push(Output::Invalid("角色标记被中断".into()));
                }
                break;
            }
            if self.code_ticks == 0 && !finish && PREFIX.starts_with(&self.pending) {
                break;
            }
            let ch = self.pending.chars().next().unwrap();
            visible.push(ch);
            self.pending.drain(..ch.len_utf8());
        }
        if !visible.is_empty() {
            out.push(Output::Text(visible));
        }
        out
    }
}

fn marker_end(raw: &str) -> Option<usize> {
    let mut quoted = false;
    let mut escaped = false;
    for (i, ch) in raw.char_indices() {
        if escaped {
            escaped = false;
            continue;
        }
        if quoted && ch == '\\' {
            escaped = true;
            continue;
        }
        if ch == '"' {
            quoted = !quoted;
        }
        if !quoted && raw[i..].starts_with("]]") {
            return Some(i);
        }
    }
    None
}

/// Dense chunk indexes prevent an avatar action from firing twice on delivery retries.
#[derive(Default)]
pub struct StreamCursor {
    attempt: String,
    revision: u64,
    next_index: u64,
}

impl StreamCursor {
    pub fn start(&mut self, attempt: &str, revision: u64) -> bool {
        if self.attempt == attempt && self.revision == revision {
            return false;
        }
        self.attempt = attempt.into();
        self.revision = revision;
        self.next_index = 0;
        true
    }
    pub fn accept(
        &mut self,
        attempt: &str,
        revision: u64,
        index: u64,
    ) -> Result<bool, &'static str> {
        if attempt != self.attempt || revision != self.revision {
            return Ok(false);
        }
        if index < self.next_index {
            return Ok(false);
        }
        if index != self.next_index {
            return Err("流式输出缺失，停止角色控制并等待最终消息");
        }
        self.next_index += 1;
        Ok(true)
    }
}

#[derive(Default)]
pub struct AvatarState {
    pub mix: BTreeMap<String, f32>,
    pub params: BTreeMap<String, f32>,
    pub layers: BTreeSet<String>,
    expires_ms: u64,
}

impl AvatarState {
    pub fn apply(&mut self, cue: &Cue, now_ms: u64) {
        if cue.clear {
            self.layers.clear();
            self.mix.clear();
            self.params.clear();
        }
        if !cue.mix.is_empty() {
            self.mix.clone_from(&cue.mix);
        }
        self.params.clone_from(&cue.params);
        for (name, enabled) in &cue.layers {
            if *enabled {
                self.layers.insert(name.clone());
            } else {
                self.layers.remove(name);
            }
        }
        self.expires_ms = now_ms.saturating_add(cue.hold.unwrap_or(2500));
    }
    pub fn tick(&mut self, now_ms: u64) {
        if now_ms >= self.expires_ms {
            self.mix.clear();
            self.params.clear();
        }
    }
    pub fn cancel(&mut self) {
        self.mix.clear();
        self.params.clear();
    }
}

pub fn visible_text(raw: &str) -> String {
    let mut p = Parser::default();
    p.push(raw)
        .into_iter()
        .chain(p.finish())
        .filter_map(|o| match o {
            Output::Text(t) => Some(t),
            _ => None,
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn every_character_boundary_and_chinese() {
        let input = "你好[[peko:{\"mix\":{\"星星眼\":0.8}}]]今天[[peko:{\"motion\":\"wave\"}]]开心";
        let mut p = Parser::default();
        let mut outputs = Vec::new();
        for c in input.chars() {
            outputs.extend(p.push(&c.to_string()));
        }
        outputs.extend(p.finish());
        let text: String = outputs
            .iter()
            .filter_map(|o| {
                if let Output::Text(t) = o {
                    Some(t.as_str())
                } else {
                    None
                }
            })
            .collect();
        assert_eq!(text, "你好今天开心");
        assert_eq!(
            outputs
                .iter()
                .filter(|o| matches!(o, Output::Cue(_)))
                .count(),
            2
        );
    }
    #[test]
    fn all_chunk_splits() {
        let input = "a[[peko:{\"mix\":{\"x\":1}}]]z";
        for i in 0..=input.len() {
            let mut p = Parser::default();
            let o = p
                .push(&input[..i])
                .into_iter()
                .chain(p.push(&input[i..]))
                .chain(p.finish())
                .collect::<Vec<_>>();
            assert_eq!(o.iter().filter(|x| matches!(x, Output::Cue(_))).count(), 1);
        }
    }
    #[test]
    fn code_blocks_and_inline_code_are_literal() {
        let raw = "`[[peko:{\"clear\":true}]]`\n```json\n[[peko:{\"clear\":true}]]\n```";
        assert_eq!(visible_text(raw), raw);
    }
    #[test]
    fn interrupted_marker_is_hidden() {
        assert_eq!(visible_text("hi[[peko:{"), "hi");
    }
    #[test]
    fn quoted_delimiter_does_not_end_marker() {
        let mut p = Parser::default();
        let o = p.push("[[peko:{\"motion\":\"x]]y\"}]]");
        assert!(matches!(&o[0],Output::Cue(Cue{motion:Some(s),..}) if s=="x]]y"));
    }
    #[test]
    fn duplicate_and_stale_chunks_do_not_fire() {
        let mut c = StreamCursor::default();
        assert!(c.start("a", 1));
        assert!(!c.start("a", 1));
        assert_eq!(c.accept("a", 1, 0), Ok(true));
        assert_eq!(c.accept("a", 1, 0), Ok(false));
        assert!(c.accept("a", 1, 2).is_err());
        c.start("b", 2);
        assert_eq!(c.accept("a", 1, 1), Ok(false));
    }
    #[test]
    fn persistent_layers_survive_emotion_expiry_and_cancel() {
        let mut s = AvatarState::default();
        let mut c = Cue::default();
        c.layers.insert("mic".into(), true);
        c.mix.insert("happy".into(), 0.8);
        s.apply(&c, 0);
        s.tick(3000);
        assert!(s.mix.is_empty());
        assert!(s.layers.contains("mic"));
        s.cancel();
        assert!(s.layers.contains("mic"));
        c.layers.insert("mic".into(), false);
        s.apply(&c, 4000);
        assert!(s.layers.is_empty());
    }
    #[test]
    fn clamp_parameters_and_reject_unknown_names() {
        let cat = Catalog {
            parameters: vec![Parameter {
                id: "x".into(),
                min: -1.,
                max: 1.,
                default: 0.,
            }],
            ..Default::default()
        };
        let mut c = Cue::default();
        c.params.insert("x".into(), 4.);
        cat.validate(&mut c).unwrap();
        assert_eq!(c.params["x"], 1.);
        c.motion = Some("missing".into());
        assert!(cat.validate(&mut c).is_err());
    }
    #[test]
    fn a_pose_change_keeps_the_existing_emotion() {
        let mut s = AvatarState::default();
        let mut c = Cue::default();
        c.mix.insert("happy".into(), 0.6);
        s.apply(&c, 0);
        s.apply(
            &Cue {
                layers: BTreeMap::from([("mic".into(), true)]),
                ..Default::default()
            },
            100,
        );
        assert_eq!(s.mix["happy"], 0.6);
        assert!(s.layers.contains("mic"));
    }
}
