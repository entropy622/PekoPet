# PekoPet

Build the Windows x64 desktop companion with Rust/Tauri/React and a separate native Cubism D3D11 window. Keep the dsh agent loop, permissions, MCP configuration and skills owned by DeepSeek Harness. Launch through a managed peko profile referencing desktop and an invocation overlay; do not edit the user's profile.

Own code uses MIT. Preserve third-party licenses. Only SDK files named in its redistribution manifest may be committed. Model caches, credentials, session logs, local state and build products stay out of Git. Models from LLM_Live2D are local evaluation assets unless redistribution permission is documented.

On 2026-11-09 the repository owner accepted the Live2D Proprietary and Open Software licenses and authorized official SDK downloads for PekoPet development, including this repository's CI. Core 5-r.5 lists the Windows library for redistribution, but omits its header. Keep that header under ignored local/cubism-core/include. Fork and pull-request checks must not accept a new license on behalf of another contributor.

Keep one JSON-RPC writer per process. Only root assistant text can emit avatar cues; tool output, reasoning, code and replay must not trigger motions. Approval defaults follow dsh. Never auto-grant an approval.

Run Node tests with `npm test`, Rust core tests with `cargo test -p peko-core`, and the native app build with `cargo build --release -p pekopet`. Inspect the rendered Web UI and native windows and real model before reporting visual completion. Record outstanding acceptance work in docs/ACCEPTANCE.md.

Use local incremental builds for UI iteration: `npm run build` compiles, and `npm run dev` compiles and launches. These commands load the installed x64 Build Tools environment. Keep GitHub Actions for integration and portable candidates; do not wait for cloud builds between local UI edits when the local toolchain is available.

Do not take over the foreground desktop for routine UI validation. Use `npm run check:ui` for the isolated offscreen Tauri/WebView2 app, CDP interactions and screenshots, then headless WebKit frontend checks. This mode uses a temporary DSH_HOME and a scripted model, creates no visible pet or tray, registers no pet hotkeys, never moves the system pointer, and never activates a window. It exercises real dsh file tools only inside its temporary workspace. Generated Live2D portraits and icons stay in the local model cache with attribution. Keep explicit desktop-only acceptance items in docs/ACCEPTANCE.md.

The whole application window is React. Reuse the pinned dsh frontend and its public slot extensions for messages, tools, approvals, questions and sessions; never maintain a second simplified chat renderer. PekoPet's titlebar, companion panes, model portrait, cue display projection and Soft UI tokens live in plugin/frontend; the pinned MIT Chat source and its cue display projection callers live in vendor/dsh-ui-chat. Keep the original dsh session text intact. Only root assistant prose drives native avatar cues through the Rust parser. The first desktop target is Windows x64; Win32/D3D11 desktop-pet rendering remains Windows-specific.

Use a light Soft UI palette: mist canvas #f1f5f9, white surfaces, indigo #6366f1 actions, slate text, mint/rose/amber state accents. Buttons and inputs use 16px radii, cards 24px, tinted soft shadows and readable 14–16px body copy. Respect reduced-motion preferences. Keep every pane usable at 880×680 and retain keyboard, Chinese input, selection, copying and scrolling behavior from dsh.

Release publication is manual through Publish release. Build main with the reusable Windows workflow, derive the tag from matching package/Cargo/Tauri versions, and publish only after the portable asset uploads. Preserve published tags; resume only a draft belonging to the exact build commit. Keep SDK consent limited to entropy622/PekoPet.
