# PekoPet agent loop

Forked from DeepSeek Harness 0.2.1-alpha.4, commit 86a402200d95fecef4529d969836f1fe13c6cb0d, packages/core/agent-loop (MIT). Original source and LICENSE are retained. PekoPet owns and builds these local TypeScript files; runtime composition always selects this driver for root and child agents. No installed dsh CLI or upstream loop is invoked. Changes: explicit PekoPet ownership marker; application boot, configuration boundaries, persistence and lifecycle live in agent/. Build with node scripts/build-frontend.mjs.
