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
- Smart Select z segmentacją semantyczną, detekcją obiektów, łączeniem masek i refine edge,
- pędzel z twardością, kryciem i spacingiem oraz niedestrukcyjną gumkę maskującą,
- clone stamp, healing brush i spot healing na osobnej warstwie,
- wiadro spójnego obszaru, gradient liniowy/radialny i pipetę,
- edytowalne warstwy tekstowe oraz skalowalne prostokąty, elipsy, linie i strzałki,
- mapę głębi, Lens Blur, relighting i atmosferę,
- super-resolution 2×/4×, redukcję artefaktów JPEG, denoise i deblur,
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
- `src/editor-workspace.js` — integracja modelu dokumentu z pipeline'em AI i eksportem,
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
- `src/editor-adjustments-ui.js` — panel warstw korekcyjnych, krzywe i porównanie przed/po,
- `src/editor-retouch.js` — format pociągnięć clone/healing i geometria źródła,
- `src/editor-retouch-processor.js` — generowanie małych patchy RGBA w Workerze lub fallbacku,
- `src/editor-smart-mask.js` — operacje masek, refine edge i ręczne poprawki,
- `src/editor-smart-select-engine.js` — SegFormer, DETR i MODNet przez wspólny runtime,
- `src/editor-depth-map.js` — normalizacja, skalowanie i ręczna edycja mapy głębi,
- `src/editor-depth-effects.js` — Lens Blur, relighting, atmosfera i finalny render kafelkowy,
- `src/editor-depth-renderer.js` — warstwy efektów głębi w stosie dokumentu,
- `src/editor-restoration-core.js` — profile restoration, skalowany tiling, lokalne fallbacki i estymacja pamięci,
- `src/editor-restoration-engine.js` — kolejka modeli Swin2SR, anulowanie i stitch 2×/4×,
- `src/editor-restoration-ui.js` — preview 1:1, A/B, różnica i wynik jako nowa warstwa.

Import tworzy bazową warstwę rastrową. Wyniki AI trafiają do osobnej warstwy, maski albo zasobu projektu i nie muszą nadpisywać obrazu źródłowego.

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

Szczegóły: `docs/EDITOR_ADJUSTMENTS.md`.

#### Retusz klasyczny

- `S` aktywuje Clone Stamp, `J` Healing Brush, a `Shift+J` Spot Healing,
- `Alt`/`Option` + klik ustawia widoczne źródło clone/healing,
- rozmiar, twardość, krycie, przepływ i spacing są regulowane,
- każde pociągnięcie zapisuje mały patch RGBA na osobnej warstwie,
- Worker wykonuje cięższe przetwarzanie, a fallback pozostaje lokalny,
- undo cofa pojedyncze pociągnięcie bez modyfikowania rastra źródłowego.

Szczegóły: `docs/EDITOR_RETOUCH.md`.

#### Smart Select

- SegFormer tworzy maski semantyczne, DETR wykrywa obiekty, a MODNet doprecyzowuje osobę,
- użytkownik może wybrać kilka obiektów i łączyć ich maski,
- kliknięcie płótna wybiera obiekt pod kursorem,
- refine edge oraz ręczne dodawanie/odejmowanie poprawiają granice,
- zapisana maska jest konwertowana do lokalnej przestrzeni warstwy i porusza się razem z nią.

Szczegóły: `docs/EDITOR_SMART_SELECT.md`.

#### Głębia i światło

- Depth Anything tworzy lokalną mapę głębi zapisywaną jako zasób projektu,
- punkt ostrości wybiera się kliknięciem, a mapę można poprawić pędzlem,
- Lens Blur, relighting i atmosfera są osobnymi warstwami,
- finalny render działa kafelkowo z overlapem.

Szczegóły: `docs/EDITOR_DEPTH.md`.

#### Restoration i super-resolution

- profile Swin2SR oferują szybkie 2×, real-world 4× oraz naprawę kompresji JPEG,
- denoise i deblur mają deterministyczne lokalne fallbacki,
- podgląd używa zaznaczenia albo środkowego fragmentu i pokazuje widoki Przed/Po/Różnica,
- finalny render działa kafelkowo ze skalowanym overlapem i tworzy nową warstwę,
- rozmiar roboczy oraz pamięć są sprawdzane przed startem,
- anulowany wynik nie zmienia dokumentu,
- SR 2×/4× zmienia wymiary dokumentu w tej samej komendzie undo/redo co dodanie warstwy.

Szczegóły: `docs/EDITOR_RESTORATION.md`.

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
- **Stare zdjęcie:** użyj naprawy JPEG lub lokalnego denoise, sprawdź podgląd 1:1 i dodaj wynik jako nową warstwę.
- **Mały obraz:** wybierz SR 2× albo 4×; przed finalnym renderem sprawdź fragment Przed/Po oraz szacowaną pamięć.

### Skaner prywatności — `/privacy.html`

Łączy lokalną analizę semantyczną z walidowanymi regułami. Wykrywa dane tożsamościowe, adresy, informacje medyczne, wynagrodzenia, e-mail, telefon, PESEL, IBAN, karty, IPv4 oraz popularne formaty kluczy API i tokenów. Reguły wbudowane są jawne i tylko do odczytu, a użytkownik może dodawać własne reguły.

### Audyt umów — `/contract.html`

Użytkownik dodaje PDF, DOCX lub tekst i pyta o pułapki w umowie. Odpowiedź wskazuje ryzyka, ich znaczenie oraz konkretne strony i linie dokumentu.

### Weryfikowalny przykład audytu — `/example.html`

Przykład używa tego samego modułu odpowiedzi co właściwy audyt i pokazuje źródła dla wykrytych ryzyk.

## Intel NPU i backendy

Bazowy rejestr wspólnego runtime’u zawiera pięć modeli:

1. `onnx-community/modnet-webnn` — usuwanie tła przez WebNN/NPU, WebGPU albo WASM,
2. `onnx-community/depth-anything-v2-small` — estymacja głębi przez WebGPU albo WASM,
3. `Xenova/swin2SR-lightweight-x2-64` — super-resolution 2× przez WebGPU albo WASM,
4. `onnx-community/swin2SR-realworld-sr-x4-64-bsrgan-psnr-ONNX` — super-resolution 4× przez WebGPU albo WASM,
5. `Xenova/swin2SR-compressed-sr-x4-48` — restoration artefaktów JPEG przez WebGPU albo WASM.

Smart Select rejestruje dodatkowo SegFormer ADE20K i DETR COCO w tej samej instancji runtime’u.

Tryb `Auto` sprawdza zgodne backendy kolejno NPU → WebGPU → WASM. Tryb `Tylko NPU` kończy się czytelnym błędem zamiast wykonywać cichy fallback. Obecnie fizycznie zweryfikowany kontrakt NPU ma wyłącznie MODNet; modele głębi, Smart Select i Swin2SR nie deklarują obsługi NPU bez testu operatorów.

Panel diagnostyczny pokazuje faktyczny backend, stan kolejki, możliwość anulowania, dostępność modeli i rozbicie czasu na pobieranie, preprocessing, transfery, inferencję i postprocessing. Pliki modeli są cache’owane z kluczem zawierającym wersję i backend, a gotowe sesje są ponownie używane.

Szczegóły runtime’u: `docs/EDITOR_NPU_RUNTIME.md`.

Proste korekty tonalne, klasyczny retusz oraz lokalne fallbacki denoise/deblur działają przez Canvas/CPU, a nie NPU. NPU pozostaje przeznaczone dla zgodnej inferencji modeli obrazu.

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

Testy obejmują rdzeń kompozycji obrazu, viewport i macierze transformacji, crop/resize, perspektywę, snapping, geometrię zaznaczeń, magic wand, historię pociągnięć, gumkę maskującą, cache warstw malowania, model dokumentu i warstw, serializowane undo/redo, round-trip i migracje `.localstudio`, autosave i odzyskiwanie projektów, czyszczenie blobów, maski i blend modes, tonalne i przestrzenne warstwy korekcyjne, poziomy, krzywe, HSL, histogram, clipping i presety, clone/healing/spot healing, Smart Select i refine edge, mapę głębi oraz efekty głębi, preprocessing MODNet, rejestr i cache modeli, wybór oraz fallback backendów, kolejkę i anulowanie inferencji, reuse sesji, benchmark etapów, tiling z overlapem, skalowany tiling 2×/4×, stitch bez szwów, denoise, JPEG restoration, deblur, atomowe warstwy wynikowe i undo/redo rozmiaru dokumentu, ranking dokumentów, lokalizacje źródeł oraz wykrywanie i anonimizację danych wrażliwych.
