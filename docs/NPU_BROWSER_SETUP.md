# Uruchamianie Intel NPU w przeglądarce

LocalFind korzysta z Intel NPU wyłącznie wtedy, gdy przeglądarka udostępnia WebNN, a utworzenie kontekstu `deviceType: "npu"` zakończy się powodzeniem.

## Zalecana konfiguracja

1. Windows 11 na komputerze z Intel Core Ultra / Intel AI Boost.
2. Najnowszy sterownik Intel NPU.
3. Aktualny Microsoft Edge Canary.
4. Zamknij wszystkie procesy Edge.
5. Uruchom Edge Canary z wiersza polecenia:

```bat
"%LOCALAPPDATA%\Microsoft\Edge SxS\Application\msedge.exe" --enable-features=WebMachineLearningNeuralNetwork --disable_webnn_for_npu=0 https://grzegorz2047.github.io/NPU-site/
```

## Interpretacja diagnostyki

- `WebNN API: nie`, `WebGPU: tak` — NPU nie jest używane; aplikacja może działać przez GPU.
- `WebNN API: tak` — przeglądarka udostępnia WebNN, ale dopiero komunikat `NPU aktywne` po uruchomieniu silnika potwierdza wybranie NPU.
- `Aktywny backend: WEBGPU` — model działa na GPU.
- `Aktywny backend: WASM` — model działa na CPU.

WebNN jest nadal rozwijaną funkcją przeglądarek. Dostępność zależy od wersji przeglądarki, systemu, sterownika NPU oraz operatorów użytych przez model.
