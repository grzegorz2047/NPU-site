# Mapa głębi, Lens Blur i relighting

LocalStudio zapisuje estymowaną mapę głębi jako lokalny zasób projektu i wykorzystuje ją ponownie bez kolejnej inferencji. Efekty są osobnymi warstwami dokumentu, nie spłaszczoną zmianą obrazu.

## Inferencja

Panel korzysta z modelu `onnx-community/depth-anything-v2-small` z rejestru wspólnego runtime’u. Tryb `Auto` wybiera zweryfikowany backend, a `Tylko NPU` nie wykonuje cichego fallbacku. Panel pokazuje faktyczny backend i czas benchmarku.

Wynik jest normalizowany do 0–255 i skalowany do rozmiaru dokumentu. Użytkownik może odwrócić mapę, jeśli wersja modelu stosuje przeciwną konwencję blisko/daleko.

## Edycja mapy

- kliknięcie płótna odczytuje głębię punktu ostrości;
- pędzel wpisuje wybraną wartość głębi z regulowanym rozmiarem i twardością;
- każda korekta pędzlem tworzy nowy zasób oraz pojedyncze undo/redo;
- istniejące warstwy efektów są przepinane na nowy zasób;
- stare zasoby pozostają dostępne dla historii i `.localstudio`.

## Warstwy efektów

**Lens Blur** mapuje odległość głębi od punktu ostrości na promień rozmycia. Kontroluje aperturę, zakres ostrości, bokeh i maksymalny promień. Obraz jest rozdzielany na przedziały głębi i rozmywany z wagami, aby ograniczyć przeciekanie krawędzi pierwszego planu.

**Relighting** miesza osobne ekspozycje pierwszego planu i tła na podstawie głębi. Dostępne są temperatura i kontrast.

**Atmosfera** dodaje mgłę oraz światło zależne od odległości, z kontrolą koloru, gęstości i początku efektu.

## Kafelkowy render

Pełna rozdzielczość jest dzielona na kafelki z overlapem zależnym od promienia efektu. Kafelki są składane wagami wygaszającymi krawędzie, więc nie powstają twarde szwy.

## Model dokumentu

`document.metadata.depthMap` przechowuje `assetId`, rozmiar, model, wersję, backend, benchmark, stan odwrócenia i daty. Warstwa efektu jest pustą grupą z `metadata.kind = depth-effect`, `depthAssetId`, deskryptorem efektu i ustawieniami kafelków. Kolejność warstw wpływa na wynik; widoczność, krycie, blend mode, maska i historia działają standardowo.

## Ograniczenia

- monocular depth jest względna, nie metryczna;
- krawędzie mogą wymagać korekty pędzlem;
- duża apertura zwiększa koszt renderowania;
- efekty pikselowe działają przez Canvas/CPU, a inferencja mapy przez wspólny runtime;
- fizyczny Intel NPU nie został zweryfikowany w CI.

## Testy

Testy obejmują normalizację i skalowanie mapy, mapping głębi na promień blur, punkt ostrości, pędzel, Lens Blur, relighting, atmosferę, kafelki z overlapem, zachowanie alfa oraz undo/redo mapy i warstw efektów.
