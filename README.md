# LocalLab NPU

Zestaw prywatnych narzędzi AI działających lokalnie w przeglądarce. Obrazy, teksty i dokumenty nie są wysyłane do backendu ani chmurowego modelu.

**Strona:** https://grzegorz2047.github.io/NPU-site/

## Narzędzia

### PortraitLab NPU — `/`

Lokalne studio portretowe oparte na modelu `onnx-community/modnet-webnn` (Apache-2.0). Model MODNet tworzy maskę osoby, a aplikacja pozwala:

- usunąć tło i pobrać przezroczyste PNG,
- podmienić tło na wybrany kolor,
- rozmyć oryginalne tło,
- regulować próg maski i miękkość krawędzi,
- pobrać PNG albo JPEG,
- wybrać NPU, WebGPU lub CPU/WASM.

Zdjęcie jest dekodowane i przetwarzane wyłącznie w bieżącej karcie. Model ONNX jest pobierany niezależnie z Hugging Face i przechowywany przez cache HTTP przeglądarki.

#### Przykład

Kliknij **Wczytaj przykład**. Aplikacja pobierze przykładowy portret, przepuści go przez ten sam model co własny plik i pokaże wynik. Następnie wybierz jasne tło do CV albo przezroczystość do dalszej obróbki.

### Skaner prywatności — `/privacy.html`

Przed wysłaniem wiadomości, logu, promptu lub fragmentu dokumentu łączy lokalną analizę semantyczną z walidowanymi regułami. Wykrywa między innymi:

- dane tożsamościowe, adresy i nazwy osób,
- informacje medyczne, diagnozy i nazwy leków,
- wynagrodzenia i inne dane finansowe,
- e-mail, telefon, PESEL, IBAN, karty, IPv4,
- popularne formaty kluczy API i tokenów.

PESEL, IBAN i karty są sprawdzane sumami kontrolnymi. Wbudowane reguły są jawne i tylko do odczytu. Użytkownik może dodać własny tekst dokładny albo RegExp, maskę oraz ustawić ignorowanie wielkości liter.

#### Przykład

Kliknij **Wstaw demo**, wybierz model i akcelerator, a następnie uruchom analizę. Porównaj tekst źródłowy z wersją zawierającą maski `[PERSON]`, `[ADDRESS]`, `[MEDICAL_INFO]`, `[MEDICATION]`, `[AMOUNT]`, `[PESEL]`, `[EMAIL]` i `[API_KEY]`.

### Audyt umów — `/contract.html`

Użytkownik dodaje PDF, DOCX lub tekst i zadaje normalne pytania, np. „Jakie są pułapki w umowie?”. Odpowiedź wskazuje ryzyka, ich znaczenie oraz stronę i linie dokumentu. Automatyczna checklista obejmuje czas trwania, wypowiedzenie, opłaty, kary, odpowiedzialność, obowiązki, dane osobowe i spory.

#### Przykład

Kliknij **Wczytaj umowę i zapytaj**. Przykładowa umowa abonamentowa zostanie dodana do tego samego indeksu co dokument użytkownika, a narzędzie zada pytanie o pułapki. Otwórz źródła i porównaj odpowiedź z konkretnymi liniami.

### Weryfikowalny przykład audytu — `/example.html`

Strona pokazuje dokument testowy obok rozmowy. Kliknięcie **Uruchom przykład** wywołuje ten sam moduł odpowiedzi co właściwy audyt. Test przechodzi tylko wtedy, gdy osiem ryzyk ma osiem źródeł i poprawne numery linii.

## Intel NPU i backendy

Narzędzia korzystają z ONNX Runtime Web. Dostępne tryby:

1. Intel NPU przez WebNN,
2. WebGPU,
3. WebAssembly na CPU.

Tryb automatyczny próbuje dostępnych backendów kolejno. Tryb „Tylko NPU” nie używa cichego fallbacku na CPU. Interfejs pokazuje backend, na którym rzeczywiście utworzono sesję.

## Prywatność

- brak backendu, kont i analityki,
- zdjęcia i tekst skanera pozostają w pamięci bieżącej karty,
- własne reguły pozostają w `localStorage`,
- dokumenty audytu i wektory są przechowywane w IndexedDB,
- treść użytkownika nie jest wysyłana do CDN ani Hugging Face,
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

Testy obejmują rdzeń kompozycji obrazu, preprocessing MODNet, wybór backendu, ranking dokumentów, lokalizacje źródeł, odpowiedzi konwersacyjne, modele wejściowe ONNX oraz wykrywanie i anonimizację danych wrażliwych.
