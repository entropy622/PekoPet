## PekoPet 0.2.0 · Electron 迁移

Windows x64 文字桌宠。使用 Electron、TypeScript、React、Cubism WebGL 与自有 Agent Runtime。

- 本地应用协议与私有 IPC 取代网页服务、浏览器 token/cookie 和 WebView2 启动链。
- 保留现有聊天、工具、审批、提问、停止、会话、人格、记忆与提醒。
- 独立透明 Live2D 窗口，保留物理、呼吸、眨眼、注视、表情混合和持续姿势；支持热切换已安装角色。
- 继续共享 dsh 的模型、凭据引用、MCP 和 skills，应用无需启动 dsh。
- 私有模型库由独立 submodule 管理，不进入公开便携包。

### 升级与启动

1. 从托盘退出旧版 PekoPet。
2. 解压 ZIP，运行 start.bat 或 PekoPet.cmd；首次运行缓存默认角色，后续可直接打开 PekoPet.exe。
3. Electron、Chromium 和 Node 随包提供，无需 Rust、Visual Studio 或系统 WebView2。
4. 原 DSH_HOME/peko-pet 会话、人格、记忆和提醒继续使用。私有角色未安装时会显示资源提示，聊天保持可用。

模型保留原作者署名与使用说明。语音和其他平台留待后续；桌面交互及长期运行的验收记录见 docs/ACCEPTANCE.md。
