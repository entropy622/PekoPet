# PekoPet implementation

The Rust process owns GPUI, the native Live2D rendering thread, incremental cue parsing, and the dsh subprocess lifetime. It sends newline-delimited JSON-RPC to one stdio writer. Only active root assistant text feeds the cue parser. Committed messages reconcile the visible transcript; replay never invokes motions.

The external Cordis plugin reuses `HarnessSdkJsonRpcServer`, forwards `agent/assistant-stream`, mounts the selected desktop agent preset, answers native UI approvals, and owns the PekoPet SQLite store. Memory extraction runs in a separate dsh Agent with an empty tool allowlist. User statements are identified by their source metadata; model and tool claims do not enter automatic extraction.

## Shared desktop configuration

dsh 0.2.1-alpha.4 reserves the `desktop` profile for its Electron launcher. PekoPet launches the supported `peko` profile under the same DSH_HOME. At each launch it refreshes the desktop bundle metadata and makes a hard link to the desktop patch file. Installed desktop plugins are referenced through a directory junction. Home-level overrides retain normal dsh precedence. PekoPet writes its own application settings only to `peko-pet/state.sqlite3`.

The invocation overlay disables browser presentation and mounts the SDK startup and PekoPet plugin. The native Schedule agent resolver replaces the browser session controller for reminder delivery. The existing dsh agent loop and permission services stay unchanged.

## Avatar cue

`[[peko:{"mix":{"星星眼":0.8},"hold":2500}]]` changes a temporary emotional overlay. `params` holds whitelisted model parameter values, `motion` chooses an existing motion, `layers` toggles persistent poses and props, and `clear` removes previous overlays. Names and parameter ranges come from the loaded model. Control markers are hidden from display and copy while raw dsh transcripts retain them.

The native window uses a premultiplied-alpha DirectComposition swapchain and Cubism D3D11 renderer. Framework shaders are embedded at build time and served through Cubism's file callbacks. Texture decoding stays in Rust so WebP assets work without optional Windows codecs. Cubism parameters reload the saved motion baseline every frame before gaze, expressions and physics. Expression targets ease over 120 ms.

## State and recovery

Conversations remain in dsh persistence. SQLite contains the PekoPet session index, message projection, preferences, memories, deletion fingerprints, persistent avatar layers and proactive counters. Deletion fingerprints prevent an automatically extracted fact from returning. Every memory also retains its source session and event sequence.

Transport loss does not replay a user prompt. The user reconnects and resumes the existing session. Shutdown first requests dsh disposal; the process-tree fallback targets only the application-owned launcher PID.

## Build faces

The normal Cargo build compiles and links the native bridge and licensed Cubism Core. `PEKO_TYPECHECK=1 cargo check -p pekopet` checks Rust and GPUI without producing a linked native application. It provides useful CI coverage before the SDK is available; it is not a native build or visual acceptance check.
