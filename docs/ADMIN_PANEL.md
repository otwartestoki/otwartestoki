# Panel administratora na Vercel

Panel jest częścią tej samej aplikacji Next.js. Adresy po wdrożeniu:

- `/admin/login` — logowanie przez Supabase Auth (e-mail i hasło).
- `/admin/baza` — edycja istniejących wpisów w sześciu tabelach.
- `/admin/aktualizacje` — import `coverage.json`, porównanie z aktualną bazą, akceptacja statusów.
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

Na stronie aktualizacji wczytaj plik `coverage.json` wygenerowany dotychczasowym audytem. Raport pozostaje w pamięci przeglądarki; odświeżenie strony wymaga ponownego wczytania. Nie publikujemy kopii bazy w publicznym repozytorium. Ta wersja nie uruchamia kolektora stron automatycznie na Vercel — dotychczasowy audyt nadal generuje raport lokalnie.

Każda zaakceptowana propozycja jest osobnym żądaniem do serwera. Panel odczytuje aktualny status i datę wpisu, porównuje je z raportem, zapisuje i ponownie odczytuje wynik. Zatrzymuje kolejkę po pierwszym błędzie. Zamknięcie karty zatrzymuje dalsze przetwarzanie; wykonane operacje pozostają w historii w Supabase. Ponowne wczytanie raportu i odczyt bazy pozwalają sprawdzić postęp. Status już zgodny z propozycją nie powoduje kolejnego zapisu.

Edycja ogólna używa podpisanej, godzinnej wersji rekordu i porównuje poprzednie wartości przy zapisie. Konflikt wymaga ponownego odczytu. Historia `prepared` lub `unverified` oznacza konieczność sprawdzenia aktualnego wpisu; nie należy zakładać, że żądanie zakończone błędem nie zapisało danych. Panel edytuje istniejące wpisy; nie dodaje ani nie usuwa rekordów.

## Ochrona

Każdy odczyt i zapis API sprawdza użytkownika przez Supabase `getUser` i serwerową listę `ADMIN_EMAILS`; adres musi być potwierdzony. Tokeny sesji są w cookies HttpOnly, Secure w produkcji, SameSite Strict. Zapisy wymagają zgodnego Origin. Klucz serwerowy jest importowany wyłącznie przez moduły `server-only`. Tabela historii ma RLS i brak uprawnień dla `anon` i `authenticated`. Panel jest wyłączony z indeksowania, GA i Clarity na wejściu pod `/admin`.

## Sprawdzenie wdrożenia

Bez logowania `/api/admin/records?table=resorts` powinno zwrócić 401. Konto spoza listy powinno dostać 403. Po zalogowaniu sprawdź odczyt każdej tabeli, a następnie na bazie testowej zmianę jednego pola i wpis `verified` w historii. Sprawdź konflikt w dwóch kartach. Nie testuj zapisu zbiorczego na danych produkcyjnych bez wybrania rzeczywistych zmian.
