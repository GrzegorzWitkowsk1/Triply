# Audyt testów — 30.10.2026

TODO:
- [x] Sprawdzić konfigurację CI oraz wszystkie zestawy testów.
- [x] Zmierzyć API i frontend przed zmianami.
- [x] Usunąć równoległe pobieranie MongoDB przez workery.
- [x] Zmierzyć i poprawić czas uruchamiania frontendu.
- [x] Rozdzielić E2E na niezależne zadania CI i dodać raporty.
- [x] Wskazać testy do zachowania i kandydatów do konsolidacji.
- [x] Zakończyć pełny przebieg E2E i weryfikację znalezionych błędów.

## Zakres i pomiary

| Zestaw | Pliki | Testy | Wynik/czas lokalny |
| --- | ---: | ---: | --- |
| API Vitest | 57 | 940 | wszystkie przechodzą; przed zmianami 41,7 s, końcowy przebieg 36,1 s |
| Web Vitest | 52 | 494 | wszystkie przechodzą; przed zmianami 185,5 s, po optymalizacji 69,8 s |
| Chromium E2E | 29 | 134 | pierwszy przebieg 128/134 w 24 min 10 s; wszystkie sześć początkowych awarii przeszło po poprawkach |

To pomiary czasu procesu Vitest na Windows, z lokalnymi cache. Podczas części
pomiarów działało E2E, więc nie jest to kontrolowany benchmark ani obietnica
identycznych czasów CI. Sam limit czterech workerów nie przyspieszył frontendu
(próbny wynik 222,9 s). Zysk przyniosło prebundlowanie MUI, wraz z importami
`styles`, `locale` i używanymi ikonami z podkatalogów. Pełny końcowy przebieg
przeszedł bez ostrzeżeń o podwójnym ładowaniu Emotion.

## MongoDB i „Validate monorepo”

25 plików samodzielnie uruchamia MongoMemoryServer lub MongoMemoryReplSet.
Bez globalnego przygotowania ich pierwsze uruchomienie może konkurować
o ten sam plik archiwum `.downloading`. W zainstalowanym downloaderze
`rename` wykonuje się w asynchronicznym handlerze `finish`, którego odrzucenie
nie jest przechwytywane przez otaczającą obietnicę. To wyjaśnia formę
zgłoszonego unhandled rejection; samo ENOENT wskazuje utratę współdzielonego
pliku tymczasowego. Historycznego wyścigu na Ubuntu nie odtworzono lokalnie.

Domyślny pool zainstalowanego Vitest 5 to wątki. Blokada pobierania MongoDB
sprawdza PID i lokalny zbiór blokad modułu; izolowane workery współdzielą PID,
ale nie ten zbiór. To pozwala im uznać blokadę innego workera za dostępną.

Nowy global setup rozwiązuje/pobiera binarkę przed uruchomieniem workerów.
Workery otrzymują gotową ścieżkę i zakaz pobierania. Własne bazy i teardown
pozostają w plikach testowych. CI cache'uje binarki; cache przyspiesza start,
natomiast poprawność nie zależy od trafienia w cache. Błędy Vitest nadal
przerywają testy. Nie zastosowano ignorowania unhandled errors ani retry.

Dwa zestawy testów Supertest uruchamiają teraz jeden listener HTTP na plik.
Usuwa to wyścig tworzenia listenerów przy równoległych żądaniach i ostrzeżenia
`MaxListenersExceededWarning`. Nie podniesiono limitów listenerów.

## E2E: czas i jakość

Pełny pierwszy przebieg trwał 24 min 10 s, pozostawiając zbyt mało zapasu
w 25-minutowym jobie na instalację i uruchomienie infrastruktury. Po poprawkach
powtórzono wszystkie sześć nieudanych scenariuszy oraz trzy dodatkowe warianty
dostępności. Pierwsze powtórzenie: 7/9, drugie po poprawieniu synchronizacji:
2/2. Oba scenariusze mobilnego asystenta i wszystkie cztery audyty dostępności
przechodzą. Nie wykonywano drugiego pełnego przebiegu wszystkich 134 testów.

134 scenariusze działały szeregowo, z jedną bazą i resetowanym stanem serwera.
Podniesienie liczby workerów w tej konfiguracji uszkodziłoby izolację; fixture
celowo tego zabrania. CI dzieli teraz pełną kolekcję na cztery odrębne runnery,
każdy z jednym workerem, własnymi portami w osobnej maszynie i własną bazą.
Żaden scenariusz nie jest wyłączony. Rzeczywisty zysk i kolejkę runnerów trzeba
zmierzyć w Actions; cztery starty infrastruktury zwiększają łączny koszt.
Podział działa na pojedynczych testach (`fullyParallel: true`), a wykonanie
na każdym runnerze pozostaje szeregowe (`workers: 1`). Dzielenie całych plików
dawało nierówny rozkład 38/48/18/30 scenariuszy.
Zweryfikowane listy po zmianie mają 34/34/33/33 testy; ich suma obejmuje
dokładnie wszystkie 134 identyfikatory, bez braków ani powtórzeń.

Szerokie skany axe kosztują około 35–42 s na scenariusz, bo badają wiele ekranów.
Macierze języków, szerokości oraz trzykrotne mobilne ścieżki użytkownika
dodają kolejny koszt. Nie ma automatycznych retry maskujących niestabilność.
Jedyny `waitForTimeout(250)` obsługuje aktywację rzeczywistego długiego dotyku;
nie odpowiada za wielominutowe wykonanie.

Znalezione i poprawione problemy:

- Dwa selektory linków kolekcji wymagały tytułu jako całej nazwy dostępności.
  Link zawiera również opis; selektory uwzględniają teraz początek nazwy EN/PL.
- Test ograniczonego ruchu wymagał tekstu `0s`, choć CSS ustawia `.01ms`.
  Teraz sprawdza górny limit czasu przejścia.
- Test polskiego zapisu nawigował dalej przed zakończeniem wejścia gościa.
  Teraz czeka na zakończenie przekierowania do `/home`. Pomiar szerokości
  Explore czeka na ustabilizowanie układu po resize zamiast mierzyć go od razu.
- Zmiana szerokości z desktopowej na 320 px przy otwartym asystencie powodowała
  rzeczywisty błąd UI. Trace pokazał `padding-right: 560px` dodany przez MUI
  przy blokowaniu przewijania. Mobilny asystent blokuje teraz tło przez CSS,
  zachowując modal i pułapkę fokusu, bez kompensacji szerokości scrollbara.
- Jeden początkowy wynik dostępności przypadł na restart Vite po zmianie
  konfiguracji w trakcie audytu; wymagał powtórzenia bez restartu serwera.

Raporty JSON Vitest i HTML/JSON Playwright są teraz zachowywane także po
poprawnym CI. Umożliwia to porównywanie czasu i ustalenie konkretnego miejsca
awarii, zamiast wnioskowania z długo działającego joba.

## Co warto ograniczyć

Nie usunięto testów. Poniższe pozycje wymagają przeniesienia unikalnych asercji,
a dopiero potem usunięcia nadmiarowych scenariuszy.

| Kandydat | Powielenie | Zalecenie |
| --- | --- | --- |
| `designConsistency.spec.ts` + `mobileVisual.spec.ts` | Zrzuty i sprawdzanie przepełnienia Home, Explore, Saved, Packing, logowania i kreatora w EN/PL | Scalić wspólne ekrany. Zachować kontrolę przycisków 44 px, dialogów, mapy, asystenta i małej wysokości. Test asystenta właśnie znalazł prawdziwy błąd. |
| `mobileExperience.spec.ts` | Te same sześć ścieżek dla szerokości 360 i 390 px, przy tym samym układzie mobilnym | Rozważyć jedną pełną ścieżkę telefonu i osobną tabletu; szerokość 390 pozostawić w krótkiej macierzy układu. Nie usuwać testów gestów, rollbacku i wersji itinerarium. |
| `i18nCoverage.spec.ts` i szerokości w testach funkcji | Powtarzane pięć szerokości na wielu trasach i w obu językach | Rozdzielić pełne scenariusze językowe od krótkiej wspólnej macierzy układu. Zachować przełączanie języka, drafty, reload i brak zapisów/wywołań AI. |

Zrzuty są załącznikami do ręcznej oceny — żaden test nie używa
`toHaveScreenshot` ani porównania z obrazem wzorcowym. Ich zapis sam w sobie
nie wykrywa regresji wizualnej; warto zostawić automatyczne asercje układu,
a pełny zestaw materiałów do przeglądu generować na żądanie.

Zachować testy migracji z transakcjami i odmową na standalone, izolacji
właścicieli, konfliktów wersji, równoległych zapisów, limitów gościa, odwołania
udostępnienia, eksportów PDF/ICS i błędów providerów. Podobne ścieżki na
poziomie API i przeglądarki badają inne granice i nie są automatycznie zbędne.
Walidacja tłumaczeń wykonuje się kilka razy w CI, lecz jej koszt jest mały;
testy walidatora badają również zachowanie na błędnych danych.

## Granice audytu

Nie zmierzono procentowego pokrycia kodu ani skuteczności mutacyjnej; sama
liczba testów nie potwierdza kompletności. E2E obejmuje Chromium i serwer Vite,
a nie Safari/Firefox lub podgląd produkcyjnego bundla. Zewnętrzni providerzy
są deterministycznie zastąpieni, więc testy nie potwierdzają aktualnej
dostępności ich usług. Produkcyjne buildy i typy są sprawdzane oddzielnie.
Końcowy test zimnego cache na Ubuntu pozostaje do wykonania w GitHub Actions.
`bun run typecheck`, `bun run typecheck:e2e`, produkcyjny `bun run build`
oraz kontrola diff przeszły. Końcowe dwa zestawy testów Supertest (63 testy)
przeszły bez ostrzeżeń o listenerach; pełne API również przeszło po tej zmianie.
