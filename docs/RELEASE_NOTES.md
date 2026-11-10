## PekoPet 初始版本

Windows x64 文字桌宠，使用 Rust / Tauri 2 / React、原生 Live2D Cubism 与 dsh。

- 主窗口复用 dsh 聊天前端，统一聊天、工作过程与陪伴设置。
- 支持流式文字、即时角色控制、审批、提问、停止任务和会话恢复。
- 复用 desktop 的 DSH_HOME、模型配置、MCP、skills 与用户插件。
- 支持人格、长期记忆、提醒与勿扰；标题栏和托盘使用本机生成的模型大头。

### 启动

1. 下载并解压 Windows x64 ZIP，先从托盘退出旧版。
2. 准备 Edge WebView2 和 Microsoft Visual C++ x64 运行库；Node 随包提供。
3. 先在 dsh desktop 配置可用模型，再运行 `PekoPet.cmd`。首次启动会下载默认角色到本机缓存，后续可直接运行 `pekopet.exe`。

模型资源不随公开包分发，保留原作者署名与使用说明。CI 使用 PekoPet 自有回退图标，本机模型加载后更新角色头像。

当前发布面向 Windows；语音和其他平台留待后续。桌宠 DPI、多显示器交互及新版本两小时持续运行仍在验收，详见仓库 `docs/ACCEPTANCE.md`。
