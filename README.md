# PekoPet

使用 Rust、GPUI、原生 Live2D Cubism 和 DeepSeek Harness 的 Windows 桌面搭档。

角色窗口独立透明显示；聊天与设置使用 GPUI。模型正文流里的 `[[peko:...]]` 标记即时驱动表情、动作和参数，聊天显示会隐藏控制标记。工作工具、MCP、skills、凭据和权限继续由 dsh 管理。

## 在 Windows 构建

需要 Rust stable MSVC、Node.js 24，以及独立的 Visual Studio Build Tools C++ 工作负载（MSVC v143、Windows SDK，含 fxc）。无需完整 VS IDE。参考 Microsoft 的 [开源开发 Build Tools 许可说明](https://devblogs.microsoft.com/cppblog/updates-to-visual-studio-build-tools-license-for-c-and-cpp-open-source-projects/)。

```powershell
git clone --recurse-submodules https://github.com/entropy622/PekoPet.git
cd PekoPet
npm ci
```

从 Live2D 官网取得 Cubism Native 5-r.5 SDK，阅读并接受其许可，解压后导入清单允许再分发的文件。

```powershell
./scripts/import-sdk.ps1 -SdkPath D:/SDK/CubismSdkForNative-5-r.5
npm run assets
cargo run --release -p pekopet
```

已有 clone 可运行 `git submodule update --init --recursive` 补齐 Framework。使用其他已有角色时运行 `npm run assets -- --all`。模型存入本机 DSH_HOME 下的缓存，保留原作者署名和使用说明。

## 第一次使用

先确保 dsh desktop 已配置可用模型。PekoPet 默认使用同一个 `DSH_HOME`（未设置时为 `~/.dsh`），读取 desktop 的模型、MCP 和插件设置。dsh 保留 desktop 启动入口给 Electron，因此 PekoPet 使用引用 desktop 配置的专用 peko profile。它不创建第二套 API Key 或 MCP 配置。

- 点击桌宠打开聊天，拖动角色移动位置，滚轮缩放。
- `Ctrl+Alt+P` 唤起聊天，`Ctrl+Alt+Shift+P` 切换鼠标穿透。
- 托盘菜单提供置顶、显示、隐藏与退出。关闭聊天保留桌宠。
- “项目”按钮选择工作目录；工具审批由你决定，可随时停止任务。
- “共同记忆”可编辑、删除、清空或暂停自动记忆。
- “相处方式”修改人格，主动陪伴和勿扰分别控制。
- “模型与连接”选择已有模型，配置变更后重新连接，不会自动重发任务。
- “角色调试”预览表情、动作、持久层和参数范围；固定角色选择在重启后生效。

## 表情协议

```text
[[peko:{"mix":{"星星眼":0.8,"泪汪汪":0.2},"hold":2500}]]这个效果我喜欢！
[[peko:{"params":{"ParamAngleZ":8},"hold":1200}]]这里再调整一下。
[[peko:{"layers":{"拿话筒":true}}]]我来主持。
[[peko:{"motion":"wave"}]]回来啦。
```

使用当前角色目录中的实际名称。表情采用权重混合，持久层使用布尔开关，参数值按模型范围裁剪。只有当前主会话的 assistant 正文能触发角色控制；代码块、工具输出、思考内容和历史回放不触发动作。

## 测试与打包

```powershell
npm test
cargo test -p peko-core --locked
node scripts/smoke-dsh.mjs
node scripts/e2e-dsh.mjs
npm run package:windows
```

`npm test` 中的 bridge 用例使用本地脚本模型，经过真实 dsh loop，不需要 API Key。`smoke-dsh` 检查当前共享配置的连接与关闭；`e2e-dsh` 使用当前真实模型，会消耗少量额度。原生 UI 的显示、模型效果与长时间运行验收见 [验收记录](docs/ACCEPTANCE.md)。

公开仓库的 Windows CI 运行 Node 测试、Rust 核心测试和 GPUI 类型检查。`PEKO_TYPECHECK=1` 仅用于 `cargo check`，不生成原生程序。SDK 就位后，正常构建还会编译 C++ 桥接层和链接 Core。

## 目录与许可

`crates/peko-core` 是流式协议与角色状态；`crates/pekopet` 是 GPUI 客户端；`native` 是 Cubism/Win32 桥接；`plugin` 是 dsh 扩展；`scripts` 提供启动、模型缓存、SDK 导入和打包。

自有代码为 MIT，第三方组件和模型保留各自许可，见 [第三方说明](THIRD_PARTY.md)。首版使用固定角色目录。SDK 和模型的公开分发按其各自授权处理。
