# Cyberpunk TCG AI — lokalny rywal, trener i deck builder

Nieoficjalny projekt fanowski (niepowiązany z CD PROJEKT RED ani WeirdCo). Aplikacja uruchamiana
lokalnie na Twoim komputerze: grasz w przeglądarce przeciwko botowi, który zna wszystkie karty,
gra zgodnie z oficjalnymi zasadami, analizuje talie i uczy się na błędach.

> Stan: **etap 3 z 8 (w toku)** — można grać w przeglądarce przeciwko botowi, w tym nowym uczciwym
> botowi ISMCTS („Bardzo trudny”, „Mistrz”). Uczący się bot — etap 4. Plan: [`docs/ROADMAP.md`](docs/ROADMAP.md).

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
- **Learning mode** (przełącznik u góry) — podświetla karty z legalnymi ruchami i pokazuje listę akcji.
  Domyślnie wyłączony: grasz jak na żywo i sam pamiętasz, co możesz zrobić.
- Każda partia zapisuje się w `var/games/` — z tych zapisów bot będzie się uczył (etap 6).

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
