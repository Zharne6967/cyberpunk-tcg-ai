# Cyberpunk TCG AI — lokalny rywal, trener i deck builder

Nieoficjalny projekt fanowski (niepowiązany z CD PROJEKT RED ani WeirdCo). Aplikacja uruchamiana
lokalnie na Twoim komputerze: grasz w przeglądarce przeciwko botowi, który zna wszystkie karty,
gra zgodnie z oficjalnymi zasadami, analizuje talie i uczy się na błędach.

> Stan: **etapy 3–5 w toku** — gra w przeglądarce na stole jak oficjalna mata (przeciąganie kart,
> bez podpowiedzi), uczciwy bot ISMCTS (Very Hard, Master) i Deck Builder. Uczący się bot — etap 6. Plan: [`docs/ROADMAP.md`](docs/ROADMAP.md).

## Szybki start (Windows)
1. Zainstaluj **Node.js LTS** z https://nodejs.org (jeśli jeszcze nie masz).
2. Kliknij dwa razy **`instaluj.bat`** (tylko za pierwszym razem — instaluje zależności i pobiera obrazki kart).
3. Kliknij dwa razy **`start.bat`** — otworzy się przeglądarka z grą (http://localhost:5177).
   Okno konsoli musi zostać otwarte, dopóki grasz; zamknięcie go wyłącza serwer.

## Jak grać
Interfejs gry jest po angielsku i używa oficjalnych nazw z zasad (Play a Card, Sell a Card, Call a Legend…).
Stół wygląda jak dwie maty naprzeciw siebie: Twoja na dole, bota (obrócona) u góry, Gigi obu graczy w środku.
- W lobby wybierz swoją talię, talię bota (albo losową) i poziom bota → **Play**.
- Na starcie okienko: los wybiera gracza, który decyduje, kto zaczyna; potem **Keep** albo **Mulligan**.
- **Przeciągaj karty**: z ręki na **FIELD** (zagranie), na swoją Jednostkę (Gear), na **EDDIES** (sprzedaż);
  swoją Jednostką na Jednostkę rywala (atak) albo na **RIVAL GIGS** (atak na Gigi); w React Step swoją
  Jednostką na atakującego (blok).
- **Klik w kartę** — menu z oficjalnymi akcjami (np. Call a Legend na zakrytej Legendzie, Activate an Effect,
  Attack). Menu nie podpowiada, co jest legalne — jeśli ruch jest niedozwolony, silnik wyświetli powód.
- **Prawy przycisk** — podgląd karty z oficjalnymi rulingami. **Klik w TRASH** — zawartość kosza.
- Gdy zasady każą coś wybrać (cel, kość Giga, kolejność efektów), po prawej pojawia się panel decyzji;
  możesz też kliknąć kartę/kość na stole.
- **Enter** albo przycisk w środku stołu = **Pass Turn** / **Pass**.
- **Win chance** (przełącznik u góry, domyślnie włączony) — pasek w środku stołu z szansą każdego gracza
  na wygranie całej partii, liczoną wyłącznie z tego, co leży na stole (Gigi, pole, Legendy, Eddies,
  liczba kart w rękach i taliach — bez zaglądania w karty). To wyuczony model z partii testowych
  (`pnpm calibrate`), więc to szacunek, nie wyrocznia. Na koniec partii — wykres szans tura po turze.
- **Learning mode** (przełącznik u góry) — podświetla karty z legalnymi ruchami i pokazuje listę akcji.
  Domyślnie wyłączony: grasz jak na żywo i sam pamiętasz, co możesz zrobić.
- **Coach** (przełącznik u góry) — trener: przy każdej Twojej decyzji pokazuje najlepszy ruch (zielona
  ramka na karcie), 2 inne opcje z szansą na wygraną i dalszy plan na tę turę („Then: …”); klik w ruch go
  wykonuje. **Dlaczego** — pod ruchami: jak wygląda stół na początku Twojej następnej tury po najlepszym
  ruchu w porównaniu z następną opcją (średnie z symulacji: Gigi, Street Cred, Jednostki na polu, karty w
  ręce, Eddies, wygrana/przegrana przed Twoją turą), np. „+ Rival's Gigs: 1.2 (2.0)”, „− Cards in your
  hand: 3 (4)”. Liczy ten sam uczciwy bot ISMCTS co poziomy Very Hard/Master, **tylko z tego, co Ty wiesz**,
  i to w Twojej przeglądarce (~1000 symulacji w 2–3 s). Działa też w grze ze znajomym — wtedy rywal widzi
  znaczek **Coach ON**.
- Każda partia zapisuje się w `var/games/` — z tych zapisów bot będzie się uczył (etap 6).

## Deck Builder
Przycisk **Deck Builder** w lobby (albo „Open in Deck Builder” przy Twojej talii).
- **Library** po lewej: klik w kartę dodaje ją do talii (Legenda trafia do obszaru Legend), prawy klik —
  podgląd. Wyszukiwarka rozumie filtry, np. `type:unit cost<=3 color:blue`, `ram>=2`, `tag:netrunner`,
  `kw:blocker`, `sell:yes`; do tego przyciski Type / Color / Cost / RAM i „Match Legends RAM”.
- **Talia** po prawej: Legendy z RAM-em na kolor, karty z licznikami (+/−), statystyki, krzywa kosztów,
  status legalności (oficjalne reguły) i „Draw Starting Hand”.
- **Save Deck** zapisuje w `var/decks/` (talia wbudowana zapisuje się jako Twoja kopia), **Import** przyjmuje
  listę wklejoną ze stron z taliami („3x Nazwa karty”), **Export** daje listę tekstową, **Play** wraca do
  lobby z tą talią, **Analyze** otwiera analizę talii, **Delete** usuwa Twoją talię albo chowa wbudowaną
  („Restore built-in decks” ją przywraca).

## Wtyczka do przeglądarki (trener na cyberpunk-tcg-sim.online)
Folder `extension/` — ten sam trener w małym okienku na stronie cyberpunk-tcg-sim.online (Solo, Hotseat,
samouczek, prywatne pokoje; wyłączony w Quick Play, Ranked i turniejach). Instalacja i szczegóły:
[`extension/README.md`](extension/README.md). Budowanie: `node extension/build.mjs`.

## Deck Analysis
Przycisk **Deck Analysis** w lobby (albo **Analyze** w Deck Builderze). Wybierasz talię albo wklejasz listę
rywala; talia rozgrywa po 4/8/16 partii z każdą talią wbudowaną (boty Easy po obu stronach, miejsca
zamieniane). Raport: słabości i mocne strony, „How to beat it”, 3 najlepsze kontr-talie (z kartami do dodania
i przyciskiem **Play it vs this deck**), wyniki każdego dopasowania, kluczowe karty i profil talii.
Z terminala: `pnpm analyze --deck <id> --games 8`.

## Co już działa
- **Gra w przeglądarce przeciwko botowi** (etap 2): pełne zasady (mulligan, Gigi, Eddies, sprzedaż,
  Legendy, Gear, ataki, blokowanie, kradzież Gigów, wszystkie wybory kart), polski interfejs i log,
  podgląd kart z FAQ, obrazki kart pobierane raz i trzymane lokalnie (`var/images`).
  Poziomy: Easy, Normal, Hard, Very Hard, Master (uczciwe — nie widzą Twojej ręki ani kolejności talii;
  Very Hard i Master to nowy bot ISMCTS z etapu 3) oraz Expert (podgląda karty).
- **Silnik zasad** zgodny z aktualnymi Comprehensive Rules (7 Gigów, Overtime, Lag, React step,
  Call a Legend, Sell for Turn…), 152 karty — każda z testem. ~2860 testów przechodzi.
- **Baza kart** `data/cards.json`: koszt, siła, RAM, kolor, tagi, słowa kluczowe, pełny tekst,
  obrazki, 244 oficjalne FAQ/rulingi.
- **Zasady** `data/rules/` — pełny tekst oficjalnych zasad (do asystenta zasad).
- **Talie** `data/decks/` — 2 startery, 15 talii testowych, przykładowa talia turniejowa z mety.
- **Parser list talii** — wkleja się listę w formacie stron z taliami („3x Nazwa karty”,
  „Nazwa: Podtytuł”, „Nazwa — Podtytuł”), sprawdza legalność (3 Legendy, 40–50 kart, max 3 kopie, RAM).
- **Symulator** bot kontra bot (`pnpm sim`) — wiele wątków, raport win-rate z przedziałem ufności.

## Instalacja (Windows)
1. Zainstaluj **Node.js 22 LTS** (lub nowszy): https://nodejs.org → „LTS” → instalator `.msi`.
2. Rozpakuj ZIP, np. do `C:\cyberpunk-tcg-ai`.
3. Otwórz **PowerShell** w tym folderze (Shift + prawy klik → „Otwórz w terminalu”) i wpisz:
   ```powershell
   corepack enable
   pnpm install
   ```
   (Jeśli `corepack` zgłosi brak uprawnień, uruchom PowerShell jako administrator albo użyj
   `npm install -g pnpm`.)

## Polecenia
```powershell
pnpm start                                        # serwer gry (po pnpm build) → http://localhost:5177
pnpm build                                        # zbuduj interfejs
pnpm images                                       # pobierz wszystkie obrazki kart (offline)
pnpm selftest 3 tactical                          # automatyczny test: 3 pełne partie przez WebSocket
pnpm sim --list                                   # lista talii i botów
pnpm sim --a starter-the-heist --b starter-embracing-power --bot-a tactical --bot-b greedy --games 20
pnpm bench --a ismcts-fast --b masterful --pairs 8 --games 4   # benchmark botów na wielu parach talii
pnpm calibrate 1000                               # naucz ocenę pozycji bota na partiach self-play
pnpm test                                         # testy silnika i naszego kodu
pnpm export-data                                  # odśwież data/cards.json i talie z silnika
```
Talię możesz podać nazwą pliku z `data/decks` (bez `.json`) albo ścieżką do własnego pliku JSON.

## Struktura
```
vendor/          silnik zasad i karty (thecardgoat/tcg-engines, MIT) — patrz vendor/UPSTREAM.md
apps/server      serwer gry (Node): sesje partii, bot w osobnym wątku, WebSocket, obrazki kart
apps/web         interfejs (React + Vite): lobby, stół, panel akcji, log, podgląd kart
packages/core    nasz kod wspólny: katalog kart, format talii, parser list, legalność, protokół
packages/ai      boty (rejestr poziomów, decyzja bota na kopii stanu)
tools/sim        symulator bot vs bot
tools/export-data eksport bazy kart / talii do data/
data/            karty, zasady, talie
var/             lokalne dane (zapisane partie, obrazki, Twoje talie) — nie trafia do ZIP-a
docs/            plan i dokumentacja
```

## Licencje
Kod: MIT. Silnik zasad: MIT © TheCardGoat (`vendor/LICENSE-tcg-engines`).
Nazwy kart, teksty i grafiki © CD PROJEKT RED / WeirdCo — używane wyłącznie do prywatnej, lokalnej gry.
