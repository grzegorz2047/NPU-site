# LocalSafe NPU

Zestaw prywatnych narzędzi działających lokalnie w przeglądarce. Dane nie są wysyłane do backendu ani chmurowego modelu.

**Strona:** https://grzegorz2047.github.io/NPU-site/

## Narzędzia

### Skaner prywatności — `/`

Przed wysłaniem wiadomości, logu, promptu lub fragmentu dokumentu łączy lokalną analizę semantyczną z walidowanymi regułami. Wykrywa między innymi:

- dane tożsamościowe, adresy i nazwy osób,
- informacje medyczne, diagnozy i nazwy leków,
- wynagrodzenia i inne dane finansowe,
- adresy e-mail i telefony,
- PESEL,
- numery rachunków / IBAN,
- karty płatnicze,
- adresy IPv4,
- popularne formaty kluczy API i tokenów.

PESEL, IBAN i karty są sprawdzane sumami kontrolnymi. Każde znalezisko wskazuje linię i kolumnę. Aplikacja tworzy zanonimizowaną kopię, zastępując wyłącznie wykryte wartości.

#### Jawny katalog reguł wbudowanych

Strona pokazuje wszystkie aktywne reguły wbudowane w dwóch grupach:

- **walidowane formaty** — tokeny, PESEL, IBAN, karty, e-mail, IPv4 i telefon,
- **NPU + ekstrakcja zakresu** — osoba, miejscowość, adres, informacja medyczna, lek i kwota.

Każda pozycja pokazuje opis formatu, używaną maskę i sposób walidacji. Reguły wbudowane są tylko do odczytu: nie można ich edytować, wyłączać ani usuwać. Lista jest generowana z tych samych definicji, których używa skaner.

#### Własne reguły

Na stronie można jawnie dodać własną regułę anonimizacji w jednym z dwóch trybów:

- **tekst dokładny** — znaki specjalne są automatycznie escapowane,
- **RegExp** — użytkownik podaje własne wyrażenie regularne.

Każda reguła ma nazwę, wzorzec, maskę zastępczą i opcję ignorowania wielkości liter. Reguły można włączać, wyłączać i usuwać. Są przechowywane wyłącznie w `localStorage` bieżącej przeglądarki.

### Audyt umów — `/contract.html`

Użytkownik dodaje PDF, DOCX lub tekst i zadaje normalne pytania, np. „Jakie są pułapki w umowie?”. Odpowiedź wskazuje ryzyka, ich znaczenie oraz stronę i linie dokumentu. Automatyczna checklista obejmuje czas trwania, wypowiedzenie, opłaty, kary, odpowiedzialność, obowiązki, dane osobowe i spory.

**Działający przykład:** https://grzegorz2047.github.io/NPU-site/example.html

## Intel NPU

Narzędzia korzystają z ONNX Runtime Web. Użytkownik może wybrać model oraz akcelerator:

1. Intel NPU / WebNN,
2. WebGPU,
3. WebAssembly na CPU.

Tryb automatyczny próbuje dostępnych backendów kolejno. Tryb „Tylko NPU” nie używa cichego fallbacku na CPU.

## Prywatność

- brak backendu, kont i analityki,
- tekst skanera pozostaje w pamięci bieżącej karty,
- własne reguły pozostają w `localStorage`,
- dokumenty audytu i wektory są przechowywane w IndexedDB,
- treść użytkownika nie jest wysyłana do CDN ani Hugging Face,
- model i biblioteki są pobierane niezależnie od treści dokumentów.

## Uruchomienie lokalne

```bash
python3 -m http.server 4173
```

Otwórz `http://localhost:4173`.

## Testy

```bash
npm test
```

Testy obejmują ranking dokumentów, lokalizacje źródeł, odpowiedzi konwersacyjne, modele wejściowe ONNX oraz wykrywanie, walidację i anonimizację danych wrażliwych — w tym katalog reguł wbudowanych i własne reguły użytkownika.