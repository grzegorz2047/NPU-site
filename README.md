# LocalSafe NPU

Zestaw prywatnych narzędzi działających lokalnie w przeglądarce. Dane nie są wysyłane do backendu ani chmurowego modelu.

**Strona:** https://grzegorz2047.github.io/NPU-site/

## Narzędzia

### Skaner prywatności — `/`

Przed wysłaniem wiadomości, logu, promptu lub fragmentu dokumentu wykrywa:

- adresy e-mail i telefony,
- PESEL,
- numery rachunków / IBAN,
- karty płatnicze,
- adresy IPv4,
- popularne formaty kluczy API i tokenów.

PESEL, IBAN i karty są sprawdzane sumami kontrolnymi. Każde znalezisko wskazuje linię i kolumnę. Aplikacja tworzy zanonimizowaną kopię, zastępując wyłącznie wykryte wartości.

### Audyt umów — `/contract.html`

Użytkownik dodaje PDF, DOCX lub tekst i zadaje normalne pytania, np. „Jakie są pułapki w umowie?”. Odpowiedź wskazuje ryzyka, ich znaczenie oraz stronę i linie dokumentu. Automatyczna checklista obejmuje czas trwania, wypowiedzenie, opłaty, kary, odpowiedzialność, obowiązki, dane osobowe i spory.

**Działający przykład:** https://grzegorz2047.github.io/NPU-site/example.html

## Intel NPU

Audyt umów korzysta z ONNX Runtime Web i w trybie automatycznym próbuje kolejno:

1. Intel NPU / WebNN,
2. WebGPU,
3. WebAssembly na CPU.

Skaner prywatności jest deterministyczny i działa natychmiast bez pobierania modelu. NPU ma zastosowanie w semantycznym indeksowaniu i odpytywaniu umów.

## Prywatność

- brak backendu, kont i analityki,
- tekst skanera pozostaje w pamięci bieżącej karty,
- dokumenty audytu i wektory są przechowywane w IndexedDB,
- treść użytkownika nie jest wysyłana do CDN ani Hugging Face,
- model i biblioteki audytu są pobierane niezależnie od treści dokumentów.

## Uruchomienie lokalne

```bash
python3 -m http.server 4173
```

Otwórz `http://localhost:4173`.

## Testy

```bash
npm test
```

Testy obejmują ranking dokumentów, lokalizacje źródeł, odpowiedzi konwersacyjne oraz wykrywanie, walidację i anonimizację danych wrażliwych.
