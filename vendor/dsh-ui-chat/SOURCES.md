# dsh Chat frontend

Source: https://github.com/deepseek-ai/deepseek-harness/tree/86a402200d95fecef4529d969836f1fe13c6cb0d/packages/client/ui-chat
Version: 0.2.1-alpha.4. License: MIT, retained in LICENSE.

Local changes: AssistantMarkdown.tsx filters PekoPet control markers from visible assistant prose; turn-assistant.ts applies the same projection to copied assistant text; TurnTailNodeView.tsx passes the interrupted state so incomplete control prefixes stay hidden. TurnProcessNodeView.tsx exposes a semantic outcome attribute so PekoPet can hide routine completed prose-only timing rows while retaining stopped/error and tool progress. Original messages, stream events, reasoning, tool cards, approval handling, node declarations and slot ownership stay with dsh. The shared display helper lives in plugin/frontend/text.mjs.

Run npm run build:frontend to build the pinned frontend copy and the PekoPet extension. index.mjs is built from the same pinned host preferences source.
