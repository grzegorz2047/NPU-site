# Pivot produktu: lokalne sprawdzanie umowy

## Dlaczego obecna wersja nie daje jasnej wartości

Ogólne pole „zapytaj dokumenty” wymaga, aby użytkownik sam wiedział, czego szuka. Pokazuje technologię wyszukiwania semantycznego, ale nie kończy konkretnego zadania.

## Główny scenariusz

Użytkownik wgrywa umowę przed podpisaniem. Aplikacja lokalnie przegląda dokument według stałej checklisty i wskazuje źródłowe fragmenty dotyczące:

- czasu trwania i automatycznego przedłużenia,
- wypowiedzenia,
- opłat i możliwości zmiany ceny,
- kar umownych,
- odpowiedzialności i jej ograniczeń,
- obowiązków oraz terminów,
- przetwarzania danych i zgód,
- sporów oraz prawa właściwego.

Aplikacja nie wydaje opinii prawnej i nie generuje odpowiedzi bez źródła. Jej zadaniem jest skrócić ręczne przeglądanie dokumentu i wskazać miejsca, które użytkownik powinien przeczytać.

## Dlaczego NPU ma tu sens

Jedno kliknięcie uruchamia wiele zapytań semantycznych do tego samego indeksu. To powtarzalna lokalna inferencja, która może działać na NPU przy niższym poborze energii, a prywatna treść umowy pozostaje na urządzeniu.
