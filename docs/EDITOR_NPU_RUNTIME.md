# Runtime modeli obrazu w LocalStudio

Runtime edytora oddziela definicję modelu, wybór backendu, kolejkę zadań i przetwarzanie pełnej rozdzielczości od konkretnego narzędzia UI.

## Moduły

- `src/editor-model-registry.js` — wersjonowany rejestr modeli, licencje, wejścia, wyjścia, preprocessing i macierz zgodności backendów;
- `src/editor-model-cache.js` — cache plików modelu w pamięci procesu oraz CacheStorage;
- `src/editor-inference-queue.js` — kolejka z priorytetem, pojedynczą kontrolowaną współbieżnością, postępem i anulowaniem;
- `src/editor-inference-benchmark.js` — pomiar pobierania, preprocessingu, transferu wejścia, inferencji, transferu wyjścia i postprocessingu;
- `src/editor-tiling.js` — plan kafelków, overlap i ważone składanie wyniku bez twardych szwów;
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

MODNet jest używany przez istniejący przycisk usuwania tła. Dotychczasowy interfejs `SegmentationEngine` pozostaje zgodny, ale wykonanie przechodzi przez wspólną kolejkę i wersjonowane sesje.

### Depth Anything V2 Small

- repozytorium: `onnx-community/depth-anything-v2-small`;
- licencja: Apache-2.0;
- zadanie: estymacja głębi;
- backendy: WebGPU i WASM przez Transformers.js;
- NPU: kontrakt operatorów nie został jeszcze zweryfikowany, dlatego tryb `Tylko NPU` jawnie odrzuca ten model.

Model głębi korzysta z tego samego API runtime, ale pełne narzędzie głębi, blur i relighting pozostają zakresem issue #58.

## Tryby backendu

- `Auto` sprawdza zgodne backendy w kolejności NPU → WebGPU → WASM;
- `Tylko NPU` nie wykonuje cichego fallbacku;
- ręczne WebGPU lub WASM uruchamia wyłącznie wybraną ścieżkę;
- raport i panel pokazują backend faktycznie użyty przez zadanie;
- jeżeli pierwszy zgodny backend zakończy się błędem w trybie `Auto`, panel oznacza uruchomienie jako `tryb zapasowy`.

## Cache i sesje

Klucz cache zawiera identyfikator modelu, wersję oraz backend. Zmiana wersji nie używa bajtów starszego modelu. Runtime ponownie wykorzystuje gotową sesję, dopóki nie zostanie jawnie zwolniona przez `releaseSession()` albo `dispose()`.

CacheStorage jest optymalizacją. Jeżeli przeglądarka go blokuje, runtime nadal używa cache w pamięci bieżącej karty.

## Kolejka i anulowanie

Kolejka wykonuje domyślnie jedno zadanie naraz, aby ograniczyć szczytowe użycie pamięci. Wyższy priorytet wyprzedza zadania oczekujące, a zadania o tym samym priorytecie zachowują kolejność FIFO.

Anulowanie korzysta z `AbortSignal`. Zadanie oczekujące jest usuwane z kolejki, a zadanie aktywne otrzymuje sygnał przerwania. Niekompletny wynik nie jest dodawany do dokumentu.

## Preview i pełna rozdzielczość

Runtime przyjmuje flagę `preview` dla szybkiej inferencji na zmniejszonym wejściu. Pełna rozdzielczość może użyć `runTiledInference()`:

1. obraz jest dzielony na kafelki z overlapem;
2. każdy kafelek przechodzi przez tę samą sesję modelu;
3. postęp raportuje liczbę ukończonych kafelków;
4. wynik jest składany z wygładzonymi wagami w obszarach nakładania.

Konkretny ekstraktor obrazu i mapowanie wyjścia dostarcza narzędzie korzystające z runtime’u, np. restoration albo depth.

## Diagnostyka

Panel `Diagnostyka modeli` jest domyślnie zwinięty, aby nie zasłaniać warstw. Pokazuje:

- aktywny backend oraz informację o fallbacku;
- stan kolejki i postęp;
- przycisk anulowania;
- dostępność backendów dla każdego modelu;
- osobne czasy etapów;
- eksport raportu JSON.

## Ograniczenia walidacji

Testy Node sprawdzają kontrakty, kolejkę, cache, fallback, reuse sesji, anulowanie i tiling. GitHub Actions sprawdza pełne `npm test` oraz składnię modułów.

Test na fizycznym Intel NPU nie jest zastępowany przez CI. Wymaga zgodnego komputera, Windows 11, sterownika Intel NPU i przeglądarki z WebNN.
