# Third-party components

PekoPet-authored code is MIT. The repository MIT license does not relicense these components.

| Component | Version | License / source |
|---|---|---|
| Tauri | 2.12.5 | Apache-2.0 OR MIT; tauri-apps/tauri |
| Tauri opener plugin | 2.7.2 | Apache-2.0 OR MIT; tauri-apps/plugins-workspace |
| React / React DOM | dsh frontend bundle | MIT; Meta Platforms and contributors |
| DeepSeek Harness runtime and frontend | 0.2.1-alpha.4 | MIT; reused npm distribution; local source reference 86a402200d95fecef4529d969836f1fe13c6cb0d |
| dsh Chat and Conversation source forks | same pinned commit | MIT; vendor/dsh-ui-chat and vendor/dsh-ui-conversation retain LICENSE and SOURCES.md with local changes |
| Cubism Native Framework | 5-r.5, 145155d2c5bdd8d23475cef9cc3ab46d3220190c | Live2D Open Software License; vendor/cubism-framework/LICENSE.md |
| Cubism Core | Native 5-r.5 | Live2D Proprietary Software License; only files listed as redistributable may be included |

Yumi is by Erara_艾拉拉. Ice Sugar and Ellen assets retain their creators' restrictions from the original LLM_Live2D repository. The asset setup script caches these models for local evaluation. They are not committed or included in the portable package. Portrait PNG/ICO files generated from them remain in the same local cache with attribution. A local build can use its cached Yumi icon; public CI uses the PekoPet-authored fallback icon.

The Cubism Core importer retains its license and redistribution list. The official SDK download requires accepting Live2D's license agreements. Model-import expansion and public binary distribution require a release-license review separate from source-code development.

## DeepSeek-chan local model

DeepSeek-chan（大肥鱼）: original art and separation by 神宫凉子; Live2D modeling by 霓虹猫_NeonNeko. The supplied usage notice permits personal use and parameter adjustments and prohibits redistributing or reuploading the complete model. `scripts/import-deepseek.mjs` copies the runtime folder and its original usage notice into ignored `local/models/deepseek`, preserving their names. Model assets, thumbnails and derived portraits are excluded from the public repository and portable releases. The authoring PSD is not imported. This character's emotion catalog excludes clothing and body-shape controls.
