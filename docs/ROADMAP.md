# Mapa drogi (etapy)

Każdy etap to osobna sesja pracy, zakończona działającą wersją i paczką ZIP.

| # | Etap | Co powstaje | Status |
|---|------|-------------|--------|
| 1 | Fundament | silnik zasad (vendor), baza kart `data/cards.json`, zasady `data/rules`, talie `data/decks`, parser list talii, symulator `pnpm sim` | ✅ gotowe |
| 2 | Gra w przeglądarce | serwer + stół do gry vs bot, klik w kartę → pełny opis, log ruchów, wszystkie wybory (cele, triggery, kradzież Gigów), `start.bat` dla Windows, lokalne obrazki kart | ✅ gotowe |
| 3 | Silny, uczciwy bot | determinizacja ukrytych kart + ISMCTS w wątkach roboczych, poziomy trudności, benchmark vs obecne boty | 🔶 działa (Very Hard bije Hard 81%), strojenie trwa |
| 4 | Stół jak na żywo | rewersy kart, ukryte własne Legendy (zgodnie z CR), losowanie pierwszego gracza w okienku, przeciąganie kart na strefy, tryb „bez podpowiedzi” | 🔶 wersja 1 gotowa |
| 5 | Deck builder | panel składania talii: wyszukiwarka i filtry kart, legalność na żywo, krzywa/kolory, zapis/eksport/import listy | 🔶 wersja 1 gotowa |
| 5b | Gra ze znajomym przez internet | kolega gra u siebie: (A) ta sama aplikacja u niego (ZIP + `instaluj.bat`) vs bot, (B) mecz człowiek–człowiek: pokoje z kodem, dwa ludzkie miejsca, każdy widzi tylko swoje karty, dostęp przez Tailscale/Cloudflare Tunnel albo mały serwer w chmurze | plan na później |
| 6 | Uczenie się | zapis każdej partii, nocny self-play, strojenie oceny pozycji, „bramka” (nowa wersja musi pokonać starą), raport czego się nauczył, model Twojego stylu gry | |
| 7 | Talie z sieci | importery (tcgcontender, ripperdeck, choombattler, exburst, tekst), snapshot mety, gauntlet, analiza talii w UI (krzywa, Eddies, aggro, tempo kluczowych kart) | |
| 8 | AI deck builder | generowanie talii + weryfikacja tysiącami symulacji vs meta, wyjaśnienia wyborów | |
| 9 | Asystent zasad i trener | czat (Claude API lub Ollama), RAG po zasadach/FAQ/kartach, analiza partii po meczu, podpowiedzi w trakcie gry (tylko w trybie nauki) | |
| 10 | Szlify | tryb offline, aktualizacja kart z nowych dodatków, instrukcja | |

> Kolejność 4–5 wynika z uwag po pierwszej partii (2026-11-08): najpierw stół ma wyglądać i działać jak prawdziwa
> karcianka, potem własne talie. Uczenie się bota przesunięte na etap 6.

## Etap 4 — Stół jak na żywo
Cel: grasz jak przy prawdziwym stole — sam pamiętasz, co możesz zrobić; system tylko pilnuje zasad.
Wzory od gracza (tylko lokalnie, `var/reference/`): oficjalna mata `playmat-official.png` i interfejs
https://cyberpunk-tcg-sim.online/creator-studio/ (`ui-cyberpunk-tcg-sim.webp`) — przenosimy *układ*, nie grafiki.

**Zasada nadrzędna: interfejs gry po angielsku, wyłącznie oficjalne nazwy z Comprehensive Rules i kart**
(Play a Card, Sell a Card, Call a Legend, Activate an Effect, Attack, [BLOCKER], [GO SOLO], Pass Turn, Start/Main
Phase, React/Fight/Steal Step, Fixer, Gigs, Eddies, Street Cred…), bez własnych dopisków. Dokumentacja dla
gracza (README, ten plik) zostaje po polsku.

Zrobione (wersja 1, 2026-11-08):
1. ✅ Ukryte własne zakryte Legendy (CR 5.7.4.1, łatka 8 w `vendor/UPSTREAM.md`), Call a Legend po pozycji;
   bot też już nie zna swoich zakrytych Legend.
2. ✅ Rewersy (własny projekt CSS; Legenda ma inny rewers niż karta z talii — CR 3.4.1): talie jako stosy,
   ręka rywala, zakryte Legendy i Eddies.
3. ✅ Okienko startu: CR 7.5 (losowy gracz decyduje, kto zaczyna) → Go first / Go second; potem Keep / Mulligan.
4. ✅ Przeciąganie: z ręki na FIELD (Play a Card), na swoją Jednostkę/odkrytą Legendę (Gear), na EDDIES
   (Sell a Card); Jednostką na Jednostkę rywala (Attack) albo na RIVAL GIGS (atak na Gigi); w React Step
   Jednostką na atakującego ([BLOCKER]). Klik w kartę = menu z oficjalnymi akcjami (bez filtrowania
   legalności), prawy klik = podgląd karty, klik w kość = wybór Giga, Enter = Pass. Gest idzie do serwera jako
   *intencja* (`handleIntent` w `apps/server/src/game.ts`): serwer wybiera pasujący legalny ruch, przy kilku
   pyta (okienko), przy żadnym pokazuje powód z silnika (np. „Not enough eddies”).
5. ✅ Stół w układzie maty: mata rywala obrócona o 180° u góry, w środku RIVAL GIGS | faza + Pass | FRIENDLY GIGS;
   każda mata: FIXER (D20…D4), FIELD (Gear wsunięty pod Jednostkę), LEGENDS, EDDIES, DECK, TRASH (klik = lista).
6. ✅ Tryb „bez podpowiedzi” domyślnie; „Learning mode” (przełącznik u góry) włącza poświatę kart z legalnymi
   ruchami, listę akcji, tagi LAG/FX i statystyki bota. Panel decyzji pokazuje tylko wybory, których wymagają zasady.
- Testy: `pnpm selftest 4 greedy` — 4/4 partie, połowa ruchów wysłana jako gesty (51 intencji), 0 błędów.

Do zrobienia w etapie 4:
- animacja losowania pierwszego gracza; animacje zagrania/ataku (karta „leci” na miejsce);
- dopracowanie wyglądu maty (kształty kości, opcjonalny własny skan maty jako tło), układ dla ekranów < 900 px wysokości;
- wybór celów efektów kliknięciem na stole z lepszą informacją zwrotną; Scry jako przeciąganie kart;
- ręczny test całej partii przez gracza i poprawki z jego uwag.

## Etap 5 — Deck builder
Wzory od gracza: deck builder https://cyberpunk-tcg-sim.online/deck-builder/ (układ, filtry, statystyki)
i widok talii na exburst.dev (siatka obrazków z licznikami, nagłówek z Legendami i „Legal ✓”).
Własny kod i wygląd, bez ich grafik; interfejs po angielsku, oficjalne nazwy.

Zrobione (wersja 1, 2026-11-08) — ekran `#/builder` (przycisk **Deck Builder** w lobby):
- pasek: zapisane talie (★ = Twoje), Load / New Deck / Copy / Delete / Import, nazwa, Save Deck, Export, Play;
  talie wbudowane (`data/decks`) są tylko do odczytu — Save tworzy Twoją kopię w `var/decks`;
- Library: wyszukiwarka ze składnią filtrów (`type:unit cost<=3 color:blue ram>=2 tag:netrunner kw:blocker
  sell:yes`, słowa w cudzysłowie), przyciski Type / Color / Cost / RAM, „Match Legends RAM”, sortowanie
  Cost / Name / Number; klik = dodaj (Legenda → obszar Legend), prawy klik = podgląd karty z rulingami;
- talia: 3 Legendy + RAM na kolor, karty pogrupowane (Units / Gears / Programs) z licznikami i +/−,
  statystyki (Main Deck x/40–50, Average cost, Sellable, Status), krzywa kosztów, kolory,
  Draw Starting Hand (6 losowych kart);
- legalność liczona na serwerze oficjalnymi regułami (CR 7.3: 3 Legendy o różnych nazwach, 40–50 kart,
  max 3 kopie, RAM per kolor) — lista problemów pod statystykami;
- API: `POST /api/decks/check`, `POST /api/decks/import`, `PUT /api/decks/:id`, `DELETE /api/decks/:id`.

Do zrobienia: sideboard (do 7 kart), eksport jako obrazek/link, porównanie dwóch talii, tryb „kolekcja”
(tylko posiadane karty), prawdopodobieństwa dobrania (Draw %).

## Decyzje
- Silnik zasad: `thecardgoat/tcg-engines` (MIT) — deterministyczny, test na każdą regułę Comprehensive Rules i każdą z 152 kart. Szczegóły i lokalne łatki: `vendor/UPSTREAM.md`.
- Dostarczanie: paczka ZIP (z historią git) na koniec każdego etapu.
- Asystent: Claude API (domyślnie) + przełącznik na lokalny Ollama.
- System docelowy: Windows (skrypty `.bat`), działa też na macOS/Linux.

## Stan botów (punkt odniesienia z etapu 1)
Pomiar (12 gier, talia The Heist w lustrze, `pnpm sim`): `tactical` vs `greedy` = 11/12 (92%, 95% CI 65–99%), ~7,5 s na partię.

Boty z silnika upstream: `greedy` (łatwy), `tactical` (minimax głębokość 3), `masterful`; `expert-oracle`, `monte-carlo`, `mcts` **podglądają ukryte karty** — nie nadają się jako uczciwy przeciwnik. Etap 3 dodaje własnego, uczciwego i silniejszego bota.

## Etap 3 — stan
Zrobione:
- `packages/ai/src/ismcts/` — **SO-ISMCTS** (jedno drzewo z perspektywy bota, nowa determinizacja w każdej
  iteracji, UCB z licznikami dostępności, ruchy rywala kluczowane tym, co bot *widzi* — „rywal zagrywa kartę X”).
  - `determinize.ts` — losuje Twoją rękę, kolejność obu talii, zakryte Legendy/Eddies i ziarno RNG z kanonicznych
    (posortowanych) multizbiorów; zna listę talii rywala (jawne listy), nie zna ręki ani kolejności.
    `KnowledgeTracker` pamięta karty, które bot już widział; karta wtasowana z powrotem do talii zachowuje tylko
    „jest gdzieś w talii”, nigdy pozycję (ważne przy mulliganie). Swoich zakrytych Legend bot nie zna (CR 5.7.4.1).
  - `playout.ts` — dogrywka polityką greedy (ε=0,1) do początku następnej tury bota.
  - `evaluation.ts` — **wyuczona ocena pozycji** (regresja logistyczna na cechach planszy obu graczy, 1000 partii
    self-play, `pnpm calibrate`): log loss 0.537 / trafność 68.5% na odłożonych partiach, wobec 0.727 / 65.2%
    dla `evaluateBoard` z silnika (gorzej niż moneta, 0.693). Ten sam model liczy licznik „Win chance” na stole
    (wyłącznie z informacji publicznych).
  - `search.ts` — budżet iteracji/czasu, scalanie statystyk korzenia z wielu wątków.
  - `fairness.test.ts` — dwa światy różniące się tylko ukrytymi kartami dają **identyczne** statystyki wyszukiwania.
- Silnik: `processCommandLean` (lokalna łatka 7) — ~2× szybsze symulacje.
- Serwer: wspólna pula wątków (`apps/server/src/bot-pool.ts`), ISMCTS dzieli budżet na wątki (root-parallel).
- Poziomy: Easy, Normal, Hard (upstream), **Very Hard** (`ismcts-fast`, 300 iteracji), **Master** (`ismcts`,
  1200 iteracji na wszystkich wątkach), Expert (oszukuje).
- Narzędzia: `pnpm bench` (wiele par talii, raport do `docs/BENCHMARK.md`), `pnpm calibrate`, `pnpm sim --opts-a`.

Wyniki: **[`docs/BENCHMARK.md`](BENCHMARK.md)** — Very Hard wygrywa z Hard 26/32 = 81% (95% CI 65–91%)
na 8 parach talii; z oceną `evaluateBoard` było 18/32 = 56%.

Do zrobienia:
1. Strojenie: horyzont dogrywki (`turns` 1 vs 2), ε, stała eksploracji; większe próbki (≥ 64 partie na porównanie).
2. Słabe dopasowania (np. Judy vs Yorinobu 0/4) — obejrzeć partie i sprawdzić, czego bot nie widzi.
3. Ocena pozycji: więcej cech (np. koszty kart w Fixerze/Overtime), trening na partiach ISMCTS zamiast greedy (etap 6).

## Etap 2 — notatki techniczne
- Serwer liczy listę legalnych akcji silnikiem (`enumerateCandidateActions` / `enumerateChoiceActions`)
  i **sprawdza każdą na kopii gry** przed pokazaniem (silnik potrafi zgłosić opcję, którą potem odrzuca,
  np. d20 z Fixera). Efekty „zmień Gig o 1” wymagają wyboru kości i wartości naraz (`resolveAdjustGig`).
- Bot liczy ruch w `worker_threads` na kopii stanu; serwer stosuje komendę na autorytatywnym silniku.
- Test end-to-end: `pnpm selftest 10 tactical` — 10/10 partii zakończonych, 0 błędów
  (wybory: first player, gainGig, chooseTarget, chooseGigsToSteal, chooseEffect, chooseTrigger,
  chooseCardToMove/Play, chooseCardType, scry).
