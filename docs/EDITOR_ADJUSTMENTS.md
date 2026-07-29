# Niedestrukcyjne korekty LocalStudio

Warstwy korekcyjne zmieniają wynik kompozycji bez modyfikowania pikseli warstwy źródłowej. Są serializowane w projekcie, korzystają ze wspólnej historii undo/redo oraz standardowych właściwości warstwy: widoczności, blokady, krycia, trybu mieszania i maski.

## Reprezentacja w dokumencie

Korekta jest pustą warstwą grupową z serializowalnymi metadanymi:

```js
{
  type: 'group',
  metadata: {
    kind: 'adjustment',
    adjustment: {
      version: 1,
      type: 'exposure',
      parameters: { exposure: 0, brightness: 0, contrast: 0, gamma: 1 }
    }
  },
  mask: { enabled: true, assetId: null, opacity: 1 },
  opacity: 1,
  blendMode: 'normal',
  children: []
}
```

Taka reprezentacja pozostaje zgodna z aktualnym formatem `.localstudio` i nie wymaga osobnej binarnej struktury projektu. Panel tworzy warstwy korekcyjne na głównym poziomie stosu. Korekta działa na całą kompozycję warstw znajdujących się pod nią; warstwy powyżej są renderowane później i nie są przez nią zmieniane.

## Dostępne korekty

- ekspozycja, jasność, kontrast i gamma;
- poziomy RGB oraz osobno czerwony, zielony i niebieski;
- krzywe RGB oraz per kanał;
- balans bieli: temperatura i tint;
- HSL dla całego obrazu oraz zakresów czerwieni, pomarańczy, żółci, zieleni, turkusu, błękitu, fioletu i magenty;
- vibrance i nasycenie;
- cienie, światła, clarity i dehaze;
- wyostrzenie i rozmycie;
- winieta i deterministyczne ziarno.

Domyślne parametry każdego typu są neutralne. Dodanie pustej warstwy korekcyjnej nie może zmienić obrazu.

## Moduły

- `src/editor-adjustment-tonal.js` — transformacje tonalne, poziomy, krzywe, balans bieli, HSL i kolor;
- `src/editor-adjustment-effects.js` — efekty przestrzenne, detal, winieta i ziarno;
- `src/editor-adjustments.js` — schematy, normalizacja, histogram i presety;
- `src/editor-adjustment-renderer.js` — integracja ze stosem warstw, maskami, kryciem i blend modes;
- `src/editor-adjustments-ui-controls.js` — podstawowe kontrolki, histogram i geometria krzywych;
- `src/editor-adjustments-ui-advanced.js` — edycja krzywych, maski, presety, histogram i clipping;
- `src/editor-adjustments-ui.js` — kontroler panelu;
- `src/editor-adjustments-bootstrap.js` — podpięcie modułów po uruchomieniu workspace.

Logika przekształceń nie zależy od DOM i jest testowana w Node.

## Maski i krycie

Każda warstwa korekcyjna otrzymuje pełną maskę. Użytkownik może zastąpić ją maską utworzoną z bieżącego zaznaczenia. Renderer łączy:

1. wynik korekty,
2. maskę warstwy,
3. krycie warstwy,
4. tryb mieszania `normal`, `multiply`, `screen` albo `overlay`.

Zasoby starszych masek nie są natychmiast usuwane z pamięci, ponieważ historia undo może przywrócić wcześniejszy snapshot odwołujący się do takiego zasobu.

## Histogram i clipping

Histogram pokazuje kanały RGB oraz luminancję. Dla dużych obrazów używa próbkowania maksymalnie 250 000 pikseli i jest przeliczany podczas bezczynności, aby nie blokować podstawowej interakcji panelu.

Ostrzeżenia clippingu nakładają na płótno:

- niebieski dla utraconych cieni,
- czerwony dla przepalonych świateł.

Nakładka jest tylko podglądem i nie trafia do eksportu.

## Krzywe

Edytor krzywych pozwala:

- kliknąć, aby dodać punkt;
- przeciągnąć punkt;
- użyć prawego przycisku, aby usunąć punkt pośredni;
- przełączać kanał RGB, czerwony, zielony lub niebieski.

Punkty skrajne zachowują pozycję `x=0` i `x=255`, a punkty pośrednie nie mogą zamieniać kolejności.

## Presety i porównanie

Wbudowane presety są tylko do odczytu. Własne presety są przechowywane lokalnie w `localStorage` i zawierają typ oraz parametry korekty, bez obrazu użytkownika.

Przycisk „Przytrzymaj, aby zobaczyć przed” renderuje dokument bez wszystkich warstw korekcyjnych. Po zwolnieniu przywraca pełny stos.

## Wydajność i ograniczenia

Korekcje są obecnie wykonywane lokalnie przez Canvas/CPU, zgodnie z zasadą epika: proste filtry pikselowe nie są przenoszone na NPU. Każda korekta działa na pełnym buforze RGBA kompozycji. Przy aktualnym limicie roboczym edytora jest to przewidywalne, ale kilka ciężkich warstw `blur`, `clarity` lub `sharpen` może zwiększać czas renderowania.

Aktualna integracja interpretuje warstwy korekcyjne wyłącznie na głównym poziomie dokumentu. Panel nie tworzy ich wewnątrz grup. Rozszerzenie semantyki korekt zagnieżdżonych wymaga osobnego modelu izolacji grup i nie jest częścią issue #55.

## Walidacja

Testy obejmują:

- neutralność i serializowalność wszystkich typów;
- normalizację parametrów;
- transformacje tonalne i kanałowe;
- kolejność stosu;
- histogram i clipping;
- zapis własnych presetów;
- maskę, krycie, blend modes i przezroczyste piksele.

Kontrola wizualna panelu jest wykonywana w Chromium na szerokości desktopowej i mobilnej. Test screenshotowy nie zastępuje pełnego testu dostępności ani testu jakości fotograficznej na reprezentatywnym zbiorze obrazów.
