# Benchmark botów

Generowane przez `pnpm bench` (ziarna parami, zamiana miejsc, 8 par talii z `data/decks`, budżety w iteracjach —
wynik nie zależy od obciążenia komputera). Boty: `greedy` = Easy, `tactical` = Normal, `masterful` = Hard
(z silnika upstream), `ismcts-fast` = Very Hard (300 iteracji), `ismcts` = Master (1200 iteracji).
Wszystkie te boty są uczciwe (nie widzą Twojej ręki ani kolejności talii); ISMCTS dowodzi tego test
`packages/ai/src/ismcts/fairness.test.ts`.

## Ocena pozycji: wyuczona vs `evaluateBoard` (2026-11-08)
ISMCTS 300 iteracji przeciw Hard, te same talie i ziarna (`--seed ab1`):

| Ocena końca symulacji | A wygrywa | 95% CI |
|---|---|---|
| `evaluateBoard` z silnika (skala 160) | 18/32 = 56.3% | 39–72% |
| **wyuczona regresja logistyczna** (`pnpm calibrate`, 1000 partii) | **26/32 = 81.3%** | **65–91%** |

Jakość ocen na odłożonych partiach (2347 pozycji): `evaluateBoard` log loss 0.727 / trafność 65.2%,
model wyuczony 0.537 / 68.5% (rzut monetą: 0.693).

Szczegóły par (model wyuczony): Alt+Gears vs Hanako 3/4, Judy vs Yorinobu 0/4, RRY Detonate vs Overwatch 4/4,
Dexter/Dum Dum vs Alt+Gears 4/4, Cyberpsychosis vs RRY Steel Dragon 3/4, Overwatch vs Johnny 4/4,
RYB Tempo vs Dexter/Dum Dum 4/4, The Heist vs Relic+Placide 4/4.

## Very Hard (ISMCTS 300) vs Easy (2026-11-08)
A = `ismcts-fast` `{}`, B = `greedy`

**A wygrywa 30/32 = 93.8%** (95% CI 80–98%), czas decyzji A 2272 ms, B 1 ms (1 wątek na partię, 15 partii naraz).

| Para talii (A vs B) | wygrane A |
|---|---|
| Alt + Gears — Multiplied Economy vs Hanako + Netdriver — Gigs as Draw Engine | 4/4 |
| Judy — Top-of-Deck Discount, Not a Guaranteed Top vs Yorinobu — Two Units for the Price of One | 2/4 |
| RRY — Detonate gear curve vs Overwatch — Recharge Control | 4/4 |
| Dexter / Dum Dum / River — Gear Aggro (Top 16) vs Alt + Gears — Multiplied Economy | 4/4 |
| Cyberpsychosis + Deadman — Burst with Insurance vs RRY — Steel Dragon on curve | 4/4 |
| Overwatch — Recharge Control vs Johnny — Fight, Ready and Steal | 4/4 |
| Red/Yellow/Blue — Low-Cost Tempo vs Dexter / Dum Dum / River — Gear Aggro (Top 16) | 4/4 |
| The Heist Starter Deck vs Relic + Placide — Surgical Reanimation | 4/4 |

## Very Hard (ISMCTS 300) vs Normal (2026-11-08)
A = `ismcts-fast` `{}`, B = `tactical`

**A wygrywa 29/32 = 90.6%** (95% CI 76–97%), czas decyzji A 2319 ms, B 62 ms (1 wątek na partię, 15 partii naraz).

| Para talii (A vs B) | wygrane A |
|---|---|
| Alt + Gears — Multiplied Economy vs Hanako + Netdriver — Gigs as Draw Engine | 3/4 |
| Judy — Top-of-Deck Discount, Not a Guaranteed Top vs Yorinobu — Two Units for the Price of One | 2/4 |
| RRY — Detonate gear curve vs Overwatch — Recharge Control | 4/4 |
| Dexter / Dum Dum / River — Gear Aggro (Top 16) vs Alt + Gears — Multiplied Economy | 4/4 |
| Cyberpsychosis + Deadman — Burst with Insurance vs RRY — Steel Dragon on curve | 4/4 |
| Overwatch — Recharge Control vs Johnny — Fight, Ready and Steal | 4/4 |
| Red/Yellow/Blue — Low-Cost Tempo vs Dexter / Dum Dum / River — Gear Aggro (Top 16) | 4/4 |
| The Heist Starter Deck vs Relic + Placide — Surgical Reanimation | 4/4 |
