// vendor/dsh-ui-conversation/src/index.ts
import z2 from "@deepseek-ai/schemastery";

// vendor/dsh-ui-conversation/src/submission-settings.ts
import z from "@deepseek-ai/schemastery";
var CONVERSATION_SETTINGS_NAMESPACE = "ui-conversation";
var BUSY_ENTER_FIELD = "busyEnter";
var BUSY_ENTER_BEHAVIORS = ["queue", "steer"];
var DEFAULT_BUSY_ENTER_BEHAVIOR = "queue";
var ConversationSettingsFields = {
  [BUSY_ENTER_FIELD]: z.union([...BUSY_ENTER_BEHAVIORS]).default(DEFAULT_BUSY_ENTER_BEHAVIOR)
};
var ConversationSettingsSchema = z.object(ConversationSettingsFields);

// vendor/dsh-ui-conversation/src/index.ts
var Config = z2.object({
  [BUSY_ENTER_FIELD]: ConversationSettingsFields[BUSY_ENTER_FIELD].volatile()
});
function apply(ctx) {
  ctx.inject(["settings"], (child) => {
    child.effect(() => child.settings.configure({ auto: false }, ctx.fiber));
  });
}
export {
  BUSY_ENTER_BEHAVIORS,
  BUSY_ENTER_FIELD,
  CONVERSATION_SETTINGS_NAMESPACE,
  Config,
  DEFAULT_BUSY_ENTER_BEHAVIOR,
  apply
};
