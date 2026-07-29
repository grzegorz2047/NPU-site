# Restoration i super-resolution w LocalStudio

Moduł restoration poprawia obraz bez nadpisywania warstwy źródłowej. Podgląd działa na małym fragmencie 1:1, a pełny wynik trafia do nowej warstwy rastrowej wraz z metadanymi modelu, backendu, czasu, pamięci i tilingu.

## Dostępne zadania

- **Super-resolution 2×** — lekki Swin2SR przeznaczony do szybkiego powiększania;
- **Super-resolution 4×** — Swin2SR real-world dla finalnej jakości;
- **Redukcja artefaktów JPEG** — wariant compressed Swin2SR, którego wynik 4× jest składany kafelkowo i skalowany z powrotem do rozmiaru źródła;
- **Odszumianie lokalne** — deterministyczny filtr edge-aware, dostępny bez pobierania modelu;
- **Redukcja lekkiego poruszenia** — lokalny unsharp/deconvolution-style fallback dla niewielkiego rozmycia.

Denoise i deblur są klasycznymi lokalnymi algorytmami. Nie są przedstawiane jako modele generatywne ani jako inferencja NPU.

## Modele

| Id runtime | Repozytorium | Zastosowanie | Skala robocza | Backend |
| --- | --- | --- | --- | --- |
| `swin2sr-lightweight-x2` | `Xenova/swin2SR-lightweight-x2-64` | szybkie SR | 2× | WebGPU / WASM |
| `swin2sr-realworld-x4` | `onnx-community/swin2SR-realworld-sr-x4-64-bsrgan-psnr-ONNX` | finalne SR | 4× | WebGPU / WASM |
| `swin2sr-compressed-x4` | `Xenova/swin2SR-compressed-sr-x4-48` | artefakty kompresji | 4×, potem powrót do 1× | WebGPU / WASM |

Modele bazowe Swin2SR są udostępnione na licencji Apache-2.0. Definicje zawierają jawny kontrakt wejścia, wyjścia, skali, wersji i kompatybilności.

Kontrakt operatorów WebNN/NPU tych wariantów nie został zweryfikowany na fizycznym Intel NPU. Dlatego tryb **Tylko NPU** kończy się błędem zamiast cicho przechodzić na GPU albo CPU.

## Architektura

- `src/editor-restoration-core.js` — profile, skalowany plan kafelków, ważone składanie RGBA, lokalne fallbacki, A/B i estymacja pamięci;
- `src/editor-restoration-engine.js` — kolejka, anulowanie, reuse sesji runtime, modelowy i lokalny tiled render;
- `src/editor-restoration-commands.js` — atomowe dodanie wyniku oraz zmiana wymiarów dokumentu z undo/redo;
- `src/editor-restoration-ui.js` — preview 1:1, A/B, mapa różnicy, raport backendu i pełny render;
- `src/editor-restoration-bootstrap.js` — uruchomienie po przygotowaniu wspólnego runtime’u.

## Podgląd 1:1

1. Jeżeli istnieje aktywne zaznaczenie, podgląd używa jego bounds.
2. Bez zaznaczenia wybierany jest środkowy fragment do 256×256 px.
3. Fragment przechodzi przez dokładnie ten sam profil co render finalny.
4. Widoki `Przed`, `Po` i `Różnica` nie zmieniają dokumentu.
5. Podgląd ma wyższy priorytet kolejki niż render finalny.

## Tiling ze skalowanym wyjściem

Standardowy tiling runtime’u zakłada ten sam rozmiar wejścia i wyjścia. Super-resolution wymaga osobnego planu:

- współrzędne i crop kafelka są mnożone przez skalę 2× lub 4×;
- overlap również jest przeliczany do przestrzeni wyniku;
- piksele na zakładkach są łączone wagami smoothstep;
- stitcher obsługuje cztery kanały RGBA i zachowuje alpha;
- JPEG restoration składa pełny wynik roboczy 4×, a następnie wraca do wymiarów źródła.

Dzięki temu granice kafelków nie tworzą twardych szwów.

## Pamięć i anulowanie

Przed uruchomieniem liczony jest szacowany rozmiar roboczy, a nie tylko finalny. Ma to znaczenie szczególnie dla profilu JPEG, który finalnie pozostaje 1×, ale chwilowo pracuje na 4×.

Domyślny limit to 80 megapikseli przestrzeni roboczej. Raport pokazuje:

- faktyczny backend;
- model i profil;
- liczbę kafelków;
- łączny czas;
- szacowany szczyt pamięci;
- przyczynę lokalnego fallbacku.

Cały preview lub render jest pojedynczym zadaniem wspólnej kolejki. `AbortSignal` jest sprawdzany między kafelkami oraz wewnątrz cięższych lokalnych pętli. Anulowany albo niekompletny wynik nie jest dodawany do dokumentu.

## Niedestrukcyjny wynik

Pełny render tworzy nowy zasób obrazu i nową warstwę `metadata.kind = restoration`. Dla SR 2×/4× rozmiar dokumentu jest zmieniany w tej samej komendzie historii co dodanie warstwy.

Jedno undo:

- usuwa warstwę wyniku;
- przywraca poprzednie wymiary dokumentu;
- pozostawia warstwy źródłowe bez zmian.

Redo odtwarza ten sam zapisany wynik bez ponownej inferencji.

## Fallbacki

Dla profili modelowych tryb `Auto` próbuje WebGPU, potem WASM. Jeżeli model nie może zostać załadowany albo wykonany i użytkownik pozostawił włączony lokalny fallback:

- SR używa skalowania bilinear z kontrolowanym wyostrzeniem;
- JPEG restoration używa odszumiania i lekkiego wyostrzenia;
- raport jednoznacznie oznacza backend `local` i zapisuje przyczynę fallbacku.

Fallback nie jest ukrywany jako wynik modelu AI.

## Walidacja

Testy Node obejmują:

- profile wszystkich czterech zadań;
- wybór regionu preview;
- skalowane współrzędne kafelków;
- overlap i składanie bez szwów;
- dokładne wycinanie kafelków;
- zachowanie wymiarów 2×/4×;
- denoise, JPEG restoration i deblur;
- mapę różnicy;
- limit pamięci i anulowanie;
- atomowe dodanie warstwy oraz undo/redo rozmiaru dokumentu.

GitHub Actions wykonuje pełne `npm test` i `node --check` dla wszystkich `src/editor-*.js`.

## Ograniczenia

- Wyniku Swin2SR nie zweryfikowano w tej sesji na rzeczywistym WebGPU/WASM z pełnym pobraniem wag.
- Nie wykonano testu na fizycznym Intel NPU.
- Lokalny fallback super-resolution nie rekonstruuje nowych detali tak jak model; zapewnia przewidywalny wynik i ciągłość pracy offline.
- Bardzo duży obraz 4× może zostać odrzucony przed startem z powodu limitu pamięci.
