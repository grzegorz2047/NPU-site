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
- niedestrukcyjne warstwy korekcyjne z poziomami, krzywymi, HSL, histogramem, maskami i presetami,
- płynny zoom zakotwiczony pod kursorem, pan myszą/touchpadem i szybkie dopasowanie widoku,
- crop z proporcjami i prostowaniem, resize dokumentu lub aktywnej warstwy,
- swobodną transformację warstwy: przesunięcie, skala, obrót, skew i perspektywa,
- linijki, prowadnice, siatkę i opcjonalne przyciąganie,
- zaznaczenia prostokątne, eliptyczne, lasso oraz magic wand z operacjami add/subtract/intersect,
- feather, rozszerzanie, zmniejszanie i odwracanie zaznaczeń,
- pędzel z twardością, kryciem i spacingiem oraz niedestrukcyjną gumkę maskującą,
- wiadro spójnego obszaru, gradient liniowy/radialny i pipetę,
- edytowalne warstwy tekstowe oraz skalowalne prostokąty, elipsy, linie i strzałki,
- eksport do PNG, JPEG i WebP.

#### Rdzeń dokumentu

Model edytora jest niezależny od DOM i rozdzielony na moduły:

- `src/editor-document.js` — dokument, warstwy raster/tekst/kształt/grupa, zaznaczenie i serializacja,
- `src/editor-history.js` — odwracalne komendy, undo/redo, limit i kompaktowanie historii,
- `src/editor-renderer.js` — kompozycja canvasa, maski, maski przycinające i blend modes,
- `src/editor-layers-ui.js` — panel warstw i skróty klawiaturowe,
- `src/editor-canvas-geometry.js` — viewport, macierze, perspektywa i snapping,
- `src/editor-canvas-commands.js` — crop, resize, prowadnice i transformacje z undo/redo,
- `src/editor-canvas-controller.js` — zoom/pan, interakcje płótna, linijki i podglądy zatwierdzania,
- `src/editor-selection.js` — geometria, maski, magic wand i operacje na zaznaczeniach,
- `src/editor-selection-render.js` — ograniczanie istniejących korekt do zaznaczonego obszaru,
- `src/editor-paint.js` — serializowalne pociągnięcia, wypełnienia, gradienty i gumka maskująca,
- `src/editor-tools-controller.js` — aktywne narzędzie, skróty, podgląd i integracja z undo/redo,
- `src/editor-workspace.js` — integracja nowego modelu z istniejącym pipeline'em AI i eksportem,
- `src/editor-project-format.js` — wersjonowany format `.localstudio`, walidacja i migracje,
- `src/editor-project-store.js` — IndexedDB, trwałe bloby, lista projektów i journal odzyskiwania,
- `src/editor-project-controller.js` — autosave, import/eksport projektu i ostrzeżenie o niezapisanych zmianach,
- `src/editor-model-registry.js` — kontrakty modeli, licencje i macierz NPU/WebGPU/WASM,
- `src/editor-model-cache.js` — wersjonowany cache plików modeli,
- `src/editor-inference-queue.js` — priorytety, postęp i anulowanie zadań,
- `src/editor-inference-runtime.js` — wspólne API sesji, jawny fallback i reuse,
- `src/editor-tiling.js` — kafelki z overlapem i składanie bez twardych szwów,
- `src/editor-runtime-ui.js` — diagnostyka backendu, kolejki i benchmarku,
- `src/editor-adjustments.js` — schematy korekt, histogram i presety,
- `src/editor-adjustment-renderer.js` — stos korekt, maski, krycie i blend modes,
- `src/editor-adjustments-ui.js` — panel warstw korekcyjnych, krzywe i porównanie przed/po.

Obecny import tworzy bazową warstwę rastrową. Wynik dotychczasowego pipeline'u pozostaje zgodny z presetami, korektami, MODNet, podmianą tła i redakcją, a kolejne wyniki AI mogą być dodawane jako osobna warstwa lub maska.

#### Nawigacja i transformacje płótna

- `Ctrl`/`Alt` + kółko skaluje widok z kursorem jako punktem odniesienia; zwykłe kółko lub touchpad przesuwa dokument,
- spacja, środkowy przycisk myszy albo narzędzie ręki uruchamiają pan,
- skróty `0` i `1` przełączają dopasowanie oraz 100%, a `+`/`-` zmieniają szybkie poziomy zoomu,
- crop i transformacja działają jako podgląd i trafiają do dokumentu dopiero po zatwierdzeniu,
- transformacje aktywnej warstwy zachowują maski i są w pełni odwracalne,
- dwuklik na linijce dodaje prowadnicę, prawy przycisk usuwa najbliższą; grid, guides i snapping można wyłączyć.

#### Narzędzia manualne

- `M` aktywuje zaznaczenie, `W` magic wand, `B` pędzel, `E` gumkę, `F` wiadro, `G` gradient, `I` pipetę, `T` tekst, a `U` kształt,
- zaznaczenie jest serializowane w projekcie i ogranicza pędzel, gumkę, wiadro oraz gradient,
- każda kreska, operacja zaznaczenia, tekst i kształt tworzą pojedynczy wpis undo/redo,
- gumka dopisuje pociągnięcia do maski warstwy zamiast usuwać źródłowe piksele,
- warstwy malowania są cache’owane przyrostowo, więc kolejne pociągnięcia nie odtwarzają całej historii od zera.

#### Korekty niedestrukcyjne

- korekty są osobnymi warstwami i nie nadpisują źródłowych pikseli,
- kolejność warstw korekcyjnych wpływa na wynik kompozycji,
- dostępne są ekspozycja, jasność, kontrast, gamma, poziomy RGB/per kanał, krzywe RGB/per kanał, balans bieli, HSL per zakres, vibrance, saturation, shadows/highlights, clarity, dehaze, sharpen, blur, winieta i ziarno,
- każda warstwa obsługuje maskę z zaznaczenia, krycie, widoczność, blokadę oraz tryby mieszania,
- histogram RGB/luminancji i ostrzeżenia clippingu są podglądem i nie trafiają do eksportu,
- presety wbudowane są tylko do odczytu, a własne zapisują się lokalnie,
- przytrzymanie przycisku porównania renderuje dokument bez warstw korekcyjnych.

Szczegóły architektury i ograniczeń znajdują się w `docs/EDITOR_ADJUSTMENTS.md`.

#### Projekty lokalne

- dokument, historia undo/redo, ustawienia i binarne zasoby obrazu są automatycznie zapisywane w IndexedDB,
- zapis jest wykonywany po bezczynności z debounce i nie blokuje renderowania płótna,
- po odświeżeniu otwierany jest ostatni projekt; niedokończony zapis może zostać odtworzony z journala,
- panel pokazuje ostatnie projekty i pozwala je otwierać lub usuwać razem ze wszystkimi blobami,
- projekt można pobrać jako `.localstudio` i ponownie zaimportować,
- nowsza, nieobsługiwana wersja formatu daje czytelny komunikat zamiast częściowego otwarcia.

#### Przykłady użycia

- **Zdjęcie do CV:** wczytaj zdjęcie, użyj presetu CV, sprawdź maskę i pobierz JPEG.
- **Sticker:** wytnij tło, dodaj obwódkę i cień, pobierz PNG.
- **Anonimizowany screenshot:** wybierz tryb redakcji, zaznacz dane i pobierz gotowy obraz.
- **Korekcja tonalna:** dodaj warstwę ekspozycji lub krzywych, ustaw maskę i porównaj wynik przed eksportem.

### Skaner prywatności — `/privacy.html`

Łączy lokalną analizę semantyczną z walidowanymi regułami. Wykrywa dane tożsamościowe, adresy, informacje medyczne, wynagrodzenia, e-mail, telefon, PESEL, IBAN, karty, IPv4 oraz popularne formaty kluczy API i tokenów. Reguły wbudowane są jawne i tylko do odczytu, a użytkownik może dodawać własne reguły.

### Audyt umów — `/contract.html`

Użytkownik dodaje PDF, DOCX lub tekst i pyta o pułapki w umowie. Odpowiedź wskazuje ryzyka, ich znaczenie oraz konkretne strony i linie dokumentu.

### Weryfikowalny przykład audytu — `/example.html`

Przykład używa tego samego modułu odpowiedzi co właściwy audyt i pokazuje źródła dla wykrytych ryzyk.

## Intel NPU i backendy

Wspólny runtime obrazu rejestruje obecnie dwa modele korzystające z jednego API:

1. `onnx-community/modnet-webnn` — usuwanie tła przez WebNN/NPU, WebGPU albo WASM,
2. `onnx-community/depth-anything-v2-small` — estymacja głębi przez WebGPU albo WASM; NPU pozostaje wyłączone do czasu weryfikacji operatorów.

Tryb `Auto` sprawdza zgodne backendy kolejno NPU → WebGPU → WASM. Tryb `Tylko NPU` kończy się czytelnym błędem zamiast wykonywać cichy fallback. Panel diagnostyczny pokazuje faktyczny backend, stan kolejki, możliwość anulowania, dostępność modeli i rozbicie czasu na pobieranie, preprocessing, transfery, inferencję i postprocessing.

Pliki modeli są cache’owane z kluczem zawierającym wersję i backend, a gotowe sesje są ponownie używane. Pełna rozdzielczość może być przetwarzana kafelkami z overlapem i ważonym składaniem wyniku. Szczegóły znajdują się w `docs/EDITOR_NPU_RUNTIME.md`.

Proste korekty tonalne i filtry pikselowe działają przez Canvas/CPU, a nie NPU. NPU pozostaje przeznaczone dla inferencji modeli obrazu.

## Prywatność

- brak backendu, kont i analityki,
- obrazy i tekst pozostają w pamięci przeglądarki,
- dokumenty audytu i wektory są przechowywane lokalnie w IndexedDB,
- modele i biblioteki są pobierane niezależnie od danych użytkownika.

## Uruchomienie lokalne

```bash
python3 -m http.server 4173
```

Otwórz `http://localhost:4173`.

Dla pracy agentowej, walidacji Chromium i fallbacku przy ograniczonym DNS zobacz `docs/LOCAL_AGENT_WORKFLOW.md`.

## Testy

```bash
npm test
```

Testy obejmują rdzeń kompozycji obrazu, viewport i macierze transformacji, crop/resize, perspektywę, snapping, geometrię zaznaczeń, magic wand, historię pociągnięć, gumkę maskującą, cache warstw malowania, model dokumentu i warstw, serializowane undo/redo, round-trip i migracje `.localstudio`, autosave i odzyskiwanie projektów, czyszczenie blobów, maski i blend modes, tonalne i przestrzenne warstwy korekcyjne, poziomy, krzywe, HSL, histogram, clipping i presety, preprocessing MODNet, rejestr i cache modeli, wybór oraz fallback backendów, kolejkę i anulowanie inferencji, reuse sesji, benchmark etapów, tiling z overlapem, ranking dokumentów, lokalizacje źródeł oraz wykrywanie i anonimizację danych wrażliwych.
