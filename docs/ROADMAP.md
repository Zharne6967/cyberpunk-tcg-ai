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
| 6 | Uczenie się | zapis każdej partii, nocny self-play, strojenie oceny pozycji, „bramka” (nowa wersja musi pokonać starą), raport czego się nauczył, model Twojego stylu gry | 🔶 self-play + bramka działają (patrz niżej) |
| 7 | Talie z sieci | importery (tcgcontender, ripperdeck, choombattler, exburst, tekst), snapshot mety, gauntlet, analiza talii w UI (krzywa, Eddies, aggro, tempo kluczowych kart) | 🔶 pula meta + dodawanie list; automat zablokowany regulaminami (niżej) |
| 8 | AI deck builder | generowanie talii + weryfikacja tysiącami symulacji vs meta, wyjaśnienia wyborów | 🔶 Deck Lab wersja 2 (dane ladderu + sprawdzenie botami Strong) |
| 9 | Asystent zasad i trener | czat (Claude API lub Ollama), RAG po zasadach/FAQ/kartach, analiza partii po meczu, podpowiedzi w trakcie gry (tylko w trybie nauki) | |
| 10 | Szlify | tryb offline, aktualizacja kart z nowych dodatków, instrukcja | |

> Kolejność 4–5 wynika z uwag po pierwszej partii (2026-11-08): najpierw stół ma wyglądać i działać jak prawdziwa
> karcianka, potem własne talie. Uczenie się bota przesunięte na etap 6.

## Etapy 6–8 — self-play, pula meta, Deck Lab (2026-11-09)
**Mocniejszy bot.** Pomiar (docs/BENCHMARK.md): Hard bije Easy tylko 59%, ISMCTS z 40 symulacjami na ruch bije
Hard 84% (8–16 symulacji: 62%). Nowy bot symulacyjny `ismcts-sim` („Strong (simulations)”, 40 symulacji, bez limitu
czasu — wynik nie zależy od komputera). **Self-play**: `pnpm selfplay` — 600 partii ISMCTS vs ISMCTS, nowa ocena
pozycji (log loss 0.506 vs 0.530), **bramka** 74/128 = 57.8% nowego modelu vs stary → wdrożony (wpływa na Very Hard,
Master, Coacha i wtyczkę). `MatchSpec.record` zapisuje pozycje z początku tury; `playout.model` pozwala testować
kandydatów.

**Deck Lab** (`#/lab`, przycisk w lobby i w Deck Analysis; CLI `pnpm lab`): bot sam wymyśla talie.
Generacja 0 = trio Legend z puli przebudowane przez Lab + losowe trio; Main Deck z kart, na które Legendy mają
kolor i RAM (punkty: popularność w talii puli tych kolorów, wartości kart wyuczone z partii, prosta heurystyka,
losowość), kształt 40 kart (≤24 Jednostki, ≤9 kart za 5+). Każda generacja: wszystkie talie grają z pulą
(talie z puli też się ścigają, na równych zasadach), wartości kart liczone na nowo z wszystkich partii (wynik
gdy karta zagrana vs nie, w tej samej talii), najlepsze się rozmnażają (inne karty / inna Legenda / nowa budowa).
Finaliści grają dodatkowe partie. Cel: **Best average** albo **Beat every deck** (najsłabsze dopasowanie, dolna
granica przedziału). Raport: wynik, *Strong against*, *Loses to*, wszystkie dopasowania, lista kart, *Save as a
new deck*, **Check with Strong bots** (`ismcts-sim`, 4 partie na rywala). Kod: `packages/ai/src/lab.ts` (karty),
`lab-loop.ts` (pętla bez danych kart), `apps/web/src/browserAnalysis.ts` (`labInBrowser`, `checkInBrowser`),
`apps/web/src/components/Lab.tsx`.

**Eksperyment „Beat every deck”** (CLI, 10 talii meta, 10 generacji × 28 talii, 17 916 partii Easy, 904 s):
z botami Easy Lab znalazł Saburo / V / Adam Smasher bijące wszystkie 10 talii (88%, najsłabsze 81%). **Botami Strong**
(`pnpm lab --check`, `ismcts-sim`, 4 partie na rywala, ~40 partii na talię): Adam/Dexter/Padre (meta) 67%,
**Lab #3 63%**, Rogue AI GGR 61%, Adam/River/Viktor 58%, Adam/Saburo/V 53%, Dexter/Padre/V 47%, Lab #1 i #2 po 43%.
Wniosek: wyszukiwanie na botach Easy znajduje też talie, które wykorzystują słabości bota Easy — o kolejności
finalistów rozstrzyga sprawdzenie botami Strong (w aplikacji: wszyscy finaliści). Rankingi botów Strong zgadzają się
z ladderem ChoomBattlera lepiej niż Easy (Adam/Dexter/Padre 64.9% na ladderze). Talii bijącej wszystko przy mocnej
grze nie znaleziono; następny krok: wyszukiwanie od razu na botach Strong (`pnpm lab --bot ismcts-sim`, nocą).

**Kształt talii (2026-11-10, uwaga gracza: 27 Jednostek i brak kart do sprzedaży nie ma sensu).** Talie meta: 12–18
Jednostek (najczęściej 15–16), 57–70% kart z tagiem sprzedaży (każdy Gear i Program ma tag, z Jednostek tylko jedna),
8–11 kart za 5+. Lab buduje w kształcie puli (`poolShape`: mediana Jednostek ±2, sprzedawalne ≥ mediana − 7 pkt,
limit kart 5+): najpierw najlepsze Jednostki do środka zakresu, potem Gear i Programy; mutacje wymieniają Jednostkę
na Jednostkę, resztę na resztę; Deck Doctor nie proponuje zmian oddalających talię od tego kształtu. Doctor nie
tnie też **rdzenia talii** (`coreCards`: karty grane w co najmniej połowie talii puli o tych samych kolorach) ani
kart, które gracz każe zostawić („Keep …” przy zmianie = nowy przebieg z tą kartą chronioną); raport mówi zdaniem,
co zmienić i o ile to pomogło, a sprawdzenie jest botami Strong (`ismcts-sim`).

**Deck Lab i Deck Doctor z danych ladderu (2026-11-10, uwaga gracza: „dalej daje bezsensowne zmiany”, „gdzie
jest bot, który sam tworzy dobre talie”).** Symulacje botami Easy nie nadają się do wyboru kart (bot Easy źle gra
karty wymagające umiejętności, a kilkaset partii to za mało na różnice 2–3 pkt). Teraz o kartach decydują **prawdziwe
partie**: `data/meta/choombattler-archetypes.json` — 12 archetypów kolorów z ChoomBattlera (ranked, Core BO1, 30 dni,
odczyt stron jak użytkownik 2026-11-10): udział, win rate, Legendy i karty z popularnością, średnią liczbą kopii,
win rate i *lift* (o ile pkt wygrywają listy z kartą). `packages/ai/src/meta-stats.ts`:
`trustedLift` (lift ściągnięty do zera przy małej liczbie partii: × games/(games+300)), `cardValue` (popularność +
lift/3), `bestLegends` (trio o kolorach archetypu, najwyższy lift), `metaBuild` (karty wg wartości w zwykłej liczbie
kopii, kształt META_SHAPE 13–17 Jednostek, ≤11 kart 5+; karty z liftem < −1 tylko gdy nic innego), `metaAdvice`
(cięcia: karta spoza listy archetypu, lift ≤ −1 albo popularność < 30%; w zamian najlepsza brakująca karta tej
samej klasy — Jednostka za Jednostkę — z liftem > −0.5; Legendy tylko przy +3 pkt i ≥300 partiach; „Keep”).
Sprawdzenie: listy meta z ChoomBattlera dostają „no changes”. UI: **Deck Lab** = najlepsza talia każdego
archetypu z liczbami przy każdej karcie i Legendzie, opcja „Build around” (Legenda), *Check with Strong bots*
(mecze z pulą meta + szacunek ladderu = wynik + 7 pkt); **Deck Doctor** w Deck Analysis = podmiany z liczbami,
tabela „Your cards on the ladder”, *Save as a new deck*, sprawdzenie botami Strong. Ewolucyjny Lab na botach
zostaje w CLI (`pnpm lab`); `pnpm ladder` drukuje talie Laba i porady Doctora dla `data/decks`. Odświeżenie danych:
ręcznie (strony archetypów `/meta/<klucz>?queue=core-bo1&window=30d`), plik JSON jak wyżej.

**Czat „Ask for a deck” w Deck Lab (2026-11-13, prośba gracza: „wpisać czego oczekuję od decku i sam mi go
stworzy, jak rozmowa”).** Bez modelu językowego (darmowy hosting, działa w przeglądarce): `packages/ai/src/
deck-request.ts` czyta wiadomość po polsku i po angielsku — kolory („4 czerwone 2 zielone”, „mono yellow”, „GGR”),
Legendy (pełne nazwy, imiona, nazwiska, polskie końcówki: „z Viktorem”), karty („3 Mantis Blades”), „bez/without/
nie chcę …” (przeczenie obejmuje listę nazw), „agresywny/aggressive/tani” (niska krzywa, ≤6 kart 5+),
„kontrolny/late” (wysoka krzywa), „15 jednostek”, „13-15 units”, „60% na sprzedaż”, „więcej/mniej jednostek”,
„najpopularniejszy”, „nietypowy”, „inny” (kolejny archetyp), „od nowa / new deck”, „pokona/against/lepszy niż X”
(archetyp, Legenda albo Rogue AI). Słowa w nazwach kart nie liczą się jako życzenia („Take Control” ≠ kontrolny).
Każda wiadomość zmienia poprzednią prośbę; gdy nic nie pasuje, zdejmuje po kolei liczbę Jednostek, krzywą, karty,
Legendy, kolory i mówi, co zdjął („Viktor Vektor is Yellow: no room for that in 4 Red / 2 Green”). Budowa:
`metaBuild(..., opts)` z `include`/`exclude`/`curve`; archetypy, w których listy grają podane Legendy (≥5%), idą
pierwsze. Odpowiedź: archetyp i dlaczego (win rate / udział), liczby z ladderu dla podanych Legend i kart,
kształt talii, „Your request: …”, talia z liczbami przy kartach, „Also fits” (przyciski), dla „beat X” —
**Test against X**: 3 kandydatów gra botami Strong z taliami meta X z puli (4 partie na talię), najlepszy zostaje
pokazany. Testy: `deck-request.test.ts`.

**Tryb Claude w czacie (2026-11-13, zgoda gracza na wersję z własnym kluczem API).** Przełącznik „Built-in /
Claude” w „Ask for a deck”. Claude rozmawia dowolnie (rozumie każdy język), ale talie robi narzędziami na tych
samych danych ladderu: `list_archetypes`, `archetype_cards`, `search_cards` (nazwa/tekst efektu/kolor/typ/koszt),
`build_deck` (= `answerRequest` z życzeniami), `check_deck` (legalność, kształt, liczby z ladderu, podmiany Deck
Doctora) — `packages/ai/src/deck-tools.ts`, uruchamiane w Web Workerze (`deckTool` w `browserAnalysis.ts`). Ostatnia
talia zbudowana/sprawdzona przez Claude'a pokazuje się w czacie z liczbami i przyciskiem botów Strong. Strona:
`apps/web/src/claudeChat.ts` (ładowany dopiero w trybie Claude, osobny chunk ~86 kB gzip): oficjalne SDK
`@anthropic-ai/sdk` 1.8, `dangerouslyAllowBrowser` (klucz gracza, prosto z przeglądarki do api.anthropic.com, nic
przez nasz serwer), tool runner (`thread: false`, `max_iterations: 10`), domyślnie `claude-opus-5-5` (do wyboru Sonnet
5.5 i Haiku 5.5), `effort: medium`, auto-cache promptu, `fallbacks: "default"` (beta `server-side-fallback-2026-07-01`)
przy odmowie. Historia rozmowy (z blokami thinking, oddawanymi bez zmian) w `sessionStorage`; klucz w
`sessionStorage`, albo `localStorage` po zaznaczeniu „Remember on this device”. Pod odpowiedzią: model, użyte
narzędzia, koszt (cennik w `CLAUDE_MODELS`). Odpowiedzi po angielsku z oficjalnymi terminami (prośba gracza o UI po
angielsku). Testy: `claudeChat.test.ts` (atrapa API: pętla narzędzi na prawdziwych danych, historia, koszt,
nagłówki — SDK 1.x wysyła klucz jako `Authorization: Bearer`). **Prawdziwego wywołania API nie sprawdzałem** (nie
wpisuję kluczy) — pierwsza rozmowa gracza jest testem.

**Pula meta** = `data/decks/meta-*`, `rogue-ai-*` + talie dodane przez gracza („Meta pool” → *Add to the meta pool*,
w przeglądarce, `apps/web/src/metaPool.ts`; używa jej też Deck Doctor). Dodane 2026-11-09 z ChoomBattler
(ranked, Core BO1, 30 dni, Standard lists): Dexter/Padre/V (62.8%), Adam/Saburo/V (58.9%), Adam/Dexter/Padre (64.9%).
**Automatyczne pobieranie mety: nie** — tcgcontender.com („Using any robot, spider…”) i ripperdeck.gg („automated
means… without our prior written consent”) zabraniają botów w regulaminach; ChoomBattler daje dane mety przez
swoje wewnętrzne API (masowe pobieranie z niego zablokował wcześniej klasyfikator uprawnień). Droga: zgoda
ChoomBattlera (contact@choombattler.ch / Discord) albo ręczne odświeżanie (czytanie stron jak użytkownik).

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
- wybór celów efektów kliknięciem na stole z lepszą informacją zwrotną;
- ✅ (2026-11-09) wybór kart spoza stołu (przeszukanie talii / Scry, Reveal, zagraj lub przenieś kartę) w oknie na
  środku stołu jak na cyberpunk-tcg-sim.online: duże karty, kwalifikujące się podświetlone, reszta przygaszona,
  zasada i licznik („Hand: Gear with cost 2 or less, up to 2 (1/2)”), Done, Hide (okno chowa się, wybór zostaje);
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
  ✅ **Trener w aplikacji** (2026-11-09): przełącznik **Coach** w grze; najlepszy ruch (zielona ramka, klik =
  wykonaj), 2 alternatywy z szansą na wygraną, plan na resztę tury; w grze ze znajomym rywal widzi „Coach ON”.
  Jak to działa (uczciwie): serwer wysyła przeglądarce jeden świat wylosowany z tego, co gracz wie
  (`coachWorld` w `packages/ai/src/coach.ts`: determinizacja + przetasowane id ukrytych kart, nowe ziarno losowe),
  przeglądarka liczy ISMCTS w Web Workerze (`coach-worker.ts`, ~1000 symulacji / 2,5 s; na telefonie 600 / 2 s).
  Testy `coach.test.ts`: świat zależy tylko od informacji gracza, id ukrytych kart przetasowane, ruchy legalne;
  `pnpm selftest 2 friend`: rywal widzi Coach ON, świat tylko dla właściciela miejsca z włączonym trenerem.
  ✅ Wyjaśnienia „dlaczego” (2026-11-09): wyszukiwanie mierzy stół w pozycjach, na których kończą się symulacje
  (początek Twojej następnej tury) osobno dla każdego pierwszego ruchu (`measure` w `ismctsSearch`); trener
  pokazuje do 2 wyraźnych zysków i 1 koszt najlepszego ruchu względem następnej opcji (Gigi, Street Cred,
  Jednostki, karty w ręce, Eddies, wygrana/przegrana), tylko gdy oba ruchy mają ≥ 20 symulacji.
  ✅ **Wtyczka do przeglądarki** v0.1 (2026-11-09, `extension/`, instrukcja w `extension/README.md`) dla
  cyberpunk-tcg-sim.online: czyta `window.__cyberpunkTcgApp.snapshot` (strona trzyma w nim stan widziany przez
  gracza i obie listy talii), `packages/ai/src/external/ctcg-sim.ts` odtwarza z niego stan naszego silnika
  (prawdziwy setup z obiema listami, potem strefy, kości, flagi tury), trener liczy w service workerze wtyczki.
  Małe okienko (2 linie, szczegóły po kliknięciu, przeciągane), przełącznik On/Off pod ikoną wtyczki.
  Działa w Solo, Hotseat, samouczku i prywatnych pokojach; **wyłączona w Quick Play, publicznych lobby, Ranked,
  turniejach i Pre-release** (regulamin strony zabrania pomocy z zewnątrz w meczach, które się liczą).
  Do zrobienia: React Step ([BLOCKER]) i wybory celów, efekty „do końca tury”, Choombattler.
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
**Domyślnie partie grają się w przeglądarce gracza** (`packages/ai/src/browser-worker.ts`, Web Workers z silnikiem,
max 4 wątki, 2 na telefonach; `GET /api/analyze/pool` daje listy przeciwników) — darmowy serwer ma ułamek rdzenia
(136 partii online: ~8 min), przeglądarka robi to w ~3 s. Serwer liczy tylko, gdy przeglądarka nie da rady.
CLI: `pnpm analyze --deck <id> --games 8`.

✅ **Deck Doctor** (2026-11-09, ten sam ekran, wiersz „Deck Doctor”): co w talii słabe i jakie podmiany ją
poprawiają. Przeciwnicy: **Meta decks** (`data/decks/meta-*`, `rogue-ai-*`) albo **All decks**; rozmiar Quick /
Normal / Deep. Runda: wyniki talii → najsłabsze karty (wynik gdy zagrana vs nie, rzadko zagrywane) × kandydaci
(karty pasujące do kolorów/RAM Legend, popularne w talii puli tych kolorów, groźne karty rywali) → podmiana
**wszystkich kopii** karty (maks. 3, każda wersja przechodzi oficjalną kontrolę legalności) → wyścig (successive
halving: wszystkie na małej liczbie partii, lepsze na większej, te same ziarna co talia bazowa) → **finaliści i
talia bazowa grają świeże partie**; podmiana przechodzi tylko przy zysku ≥ 3 pkt i z = 1,28 (wcześniejsza wersja
bez tego kroku przyjmowała „szczęśliwe” podmiany: potwierdzenie 65,8% → 62,0%). Na końcu potwierdzenie oryginał vs
wynik na nowych partiach, **Check with Hard bots** (boty Hard, 12 partii na rywala) i **Save as a new deck**.
Wszystko w przeglądarce (Normal vs 6 talii meta ≈ 7900 partii Easy; w przeglądarce ~25–30 partii/s).
Kod: `packages/ai/src/doctor-loop.ts` (pętla bez danych kart, importuje ją strona), `packages/ai/src/doctor.ts`
(karty), `apps/web/src/browserAnalysis.ts` (`doctorInBrowser`, `confirmInBrowser`), CLI
`pnpm doctor --deck <id> [--opponents meta|all] [--verify masterful]`.
Pierwszy test (Rogue AI GGR 40 vs 6 talii meta, Normal, 7716 partii, 242 s w CLI): −3 Satori: Sword of Saburo
+3 Valentino Street Racer, −2 Riot Shield +2 6th Street Recruits → boty Easy 66,7% → 75,3% (396 nowych partii),
ale **boty Hard 71,5% → 72,9% (144 partie, w granicach szumu)** — zysk dotyczył głównie słabości bota Easy z Gear.
Granice: boty Easy nie umieją grać częścią kart (np. zagrywanie Gear/Programów z warunkami), więc „słaba karta”
bywa słaba dla bota, nie dla człowieka — stąd kontrola botami Hard; docelowo silniejszy bot do symulacji (etap 6).

Do zrobienia:
1. Silniejsze boty w symulacjach (opcja „Normal”/„Very Hard” w domu; Easy gra prosto, wyniki to przybliżenie).
2. Deck Doctor: zmiana Legend, budowanie talii od zera z meta (etap 7–8), wyścig na botach Hard w domu (CLI).
3. Pula przeciwników: także Twoje talie.

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
4. **Cel gracza (2026-11-09): nasz bot i trener we wtyczce mają być silniejsi niż „Rogue AI” na choombattler.com.**
   Najpierw sprawdzić, jak tam się z nim gra i czy da się rozegrać serię partii (wynik = miara), potem strojenie.
   Ustalenia (2026-11-09): Rogue AI = konto „o7” (bot zatwierdzony przez stronę, uczony self-play jak AlphaGo,
   97,4% wygranych z 620 graczami). **Regulamin ChoomBattlera: program może tam grać tylko za zgodą
   administratorów („An account found playing by program without permission is banned”)** — więc nasz bot nie
   gra tam bez zgody (droga: prośba do contact@choombattler.ch / Discord). o7 **zmienia talie między meczami**
   (np. Viktor Vektor / River Ward / Adam Smasher, wcześniej Green-Green-Red), a pełnych list strona nie pokazuje
   (gracz sam decyduje o odsłonięciu talii po grze; o7 nie odsłania) — widać tylko karty, które zagrał/odsłonił.
   Talie testowe w `data/decks`: `meta-cb-*` (standardowe listy 4 najpopularniejszych archetypów ChoomBattlera;
   4Y/2R Adam·River·Viktor to najczęściej grana talia mety — 15,8% gier, 60,4% wygranych — i ta, którą grał o7)
   oraz `rogue-ai-ggr-*` (talia Jackie Welles: Mama's Favorite · Padre · V spisana przez gracza: 45 kart i szacunek 40).
   Uwaga: w analizie z botami Easy 4Y/2R wygrywa tylko 45% — Easy nie umie grać takich talii; do oceny talii mety
   potrzebne symulacje z Very Hard (i docelowo analiza z silniejszym botem, etap 5c pkt 1).

## Etap 2 — notatki techniczne
- Serwer liczy listę legalnych akcji silnikiem (`enumerateCandidateActions` / `enumerateChoiceActions`)
  i **sprawdza każdą na kopii gry** przed pokazaniem (silnik potrafi zgłosić opcję, którą potem odrzuca,
  np. d20 z Fixera). Efekty „zmień Gig o 1” wymagają wyboru kości i wartości naraz (`resolveAdjustGig`).
- Bot liczy ruch w `worker_threads` na kopii stanu; serwer stosuje komendę na autorytatywnym silniku.
- Test end-to-end: `pnpm selftest 10 tactical` — 10/10 partii zakończonych, 0 błędów
  (wybory: first player, gainGig, chooseTarget, chooseGigsToSteal, chooseEffect, chooseTrigger,
  chooseCardToMove/Play, chooseCardType, scry).
