// vendor/dsh-ui-chat/src/index.ts
import z2 from "@deepseek-ai/schemastery";

// vendor/dsh-ui-chat/src/chat-settings.ts
import z from "@deepseek-ai/schemastery";
var CHAT_SETTINGS_NAMESPACE = "ui-chat";
var TRANSCRIPT_VIEW_FIELD = "transcriptView";
var COLLAPSE_TIMING_FIELD = "collapseTiming";
var COLLAPSE_TIMINGS = ["completion", "next-input"];
var DEFAULT_COLLAPSE_TIMING = "completion";
var TRANSCRIPT_VIEW_MODES = ["compact", "standard", "detailed", "verbose"];
var LEGACY_TRANSCRIPT_VIEW_MODE = "normal";
var LEGACY_EXPANDED_TRANSCRIPT_VIEW_MODE = "expanded";
var TRANSCRIPT_VIEW_SETTING_VALUES = [
  ...TRANSCRIPT_VIEW_MODES,
  LEGACY_TRANSCRIPT_VIEW_MODE,
  LEGACY_EXPANDED_TRANSCRIPT_VIEW_MODE
];
var DEFAULT_TRANSCRIPT_VIEW_MODE = "detailed";
var PERFORMANCE_USAGE_MODES = ["compact", "detailed"];
var DEFAULT_PERFORMANCE_USAGE = "detailed";
var DEFAULT_LINK_OPENING = "sidebar";
var ChatSettingsFields = {
  [COLLAPSE_TIMING_FIELD]: z.union([...COLLAPSE_TIMINGS]).default(DEFAULT_COLLAPSE_TIMING),
  linkOpening: z.union(["sidebar", "new-tab"]).default(DEFAULT_LINK_OPENING),
  performanceUsage: z.union([...PERFORMANCE_USAGE_MODES]).default(DEFAULT_PERFORMANCE_USAGE),
  // Missing and unrecognized modes defer to the client's default.
  [TRANSCRIPT_VIEW_FIELD]: z.union([...TRANSCRIPT_VIEW_SETTING_VALUES]).loose()
};
var ChatSettingsSchema = z.object(ChatSettingsFields);

// vendor/dsh-ui-chat/src/index.ts
var Config = z2.object({
  [TRANSCRIPT_VIEW_FIELD]: ChatSettingsFields[TRANSCRIPT_VIEW_FIELD].volatile(),
  collapseTiming: ChatSettingsFields.collapseTiming.volatile(),
  performanceUsage: ChatSettingsFields["performanceUsage"].volatile(),
  linkOpening: ChatSettingsFields.linkOpening.volatile()
});
function apply(ctx) {
  ctx.inject(["settings"], (child) => {
    child.effect(() => child.settings.configure({ auto: false }, ctx.fiber));
  });
}
export {
  CHAT_SETTINGS_NAMESPACE,
  Config,
  DEFAULT_TRANSCRIPT_VIEW_MODE,
  LEGACY_EXPANDED_TRANSCRIPT_VIEW_MODE,
  LEGACY_TRANSCRIPT_VIEW_MODE,
  TRANSCRIPT_VIEW_FIELD,
  TRANSCRIPT_VIEW_MODES,
  apply
};
