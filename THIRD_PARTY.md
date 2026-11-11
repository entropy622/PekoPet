# Third-party components

PekoPet-authored code is MIT. Model assets and third-party components retain their own licenses.

| Component | Version | License / source |
|---|---|---|
| Electron | 45.3.0 | MIT; bundled Chromium and third-party notices are retained in the portable application |
| Node.js | 24.x, exact bundled build recorded by its binary | Node.js license; LICENSE-NODE in portable outputs |
| React / React DOM | pinned dsh frontend distribution | MIT; Meta Platforms and contributors |
| DeepSeek Harness component libraries | 0.2.1-alpha.4 | MIT; source baseline 86a402200d95fecef4529d969836f1fe13c6cb0d |
| PekoPet agent-loop fork | same baseline | MIT; vendor/peko-agent-loop LICENSE and SOURCES.md |
| Session controller and settings adaptations | same baseline | MIT; agent/LICENSE and agent/SOURCES.md |
| dsh Chat and Conversation forks | same baseline | MIT; vendor/dsh-ui-chat and vendor/dsh-ui-conversation retain LICENSE and SOURCES.md |
| Cubism Web Framework and GLSL shaders | SDK for Web 5-r.5 | Live2D Open Software License; vendor/cubism-web-framework/LICENSE.md |
| Cubism Core for Web | SDK for Web 5-r.5 | Live2D Proprietary Software License; vendor/cubism-web-core/LICENSE.md and RedistributableFiles.txt |

Only live2dcubismcore.min.js and live2dcubismcore.d.ts from the Core runtime are included, as listed in its redistribution manifest. Core source maps and unrelated SDK files are not included. The repository owner authorized the official Web SDK download and both Live2D agreements on 2026-11-11. Third-party npm license notices remain with their packages in the private Node runtime.

## Models and portraits

The optional models submodule references the private entropy622/Live2DModels repository. It contains personal copies and the supplied author notices. Public source records only a gitlink and integration metadata. Public CI does not fetch this library, and portable outputs exclude its contents. Keep the library private and follow each creator's original terms in every consuming project. Generated portraits remain in the user's local cache with attribution.

- Yumi: Erara_艾拉拉. The original LLM_Live2D source revision is fixed in assets/model-files.json.
- Ice Sugar: 神宫凉子. Ellen: 神宫凉子 / 杨小唸. Retain their original restrictions and notices.
- DeepSeek-chan（大肥鱼）: original art and separation by 神宫凉子; modeling by 霓虹猫_NeonNeko. Its supplied notice restricts complete-model redistribution. The local importer retains the runtime directory and notice and omits authoring PSD files.
- Strawberry Rabbit DLC（草莓兔兔）: illustration by 赛博撸猫人; modeling by 糖糖锦鲤. Imported from the user-supplied 草莓兔兔-DLC+(2).zip with 草莓猫猫兔使用说明.txt retained. The notice requests no reuploading. Watermark, hairstyle and game-button controls stay outside the semantic emotion catalog.

A private copy grants no additional rights. Public release licensing remains governed by the SDK and model terms. Public CI uses the PekoPet-authored fallback executable icon; runtime window and tray icons can use locally generated portraits.
