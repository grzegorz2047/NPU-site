# Uruchamianie Intel NPU w Chrome

LocalFind korzysta z Intel NPU wyłącznie wtedy, gdy Chrome udostępnia WebNN, a ONNX Runtime Web zdoła utworzyć provider WebNN z `deviceType: "npu"`.

## Wymagania

1. Windows 11.
2. Komputer z Intel Core Ultra / Intel AI Boost.
3. Najnowszy sterownik Intel NPU.
4. Aktualna wersja Google Chrome. W razie braku flagi warto sprawdzić Chrome Beta lub Canary.

## Włączenie WebNN

1. Wpisz w pasku adresu Chrome:

```text
chrome://flags/#web-machine-learning-neural-network
```

2. Przy pozycji **Web Machine Learning Neural Network** wybierz **Enabled**.
3. Kliknij **Relaunch** na dole strony z flagami.
4. Otwórz ponownie LocalFind:

```text
https://grzegorz2047.github.io/NPU-site/
```

5. Otwórz **Diagnostykę**. Oczekiwany wynik to `WebNN API: tak`.
6. W polu **Akcelerator** wybierz **Tylko NPU** i kliknij **Uruchom silnik**.
7. Dopiero komunikat `Aktywny backend: NPU` potwierdza, że sesja modelu została uruchomiona z żądaniem NPU.

## Oficjalny opis

ONNX Runtime Web opisuje provider WebNN, wymagania przeglądarki, flagę `Enables WebNN API` i konfigurację `deviceType` tutaj:

https://onnxruntime.ai/docs/tutorials/web/ep-webnn.html

## Interpretacja diagnostyki

- `WebNN API: nie`, `WebGPU: tak` — NPU nie jest używane; aplikacja może działać przez GPU.
- `WebNN API: tak` — Chrome udostępnia WebNN, ale nie jest to jeszcze potwierdzenie wykonania modelu na NPU.
- `Aktywny backend: NPU` — aplikacja utworzyła sesję ONNX Runtime z providerem WebNN i żądaniem NPU.
- `Aktywny backend: WEBGPU` — model działa przez WebGPU.
- `Aktywny backend: WASM` — model działa na CPU.

## Ograniczenia

WebNN jest nadal rozwijaną funkcją przeglądarek. Dostępność NPU zależy od wersji Chrome, systemu, sterownika Intel NPU oraz operatorów wykorzystywanych przez konkretny model. Część grafu może zostać wykonana przez provider awaryjny, dlatego aktywność NPU warto dodatkowo sprawdzić w Menedżerze zadań Windows podczas indeksowania dokumentów.
