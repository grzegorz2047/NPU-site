# Architektura informacji panelu edytora

## Problem z poprzednim układem

Prawa kolumna była jednym przewijanym stosem akordeonów. W tym samym miejscu znajdowały się:

- bieżące opcje narzędzia,
- warstwy i korekty,
- projekty lokalne oraz ustawienia widoku,
- runtime i narzędzia AI,
- rozmiar dokumentu oraz eksport.

Użytkownik musiał pamiętać, gdzie w długiej liście znajduje się dana funkcja. Sekcja projektów zajmowała górę panelu mimo że podczas edycji jest używana sporadycznie, a nieaktywne narzędzia nadal pozostawiały widoczne puste panele.

## Nowy model

Panel ma cztery stałe kategorie:

1. **Narzędzie** — aktywne narzędzie płótna, retusz oraz szybkie operacje obrazu.
2. **Warstwy** — stos warstw, mieszanie, krycie i korekty niedestrukcyjne.
3. **Dokument** — projekty lokalne, widok, prowadnice, rozmiar oraz eksport.
4. **AI** — silnik, Smart Select, mapa głębi i restoration.

Kategorie są zakładkami z semantyką `tablist`/`tabpanel`. Klawiatura obsługuje strzałki, Home i End. Wybrana zakładka jest zachowywana w `sessionStorage`.

## Zachowanie kontekstowe

- kliknięcie narzędzia manualnego, kadrowania, transformacji albo retuszu otwiera zakładkę **Narzędzie**;
- Smart Select, głębia i usuwanie tła otwierają **AI**;
- kliknięcie warstwy lub polecenia warstwy otwiera **Warstwy**;
- polecenia projektu i eksportu kierują do **Dokumentu**;
- nieaktywny panel narzędzi manualnych i retuszu nie zajmuje miejsca;
- nagłówek każdej zakładki wyjaśnia aktualny kontekst zamiast pokazywać wyłącznie ogólne „Właściwości”.

## Dodatkowe porządki

- pole wyboru obrazu tła zostało przeniesione z sekcji runtime do „Tło i kompozycja”;
- „AI i dokument” zostało nazwane „Silnik AI”;
- projekty lokalne oraz ustawienia dokumentu są domyślnie zwinięte;
- panel został nieznacznie poszerzony na dużych ekranach, ale nadal przechodzi pod płótno poniżej 980 px.

## Walidacja UX

Wizualną kontrolę należy wykonać dla:

- domyślnej zakładki Warstwy z otwartym obrazem;
- aktywnego narzędzia w zakładce Narzędzie;
- zakładki AI ze stanem wyłączonego i uruchomionego runtime;
- szerokości desktopowej oraz mobilnej 390 px;
- nawigacji klawiaturą między zakładkami i widocznego focusu.
