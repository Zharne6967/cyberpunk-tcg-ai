# Cyberpunk TCG AI — lokalny rywal, trener i deck builder

Nieoficjalny projekt fanowski (niepowiązany z CD PROJEKT RED ani WeirdCo). Aplikacja uruchamiana
lokalnie na Twoim komputerze: grasz w przeglądarce przeciwko botowi, który zna wszystkie karty,
gra zgodnie z oficjalnymi zasadami, analizuje talie i uczy się na błędach.

> Stan: **etap 2 z 8** — można grać w przeglądarce przeciwko botowi. Silniejszy, uczący się bot
> przyjdzie w etapach 3–4. Plan: [`docs/ROADMAP.md`](docs/ROADMAP.md).

## Szybki start (Windows)
1. Zainstaluj **Node.js LTS** z https://nodejs.org (jeśli jeszcze nie masz).
2. Kliknij dwa razy **`instaluj.bat`** (tylko za pierwszym razem — instaluje zależności i pobiera obrazki kart).
3. Kliknij dwa razy **`start.bat`** — otworzy się przeglądarka z grą (http://localhost:5177).
   Okno konsoli musi zostać otwarte, dopóki grasz; zamknięcie go wyłącza serwer.

## Jak grać
- W lobby wybierz swoją talię, talię bota (albo losową) i poziom bota → **Graj**.
- Karty z **niebieską poświatą** mają dostępne akcje — kliknij je, by zobaczyć menu (zagraj, atakuj,
  podłącz Gear, użyj zdolności, przywołaj Legendę…). Wszystkie akcje są też po prawej, w panelu akcji.
- **Prawy przycisk** na karcie (albo „Szczegóły”) — pełny opis karty, aktualna siła, aktywne efekty
  i oficjalne FAQ. Karty zagrane przez bota pulsują na różowo; w logu ikona 🔍 pokazuje kartę.
- **Enter** = „Zakończ turę” / „Pas”. Tempo ruchów bota ustawisz w prawym górnym rogu.
- Każda partia zapisuje się w `var/games/` — z tych zapisów bot będzie się uczył (etap 4).

## Co już działa
- **Gra w przeglądarce przeciwko botowi** (etap 2): pełne zasady (mulligan, Gigi, Eddies, sprzedaż,
  Legendy, Gear, ataki, blokowanie, kradzież Gigów, wszystkie wybory kart), polski interfejs i log,
  podgląd kart z FAQ, obrazki kart pobierane raz i trzymane lokalnie (`var/images`).
  Poziomy: Łatwy, Średni, Trudny (uczciwe) oraz Ekspert (podgląda karty — do treningu pod presją).
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
