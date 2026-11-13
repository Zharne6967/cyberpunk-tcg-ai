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
  „No game on this page yet”, albo dokładny powód, gdy coś nie gra:
  - „No word from the page yet: reload it (F5)” — skrypt wtyczki jeszcze nie odezwał się ze strony;
  - „The site's game is not on this page (/…)” — na tej podstronie nie ma gry (np. Deck Builder, Ranked);
  - „The game is here but could not be read: …” — gra jest, ale coś w jej stanie zatrzymało odczyt; ten sam
    tekst pokazuje okienko na stronie („Could not read the game: …”) — przyślij go, wtedy wiadomo, co poprawić;
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

## Okienko (wersja 0.1.6)
- **▶ co zrobić**: przy wyborze na stronie — dokładnie który przycisk kliknąć („Click CALL L1”, „Click TAKE D4 3”,
  „Click MINUS”, „Click KEEP”), pod spodem ten ruch w oficjalnych terminach; w Main Phase — ruch (np. „Play a Card: …”).
- **dlaczego**: najwyraźniejsza różnica na stole do Twojej następnej tury względem drugiej opcji (np. „+ Rival's Gigs:
  5,1 (6)”), a gdy różnic nie ma — szanse obu opcji.
- **plan tury**: „Then: …” — kolejne Twoje ruchy w tej turze, jak je widzi Coach.
- Klik w okienko (albo w przycisku wtyczki **Always show details**): plan krok po kroku, wszystkie powody, inne
  opcje z szansami i ich przyciskami, liczba symulacji.

## Co umie (wersja 0.1.6)
- **React Step**: gdy rywal atakuje — blok ([BLOCKER]), Call a Legend, karta Quick albo PASS; Coach odtwarza atak
  rywala w naszym silniku i liczy każdą odpowiedź.
- **Kto zaczyna** („Go first” / „Go second”) i **ręka startowa** („Keep” / „Mulligan”): każda opcja z szansą na
  wygraną z symulacji dwóch pierwszych tur obu graczy (przy małej różnicy obie opcje są podobnie dobre).
- Twoja **Main Phase** (zagranie, sprzedaż, Call a Legend, atak, Pass Turn) — także po atakach w tej samej turze —
  i **wybór kości Giga** na początku tury (tylko kości, którymi strona pozwala rzucić).
- **Wybory z efektów Twoich kart i ataków**: np. który Gig i o ile zmienić (Afterparty at Lizzie's), cel ataku
  („Rival Gig area” albo Jednostka), który Gig ukraść. Wtyczka odtwarza w naszym silniku Twój ostatni ruch z Main
  Phase, który do tego wyboru doprowadził, i liczy każdą opcję. Strona dzieli niektóre wybory na kroki (np. Gig →
  PLUS/MINUS → ile) — podpowiedź opisuje cały wybór naraz (np. „Adjust: D4 (4) → 3”).
- Wybory, których nie da się tak odtworzyć (np. efekt karty rywala), nadal tylko opisuje:
  „Your choice: …” albo „Rival is choosing”.
- Nie czyta jeszcze efektów „do końca tury” z kart programów — wtedy podpowiedź jest przybliżona.
- 0.1.6: odczyt strony odporny na nietypowe dane (zamiast milczeć, pokazuje powód), po instalacji albo
  aktualizacji wtyczka sama startuje w otwartych już kartach gry (bez F5), działa też pod adresem z „www.”.
- 0.1.2: ocena pozycji z self-play (mocniejsze podpowiedzi). 0.1.3: Coach jest włączony, dopóki go nie wyłączysz
  (przycisk i okienko zawsze zgodne), okienko nie może zostać poza ekranem, diagnostyka w przycisku wtyczki.
- Wtyczka czyta stan gry, który strona trzyma w przeglądarce; jeśli strona zmieni jego format, okienko napisze
  „The coach could not read this position” — wtedy trzeba zaktualizować wtyczkę.
