# Runtime modeli obrazu w LocalStudio

Runtime edytora oddziela definicję modelu, wybór backendu, kolejkę zadań i przetwarzanie pełnej rozdzielczości od konkretnego narzędzia UI.

## Moduły

- `src/editor-model-registry.js` — wersjonowany rejestr modeli, licencje, wejścia, wyjścia, preprocessing i macierz zgodności backendów;
- `src/editor-model-cache.js` — cache plików modelu w pamięci procesu oraz CacheStorage;
- `src/editor-inference-queue.js` — kolejka z priorytetem, pojedynczą kontrolowaną współbieżnością, postępem i anulowaniem;
- `src/editor-inference-benchmark.js` — pomiar pobierania, preprocessingu, transferu wejścia, inferencji, transferu wyjścia i postprocessingu;
- `src/editor-tiling.js` — plan kafelków, overlap i ważone składanie wyniku o tej samej skali;
- `src/editor-restoration-accumulator.js` — strumieniowe składanie kafelków RGBA o wyjściu 2×/4×;
- `src/editor-inference-runtime.js` — wspólny kontrakt sesji, fallback, reuse i zwalnianie sesji;
- `src/editor-runtime.js` — adaptery przeglądarkowe WebNN/NPU, WebGPU i WASM oraz zgodność z istniejącym `SegmentationEngine`;
- `src/editor-runtime-ui.js` — stan kolejki, faktyczny backend, anulowanie, kompatybilność modeli i eksport raportu JSON.

## Zarejestrowane modele

### MODNet portrait matting

- repozytorium: `onnx-community/modnet-webnn`;
- licencja: Apache-2.0;
- zadanie: usuwanie tła / portrait matting;
- wejście NPU: tensor `float32` NCHW `1×3×256×256`;
- backendy: WebNN/NPU, WebGPU i WASM.

MODNet jest używany przez przycisk usuwania tła i Smart Select dla dokładnej maski osoby. Interfejs `SegmentationEngine` pozostaje zgodny, ale wykonanie przechodzi przez wspólną kolejkę i wersjonowane sesje.

### Depth Anything V2 Small

- repozytorium: `onnx-community/depth-anything-v2-small`;
- licencja: Apache-2.0;
- zadanie: estymacja głębi;
- backendy: WebGPU i WASM przez Transformers.js;
- NPU: kontrakt operatorów nie został zweryfikowany, dlatego tryb `Tylko NPU` jawnie odrzuca ten model.

Model zasila mapę głębi, Lens Blur, relighting i atmosferę.

### Swin2SR

Bazowy rejestr zawiera trzy warianty image-to-image:

- `Xenova/swin2SR-lightweight-x2-64` — szybkie super-resolution 2×;
- `onnx-community/swin2SR-realworld-sr-x4-64-bsrgan-psnr-ONNX` — real-world super-resolution 4×;
- `Xenova/swin2SR-compressed-sr-x4-48` — redukcja artefaktów kompresji JPEG.

Warianty korzystają z WebGPU albo WASM. Kontrakt operatorów WebNN/NPU nie został fizycznie zweryfikowany, więc rejestr oznacza NPU jako nieobsługiwane zamiast wykonywać cichy fallback.

### Modele Smart Select

`SmartSelectEngine` rejestruje w tej samej instancji runtime’u dwa dodatkowe modele:

- SegFormer B0 ADE20K — `image-segmentation`;
- DETR ResNet-50 COCO — `object-detection`.

Oba korzystają z generycznych adapterów Transformers.js WebGPU/WASM. NPU pozostaje wyłączone do czasu osobnej walidacji operatorów.

## Tryby backendu

- `Auto` sprawdza zgodne backendy w kolejności NPU → WebGPU → WASM;
- `Tylko NPU` nie wykonuje cichego fallbacku;
- ręczne WebGPU lub WASM uruchamia wyłącznie wybraną ścieżkę;
- raport i panel pokazują backend faktycznie użyty przez zadanie;
- jeżeli pierwszy zgodny backend zakończy się błędem w trybie `Auto`, panel oznacza uruchomienie jako `tryb zapasowy`.

Lokalne algorytmy restoration nie udają backendu modelowego. Raportują `local`, a w trybie `Tylko NPU` fallback modelu Swin2SR jest blokowany.

## Cache i sesje

Klucz cache zawiera identyfikator modelu, wersję oraz backend. Zmiana wersji nie używa bajtów starszego modelu. Runtime ponownie wykorzystuje gotową sesję, dopóki nie zostanie jawnie zwolniona przez `releaseSession()` albo `dispose()`.

CacheStorage jest optymalizacją. Jeżeli przeglądarka go blokuje, runtime nadal używa cache w pamięci bieżącej karty.

Dla sesji NPU diagnostyka wykrywa dostępność API IO binding / MLTensor. Samo wykrycie API nie oznacza jeszcze, że każde wywołanie modelu używa jawnego powiązania buforów; adapter musi zaimplementować tę ścieżkę osobno.

## Kolejka i anulowanie

Kolejka wykonuje domyślnie jedno zadanie naraz, aby ograniczyć szczytowe użycie pamięci. Wyższy priorytet wyprzedza zadania oczekujące, a zadania o tym samym priorytecie zachowują kolejność FIFO.

Anulowanie korzysta z `AbortSignal`. Zadanie oczekujące jest usuwane z kolejki, a zadanie aktywne otrzymuje sygnał przerwania. Niekompletny wynik nie jest dodawany do dokumentu.

Preview restoration ma wyższy priorytet od pełnego renderu. Cały zestaw kafelków jest jednym zadaniem kolejki, a poszczególne wywołania modelu ponownie używają tej samej sesji.

## Preview i pełna rozdzielczość

Runtime przyjmuje flagę `preview` dla szybkiej inferencji na zmniejszonym wejściu. Pełna rozdzielczość może użyć `runTiledInference()`:

1. obraz jest dzielony na kafelki z overlapem;
2. każdy kafelek przechodzi przez tę samą sesję modelu;
3. postęp raportuje liczbę ukończonych kafelków;
4. wynik jest składany z wygładzonymi wagami w obszarach nakładania.

Dla super-resolution osobny plan mnoży współrzędne, crop i overlap przez skalę 2×/4×. `ScaledRgbaAccumulator` dopisuje każdy wynik bez przechowywania listy wszystkich kafelków. Po dodaniu kafelka jego bufor może zostać zwolniony.

Konkretny ekstraktor obrazu i mapowanie wyjścia dostarcza narzędzie korzystające z runtime’u, np. restoration albo depth.

## Diagnostyka

Panel `Diagnostyka modeli` jest domyślnie zwinięty, aby nie zasłaniać warstw. Pokazuje:

- aktywny backend oraz informację o fallbacku;
- stan kolejki i postęp;
- przycisk anulowania;
- dostępność backendów dla każdego modelu;
- osobne czasy etapów;
- eksport raportu JSON.

Panel restoration dodatkowo pokazuje liczbę kafelków, czas, szacowany szczyt pamięci i przyczynę lokalnego fallbacku.

## Ograniczenia walidacji

Testy Node sprawdzają kontrakty, kolejkę, cache, fallback, reuse sesji, anulowanie, tiling, skalowane składanie RGBA i ścisły tryb NPU. GitHub Actions sprawdza pełne `npm test`, składnię modułów i kompletność offline shell.

Test na fizycznym Intel NPU nie jest zastępowany przez CI. Wymaga zgodnego komputera, Windows 11, sterownika Intel NPU i przeglądarki z WebNN.
