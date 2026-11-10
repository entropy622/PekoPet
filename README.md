# PekoPet

使用 Rust、Tauri 2、React、原生 Live2D Cubism 和 DeepSeek Harness 的 Windows 桌面搭档。

角色窗口独立透明显示；整个主窗口使用 React，直接复用 dsh 的聊天前端，陪伴设置通过它的公开 Slot 接口扩展。模型正文流里的 `[[peko:{"motion":"wave"}]]` 标记即时驱动表情、动作和参数，聊天显示会隐藏控制标记。工作工具、MCP、skills、凭据和权限继续由 dsh 管理。

## 在 Windows 构建

需要 Rust stable MSVC、Node.js 24，以及独立的 Visual Studio Build Tools C++ 工作负载（MSVC v143、Windows SDK，含 fxc）。无需完整 VS IDE。参考 Microsoft 的 [开源开发 Build Tools 许可说明](https://devblogs.microsoft.com/cppblog/updates-to-visual-studio-build-tools-license-for-c-and-cpp-open-source-projects/)。

```powershell
git clone --recurse-submodules https://github.com/entropy622/PekoPet.git
cd PekoPet
npm ci
```

从 Live2D 官网取得 Cubism Native 5-r.5 SDK，阅读并接受其许可，解压后导入清单允许再分发的文件。

Windows 库随仓库提供。Core 头文件未列入官方再分发清单，导入器将其保存到本机 `local/cubism-core/include`，不会入库。

```powershell
./scripts/import-sdk.ps1 -SdkPath D:/SDK/CubismSdkForNative-5-r.5
npm run assets
npm run dev
```

已有 clone 可运行 `git submodule update --init --recursive` 补齐 Framework。使用其他已有角色时运行 `npm run assets -- --all`。模型存入本机 DSH_HOME 下的缓存，保留原作者署名和使用说明。

### 本地界面开发

装好独立 Build Tools 后，在项目目录运行：

```powershell
npm run dev
```

此命令自动加载本机 x64 C++ 开发环境，用 Cargo 增量构建并启动原生程序。PekoPet 的界面扩展位于 `plugin/frontend`；聊天源码固定在 `vendor/dsh-ui-chat`，沿用 dsh 的会话、工具、审批与问题组件，仅在正文显示和复制入口过滤表情标记。通过 npm override 加载同一份聊天组件。修改这些 JS/CSS 文件不触发 Rust 重编译。运行 `npm run build:frontend`，再在应用中重新连接 dsh 即可加载更新。只编译可用 `npm run build`。发布便携包仍使用 `npm run package:windows`；GitHub Actions 保留测试与发布候选包构建。

运行 `npx playwright install webkit` 准备 WebKit 测试浏览器，再运行 `npm run check:ui`。测试在屏幕外的原生 Tauri/WebView2 窗口检查界面，通过 CDP 操作组件，并使用无头 WebKit 检查同一套 React 前端。它连接真实 dsh loop 的脚本模型，使用临时 DSH_HOME 和项目目录；文件工具只操作该测试目录，不移动系统鼠标、不激活前台窗口。截图和报告写入 `work/ui-checks`。标题栏、任务栏与托盘图标使用本机 Live2D 模型渲染的大头图，缓存于 `DSH_HOME/peko-pet/icons`，附带作者信息。

便携包首次运行使用 `PekoPet.cmd`，它会缓存默认模型再打开程序。此后可以直接打开 `pekopet.exe`。Node 随便携包提供，运行模型缓存无需 Git。

## 第一次使用

先确保 dsh desktop 已配置可用模型。PekoPet 默认使用同一个 `DSH_HOME`（未设置时为 `~/.dsh`），读取 desktop 的模型、MCP 和插件设置。dsh 保留 desktop 启动入口给 Electron，因此 PekoPet 使用引用 desktop 配置的专用 peko profile。它不创建第二套 API Key 或 MCP 配置。

- 点击桌宠打开聊天，拖动角色移动位置，滚轮缩放。
- `Ctrl+Alt+P` 唤起聊天，`Ctrl+Alt+Shift+P` 切换鼠标穿透。
- 托盘菜单提供置顶、显示、隐藏与退出。关闭聊天保留桌宠。
- 聊天沿用 dsh 的工作区、文件选择、模型选择、工具审批和停止任务入口。
- “共同记忆”可编辑、删除、清空或暂停自动记忆。
- “相处方式”修改人格，选择陪伴频率；主动陪伴和勿扰分别控制。
- “模型与连接”显示共享目录与连接状态；聊天中的模型选择沿用 dsh。配置变更后重新连接，不会自动重发任务。PekoPet 在本机状态目录保留专用 Web 端口，使 dsh 的浏览器会话选择与偏好跨重连保留。
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
node scripts/e2e-work.mjs
npm run package:windows
```

`npm test` 中的 bridge 用例使用本地脚本模型，经过真实 dsh loop，不需要 API Key。`smoke-dsh` 检查当前共享配置的连接与关闭；`e2e-dsh` 使用当前真实模型，会消耗少量额度。原生 UI 的显示、模型效果与长时间运行验收见 [验收记录](docs/ACCEPTANCE.md)。

`e2e-dsh` 可通过 `PEKO_TEST_PROVIDER` 和 `PEKO_TEST_MODEL` 指定已有测试路由，不改动 dsh 配置。

公开仓库的 Windows CI 运行 Node 测试、Rust 核心测试、Tauri 类型检查、原生 Cubism 编译与链接，并生成 Windows x64 便携包。构建产物位于成功工作流的 `PekoPet-portable-windows-x64` artifact。`PEKO_TYPECHECK=1` 仅用于 `cargo check`，不生成原生程序。

## 目录与许可

`crates/peko-core` 是流式协议与角色状态；`crates/pekopet` 是 Tauri 桌面壳和 Rust 角色协议桥；`native` 是 Cubism/Win32 桥接；`plugin` 是 dsh 扩展和 React 前端扩展；`vendor/dsh-ui-chat` 保留固定版本的 MIT 聊天源码与来源；`scripts` 提供启动、模型缓存、SDK 导入和打包。

自有代码为 MIT，第三方组件和模型保留各自许可，见 [第三方说明](THIRD_PARTY.md)。首版使用固定角色目录。SDK 和模型的公开分发按其各自授权处理。

## 平台与 WebView

当前交付目标为 Windows x64，主窗口使用系统 Edge WebView2，并依赖 Microsoft Visual C++ x64 运行库。运行便携包无需 Visual Studio 或 Rust；缺少 `MSVCP140.dll` 时安装 [Visual C++ Redistributable](https://learn.microsoft.com/en-us/cpp/windows/latest-supported-vc-redist)。WebView2 缺失时可从 Microsoft 安装 Evergreen Runtime。主窗口与独立的 Live2D 窗口分别管理，关闭聊天保留桌宠，从托盘退出才结束应用。

React 页面共用同一套组件与样式。macOS 的 WKWebView、Linux 的 WebKitGTK 具有不同的浏览器能力；无头 WebKit 检查覆盖前端兼容性，目标系统的输入法、剪贴板、窗口与打包仍需分别验收。当前 Win32／DirectComposition／D3D11 桌宠层需要对应平台实现后再发布其他平台。
