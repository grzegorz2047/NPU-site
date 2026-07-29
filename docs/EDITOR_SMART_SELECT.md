# Smart Select, obiekty i maski semantyczne

Smart Select łączy trzy lokalne ścieżki inferencji przez wspólny runtime obrazu:

- **SegFormer B0 ADE20K** — segmentacja semantyczna;
- **DETR ResNet-50 COCO** — detekcja instancji i bounding boxów;
- **MODNet** — dokładniejsze doprecyzowanie osoby, zwłaszcza włosów i półprzezroczystych krawędzi.

Modele działają lokalnie. Segmentacja i detekcja mają zweryfikowany kontrakt Transformers.js dla WebGPU i WASM. Tryb `Tylko NPU` kończy się błędem dla tych dwóch modeli, ponieważ ich kontrakt operatorów WebNN nie został potwierdzony. MODNet nadal może działać na NPU.

## Przepływ użytkownika

1. Aktywuj Smart Select przyciskiem w pasku narzędzi albo skrótem `Q`.
2. Uruchom analizę obrazu.
3. Kliknij obiekt na płótnie lub wybierz wiele obiektów z listy.
4. Dostosuj feather, expand/contract, próg i miękkość krawędzi.
5. Opcjonalnie popraw maskę pędzlem add/subtract.
6. Zapisz wynik jako maskę aktywnej warstwy.

Interfejs pokazuje faktycznie użyte backendy i łączny czas z raportów benchmarku runtime’u. Analizę można anulować przez wspólną kolejkę zadań.

## Kategorie użytkowe

Wyniki modeli są normalizowane do kategorii:

- osoba,
- produkt / przedmiot,
- samochód / pojazd,
- niebo,
- roślinność,
- inne.

Maska semantyczna jest rozdzielana na spójne komponenty, dzięki czemu dwa oddzielne drzewa lub dwa produkty mogą być wybierane niezależnie. Detekcje są łączone z maskami na podstawie kategorii i IoU. Kliknięcie wybiera najmniejszy obiekt zawierający punkt, co ułatwia pracę przy nakładających się obiektach.

## Refine edge

Refine edge obejmuje:

- rozszerzenie maski przez dylatację,
- zmniejszenie maski przez erozję,
- feather z ważeniem przestrzennym i ochroną krawędzi koloru,
- próg i miękkość przejścia alfa,
- ręczny pędzel dodający i odejmujący.

Dla osoby wynik MODNet zastępuje słabszą maskę klasy `person` z segmentacji semantycznej.

## Transformacje warstwy

Analiza działa w przestrzeni dokumentu, ponieważ użytkownik wybiera obiekty na skomponowanym płótnie. Przed zapisaniem maska jest odwzorowywana do lokalnej przestrzeni aktywnej warstwy.

Renderer rozpoznaje maski z:

```js
metadata: {
  source: 'smart-select',
  coordinateSpace: 'layer'
}
```

Taka maska jest stosowana przed transformacją warstwy. Późniejsze przesunięcie, obrót, skala i skew przenoszą maskę razem z warstwą zamiast pozostawiać ją w dawnym miejscu dokumentu.

## Model dokumentu i historia

Zapis maski jest pojedynczą komendą undo/redo. Zasób maski trafia do runtime assets i formatu `.localstudio`. Metadane maski zawierają:

- wykorzystane modele i backendy,
- wybrane identyfikatory obiektów,
- ustawienia refine edge,
- czas analizy,
- kategorie i bounds wykrytych obiektów bez serializowania dużych tymczasowych masek każdego obiektu.

## Moduły

- `editor-smart-mask.js` — skalowanie, łączenie, komponenty, refine edge i pędzel;
- `editor-smart-objects.js` — kategorie, normalizacja modeli, IoU i hit testing;
- `editor-smart-select-engine.js` — modele i wspólna kolejka runtime’u;
- `editor-smart-mask-renderer.js` — zapis i render maski lokalnej warstwy;
- `editor-smart-select-ui.js` — panel, lista obiektów i interakcja z płótnem;
- `editor-smart-select-bootstrap.js` — podpięcie po uruchomieniu workspace.

## Ograniczenia

- pierwsze użycie wymaga pobrania modeli zgodnie z cache runtime’u;
- dokładność kategorii ADE20K i COCO zależy od sceny i nie zastępuje ręcznej korekty;
- maska jest zapisywana dla jednej aktywnej warstwy;
- perspektywiczna transformacja maski używa obecnego renderera warstwy; precyzyjne odwzorowanie perspektywy podczas konwersji dokument → warstwa wymaga dalszego rozszerzenia geometrii;
- test fizycznego Intel NPU nie został wykonany w środowisku CI.

## Testy

Testy Node obejmują skalowanie masek, union/intersection/subtract, komponenty spójne, kategorie, łączenie detekcji z segmentacją, hit testing, MODNet person, refine edge, pędzel add/subtract, kontrakty backendów, wspólną kolejkę modeli, konwersję maski do przestrzeni warstwy oraz undo/redo zapisu maski.
