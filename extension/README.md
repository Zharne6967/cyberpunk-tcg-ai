# Cyberpunk TCG Coach — wtyczka do przeglądarki

Trener do nauki gry na **cyberpunk-tcg-sim.online**: przy Twojej decyzji pokazuje w małym okienku najlepszy
ruch z szansą na wygraną; klik w okienko rozwija 2 inne opcje, „dlaczego” i plan na turę. Liczy ten sam
uczciwy bot co „Coach” w naszej aplikacji — **wyłącznie z tego, co widzisz Ty** (ręka rywala, kolejność talii
i zakryte karty są dla niego tak samo nieznane jak dla Ciebie) — i to na Twoim komputerze, nic nie jest
nigdzie wysyłane.

## Aktualizacja
Najpewniej: `chrome://extensions` → przy starym „Cyberpunk TCG Coach” **Usuń**, potem **Załaduj rozpakowane** →
folder z nową wersją, na końcu odśwież stronę gry (F5). Przy podmianie plików w tym samym folderze wystarczy ikona
odświeżania (↻) przy wtyczce i F5 na stronie gry. Nie trzymaj dwóch wersji naraz.

## Gdy nie działa
Kliknij ikonę wtyczki (na stronie gry). Okienko pokazuje:
- **This page: …** — co wtyczka widzi na tej stronie: „Showing advice”, „Rival's turn”, „Coach is off”,
  „No game on this page yet”, „The coach cannot read this page (the site may have changed)”, albo prośbę o F5;
- **Coach engine: ready** albo „not answering” (wtedy ↻ przy wtyczce w `chrome://extensions`);
- **Reset box position** — przywraca okienko w lewy górny róg.

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

## Co umie (wersja 0.1.4)
- **Kto zaczyna** („Go first” / „Go second”) i **ręka startowa** („Keep” / „Mulligan”): każda opcja z szansą na
  wygraną z symulacji dwóch pierwszych tur obu graczy (przy małej różnicy obie opcje są podobnie dobre).
- Twoja **Main Phase** (zagranie, sprzedaż, Call a Legend, atak, Pass Turn) — także po atakach w tej samej turze —
  i **wybór kości Giga** na początku tury (tylko kości, którymi strona pozwala rzucić).
- **Wybory z efektów Twoich kart i ataków**: np. który Gig i o ile zmienić (Afterparty at Lizzie's), cel ataku
  („Rival Gig area” albo Jednostka), który Gig ukraść. Wtyczka odtwarza w naszym silniku Twój ostatni ruch z Main
  Phase, który do tego wyboru doprowadził, i liczy każdą opcję. Strona dzieli niektóre wybory na kroki (np. Gig →
  PLUS/MINUS → ile) — podpowiedź opisuje cały wybór naraz (np. „Adjust: D4 (4) → 3”).
- Wybory, których nie da się tak odtworzyć (np. efekt karty rywala, React Step), nadal tylko opisuje:
  „Your choice: …” albo „Rival is choosing”.
- Nie czyta jeszcze efektów „do końca tury” z kart programów — wtedy podpowiedź jest przybliżona.
- 0.1.2: ocena pozycji z self-play (mocniejsze podpowiedzi). 0.1.3: Coach jest włączony, dopóki go nie wyłączysz
  (przycisk i okienko zawsze zgodne), okienko nie może zostać poza ekranem, diagnostyka w przycisku wtyczki.
- Wtyczka czyta stan gry, który strona trzyma w przeglądarce; jeśli strona zmieni jego format, okienko napisze
  „The coach could not read this position” — wtedy trzeba zaktualizować wtyczkę.
