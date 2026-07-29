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
- eksport do PNG, JPEG i WebP.

#### Rdzeń dokumentu

Model edytora jest niezależny od DOM i rozdzielony na moduły:

- `src/editor-document.js` — dokument, warstwy raster/tekst/kształt/grupa, zaznaczenie i serializacja,
- `src/editor-history.js` — odwracalne komendy, undo/redo, limit i kompaktowanie historii,
- `src/editor-renderer.js` — kompozycja canvasa, maski, maski przycinające i blend modes,
- `src/editor-layers-ui.js` — panel warstw i skróty klawiaturowe,
- `src/editor-workspace.js` — integracja nowego modelu z istniejącym pipeline'em AI i eksportem,
- `src/editor-project-format.js` — wersjonowany format `.localstudio`, walidacja i migracje,
- `src/editor-project-store.js` — IndexedDB, trwałe bloby, lista projektów i journal odzyskiwania,
- `src/editor-project-controller.js` — autosave, import/eksport projektu i ostrzeżenie o niezapisanych zmianach.

Obecny import tworzy bazową warstwę rastrową. Wynik dotychczasowego pipeline'u pozostaje zgodny z presetami, korektami, MODNet, podmianą tła i redakcją, a kolejne wyniki AI mogą być dodawane jako osobna warstwa lub maska.

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

### Skaner prywatności — `/privacy.html`

Łączy lokalną analizę semantyczną z walidowanymi regułami. Wykrywa dane tożsamościowe, adresy, informacje medyczne, wynagrodzenia, e-mail, telefon, PESEL, IBAN, karty, IPv4 oraz popularne formaty kluczy API i tokenów. Reguły wbudowane są jawne i tylko do odczytu, a użytkownik może dodawać własne reguły.

### Audyt umów — `/contract.html`

Użytkownik dodaje PDF, DOCX lub tekst i pyta o pułapki w umowie. Odpowiedź wskazuje ryzyka, ich znaczenie oraz konkretne strony i linie dokumentu.

### Weryfikowalny przykład audytu — `/example.html`

Przykład używa tego samego modułu odpowiedzi co właściwy audyt i pokazuje źródła dla wykrytych ryzyk.

## Intel NPU i backendy

Segmentacja obrazu korzysta z modelu `onnx-community/modnet-webnn`. Dostępne ścieżki:

1. Intel NPU przez WebNN,
2. WebGPU przez Transformers.js,
3. WebAssembly na CPU przez Transformers.js.

Tryb automatyczny próbuje backendów kolejno. Interfejs pokazuje runtime, który rzeczywiście został uruchomiony.

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

## Testy

```bash
npm test
```

Testy obejmują rdzeń kompozycji obrazu, model dokumentu i warstw, serializowane undo/redo, round-trip i migracje `.localstudio`, autosave i odzyskiwanie projektów, czyszczenie blobów, maski i blend modes, preprocessing MODNet, wybór backendu, ranking dokumentów, lokalizacje źródeł oraz wykrywanie i anonimizację danych wrażliwych.
