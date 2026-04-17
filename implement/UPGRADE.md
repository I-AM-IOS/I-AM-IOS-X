# I-AM-IOS Monorepo — Upgrade Notes (v2.0.0)

## What Changed

### New Packages Added
| Package | Path | Description |
|---|---|---|
| `@i-am-ios/validator` | `packages/validator/` | BFT validator node (HTTP + consensus engine) |
| `@i-am-ios/relay`     | `packages/relay/`     | P2P relay bridge between validator and peers |
| `@i-am-ios/cli`       | `packages/cli/`       | `iamios` CLI: init, validator, status, deploy |
| `@i-am-ios/shared`    | `packages/shared/`    | Shared utilities and constants |
| `create-i-am-ios-app` | `packages/create-i-am-ios-app/` | Interactive project scaffolder |

### SDK (`packages/sdk/`) Upgrades
- `src/index.ts` — full barrel export (core + types)
- `src/react/index.tsx` — SovereignProvider + context (v2 provider pattern)
- `src/react/hooks.tsx` — useSovereignLog, useNetworkStatus hooks
- `src/vue/index.ts` — sovereignPlugin + composables (v2 plugin pattern)
- `src/vue/composables.ts` — useSovereignLog, useNetworkStatus composables
- `src/svelte/index.ts` — writable/derived stores + configureSovereign
- `src/svelte/stores.ts` — createSovereignLog store factory
- `src/sovereign-log.ts` — upgraded full-featured version
- `src/hybrid-network.ts` — upgraded with full mode-switching logic

### Infrastructure Added
- `docker-compose.yml` — spins up validator (8080) + relay (8091)
- `packages/validator/Dockerfile`
- `packages/relay/Dockerfile`
- `.env.example` files at root and per-service

## Quick Start

```bash
cd implement

# Option A — Docker (recommended for production)
docker compose up --build

# Option B — Local dev
npm install
npm run dev:validator   # validator on :8080
npm run dev:relay       # relay on :8091
npm run build           # compile SDK TypeScript
```

## SDK Usage

```ts
// React
import { SovereignProvider, useSovereignLog } from '@i-am-ios/sdk/react';

// Vue
import { sovereignPlugin, useSovereignLog } from '@i-am-ios/sdk/vue';

// Svelte
import { configureSovereign, sovereignLog } from '@i-am-ios/sdk/svelte';

// Vanilla TS
import { SovereignLog, HybridNetwork } from '@i-am-ios/sdk';
```
