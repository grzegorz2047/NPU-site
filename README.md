# LocalLab NPU

Zestaw prywatnych narzędzi AI działających lokalnie w przeglądarce. Obrazy, teksty i dokumenty nie są wysyłane do backendu ani chmurowego modelu.

**Strona:** https://grzegorz2047.github.io/NPU-site/

## Narzędzia

### Ekran startowy — `/`

Strona główna jest lekkim katalogiem narzędzi. Nie ładuje modelu ani runtime'u edytora, dopóki użytkownik nie przejdzie do konkretnej podstrony.

### LocalStudio NPU — `/editor.html`

Pełnosprawny lokalny edytor obrazu w kompaktowym układzie typu desktopowego. Umożliwia:

- import JPG, PNG i WebP,
- korektę jasności, kontrastu, nasycenia, sepii, skali szarości i rozmycia,
- obrót oraz odbicie obrazu,
- usuwanie tła modelem MODNet,
- podmianę tła na kolor, gradient, rozmycie albo własny obraz,
- tworzenie przezroczystych stickerów z obwódką i cieniem,
- gotowe presety: portret do CV, sticker PNG i rozmyte tło portretu,
- ręczną anonimizację screenshotów przez blur, pikselizację albo czarny pasek,
- niedestrukcyjny dokument z warstwami, maskami, trybami mieszania oraz undo/redo,
- płynny zoom zakotwiczony pod kursorem, pan myszą/touchpadem i szybkie dopasowanie widoku,
- crop z proporcjami i prostowaniem, resize dokumentu lub aktywnej warstwy,
- swobodną transformację warstwy: przesunięcie, skala, obrót, skew i perspektywa,
- linijki, prowadnice, siatkę i opcjonalne przyciąganie,
- eksport do PNG, JPEG i WebP.

#### Rdzeń dokumentu

Model edytora jest niezależny od DOM i rozdzielony na moduły:

- `src/editor-document.js` — dokument, warstwy raster/tekst/kształt/grupa, zaznaczenie i serializacja,
- `src/editor-history.js` — odwracalne komendy, undo/redo, limit i kompaktowanie historii,
- `src/editor-renderer.js` — kompozycja canvasa, maski, maski przycinające, blend modes i perspektywa,
- `src/editor-layers-ui.js` — panel warstw i skróty klawiaturowe,
- `src/editor-canvas-geometry.js` — viewport, macierze, perspektywa i snapping,
- `src/editor-canvas-commands.js` — crop, resize, prowadnice i transformacje z undo/redo,
- `src/editor-canvas-ui.js` — kontrolki nawigacji i transformacji montowane bez przebudowy legacy HTML,
- `src/editor-canvas-controller.js` — zoom/pan, interakcje płótna, linijki i podglądy zatwierdzania,
- `src/editor-workspace.js` — integracja modelu z istniejącym pipeline'em AI i eksportem,
- `src/editor-project-format.js` — wersjonowany format `.localstudio`, walidacja i migracje,
- `src/editor-project-store.js` — IndexedDB, trwałe bloby, lista projektów i journal odzyskiwania,
- `src/editor-project-controller.js` — autosave, import/eksport projektu i ostrzeżenie o niezapisanych zmianach.

#### Nawigacja i transformacje płótna

- `Ctrl`/`Alt` + kółko skaluje widok z kursorem jako punktem odniesienia; zwykłe kółko lub touchpad przesuwa dokument,
- spacja, środkowy przycisk myszy albo narzędzie ręki uruchamiają pan,
- skróty `0` i `1` przełączają dopasowanie oraz 100%, a `+`/`-` zmieniają szybkie poziomy zoomu,
- crop i transformacja działają jako podgląd i trafiają do dokumentu dopiero po zatwierdzeniu,
- transformacje aktywnej warstwy zachowują maski i są w pełni odwracalne,
- dwuklik na linijce dodaje prowadnicę, prawy przycisk usuwa najbliższą; grid, guides i snapping można wyłączyć.

#### Projekty lokalne

- dokument, historia undo/redo, ustawienia i binarne zasoby obrazu są automatycznie zapisywane w IndexedDB,
- zapis jest wykonywany po bezczynności z debounce i nie blokuje renderowania płótna,
- po odświeżeniu otwierany jest ostatni projekt; niedokończony zapis może zostać odtworzony z journala,
- panel pokazuje ostatnie projekty i pozwala je otwierać lub usuwać razem ze wszystkimi blobami,
- projekt można pobrać jako `.localstudio` i ponownie zaimportować,
- nowsza, nieobsługiwana wersja formatu daje czytelny komunikat zamiast częściowego otwarcia.

### Skaner prywatności — `/privacy.html`

Łączy lokalną analizę semantyczną z walidowanymi regułami i wykrywa dane wrażliwe bez wysyłania treści do chmury.

### Audyt umów — `/contract.html`

Użytkownik dodaje PDF, DOCX lub tekst i pyta o pułapki w umowie. Odpowiedź wskazuje ryzyka oraz konkretne strony i linie dokumentu.

## Intel NPU i backendy

Segmentacja obrazu korzysta z modelu `onnx-community/modnet-webnn`: Intel NPU przez WebNN, WebGPU albo WebAssembly na CPU. Tryb automatyczny próbuje backendów kolejno i pokazuje faktycznie uruchomiony runtime.

## Prywatność

- brak backendu, kont i analityki,
- obrazy i tekst pozostają lokalnie,
- projekty edytora, dokumenty audytu i wektory są przechowywane w IndexedDB.

## Uruchomienie lokalne

```bash
python3 -m http.server 4173
```

Otwórz `http://localhost:4173`.

## Testy

```bash
npm test
```

Testy obejmują kompozycję obrazu, viewport i macierze transformacji, crop/resize, perspektywę, snapping, dokument i warstwy, undo/redo, `.localstudio`, autosave, maski, backendy NPU/GPU/CPU, ranking dokumentów i wykrywanie danych wrażliwych.
