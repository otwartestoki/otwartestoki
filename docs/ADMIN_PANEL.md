# Panel administratora na Vercel

Panel jest częścią tej samej aplikacji Next.js. Adresy po wdrożeniu:

- `/admin/login` — logowanie przez Supabase Auth (e-mail i hasło).
- `/admin/baza` — edycja istniejących wpisów w sześciu tabelach.
- `/admin/aktualizacje` — automatyczny odczyt bazy, sprawdzanie stron źródłowych, akceptacja statusów.
- `/admin/historia` — ostatnie 200 zapisów i ich wynik.

## Konfiguracja

1. W Supabase SQL Editor wykonaj `supabase/migrations/202610290001_admin_panel.sql`. Migracja dodaje wyłącznie chronioną tabelę historii; nie zmienia danych o stokach.
2. W Supabase Authentication utwórz konto administratora z hasłem i potwierdzonym adresem e-mail. Nie wystarczy konto logowania do pulpitu Supabase: musi istnieć użytkownik projektu w Auth.
3. W Vercel → Project → Settings → Environment Variables ustaw:

| Zmienna | Wartość |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | URL istniejącego projektu |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | istniejący klucz publiczny |
| `SUPABASE_SECRET_KEY` | sekret serwerowy Supabase; alternatywnie `SUPABASE_SERVICE_ROLE_KEY` dla starszego klucza |
| `ADMIN_EMAILS` | zatwierdzony e-mail administratora; kolejne oddziel przecinkami |
| `ADMIN_REVISION_SECRET` | opcjonalny niezależny losowy sekret do podpisywania wersji wpisów |

Sekretów nie dodawaj do zmiennych z prefiksem `NEXT_PUBLIC_`, kodu ani GitHub. Skonfiguruj właściwe środowisko Vercel i wykonaj redeploy. Do podglądu PR ustaw osobno zmienne Preview; zalecana jest osobna testowa baza.

## Raport i zapisy

Strona aktualizacji automatycznie odczytuje wszystkie ośrodki, trasy i wyciągi z Supabase. Nie wymaga plików JSON. „Sprawdź źródła” ponownie odczytuje bazę, a następnie pobiera przypisane strony/API ze statycznego katalogu `src/lib/admin/source-catalog.json`. Można sprawdzić wszystkie ośrodki albo wybrać jeden. Kolektor działa na serwerze Vercel, po dwa źródła jednocześnie, z limitem 10 sekund i 3 MB na źródło. Nie korzysta z modelu AI ani tokenów OpenAI.

Wyniki pojawiają się podczas sprawdzania. Widoczne są status z bazy, odczyt źródła, adres, data danych (jeżeli podana), czas pobrania i ewentualny błąd. Wszystkie obiekty z bazy pozostają widoczne, także bez automatycznego źródła. Brak danych, nieznany kod i błąd sieci nie oznaczają zamknięcia. Status ośrodka nie jest wyliczany z otwartej kolei turystycznej; deklaracja stacji w źródle jest informacją do ręcznej oceny. Dopasowania wieloznaczne lub współdzielone nie mogą być automatyczną propozycją.

Każda zaakceptowana propozycja jest osobnym żądaniem do serwera. Panel porównuje bieżący status i datę wpisu ze stanem odczytanym przed sprawdzeniem źródeł, zapisuje i ponownie odczytuje wynik. Zatrzymuje zapis po pierwszym błędzie. Sprawdzanie internetu samo nie zmienia bazy. Zamknięcie karty zatrzymuje kolejne operacje; potwierdzenia zapisów pozostają w historii Supabase. Wyniki sprawdzania stron są w pamięci karty — po odświeżeniu uruchom sprawdzanie ponownie. Status już zgodny z propozycją nie powoduje kolejnego zapisu.

W porównaniu danych przy nazwie, numerze/kodzie, długości i statusie dostępny jest przycisk „← Do bazy”. Kopiuje tylko wybrane pole, przelicza długość na metry i używa tego samego mechanizmu historii oraz weryfikacji co edytor. Przed zapisem porównuje wyświetlony rekord z nowym odczytem, a podpisana wersja i warunek aktualizacji chronią również przed zmianą pomiędzy odczytem i zapisem. Brak źródłowej wartości, nieznany/częściowy status i niejednoznaczna długość nie mogą wyczyścić ani zastąpić pola. Kategoria trasa/wyciąg jest informacją o rodzaju rekordu, a nie polem do przepisywania.

Nowe ośrodki z bazy pojawiają się automatycznie; nowe formaty stron wymagają dodania źródła i parsera. Przekierowanie poza domenę przypisanego źródła jest blokowane. Kolektor nie omija blokad HTTP ani logowania. Nie wszystkie źródła podają datę; brak daty jest widoczny bez dodatkowego obowiązkowego potwierdzenia.

Edycja ogólna używa podpisanej, godzinnej wersji rekordu i porównuje poprzednie wartości przy zapisie. Konflikt wymaga ponownego odczytu. Historia `prepared` lub `unverified` oznacza konieczność sprawdzenia aktualnego wpisu; nie należy zakładać, że żądanie zakończone błędem nie zapisało danych. Panel edytuje istniejące wpisy; nie dodaje ani nie usuwa rekordów.

## Ochrona

Każdy odczyt i zapis API sprawdza użytkownika przez Supabase `getUser` i serwerową listę `ADMIN_EMAILS`; adres musi być potwierdzony. Tokeny sesji są w cookies HttpOnly, Secure w produkcji, SameSite Strict. Zapisy wymagają zgodnego Origin. Klucz serwerowy jest importowany wyłącznie przez moduły `server-only`. Tabela historii ma RLS i brak uprawnień dla `anon` i `authenticated`. Panel jest wyłączony z indeksowania, GA i Clarity na wejściu pod `/admin`.

## Sprawdzenie wdrożenia

Bez logowania `/api/admin/records?table=resorts` powinno zwrócić 401. Konto spoza listy powinno dostać 403. Po zalogowaniu sprawdź odczyt każdej tabeli, a następnie na bazie testowej zmianę jednego pola i wpis `verified` w historii. Sprawdź konflikt w dwóch kartach. Nie testuj zapisu zbiorczego na danych produkcyjnych bez wybrania rzeczywistych zmian.

## Status na stronie głównej

Status narciarski jest liczony z pełnej listy tras, niezależnie od filtrów wyszukiwania. Komplet zamkniętych tras daje „Zamknięte”, nawet jeżeli starszy wpis ośrodka ma „otwarty” lub działa kolej turystyczna. Otwarcie wymaga przynajmniej jednej otwartej trasy oraz jawnego potwierdzenia statusu ośrodka z ostatnich 72 godzin. Bez tego strona pokazuje „Do weryfikacji”, a nie starsze otwarte kilometry jako aktualnie dostępne.

W panelu pod statusem ośrodka są przyciski potwierdzenia zamknięcia i narciarskiego otwarcia. Zapisują status oraz last_checked_at z historią i odczytem kontrolnym. Zmiana samej nazwy czy długości nie odnawia potwierdzenia otwarcia. Potwierdzenie ośrodka nie przepisuje automatycznie statusów wszystkich tras ani wyciągów. Odczyt źródeł nie jest potwierdzeniem otwarcia, a brak dopasowania wymaga odrębnej weryfikacji obiektu.
