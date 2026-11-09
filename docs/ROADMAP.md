# Mapa drogi (etapy)

Każdy etap to osobna sesja pracy, zakończona działającą wersją i paczką ZIP.

| # | Etap | Co powstaje | Status |
|---|------|-------------|--------|
| 1 | Fundament | silnik zasad (vendor), baza kart `data/cards.json`, zasady `data/rules`, talie `data/decks`, parser list talii, symulator `pnpm sim` | ✅ gotowe |
| 2 | Gra w przeglądarce | serwer + stół do gry vs bot, klik w kartę → pełny opis, log ruchów, wszystkie wybory (cele, triggery, kradzież Gigów), `start.bat` dla Windows, lokalne obrazki kart | ✅ gotowe |
| 3 | Silny, uczciwy bot | determinizacja ukrytych kart + ISMCTS w wątkach roboczych, poziomy trudności, benchmark vs obecne boty | 🔶 działa (Very Hard bije Hard 81%), strojenie trwa |
| 4 | Stół jak na żywo | rewersy kart, ukryte własne Legendy (zgodnie z CR), losowanie pierwszego gracza w okienku, przeciąganie kart na strefy, tryb „bez podpowiedzi” | 🔶 wersja 1 gotowa |
| 5 | Deck builder | panel składania talii: wyszukiwarka i filtry kart, legalność na żywo, krzywa/kolory, zapis/eksport/import listy | 🔶 wersja 1 gotowa |
| 5b | Gra ze znajomym + telefon | pokoje z linkiem zaproszenia (człowiek–człowiek, każdy widzi tylko swoje karty), klucz dostępu dla urządzeń z zewnątrz, Cloudflare quick tunnel z poziomu poczekalni, przeciąganie palcem, podgląd karty po najechaniu / przytrzymaniu, układ na telefon | 🔶 wersja 1 (patrz niżej) |
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

## Wdrożenie online — stan (2026-11-09)
✅ Gotowe po naszej stronie: kody pokoi 6-cyfrowe + „Room code / Join” w lobby, tryb online `CPAI_CLOUD=1`
(strona otwarta, talie w przeglądarce, limit zgadywania kodów, CORS dla /api/health), strona startowa z ekranem
ładowania (`landing/`), `render.yaml` (Static Site zawsze włączony + Free web service usypiany), instrukcja
[`docs/DEPLOY.md`](DEPLOY.md). Testy: `CPAI_CLOUD=1 pnpm selftest 2 friend` ✓, API trybu online ✓.
✅ **Działa w internecie**: https://cyberpunk-tcg-ai.onrender.com (publiczne repo GitHub + Render Blueprint, darmowe;
każdy `git push` na `main` wdraża się sam). Sprawdzone online: gra z botem (Very Hard: tura ~10–20 s), pokój ze
znajomym przez 6-cyfrowy kod, poddanie, widok telefonu, przekierowanie linku zaproszenia przez stronę startową.
Na Render boty liczą w głównym procesie (`BOT_THREADS=0`) — wątki robocze tam nie odpowiadały.
Do sprawdzenia przy okazji: ekran ładowania po uśpieniu serwera (po ~15 min bez graczy).

## Prośby gracza (2026-11-08) — do rozplanowania na początku następnej sesji
- **Strona dostępna zawsze, dla każdego** (hosting w chmurze, np. Fly.io / Render / mały VPS, serwer działa 24/7 bez
  Twojego komputera) + **dołączanie 6-cyfrowym kodem pokoju** (zamiast długiego linku); do przemyślenia: konta/
  nicki, limit pokoi, koszt hostingu, gdzie trzymać talie użytkowników.
  Decyzje gracza: **hosting wyłącznie darmowy**; serwer **usypia, gdy nikt nie gra**, i budzi się na żądanie z
  **ekranem ładowania**. Propozycja: lekka strona startowa na darmowym statycznym hostingu (Cloudflare Pages /
  GitHub Pages, zawsze dostępna) pokazuje ekran ładowania i „budzi” serwer gry na darmowym planie z usypianiem
  (np. Render free: zasypia po ~15 min, start ~30–60 s), potem przechodzi do lobby. Wzór od gracza:
  https://claude.ai/artifact/T5tyuer5ype1xnNK4fU8TZ (aplikacja znajomego) — obejrzeć na początku sesji.
  Kod: **prywatne repozytorium GitHub** (darmowe). Uwaga: GitHub Pages dla prywatnych repo wymaga płatnego planu,
  a serwera Node nie uruchomi — dlatego strona startowa na Cloudflare Pages i serwer na Render, oba darmowe i oba
  wdrażane z prywatnego repo. Sama strona ma adres publiczny, więc wejście chronione kluczem dostępu / kodem pokoju.
- ✅ **Usuwanie talii wbudowanych z poziomu strony** (2026-11-09): Delete w Deck Builderze działa dla każdej talii;
  wbudowana znika z Twoich list w tej przeglądarce, „Restore built-in decks (n)” przywraca.
- **AI tworzy talie samo, na bazie mety**: import najczęściej granych talii (etap 7: tcgcontender, ripperdeck,
  choombattler/meta, exburst), regularne odświeżanie; AI ulepsza je (podmiany kart sprawdzane tysiącami
  symulacji, etap 8) i pisze przewodnik „jak na nią grać / jak ją kontrować” (łączy się z 5c).
- **Wtyczka do przeglądarki (trener)**: czyta stan gry z symulatora online (np. choombattler.com /
  cyberpunk-tcg-sim.online) i pokazuje najlepsze zagranie + wyjaśnienie, liczone naszym uczciwym botem
  (tylko informacje widoczne dla gracza). Cel: nauka gry (gracz uczy kolegę, także w ich wspólnych partiach).
  Decyzja gracza: prosty przełącznik **włącz/wyłącz**, bez blokad trybów; widoczny znaczek „Coach ON”, gdy działa.
  Ten sam „trener” także w naszej aplikacji (podpowiedź najlepszego ruchu + wyjaśnienie, opcjonalnie w grze ze znajomym).
  Ryzyko techniczne: odczyt stanu z cudzej strony (DOM/WebSocket) bywa kruchy przy jej zmianach.

## Etap 5c — Analiza talii rywala i kontr-talia
✅ Wersja 1 (2026-11-09): ekran **Deck Analysis** (`#/analyze`, przycisk w lobby i „Analyze” w Deck Builderze).
Wybierasz zapisaną talię, wklejasz listę albo bierzesz niezapisaną talię z Deck Buildera; talia gra z każdą
talią wbudowaną (4/8/16 partii na parę, miejsca zamieniane, boty Easy po obu stronach). Raport:
- **Weaknesses / Strengths** — najgorsze i najlepsze dopasowania, krzywa / karty do sprzedaży / tanie Jednostki /
  [BLOCKER] w porównaniu z resztą talii, zależność od kluczowych kart, długie vs krótkie partie, gra jako drugi,
  karty rywali, przeciw którym wyraźnie przegrywa (porównane z oczekiwanym wynikiem danego dopasowania);
- **How to beat it** — najlepsza talia przeciw niej, karty, z którymi sobie nie radzi, karty do zbicia w
  pierwszej kolejności, plan tempa, kto ma zaczynać;
- **Counter decks** — 3 najlepsze talie z puli + „Cards to add” (groźne dla niej karty pasujące do RAM-u Legend
  kontr-talii), przycisk **Play it vs this deck** (grasz kontr-talią, bot analizowaną talią);
- **Matchups**, **Key cards** (wynik, gdy karta zagrana / niezagrana), **Deck profile** z krzywą.
Technicznie: `packages/ai/src/match.ts` (partia bot–bot ze statystyką kart, wersja generatora nieblokująca
serwera), `packages/ai/src/analysis.ts` (plan gauntletu + raport), `apps/server/src/analysis.ts` (kolejka zadań,
`POST /api/analyze`, `GET /api/analyze/:id`; w domu wątki, online w głównym procesie w krótkich porcjach).
Czas: 136 partii ≈ 12 s na jednym wątku, 272 partie ≈ 8 s na 4 wątkach. CLI: `pnpm analyze --deck <id> --games 8`.

Do zrobienia:
1. Silniejsze boty w symulacjach (opcja „Normal”/„Very Hard” w domu; Easy gra prosto, wyniki to przybliżenie).
2. Warianty kontr-talii: podmiany kart sprawdzane symulacjami (etap 8), zapis jako Twoja talia.
3. Pula przeciwników: także Twoje talie i meta z sieci (etap 7).

## Etap 5b — Gra ze znajomym i telefon (stan 2026-11-08)
Zrobione: lobby „vs Bot / vs Friend” + imię; pokój (`POST /api/rooms`) → poczekalnia z linkiem
`#/join/<gra>/<zaproszenie>`; kolega wybiera talię albo wkleja listę; tokeny miejsc (WebSocket tylko z tokenem);
`apps/server/src/share.ts` — klucz dostępu (cookie) dla wszystkiego spoza tego komputera, zapis/usuwanie talii
i start tunelu tylko lokalnie, przycisk „Share over the internet” uruchamia `cloudflared` (quick tunnel);
przeciąganie na pointer events (mysz + palec), podgląd karty po 0,45 s najechania / przytrzymaniu palcem;
pierwsza wersja CSS pod telefon (log jako wysuwany panel, opcje pod „⋯”). `pnpm selftest 2 friend` ✓.

Do zrobienia (następna sesja):
1. Zainstalować `cloudflared` (`winget install Cloudflare.cloudflared` — wymaga zgody) i przetestować link z telefonu.
2. Dopracować układ na telefon w przeglądarce (sprawdzić na 375×812), mulligan na pełnym ekranie jak w Choombattlerze,
   kod QR z linkiem zaproszenia.
3. Podgląd po najechaniu także w Deck Builderze.
4. Skrypt `udostepnij.bat` (start serwera + tunel jednym kliknięciem).

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

- ✅ Sideboard (Tournament Rules 3.4.4: 7 kart z talii głównej, bez Legend; niepełny = ostrzeżenie, nie blokuje
  gry), „Add to: Main Deck / Sideboard”, import i eksport sekcji Sideboard; ✅ Draw % — szansa na co najmniej
  jedną kopię w ręce startowej (6 kart, rozkład hipergeometryczny).

Do zrobienia: eksport jako obrazek/link, porównanie dwóch talii, tryb „kolekcja” (tylko posiadane karty).

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
