# Clone stamp, healing brush i spot healing

Retusz LocalStudio działa niedestrukcyjnie. Każdy gest tworzy mały patch RGBA przechowywany jako zasób projektu i dopisywany do osobnej warstwy retuszu. Źródłowy raster nie jest modyfikowany.

## Narzędzia

- **Clone stamp (`S`)** — kopiuje próbkę bez dopasowania koloru.
- **Healing brush (`J`)** — przenosi lokalną teksturę i dopasowuje średni kolor próbki do obszaru docelowego.
- **Spot healing (`Shift+J`)** — automatycznie wybiera sąsiednią próbkę i dopasowuje ją do celu.

Dla clone stamp oraz healing brush źródło ustawia się przez `Alt/Option+klik`. Na płótnie jest widoczny zielony znacznik źródła, zewnętrzny obrys pędzla i wewnętrzny obrys twardości. Próbka jest pokazywana półprzezroczysto pod kursorem przed zatwierdzeniem pociągnięcia.

## Parametry

- rozmiar,
- twardość,
- krycie,
- przepływ,
- spacing,
- wyrównane lub niewyrównane źródło,
- próbkowanie bieżącej warstwy albo całej kompozycji.

W trybie wyrównanym przesunięcie między źródłem a celem jest zachowane między kolejnymi pociągnięciami. W trybie niewyrównanym każde nowe pociągnięcie zaczyna ponownie od ustawionego punktu źródłowego.

## Model dokumentu

Warstwa retuszu jest serializowalną pustą grupą:

```js
{
  type: 'group',
  metadata: {
    kind: 'retouch',
    version: 1,
    strokes: [
      {
        id: 'retouch-...',
        tool: 'healing',
        points: [{ x, y, pressure }],
        sourceOffset: { x, y },
        patchAssetId: 'retouch-patch-...',
        bounds: { x, y, width, height },
        size,
        hardness,
        opacity,
        flow,
        spacing,
        aligned,
        sampleMode,
        sampleLayerId,
        selection
      }
    ]
  },
  mask: { enabled: true, opacity: 1 },
  children: []
}
```

Patch przechowuje wyłącznie obszar objęty gestem. Renderer składa patche w kolejności pociągnięć, a następnie stosuje standardową transformację, maskę, krycie i blend mode warstwy.

## Historia i zapis projektu

Każde pociągnięcie jest pojedynczą komendą undo/redo. Patch jest tworzony przed wykonaniem komendy i pozostaje w pamięci runtime również po cofnięciu, ponieważ redo może go ponownie użyć.

Indeksowanie zasobów `.localstudio` skanuje zarówno bieżący dokument, jak i snapshoty historii. Dzięki temu projekt zapisany po `undo` nadal zawiera patch wymagany przez późniejsze `redo` po ponownym otwarciu.

## Worker i wydajność

Ciężkie obliczenia clone/healing są wykonywane przez modułowego Web Workera. Do Workera trafiają kopie bufora RGBA, opis pociągnięcia oraz opcjonalna maska zaznaczenia. Wynikiem jest przycięty patch RGBA i jego położenie.

Jeżeli Worker nie jest dostępny, `RetouchProcessor` używa tej samej czystej funkcji synchronicznie. Ponowne renderowanie dokumentu nie przelicza algorytmu healing — tylko składa zapisane patche.

## Zaznaczenia i maski

Aktywne zaznaczenie jest rasteryzowane w chwili zatwierdzania pociągnięcia i ogranicza alfę patcha. Warstwa retuszu nadal może mieć własną maskę warstwy i niedestrukcyjną gumkę.

## Algorytm healing

Dla każdego stempla:

1. pobierana jest próbka źródłowa z interpolacją biliniową;
2. obliczana jest lokalna średnia RGB wokół źródła i celu;
3. różnica średnich jest dodawana do próbki, zachowując drobną teksturę;
4. wynik jest składany z miękką wagą pędzla, kryciem, przepływem i maską zaznaczenia.

Jest to lokalny klasyczny healing, bez modelu generatywnego i bez wysyłania obrazu poza urządzenie.

## Ograniczenia

- patch jest rasteryzowany w rozdzielczości dokumentu w chwili gestu;
- późniejsza zmiana źródłowej warstwy nie zmienia już istniejącego patcha;
- tryb „bieżąca warstwa” korzysta z warstwy zapamiętanej przy aktywacji narzędzia;
- bardzo duży pędzel lub długie pociągnięcie zwiększa koszt Workera, ale nie blokuje głównego wątku;
- narzędzie nie jest odpowiednikiem generatywnego usuwania obiektów z issue #63.

## Testy

Testy obejmują:

- źródło wyrównane i niewyrównane,
- automatyczne źródło spot healing,
- mapping celu do źródła,
- spacing i granice patcha,
- dokładne kopiowanie clone stamp,
- miękkie i twarde krawędzie,
- dopasowanie koloru healing,
- maskę zaznaczenia,
- fallback bez Workera,
- jedno undo/redo na pociągnięcie,
- serializowalność warstwy,
- zachowanie zasobu obecnego wyłącznie w redo.
