# LocalLab NPU

Zestaw prywatnych narzędzi AI działających lokalnie w przeglądarce. Obrazy, teksty i dokumenty nie są wysyłane do backendu ani chmurowego modelu.

**Strona:** https://grzegorz2047.github.io/NPU-site/

## Narzędzia

### LocalStudio NPU — `/`

Pełnosprawny lokalny edytor obrazu, a nie pojedyncze demo technologiczne. Umożliwia:

- import JPG, PNG i WebP,
- korektę jasności, kontrastu, nasycenia, sepii, skali szarości i rozmycia,
- obrót oraz odbicie obrazu,
- usuwanie tła modelem MODNet,
- podmianę tła na kolor, gradient, rozmycie albo własny obraz,
- tworzenie przezroczystych stickerów z obwódką i cieniem,
- gotowe presety: portret do CV, sticker PNG i rozmyte tło portretu,
- ręczną anonimizację screenshotów przez blur, pikselizację albo czarny pasek,
- eksport do PNG, JPEG i WebP.

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

Testy obejmują rdzeń kompozycji obrazu, preprocessing MODNet, wybór backendu, ranking dokumentów, lokalizacje źródeł oraz wykrywanie i anonimizację danych wrażliwych.
