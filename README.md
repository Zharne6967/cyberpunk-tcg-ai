# Cyberpunk TCG AI — lokalny rywal, trener i deck builder

Nieoficjalny projekt fanowski (niepowiązany z CD PROJEKT RED ani WeirdCo). Aplikacja uruchamiana
lokalnie na Twoim komputerze: grasz w przeglądarce przeciwko botowi, który zna wszystkie karty,
gra zgodnie z oficjalnymi zasadami, analizuje talie i uczy się na błędach.

> Stan: **etap 1 z 8** — fundament (silnik zasad, baza kart, symulator). Gra w przeglądarce
> pojawi się w etapie 2. Plan: [`docs/ROADMAP.md`](docs/ROADMAP.md).

## Co już działa
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
pnpm sim --list                                   # lista talii i botów
pnpm sim --a starter-the-heist --b starter-embracing-power --bot-a tactical --bot-b greedy --games 20
pnpm test                                         # testy silnika i naszego kodu
pnpm export-data                                  # odśwież data/cards.json i talie z silnika
```
Talię możesz podać nazwą pliku z `data/decks` (bez `.json`) albo ścieżką do własnego pliku JSON.

## Struktura
```
vendor/          silnik zasad i karty (thecardgoat/tcg-engines, MIT) — patrz vendor/UPSTREAM.md
packages/core    nasz kod wspólny: katalog kart, format talii, parser list, legalność
tools/sim        symulator bot vs bot
tools/export-data eksport bazy kart / talii do data/
data/            karty, zasady, talie
docs/            plan i dokumentacja
```

## Licencje
Kod: MIT. Silnik zasad: MIT © TheCardGoat (`vendor/LICENSE-tcg-engines`).
Nazwy kart, teksty i grafiki © CD PROJEKT RED / WeirdCo — używane wyłącznie do prywatnej, lokalnej gry.
