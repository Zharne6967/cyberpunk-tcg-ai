# Cyberpunk TCG Coach — wtyczka do przeglądarki

Trener do nauki gry na **cyberpunk-tcg-sim.online**: przy Twojej decyzji pokazuje w małym okienku najlepszy
ruch z szansą na wygraną; klik w okienko rozwija 2 inne opcje, „dlaczego” i plan na turę. Liczy ten sam
uczciwy bot co „Coach” w naszej aplikacji — **wyłącznie z tego, co widzisz Ty** (ręka rywala, kolejność talii
i zakryte karty są dla niego tak samo nieznane jak dla Ciebie) — i to na Twoim komputerze, nic nie jest
nigdzie wysyłane.

## Instalacja (Chrome / Edge)
1. Rozpakuj `cyberpunk-tcg-coach.zip` do folderu (albo zbuduj sam: `node extension/build.mjs` → `extension/dist`).
2. Otwórz `chrome://extensions` (w Edge: `edge://extensions`) i włącz **Tryb dewelopera**.
3. **Załaduj rozpakowane** → wskaż folder z plikiem `manifest.json`.
4. Przypnij ikonę wtyczki; klik w nią = przełącznik **Coach** (włącz / wyłącz). Gdy działa, na stronie gry
   widać okienko **COACH ON** (można je przeciągnąć za nagłówek).

## Gdzie działa
- ✅ **Solo** (gra z AI strony), **Hotseat** (dwie osoby przy jednym urządzeniu), **samouczek**, prywatny pokój
  z kodem (np. gra z kolegą, który wie, że masz trenera).
- ⛔ **Quick Play, publiczne lobby, Ranked, turnieje, Pre-release** — tam okienko pokazuje „COACH PAUSED”.
  Regulamin strony zabrania pomocy z zewnątrz w meczach, które się liczą („cheats … to manipulate matches,
  rankings … or tournament results”), a gra z obcymi przeciwnikami ma być uczciwa.

## Co umie (wersja 0.1)
- Twoja **Main Phase** (zagranie, sprzedaż, Call a Legend, atak, Pass Turn) i **wybór kości Giga** na początku tury.
- W pozostałych chwilach (tura rywala, React Step, wybory celów) okienko czeka: „Waiting for your turn”.
- Nie czyta jeszcze efektów „do końca tury” z kart programów — wtedy podpowiedź jest przybliżona.
- Wtyczka czyta stan gry, który strona trzyma w przeglądarce; jeśli strona zmieni jego format, okienko napisze
  „The coach could not read this position” — wtedy trzeba zaktualizować wtyczkę.
