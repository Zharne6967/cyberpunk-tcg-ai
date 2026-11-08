# Mapa drogi (etapy)

Każdy etap to osobna sesja pracy, zakończona działającą wersją i paczką ZIP.

| # | Etap | Co powstaje | Status |
|---|------|-------------|--------|
| 1 | Fundament | silnik zasad (vendor), baza kart `data/cards.json`, zasady `data/rules`, talie `data/decks`, parser list talii, symulator `pnpm sim` | ✅ gotowe |
| 2 | Gra w przeglądarce | serwer + stół do gry vs bot, klik w kartę → pełny opis, log ruchów, wszystkie wybory (cele, triggery, kradzież Gigów), `start.bat` dla Windows, lokalne obrazki kart | ✅ gotowe |
| 3 | Silny, uczciwy bot | determinizacja ukrytych kart + ISMCTS w wątkach roboczych, poziomy trudności, benchmark vs obecne boty | ⏳ następny |
| 4 | Uczenie się | zapis każdej partii, nocny self-play, strojenie oceny pozycji, „bramka” (nowa wersja musi pokonać starą), raport czego się nauczył, model Twojego stylu gry | |
| 5 | Talie z sieci | importery (tcgcontender, ripperdeck, choombattler, exburst, tekst), snapshot mety, gauntlet, analiza talii w UI (krzywa, Eddies, aggro, tempo kluczowych kart) | |
| 6 | AI deck builder | generowanie talii + weryfikacja tysiącami symulacji vs meta, wyjaśnienia wyborów | |
| 7 | Asystent zasad i trener | czat (Claude API lub Ollama), RAG po zasadach/FAQ/kartach, analiza partii po meczu, podpowiedzi w trakcie gry | |
| 8 | Szlify | tryb offline, aktualizacja kart z nowych dodatków, instrukcja | |

## Decyzje
- Silnik zasad: `thecardgoat/tcg-engines` (MIT) — deterministyczny, test na każdą regułę Comprehensive Rules i każdą z 152 kart. Szczegóły i lokalne łatki: `vendor/UPSTREAM.md`.
- Dostarczanie: paczka ZIP (z historią git) na koniec każdego etapu.
- Asystent: Claude API (domyślnie) + przełącznik na lokalny Ollama.
- System docelowy: Windows (skrypty `.bat`), działa też na macOS/Linux.

## Stan botów (punkt odniesienia z etapu 1)
Pomiar (12 gier, talia The Heist w lustrze, `pnpm sim`): `tactical` vs `greedy` = 11/12 (92%, 95% CI 65–99%), ~7,5 s na partię.

Boty z silnika upstream: `greedy` (łatwy), `tactical` (minimax głębokość 3), `masterful`; `expert-oracle`, `monte-carlo`, `mcts` **podglądają ukryte karty** — nie nadają się jako uczciwy przeciwnik. Etap 3 dodaje własnego, uczciwego i silniejszego bota.

## Etap 2 — notatki techniczne
- Serwer liczy listę legalnych akcji silnikiem (`enumerateCandidateActions` / `enumerateChoiceActions`)
  i **sprawdza każdą na kopii gry** przed pokazaniem (silnik potrafi zgłosić opcję, którą potem odrzuca,
  np. d20 z Fixera). Efekty „zmień Gig o 1” wymagają wyboru kości i wartości naraz (`resolveAdjustGig`).
- Bot liczy ruch w `worker_threads` na kopii stanu; serwer stosuje komendę na autorytatywnym silniku.
- Test end-to-end: `pnpm selftest 10 tactical` — 10/10 partii zakończonych, 0 błędów
  (wybory: first player, gainGig, chooseTarget, chooseGigsToSteal, chooseEffect, chooseTrigger,
  chooseCardToMove/Play, chooseCardType, scry).
