# PekoPet

Build the Windows x64 desktop companion with Rust/GPUI and a separate native Cubism D3D11 window. Keep the dsh agent loop, permissions, MCP configuration and skills owned by DeepSeek Harness. Launch through its desktop profile and an invocation overlay; do not edit the user's profile.

Own code uses MIT. Preserve third-party licenses. Only SDK files named in its redistribution manifest may be committed. Model caches, credentials, session logs, local state and build products stay out of Git. Models from LLM_Live2D are local evaluation assets unless redistribution permission is documented.

Keep one JSON-RPC writer per process. Only root assistant text can emit avatar cues; tool output, reasoning, code and replay must not trigger motions. Approval defaults follow dsh. Never auto-grant an approval.

Run Node tests with `npm test`, Rust core tests with `cargo test -p peko-core`, and the native app build with `cargo build --release -p pekopet`. Inspect the running native windows and real model before reporting visual completion. Record outstanding acceptance work in docs/ACCEPTANCE.md.
