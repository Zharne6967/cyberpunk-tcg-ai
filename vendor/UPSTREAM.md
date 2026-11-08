# Vendored upstream code

Source: https://github.com/thecardgoat/tcg-engines (MIT, see `LICENSE-tcg-engines`)
commit: `6de59de1c203827edc1bc6faa1bc6184cd126a5f`

| Here | Upstream path |
|---|---|
| `cyberpunk-engine` | `submodules/cyberpunk/packages/engine` |
| `cyberpunk-cards` | `submodules/cyberpunk/packages/cards` |
| `cyberpunk-types` | `submodules/cyberpunk/packages/types` |
| `cyberpunk-utils` | `submodules/cyberpunk/packages/utils` |
| `cyberpunk-typescript-config` | `submodules/cyberpunk/packages/typescript-config` |
| `cyberpunk-ai-runner` | `submodules/cyberpunk/tools/ai-runner` |
| `card-model`, `engine-core`, `bot-core`, `protocol` | `submodules/agnostic-simulator/packages/*` |
| `../data/rules/upstream-references` | `submodules/cyberpunk/.agents/skills/cyberpunk-tcg-rules/references` |

## Local patches (keep this list short; re-apply after a sync)
1. `package.json` files: `link:`/`catalog:` deps rewritten to `workspace:*` / concrete versions;
   vite-plus / tsgo dev tooling removed; `vite.config.ts` (vite-plus) files deleted.
2. `card-model/src/conformance.ts` deleted (compile-time check against other games' packages).
3. Relative imports that crossed the old monorepo layout repointed
   (`cyberpunk-ai-runner/src/legal-decks.ts`, `unit-development-benchmark.ts`,
   `cyberpunk-engine/tests/automation/expert-live-cycle.test.ts`,
   `cyberpunk-engine/tests/comprehensive-rules/{coverage,cr-setup}.test.ts`).
4. Tests import `vite-plus/test`; the root `vitest.config.ts` aliases it to `vitest`.
5. Agnostic packages tsconfig.json made standalone (upstream extended `../typescript-config/node.json`).

## Known test failures (as of the vendored commit, Node 22, vitest 3)
2863/2868 upstream tests pass. The 5 failures are not rules bugs:
- `cyberpunk-ai-runner/tests/runner.test.ts` (2) — spawns worker threads without a TS loader
  inside vitest (`Cannot find module .../deadlock.js`). Environment only. Excluded.
- `protocol/src/native.test.ts` — JSON-schema snapshot differs with a newer `zod`. Excluded.
- `cyberpunk-cards/tests/canonical-authorship.test.ts` — the stale scraped `rawCards` row for
  Alt Cunningham: Soulkiller Architect lacks its first ability; the authored definition matches the
  official API (verified 2026-11-08 via api.netdeck.gg). Excluded.
- `cyberpunk-engine/src/cards/programs/shattered-memories.test.ts` — one assertion about an
  animation "emphasis" step (presentation only, game state is correct). Left visible.
6. `cyberpunk-engine/src/index.ts`: re-export `enumerateCandidateActions` / `enumerateChoiceActions`
   (used by the game server to list legal actions for the human player).
7. `cyberpunk-engine/src/command/processor.ts`: added `processCommandLean` (same rules path as
   `processCommand`, without undo patches / move logs / animation / clock) for ISMCTS simulations;
   exported from `command/index.ts` and `src/index.ts`. Never used for the authoritative game.
8. `cyberpunk-engine/src/view/filter.ts`: face-down Legends are hidden from their owner too
   (CR 5.7.4.1; only `meta.revealed` from a "look at" effect shows them), also as effect sources.
   Test `tests/comprehensive-rules/cr-gigs-hidden.test.ts` updated to assert the rule.
9. Tests adjusted to patch 8 / Windows:
   - `cyberpunk-ai-runner/tests/curve-prompt-lines.test.ts`: 5 tests skipped (`test.skip`, comment in place) —
     they assert that an upstream bot calls one specific face-down Legend by identity, which CR 5.7.4.1
     makes impossible.
   - `cyberpunk-engine/tests/automation/boundary.test.ts`: path check normalises Windows `\` separators.
   - `cyberpunk-ai-runner/tests/train.test.ts` can time out when the CPU is busy (e.g. a benchmark running);
     it passes on its own.
