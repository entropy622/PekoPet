# Third-party components

PekoPet-authored code is MIT. The repository MIT license does not relicense these components.

| Component | Version | License / source |
|---|---|---|
| Tauri | 2.12.5 | Apache-2.0 OR MIT; tauri-apps/tauri |
| Tauri opener plugin | 2.7.2 | Apache-2.0 OR MIT; tauri-apps/plugins-workspace |
| React / React DOM | dsh frontend bundle | MIT; Meta Platforms and contributors |
| DeepSeek Harness component libraries and frontend | 0.2.1-alpha.4 | MIT; reused npm distribution; local source reference 86a402200d95fecef4529d969836f1fe13c6cb0d |
| PekoPet agent-loop source fork | 0.2.1-alpha.4 / same pinned commit | MIT; vendor/peko-agent-loop retains original source, LICENSE and SOURCES.md |
| PekoPet session control and settings forms | same pinned commit | MIT adaptations from SDK server and settings; agent/LICENSE and agent/SOURCES.md |
| dsh Chat and Conversation source forks | same pinned commit | MIT; vendor/dsh-ui-chat and vendor/dsh-ui-conversation retain LICENSE and SOURCES.md with local changes |
| Cubism Native Framework | 5-r.5, 145155d2c5bdd8d23475cef9cc3ab46d3220190c | Live2D Open Software License; vendor/cubism-framework/LICENSE.md |
| Cubism Core | Native 5-r.5 | Live2D Proprietary Software License; only files listed as redistributable may be included |

Yumi is by Erara_艾拉拉. Ice Sugar and Ellen assets retain their creators' restrictions from the original LLM_Live2D repository. The asset setup script caches these models for local evaluation. They are not committed or included in the portable package. Portrait PNG/ICO files generated from them remain in the same local cache with attribution. A local build can use its cached Yumi icon; public CI uses the PekoPet-authored fallback icon.

## Private Live2D asset library

The optional `models` submodule references the private entropy622/Live2DModels repository. It stores the owner's personal copies of the fixed characters and their original notices, with binary assets in Git LFS. The public source contains only a gitlink, integration metadata and code. Public CI does not fetch this submodule; portable packages and archives exclude its assets. Shared private storage grants no additional model rights. Keep access restricted to the owner and follow each original notice for every consuming project.

Strawberry Rabbit DLC（草莓兔兔）: illustration by 赛博撸猫人; Live2D modeling by 糖糖锦鲤. Imported from the user-supplied 草莓兔兔-DLC+(2).zip with the original 草莓猫猫兔使用说明.txt retained. The notice requests no reuploading. Its watermark, hairstyle and game-button expressions are excluded from semantic emotion control. Runtime expressions and motions are discovered from the original files without rewriting them. Derived portraits remain in the local cache and are excluded from public distribution.

The Cubism Core importer retains its license and redistribution list. The official SDK download requires accepting Live2D's license agreements. Model-import expansion and public binary distribution require a release-license review separate from source-code development.

## DeepSeek-chan local model

DeepSeek-chan（大肥鱼）: original art and separation by 神宫凉子; Live2D modeling by 霓虹猫_NeonNeko. The supplied usage notice permits personal use and parameter adjustments and prohibits redistributing or reuploading the complete model. `scripts/import-deepseek.mjs` copies the runtime folder and its original usage notice into ignored `local/models/deepseek`, preserving their names. Model assets, thumbnails and derived portraits are excluded from the public repository and portable releases. The authoring PSD is not imported. This character's emotion catalog excludes clothing and body-shape controls.
