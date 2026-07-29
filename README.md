# LocalFind NPU

Prywatna, działająca w przeglądarce wyszukiwarka semantyczna dokumentów. Użytkownik dodaje PDF, DOCX, TXT, Markdown, CSV, JSON lub HTML, a aplikacja dzieli treść na fragmenty, tworzy lokalny indeks znaczeń i pozwala szukać pytaniem zamiast dokładną frazą.

**Strona:** https://grzegorz2047.github.io/NPU-site/

## Realny problem

Prywatne dokumenty — umowy, instrukcje, raporty, notatki medyczne czy dokumentacja projektowa — często nie mogą być wysłane do chmurowego chatbota. Klasyczne wyszukiwanie wymaga natomiast pamiętania konkretnych słów. LocalFind rozwiązuje oba problemy: przetwarza pliki lokalnie i zwraca źródłowy fragment zamiast generować odpowiedź bez dowodu.

## Jak używane jest Intel NPU

Warstwa inferencji korzysta z ONNX Runtime Web i żąda providera WebNN z `deviceType: "npu"`. W trybie automatycznym aplikacja próbuje kolejno:

1. Intel NPU / WebNN,
2. WebGPU,
3. WebAssembly na CPU.

Diagnostyka pokazuje dostępne API oraz wybrany backend. Ważne: ONNX Runtime może przenieść nieobsługiwane operatory na WASM; dlatego UI mówi o żądanym backendzie, a nie obiecuje, że 100% grafu wykonało NPU.

## Prywatność

- brak backendu, kont i analityki,
- pliki są odczytywane przez JavaScript w przeglądarce,
- tekst i wektory są przechowywane w IndexedDB danej przeglądarki,
- model i biblioteki są pobierane z CDN/Hugging Face; treść dokumentów nie jest do nich wysyłana,
- użytkownik może usunąć pojedynczy dokument lub całą bibliotekę.

## Obsługiwane formaty

PDF z warstwą tekstową, DOCX, TXT, MD, CSV, JSON, HTML, LOG, XML, YAML. Skanowane PDF-y wymagające OCR są świadomie odrzucane i znajdują się w roadmapie.

## Uruchomienie lokalne

```bash
python3 -m http.server 4173
```

Otwórz `http://localhost:4173`. Nie otwieraj `index.html` jako `file://`, ponieważ moduły ES i service worker wymagają serwera HTTP.

## Testy

```bash
npm test
npm run check
```

## NPU na Windows 11

Najlepsza ścieżka testowa to aktualny Microsoft Edge lub Chrome na komputerze Intel Core Ultra. Jeśli WebNN nie jest domyślnie dostępne, włącz eksperymentalną flagę WebNN i zaktualizuj sterownik NPU. Dokładne zachowanie zależy od wersji przeglądarki, sterownika i obsługi operatorów modelu.

## Roadmapa

Backlog jest prowadzony w GitHub Issues. Najważniejsze dalsze obszary to OCR dla skanów, import folderów, eksport/import indeksu, porównanie jakości modeli i testy na fizycznym Intel AI PC.
