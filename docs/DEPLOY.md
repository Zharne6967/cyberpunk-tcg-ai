# Wdrożenie w internecie (darmowe)

**Działa od 2026-11-09:**
- strona dla graczy (zawsze włączona, budzi serwer): **https://cyberpunk-tcg-ai.onrender.com**
- serwer gry (Render Free, usypia): https://cyberpunk-tcg-ai-server.onrender.com
- kod: https://github.com/Zharne6967/cyberpunk-tcg-ai (publiczne repo) — Render wdraża każdy `git push` na `main`
  sam (Auto-Deploy), panel: https://dashboard.render.com (Blueprint `cyberpunk-tcg-ai`).

Cel: strona dostępna zawsze, dla Ciebie i znajomych, bez włączonego komputera.

```
przeglądarka ──► cyberpunk-tcg-ai.onrender.com          (strona startowa, Render Static Site: zawsze włączona)
                     │  ekran ładowania, budzi serwer, potem przenosi dalej
                     ▼
                 cyberpunk-tcg-ai-server.onrender.com   (serwer gry, Render Free: usypia po ~15 min bez graczy,
                                                          budzi się w ~30–60 s)
```

Wszystko opisuje plik [`render.yaml`](../render.yaml). Kod leży w **prywatnym** repozytorium GitHub,
Render pobiera go stamtąd sam (nikt inny kodu nie widzi). Oba plany są darmowe.

## Tryb online (`CPAI_CLOUD=1`)
- Strona jest otwarta dla każdego; do wspólnej gry dołącza się **6-cyfrowym kodem pokoju** (lobby → vs Friend →
  Create room / Room code) albo linkiem zaproszenia. Kody są ważne do startu partii; zgadywanie kodów jest
  ograniczone (20 prób na minutę z jednego adresu).
- **Twoje talie zapisują się w przeglądarce** (dysk darmowego serwera jest czyszczony przy uśpieniu); przy starcie
  gry talia jest wysyłana na serwer i sprawdzana oficjalnymi regułami.
- Bot liczy na jednym wątku (`BOT_THREADS=1`), więc „Master” myśli wolniej niż na Twoim komputerze.
- Obrazki kart serwer pobiera przy pierwszym użyciu (po uśpieniu od nowa).

## Kroki (jednorazowo)
1. **GitHub**: załóż puste, **prywatne** repozytorium (np. `cyberpunk-tcg-ai`, bez README) i podaj mi jego adres —
   wyślę kod (`git push`; przy pierwszym razie okno logowania GitHub).
2. **Render** (https://render.com): „Sign up with GitHub”, zezwól na dostęp do tego repozytorium.
3. Render → **New → Blueprint** → wybierz repozytorium → **Apply**. Po kilku minutach działają obie usługi.
4. Wejdź na adres strony startowej (`https://cyberpunk-tcg-ai….onrender.com`) — to jest link dla znajomych.

Każdy kolejny `git push` na gałąź `main` wdraża nową wersję automatycznie.

## Lokalnie, jak dotąd
`start.bat` / `pnpm start` działa bez zmian (tryb domowy: talie na dysku, „Share over the internet” przez tunel).
Tryb online lokalnie: `CPAI_CLOUD=1 pnpm start`.
