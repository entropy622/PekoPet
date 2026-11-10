# PekoPet

Build the Windows x64 desktop companion with Rust/GPUI and a separate native Cubism D3D11 window. Keep the dsh agent loop, permissions, MCP configuration and skills owned by DeepSeek Harness. Launch through its desktop profile and an invocation overlay; do not edit the user's profile.

Own code uses MIT. Preserve third-party licenses. Only SDK files named in its redistribution manifest may be committed. Model caches, credentials, session logs, local state and build products stay out of Git. Models from LLM_Live2D are local evaluation assets unless redistribution permission is documented.

On 2026-11-09 the repository owner accepted the Live2D Proprietary and Open Software licenses and authorized official SDK downloads for PekoPet development, including this repository's CI. Core 5-r.5 lists the Windows library for redistribution, but omits its header. Keep that header under ignored local/cubism-core/include. Fork and pull-request checks must not accept a new license on behalf of another contributor.

Keep one JSON-RPC writer per process. Only root assistant text can emit avatar cues; tool output, reasoning, code and replay must not trigger motions. Approval defaults follow dsh. Never auto-grant an approval.

Run Node tests with `npm test`, Rust core tests with `cargo test -p peko-core`, and the native app build with `cargo build --release -p pekopet`. Inspect the running native windows and real model before reporting visual completion. Record outstanding acceptance work in docs/ACCEPTANCE.md.

The GPUI design is light Soft UI: mist canvas #f1f5f9, white surfaces, indigo #6366f1 actions, slate text, and small mint/rose/amber state accents. Keep tokens, embedded line icons, surfaces and buttons in src/ui.rs; keep pane presentation in src/views.rs. Buttons and inputs use 16px radii, cards 24px, tinted soft shadows and an 8px spacing rhythm. Use readable 14–16px body copy. Keep chat, history, memory, persona, connections, avatar debugging and approvals usable with scrolling at the minimum window size. Hover movement lasts 300ms and respects Windows reduced-motion preferences; PEKO_REDUCED_MOTION=1 disables it for validation. Preserve dsh and avatar state contracts when changing presentation.
