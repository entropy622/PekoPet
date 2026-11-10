use anyhow::{Context, Result};
use serde_json::{Value, json};
use std::os::windows::process::CommandExt;
use std::{
    fs::{self, OpenOptions},
    io::{BufRead, BufReader, Write},
    path::PathBuf,
    process::{Child, Command, Stdio},
    sync::{
        Arc, LazyLock, Mutex,
        mpsc::{self, Sender},
    },
    thread,
    time::{Duration, Instant},
};
static CLOCK: LazyLock<Instant> = LazyLock::new(Instant::now);
pub fn arrival(micros: u64) -> Instant {
    *CLOCK + Duration::from_micros(micros)
}

pub struct Rpc {
    writer: Sender<Value>,
    child: Arc<Mutex<Child>>,
    next: u64,
    closed: bool,
}
impl Rpc {
    pub fn start(root: PathBuf, events: Sender<Value>, generation: u64) -> Result<Self> {
        let logdir = root.join("work");
        fs::create_dir_all(&logdir)?;
        let stderr = OpenOptions::new()
            .create(true)
            .append(true)
            .open(logdir.join("agent.log"))?;
        let node = std::env::var_os("PEKO_NODE").unwrap_or_else(|| {
            if root.join("node.exe").exists() {
                root.join("node.exe").into_os_string()
            } else {
                "node.exe".into()
            }
        });
        let mut child = Command::new(node)
            .arg(root.join("scripts/start-agent.mjs"))
            .current_dir(&root)
            .env("PEKO_EMBEDDED_UI", "1")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(stderr)
            .creation_flags(0x08000000)
            .spawn()
            .context("启动 PekoPet agent 失败，请安装 Node.js 24 并运行 npm install")?;
        let mut stdin = child.stdin.take().unwrap();
        let stdout = child.stdout.take().unwrap();
        let (tx, rx) = mpsc::channel::<Value>();
        let errors = events.clone();
        thread::spawn(move || {
            for value in rx {
                if let Err(e) = (|| -> std::io::Result<()> {
                    serde_json::to_writer(&mut stdin, &value)?;
                    stdin.write_all(b"\n")?;
                    stdin.flush()
                })() {
                    let _ = errors.send(
                        json!({"transportError":e.to_string(),"connectionGeneration":generation}),
                    );
                    break;
                }
            }
        });
        thread::spawn(move || {
            for line in BufReader::new(stdout).lines() {
                match line {
                    Ok(line) => match serde_json::from_str::<Value>(&line) {
                        Ok(mut frame) => {
                            frame["connectionGeneration"] = json!(generation);
                            frame["receivedMicros"] = json!(CLOCK.elapsed().as_micros() as u64);
                            if events.send(frame).is_err() {
                                break;
                            }
                        }
                        Err(e) => {
                            let _ = events.send(
                                json!({"transportError":format!("Agent 运行时输出了非协议内容: {e}"),"connectionGeneration":generation}),
                            );
                            break;
                        }
                    },
                    Err(e) => {
                        let _ = events.send(json!({"transportError":e.to_string(),"connectionGeneration":generation}));
                        break;
                    }
                }
            }
            let _ = events.send(json!({"transportError":"Agent 运行时已停止，未自动重发任务","connectionGeneration":generation}));
        });
        Ok(Self {
            writer: tx,
            child: Arc::new(Mutex::new(child)),
            next: 1,
            closed: false,
        })
    }
    pub fn call(&mut self, method: &str, params: Value) -> u64 {
        let id = self.next;
        self.next += 1;
        let _ = self
            .writer
            .send(json!({"jsonrpc":"2.0","id":id,"method":method,"params":params}));
        id
    }
    pub fn close(&mut self) {
        if self.closed {
            return;
        }
        self.closed = true;
        self.call("shutdown", json!({}));
        let child = self.child.clone();
        {
            for _ in 0..40 {
                if child.lock().unwrap().try_wait().ok().flatten().is_some() {
                    return;
                }
                thread::sleep(std::time::Duration::from_millis(50));
            }
            let pid = child.lock().unwrap().id();
            let _ = Command::new("taskkill.exe")
                .args(["/PID", &pid.to_string(), "/T", "/F"])
                .creation_flags(0x08000000)
                .status();
            let _ = child.lock().unwrap().wait();
        }
    }
}
impl Drop for Rpc {
    fn drop(&mut self) {
        self.close();
    }
}
