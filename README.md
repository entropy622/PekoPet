# PekoPet

Electron、TypeScript、React、Live2D Cubism Web 与自有 Agent Runtime 构成的 Windows 桌面搭档。聊天窗口保持简洁，透明角色窗口独立运行；工具、审批、会话、记忆与提醒由 PekoPet 管理。

桌面通过本地 `peko-app://` 应用协议加载资源，使用隔离 preload 与私有 IPC 访问自己的 Node 子进程。无需启动 dsh、打开 localhost 网页或完成浏览器登录。模型 API、MCP 的对外连接仍按各自配置运行。

## 本机开发

需要 Node.js 24 和 Git。日常构建使用 TypeScript/esbuild，无需 Rust、Tauri、Cubism Native 或 MSVC 工具链。

```powershell
git clone https://github.com/entropy622/PekoPet.git
cd PekoPet
npm ci
npm run assets
npm run dev
```

`npm ci` 安装 Electron；`npm run dev` 增量构建并启动。只构建可运行 `npm run build`。也可双击根目录的 `start.bat`，脚本按自身位置定位工程，支持中文和空格路径。

Cubism Web 5-r.5 的 Framework、GLSL 着色器及清单允许的 Core 运行文件随源码提供，保留原许可；使用前请阅读 [Live2D 专有软件许可](https://www.live2d.com/eula/live2d-proprietary-software-license-agreement_en.html) 与 [开放软件许可](https://www.live2d.com/eula/live2d-open-software-license-agreement_en.html)。

## 使用便携版

解压 Windows x64 ZIP，从托盘退出旧版 PekoPet，再运行 `start.bat` 或 `PekoPet.cmd`。首次启动缓存默认角色，后续可直接打开 `PekoPet.exe`。Electron、Chromium 和独立 Node 运行时随包提供，无需系统 WebView2。

从 Rust/Tauri 版本升级时，原 `DSH_HOME/peko-pet` 中的会话、记忆、人格和提醒继续使用。Electron 窗口偏好使用自己的 userData；旧版 WebView 的 cookie 不参与新应用启动。请先退出旧版，避免两个 Agent Runtime 同时操作同一会话。

默认角色为 Yumi。若保存的私有角色在当前电脑尚未安装，聊天仍可使用，并显示资源提示；在角色调试中选择已安装角色即可恢复桌宠。

## 共享 dsh 配置，独立管理 Agent

默认读取 `DSH_HOME`，未设置时使用 `~/.dsh`。共享来源为：

- `profiles/desktop/cordis.patch.yml` 与 home 层补丁中的模型提供方、默认模型、MCP 和 skills。
- 原有凭据引用和管理存储，以及自定义 skill 目录。

不加载 dsh CLI、desktop 启动树、用户启动插件、权限覆盖或展示层，也不创建 `profiles/peko`。在 PekoPet 修改模型配置时，仅写回相应共享条目；检测到外部修改时要求重新加载。其他应用设置保存在 `DSH_HOME/peko-pet/config.patch.yml`。

应用自行启动和回收 Node Agent Runtime。loop 源码在 `vendor/peko-agent-loop/src`，服务组合在 `agent/composition.yml`，固定的空入口 `agent/entry.yml` 将模块解析锚定在应用安装目录；用户配置在内存中合成。数据保存在 `DSH_HOME/peko-pet`：

- `sessions`、`attachments/v1`：会话与引用附件。
- `state.sqlite3`：人格、记忆、角色状态与会话索引。
- `storages`：提醒等运行状态。
- `icons`、`logs`：本机生成的角色头像和运行日志。

旧版会话布局首次升级时会复制 PekoPet 管理的根会话、子会话、附件及提醒，保留原会话文件。提醒交接会停用旧库中的 PekoPet 提醒，保留其他任务。已完成该迁移的电脑直接沿用现有数据。

## 聊天与桌宠

- 点击角色打开聊天；拖动移动，滚轮缩放。角色窗口默认不抢焦点。
- `Ctrl+Alt+P` 唤起聊天，`Ctrl+Alt+Shift+P` 切换鼠标穿透。
- 关闭聊天保留桌宠和任务，托盘“退出 PekoPet”结束应用。
- 标题栏提供聊天记录、新对话和更多选项；工作选项按需展开。
- 审批、用户提问、错误和停止按钮在需要时显示，权限沿用 PekoPet 的工具策略。
- “共同记忆”支持查看、修改、删除、暂停与清空；删除内容不会从旧消息自动重新提取。
- “相处方式”配置人格、主动陪伴与勿扰。应用不主动截图或观察前台软件。
- “模型与配置”显示共享目录与运行状态；空闲时“重新加载配置”生效，不重复提交任务。
- “角色调试”热切换已安装角色，预览表情、持续姿势、道具、动作和实际参数范围。

默认每天最多主动问候两次，空闲 60 分钟后、09:00—22:00 本地时间生效，可关闭或调整。提醒使用持久化 Schedule。

## 私有 Live2D 资源库

`models` 是 [entropy622/Live2DModels](https://github.com/entropy622/Live2DModels) 私有仓库的 submodule，可供其他个人项目复用。具有访问权的电脑可运行：

```powershell
git lfs install
git submodule update --init models
git -C models lfs pull
node models/scripts/validate.mjs
```

收录 Yumi、冰糖、艾莲、DeepSeek-chan 和草莓兔兔 DLC。PekoPet 优先读取私有库，再使用现有缓存或本机导入路径。模型原文件、作者说明和署名保留；二进制由 Git LFS 管理。公开 CI 和便携包不包含私有模型。无私有库访问权也可构建，并使用 `npm run assets` 缓存默认角色；`npm run assets -- --all` 缓存其他原有评估角色。

草莓兔兔 DLC：立绘 赛博撸猫人，建模 糖糖锦鲤。提供 13 种情绪、5 个持续手势／道具层和 4 个原始动作；水印、发型与游戏按键不暴露为语义情绪。原说明要求不要二传，私有存储不扩大原使用授权。

DeepSeek-chan（大肥鱼）：原画及拆分 神宫凉子，Live2D 建模 霓虹猫_NeonNeko。已有本机导入仍有效，也可用完整原包导入：

```powershell
node scripts/import-deepseek.mjs "模型压缩包解压目录"
```

## 即时角色控制

模型可在正文流插入短标记：

```text
[[peko:{"mix":{"星星眼":0.8,"泪汪汪":0.2},"hold":2500}]]这个效果我喜欢！
[[peko:{"params":{"ParamAngleZ":8},"hold":1200}]]这里再调整一下。
[[peko:{"layers":{"拿话筒":true}}]]我来主持。
[[peko:{"motion":"wave"}]]回来啦。
```

使用当前角色目录中公布的名称，参数按真实范围裁剪。TypeScript 增量解析器处理跨 chunk 标记，闭合后立即通过 IPC 更新 WebGL；聊天显示和复制内容隐藏标记，会话原文保留。代码、思考、工具结果、子任务和历史回放不驱动角色。重复 chunk 不重复执行；取消清理临时表现，持续层保留到关闭或切换角色。

Cubism 保留原物理、呼吸、眨眼和注视。普通帧率 30 FPS，交互时提升至 60 FPS，隐藏时暂停绘制。人格和外观分别配置。

## 测试与打包

```powershell
npm test
npm run typecheck
npm run build
npm run check:ui
node scripts/smoke-agent.mjs
npm run package:windows
```

离屏检查使用真实隐藏 Electron 窗口、隔离 DSH_HOME、持久测试 userData、脚本模型和临时项目，不移动系统鼠标、不抢焦点、不注册托盘或全局快捷键。覆盖连续启动、重启、配置重载、原始聊天组件、工具、审批、提问、停止、记忆、历史和真实 WebGL 模型。截图及报告保存在忽略的 `work/electron-checks`。

`smoke-agent` 检查运行时启动与共享配置；`e2e-agent` 和 `e2e-work` 使用当前真实模型，会消耗额度。可通过 `PEKO_TEST_PROVIDER` 与 `PEKO_TEST_MODEL` 选择已有测试路由。

便携打包默认输出 `dist/PekoPet-windows-x64` 和同名 ZIP。可用 `--destination` 指定新目录，`--no-zip` 仅构建便携目录。独立 Node 的原生依赖按 Node ABI 准备；Electron 渲染器不加载这些模块。

## GitHub Actions 与发布

Windows checks 运行构建、类型检查、Node 测试和隐藏 Electron 验收，并生成便携候选包。公开 CI 不拉取私有 submodule。

发布仍需手动运行 Actions → Publish release，固定构建 main。版本取自 package.json；已发布标签保留。下一版先更新版本，再运行工作流，上传完成后公开 Release。本次迁移为 0.2.0，未自动覆盖旧版本发布。

## 代码位置与许可

- `electron`：主进程、隔离 preload、本地协议与界面 transport。
- `desktop`：运行时子进程、增量角色协议和模型路径。
- `renderer/pet`：透明窗口内的 Cubism WebGL 渲染。
- `agent`：应用自有运行时、配置共享、IPC carrier 和迁移。
- `plugin`：陪伴、记忆和 React 界面扩展。
- `vendor`：固定版本的 loop、React 组件及许可允许的 Cubism Web 文件。

自有代码为 MIT，第三方组件与模型保留各自许可，见 [第三方说明](THIRD_PARTY.md)。当前交付目标为 Windows x64；其他平台的窗口交互与打包分别验收。实际测试记录见 [验收记录](docs/ACCEPTANCE.md)。
