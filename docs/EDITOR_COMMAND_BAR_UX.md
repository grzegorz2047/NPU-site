# Hierarchia górnego paska edytora

## Problem

Poprzedni pasek pokazywał jednocześnie import obrazu, przykład, cztery operacje projektu, historię, usuwanie tła, trzy presety, reset i eksport. Wszystkie działania miały niemal tę samą wagę wizualną, mimo że różnią się częstotliwością, konsekwencjami i kontekstem użycia.

## Nowy układ

Stale widoczne pozostają tylko działania potrzebne podczas typowej sesji:

- **Otwórz** — główny punkt wejścia;
- **Cofnij / Ponów** — historia bieżącej pracy;
- **Usuń tło** — główna szybka funkcja AI produktu;
- **Eksportuj** — główne zakończenie przepływu.

Pozostałe działania są pogrupowane:

- **Plik** — przykład, nowy dokument, otwieranie i zapisywanie projektu oraz destrukcyjne przywrócenie obrazu;
- **Szybkie akcje** — presety CV, Sticker PNG i rozmycie tła.

Wszystkie dotychczasowe identyfikatory elementów zostały zachowane, więc reorganizacja nie zmienia istniejącej logiki aplikacji.

## Zasady interakcji

- otwarcie jednego menu zamyka drugie;
- kliknięcie poza paskiem oraz `Escape` zamykają menu;
- `ArrowDown` na przycisku menu otwiera je i przechodzi do pierwszej aktywnej pozycji;
- w menu działają `ArrowUp`, `ArrowDown`, `Home` i `End`;
- po wybraniu działania menu zamyka się automatycznie;
- akcje niedostępne zachowują stan `disabled` także wewnątrz menu.

## Walidacja UX

Kontrola wizualna powinna obejmować:

- desktop z zamkniętymi menu;
- rozwinięte menu **Plik**;
- rozwinięte **Szybkie akcje** po otwarciu obrazu;
- szerokość mobilną i przewijanie poziome paska;
- focus klawiatury oraz zamykanie przez `Escape`.
