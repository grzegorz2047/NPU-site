# Local agent workflow — NPU-site

Ten dokument opisuje powtarzalny sposób pracy agenta nad `NPU-site`: od świeżego stanu GitHuba, przez testy Node i walidację przeglądarkową, po PR i merge. Środowisko Work Mode jest efemeryczne, więc każdą dostępność narzędzia należy sprawdzić ponownie zamiast kopiować ścieżki z poprzedniej rozmowy.

## 1. Zasady źródła i izolacji zmian

Przed rozpoczęciem issue:

1. odczytaj najnowszy SHA `main` przez konektor GitHub;
2. przeczytaj README, issue nadrzędne, bieżące issue i istotne pliki `.md`;
3. sprawdź wszystkie otwarte PR-y oraz ich zmienione pliki;
4. nie nadpisuj plików zmienianych przez inny aktywny PR;
5. utwórz osobną gałąź `agent/<opis>` dokładnie z aktualnego `main`;
6. przed merge ponownie porównaj gałąź z aktualnym `main` i sprawdź nowe PR-y.

Konektor GitHub jest źródłem prawdy dla repozytorium, issue, PR-ów i GitHub Actions. Lokalny checkout jest tylko kopią roboczą.

## 2. Minimalny profil środowiska

Na początku zapisz wynik:

```bash
pwd
node -p 'process.version + " ABI=" + process.versions.modules + " NAPI=" + process.versions.napi + " V8=" + process.versions.v8'
npm --version
node -p 'process.platform + "/" + process.arch'
command -v chromium || true
chromium --version || true
command -v playwright || true
```

Repo nie wymaga backendu ani natywnych modułów. Podstawowy gate to Node, testy modułów i statyczny serwer HTTP.

## 3. Pobranie źródeł

Preferowana ścieżka to świeży checkout:

```bash
git clone https://github.com/grzegorz2047/NPU-site.git
cd NPU-site
git switch main
git pull --ff-only
```

Jeżeli kontener nie ma publicznego DNS, nie traktuj błędu `Could not resolve host` jako błędu repozytorium. Odczytaj i modyfikuj pliki przez konektor GitHub, a pełny gate uruchom w GitHub Actions. Nie twierdź wtedy, że wykonano lokalny checkout.

## 4. Testy Node i kontrola składni

Repo nie wymaga `npm install`. Uruchom:

```bash
npm test
```

Dla każdego zmienionego modułu JavaScript wykonaj:

```bash
node --check src/nazwa-modulu.js
```

Dla zmian edytora należy uruchomić pełny workflow `Editor core`, który wykonuje `npm test` oraz kontrolę składni wszystkich modułów `src/editor-*.js`.

## 5. Lokalny serwer

Strona korzysta z modułów ES i Service Workera, dlatego nie otwieraj `editor.html` przez `file://`.

```bash
python3 -m http.server 4173 --bind 127.0.0.1
```

Adresy kontrolne:

- `http://127.0.0.1:4173/`
- `http://127.0.0.1:4173/editor.html`
- `http://127.0.0.1:4173/privacy.html`
- `http://127.0.0.1:4173/contract.html`

## 6. Chromium i zrzuty ekranu bez CDN Playwrighta

Najpierw użyj systemowego Chromium:

```bash
CHROMIUM_PATH="$(command -v chromium || true)"
test -n "$CHROMIUM_PATH"
test -s "$CHROMIUM_PATH"
file "$CHROMIUM_PATH"
```

Jeżeli systemowej binarki nie ma, można zainstalować tymczasowy pakiet poza repo, bez zmiany `package.json` i lockfile'a:

```bash
npm install \
  --cache /tmp/npu-site-npm-cache \
  --prefix /tmp/npu-site-playwright-browser \
  @sparticuz/chromium@149.0.0

mkdir -p /tmp/npu-site-chromium-runtime
TMPDIR=/tmp/npu-site-chromium-runtime \
  node --input-type=module -e \
  "import { inflate } from '/tmp/npu-site-playwright-browser/node_modules/@sparticuz/chromium/build/lambdafs.js'; console.log(await inflate('/tmp/npu-site-playwright-browser/node_modules/@sparticuz/chromium/bin/chromium.br'))"

CHROMIUM_PATH="/tmp/npu-site-chromium-runtime/chromium"
test -s "$CHROMIUM_PATH"
file "$CHROMIUM_PATH"
```

Nie używaj `chromium.executablePath()` w ograniczonym kontenerze, jeżeli próbuje rozpakować dodatkowe zasoby lub wykonywać `chown`.

### Minimalny screenshot Playwright

Jeżeli Pythonowy pakiet Playwright jest dostępny:

```bash
mkdir -p /tmp/npu-site-ux
python3 - <<'PY'
from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    browser = p.chromium.launch(
        executable_path="/usr/bin/chromium",
        headless=True,
        args=["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
    )
    page = browser.new_page(viewport={"width": 1440, "height": 900}, device_scale_factor=1)
    page.goto("http://127.0.0.1:4173/editor.html", wait_until="networkidle")
    page.screenshot(path="/tmp/npu-site-ux/01-editor-empty.png", full_page=True)
    browser.close()
PY
```

Przed użyciem zrzutu jako dowodu otwórz go i sprawdź, czy nie przedstawia pustej strony, błędu, niedokończonego ładowania lub niewłaściwego okna.

## 7. Zakres audytu UX

Dla zmian edytora wykonaj co najmniej:

1. zrzut pustego stanu;
2. zrzut po otwarciu obrazu testowego, o ile plik jest dostępny lokalnie;
3. zrzut stanu uruchamiania modelu lub kolejki, jeżeli można go bezpiecznie zasymulować;
4. kontrolę szerokości 1440 px i mobilnej 390 px;
5. kontrolę focusu klawiatury, nazw dostępności i stanów `disabled` najważniejszych przycisków.

Ze screenshotu nie wolno wyciągać wniosku o pełnej zgodności dostępności. Test fizycznego Intel NPU wymaga prawdziwego urządzenia, Windows 11, aktualnego sterownika i zgodnej przeglądarki.

## 8. Zasady dla modeli i NPU

Każdy model musi mieć jawnie zapisane:

- nazwę i identyfikator repozytorium;
- wersję/revizję cache;
- licencję;
- wejścia, wyjścia i preprocessing;
- macierz zgodności NPU/WebNN, WebGPU i WASM;
- faktycznie użyty backend w raporcie wykonania.

Tryb `Tylko NPU` nie może cicho przejść na GPU lub CPU. Tryb `Auto` może wykonać fallback, ale UI i raport muszą go pokazać.

Nie pobieraj dużego modelu bez działania użytkownika. Obrazy i dane wejściowe nie mogą być wysyłane do backendu ani chmury.

## 9. PR, CI i merge

Przed otwarciem PR:

- wykonaj self-review pełnego diffu;
- potwierdź, że gałąź nie jest za aktualnym `main`;
- sprawdź ponownie otwarte PR-y i nakładanie plików;
- opisz testy wykonane lokalnie i testy wykonane tylko przez Actions;
- jawnie zaznacz brak testu fizycznego NPU lub pełnego testu przeglądarkowego.

Merge jest dozwolony dopiero, gdy:

- PR jest mergowalny bez konfliktów;
- workflow dotyczący zmienionego kodu jest zielony;
- nie pojawił się nowy PR zmieniający ten sam obszar;
- diff nie zawiera plików spoza zakresu issue.
