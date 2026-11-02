# Mini App Telegram: CRM în buzunar și scaner de documente pentru echipă

## Pe scurt
Un bot Telegram nou, separat de cel cu notificările, are un buton de meniu care deschide **panoul de admin actual** în Telegram, pe tot ecranul, fără parolă. Omul e recunoscut după datele semnate de Telegram (`initData`), pe care serverul le verifică la fiecare cerere. **Proprietarul** vede tot, ca în browser. **Angajații** văd doar pâlnia (cardurile, schimbarea etapei, notele, adăugarea de clienți) și scanerul de documente, fără sume, plăți, Financiar, Scadențe, Catalog și rapoarte. Serverul aplică aceste limite, nu doar interfața.

**Nu se adaugă funcții Vercel:** rămânem la 12 din 12 pe planul Hobby. Prima versiune nu a cerut migrare SQL; sursa „Telegram” și autorul acțiunilor (@username) au adăugat ulterior migrarea `supabase/migrations/2026-10-30-telegram-autor.sql` (rulată).

## Pornim de la ce există
- `admin.html` + `admin.js`, `admin-fin.js`, `admin-dues.js`, `admin-cat.js`: tabla pâlniei, lista, fișa clientului, „Client nou”, „Încarcă document”, Financiar, Scadențe, Catalog. Toate cererile trec prin `api()` din `admin.js`.
- `api/_lib/auth.js`: o singură parolă și cookie-ul `temelia_admin` (HttpOnly, SameSite=Strict), apoi `requireAdmin()` pe toate rutele `/api/admin/*`.
- Rutele (12): `contact`, `admin/login`, `admin/logout`, `admin/payments`, `admin/telegram-chats`, `admin/report`, `admin/dues`, `admin/expenses`, `admin/catalog`, `admin/requests/index`, `admin/requests/[id]`, `admin/docs/[action]`.
- Botul vechi (`TELEGRAM_BOT_TOKEN`) trimite notificările în grupuri și e citit cu `getUpdates` în `telegram-chats.js`. **Nu îl atingem.** Botul nou nu primește webhook (adresă la care Telegram trimite mesajele botului), deci nici `getUpdates` nu se strică.
- Pe tablă, cardurile au deja selectul „Mută în…” (`.card-move`), iar tabla derulează orizontal în interiorul ei (`.board`).

## Pentru cine e
- **Proprietarul**, cu ID-ul Telegram în `TG_OWNER_IDS`: tot panoul.
- **Angajații**, cu ID-ul Telegram în `TG_STAFF_IDS`: pâlnia și scanerul.
- Oricine altcineva care deschide botul vede doar ecranul „Acces refuzat”, cu propriul ID.

## Pașii principali

### Pregătirea, o singură dată (o face proprietarul)
1. În Telegram deschide **@BotFather**, scrie `/newbot`, apoi:
   - numele afișat, de exemplu `LUXARCH CRM`;
   - un username care se termină în `bot`, de exemplu `luxarch_crm_bot`.
2. BotFather trimite **tokenul** (un șir de forma `123456:ABC...`). Îl copiază, iar tokenul ajunge în Vercel ca `TELEGRAM_APP_BOT_TOKEN`, pus prin API din clipboard.
3. În @BotFather: `/mybots` → botul nou → **Bot Settings** → **Menu Button** → **Configure menu button**:
   - adresa: `https://luxarch.vercel.app/admin`;
   - textul butonului: `CRM`.
4. În Vercel se pun:
   - `TG_OWNER_IDS`: ID-ul proprietarului;
   - `TG_STAFF_IDS`: ID-urile angajaților, separate prin virgulă, fără spații obligatorii, de exemplu `111111111,222222222`. Poate fi gol.
   Proprietarul își află ID-ul la fel ca un angajat (pasul 6). Până atunci `TG_OWNER_IDS` poate rămâne gol.
5. **După orice schimbare a variabilelor, e nevoie de o republicare în Vercel** (Redeploy). Fără ea, schimbarea nu are efect.

### Un angajat nou
6. Angajatul deschide botul și apasă butonul de meniu **CRM**. Apare ecranul „Acces refuzat”:
   - textul: „Nu ai încă acces. Trimite proprietarului ID-ul tău Telegram:”;
   - ID-ul, scris mare, de exemplu `123456789`;
   - butonul „Copiază ID-ul”, care la apăsare afișează „Copiat”.
7. Proprietarul adaugă ID-ul în `TG_STAFF_IDS` și republică. Angajatul închide și redeschide Mini App și intră în pâlnie.
8. Scoaterea unui angajat: ID-ul se șterge din `TG_STAFF_IDS`, apoi se republică. Accesul se pierde la următoarea cerere după publicare.

### Folosirea zilnică
9. Cine e pe listă apasă **CRM** și ajunge direct în pâlnie, fără parolă.
10. **Pâlnia** (la ambele roluri): cardurile pe etape, deschiderea fișei, schimbarea etapei, notele, butonul „Client nou”. La „Respins”, motivul rămâne obligatoriu (dialogul actual).
11. **Scanerul**: butonul „Încarcă document” are două opțiuni:
    - „Fotografiază”, care deschide camera din spate;
    - „Alege fișier”, pentru poze sau un PDF.
    Urmează fluxul actual: recunoașterea cu Claude → ecranul de verificare → „Salvează”.
12. **Proprietarul** vede, în plus, tot ce vede în browser: sumele, plățile, Financiarul, Scadențele, Catalogul și toate tipurile de documente.

## Drepturile angajatului

### Ce poate
- Să vadă toți clienții pe tablă și în listă, cu numele, telefonul, emailul, tipul, serviciul, sursa, etapa și datele.
- Să deschidă fișa clientului: datele de contact, mesajul, notele, istoricul etapelor și originalele documentelor legate de client (carte de vizită, chestionar).
- Să mute clientul în **orice etapă**, inclusiv „Avans” și „Plătit”. Anunțul de plată pleacă în chatul „Achitări”, prin botul vechi, exact ca acum. Angajatul nu vede sumele din anunț.
- Să scrie note și să adauge clienți manual (`POST /api/admin/requests`).
- Să scaneze și să salveze patru tipuri:
  - **carte de vizită** și **chestionar**: devin clienți;
  - **aviz** și **chitanță**: devin cheltuieli.
  Vede doar documentul pe care l-a scanat (câmpurile din ecranul de verificare, inclusiv suma lui) și confirmarea după salvare.

### Ce nu poate (serverul răspunde `403 { error: 'forbidden' }`, iar interfața nici nu arată)
- Financiarul, Scadențele, Catalogul și rapoartele. Rutele `admin/expenses`, `admin/report`, `admin/dues`, `admin/catalog`, `admin/payments` și `admin/telegram-chats` sunt refuzate la orice metodă.
- Valoarea contractului, moneda, plățile, ratele de încasat și eticheta „Restant”: nu apar în răspunsurile pentru angajat (vezi „Ce schimbăm în API”).
- Să modifice `contract_value` sau `currency` (PATCH-ul cu aceste câmpuri e refuzat cu 403, iar nimic din cerere nu se salvează).
- Să salveze documentele „De plătit”, „De încasat” sau „Listă de prețuri”. Mesajul afișat: **„Doar proprietarul poate salva acest tip de document.”**
- Să deschidă originalele altor documente decât cele legate de un client (`documents.request_id` completat).

## Aspectul pe telefon

> **De confirmat de utilizator.** La întrebarea „Ce se deschide în Telegram?” utilizatorul a răspuns „mini aplicația arată bine pe telefon”. Am interpretat răspunsul ca: **se deschide panoul actual, adaptat pentru Telegram**, cu cerințele de mai jos. Dacă se dorea o pagină separată și simplificată, secțiunea aceasta și „Ce schimbăm în interfață” se refac.

Cerințe verificabile, toate doar când panoul rulează în Telegram (`window.Telegram.WebApp.initData` nu e gol):
1. **Tot ecranul.**
   - La pornire se apelează `Telegram.WebApp.ready()` și `expand()`.
   - Pe telefon (`platform` = `ios` sau `android`), dacă există `requestFullscreen()` (Bot API 8.0+), se apelează și aceasta.
   - Conținutul respectă zonele sigure (marginile ecranului unde se suprapun butoanele Telegram sau decupajul camerei): variabilele CSS `--tg-safe-area-inset-*` și `--tg-content-safe-area-inset-*`. Nimic nu ajunge sub butoanele Telegram sau sub decupajul camerei.
2. **Culorile.**
   - Panoul păstrează tema lui deschisă (culorile LUXARCH), chiar dacă Telegram are tema întunecată.
   - Antetul și fundalul Telegram se potrivesc cu panoul, prin `setHeaderColor` și `setBackgroundColor` cu culoarea `--bg` a panoului.
   - Nu există text deschis pe fundal deschis și nici fâșii de altă culoare la margini.
3. **Butonul Back al Telegramului.**
   - E vizibil oriunde, în afară de ecranul principal (pâlnia).
   - La apăsare face exact ce face „Înapoi” din panou: fișă → tablă sau lista de unde s-a venit; Financiar/Scadențe/Catalog → pâlnia.
   - Dacă un dialog e deschis (document, motivul respingerii), Back îl închide.
4. **Antetul.**
   - Nu apare antetul paginii de site.
   - Butonul „Ieșire” e ascuns: în Telegram nu există sesiune cu parolă.
   - Bara de secțiuni (CRM / Financiar / Scadențe / Catalog) apare doar la proprietar. La angajat rămân titlul, „Client nou” și „Încarcă document”.
5. **Nicio derulare orizontală a paginii** la 375px și la 320px, pe toate ecranele la care are acces rolul respectiv. Se verifică la ambele roluri.
6. **Butoane ușor de apăsat**: orice buton, link de acțiune sau select are cel puțin 44×44px. Câmpurile au `font-size` de cel puțin 16px, ca iOS să nu mărească pagina la atingere.
7. **Pâlnia pe telefon** (lățime ≤ 700px, în Telegram):
   - Sus, un rând de etape cu numărul de clienți la fiecare: `Nouă 3 · Contactată 5 · …`. Rândul derulează în interiorul lui, ca `.status-filter`, iar pagina nu.
   - Sub el, cardurile etapei alese, una sub alta, pe toată lățimea.
   - Etapa aleasă se păstrează în adresă, ca Back să revină la ea.
   - Mutarea se face din selectul „Mută în…” al cardului. Tragerea cardurilor e oprită în Telegram.
   - După mutare, cardul dispare din lista etapei și numărul se actualizează.
   - Peste 700px (Telegram Desktop) rămâne tabla actuală.
8. **Scanerul pe telefon**: dialogul de document ocupă tot ecranul. Ecranul de verificare e pe o singură coloană. „Salvează” și „Renunță” rămân la vedere, jos.
9. **Confirmarea la închidere**: cât timp ecranul de verificare are date nesalvate, se cere confirmare înainte de închiderea Mini App (`enableClosingConfirmation`), iar după salvare sau renunțare se oprește.

## Ce trebuie să funcționeze

### Obligatoriu în prima versiune
- [ ] Butonul de meniu al botului nou deschide `/admin` în Telegram, iar cine e pe listă intră fără parolă.
- [ ] Serverul verifică `initData` la fiecare cerere, conform documentației Telegram:
  - cheia secretă = HMAC-SHA256(`TELEGRAM_APP_BOT_TOKEN`, cheie `"WebAppData"`);
  - `hash` = HMAC-SHA256(data-check-string, cheia secretă), comparat în timp constant;
  - `auth_date` are cel mult 24 de ore.
  Fără o verificare reușită, nu se întoarce nicio dată.
- [ ] Rolul se stabilește după `user.id` din `initData` verificat:
  - ID în `TG_OWNER_IDS` → `owner`, chiar dacă e și în `TG_STAFF_IDS`;
  - ID în `TG_STAFF_IDS` → `staff`;
  - altfel → refuzat.
- [ ] Ecranul „Acces refuzat” afișează ID-ul Telegram și butonul „Copiază ID-ul”.
- [ ] Angajatul are exact drepturile din „Drepturile angajatului”, aplicate pe server.
- [ ] Browserul obișnuit: `/admin` arată ecranul cu parolă, ca acum. Un antet `initData` falsificat sau vechi primește 401, fără date.
- [ ] Toate cerințele 1–8 din „Aspectul pe telefon”.
- [ ] Scanerul cu „Fotografiază” și „Alege fișier” funcționează în Telegram pe Android și pe iOS.
- [ ] După ce un angajat salvează o cheltuială, apare confirmarea „Cheltuială salvată: <furnizor>, <data>, <suma> <moneda>” și butonul „Încarcă alt document”, nu fișa din Financiar. După salvarea unui client se deschide fișa lui, ca acum.
- [ ] Numărul de funcții din `api/` rămâne 12.

### De dorit
- [ ] Confirmarea la închidere (cerința 9).
- [ ] O vibrație scurtă la mutarea unui card și la salvarea unui document (`HapticFeedback`).

### Mai târziu
- Notificarea „client nou adăugat manual” și istoricul etapelor să arate **cine** a făcut acțiunea (numele din Telegram). Acum nu se știe dacă a fost proprietarul sau un angajat.
- O listă de angajați administrată din panou, în locul variabilelor din Vercel, fără republicare.
- Contul clientului. Cererea clienților are acum specificația ei, cu bot separat: `docs/specs/2026-11-02-mini-app-clienti.md`.
- Rezervarea pe ore și cardul de fidelitate: nu se potrivesc unui birou de proiectare.
- Un link direct spre Mini App (`/newapp` la BotFather), ca s-o poată trimite cuiva.

## Erori și cazuri limită
- **Mini App deschisă de cineva care nu e pe listă**: „Acces refuzat” cu ID-ul. Niciun apel la `/api/admin/*` nu întoarce date (403 `{ error: 'tg_denied' }`).
- **`initData` mai vechi de 24 de ore** (Mini App lăsată deschisă): orice cerere primește 401 `{ error: 'tg_expired' }`. Ecranul arată „Sesiunea a expirat. Închide aplicația și deschide-o din nou din butonul CRM.” În Telegram nu apare niciodată ecranul cu parolă.
- **Lipsește `TELEGRAM_APP_BOT_TOKEN` în Vercel**: orice cerere cu antet Telegram primește 500 `{ error: 'tg_config' }`. Ecranul arată „Mini App nu e configurată încă (lipsește tokenul botului).” Accesul cu parolă din browser merge mai departe.
- **ID scos din listă în timp ce aplicația e deschisă**: după republicare, următoarea cerere primește 403 `tg_denied`, iar ecranul trece la „Acces refuzat”.
- **Angajatul scanează un document „De plătit”, „De încasat” sau „Listă de prețuri”**:
  - după citire, serverul întoarce `{ ok: true, doc_type, supported: false, reason: 'owner_only' }`, fără câmpuri, și șterge fișierele temporare;
  - ecranul arată „Doar proprietarul poate salva acest tip de document.” și butonul „Încarcă alt document”;
  - dacă angajatul alege el însuși tipul, același refuz vine înainte de citire, ca să nu se cheltuie o citire Claude;
  - un `save` direct cu aceste tipuri → 403 `owner_only`.
- **Duplicat la o cheltuială scanată de angajat**: apare avertismentul actual, „Pare să existe deja”, cu furnizorul, numărul și data, **fără sumă și fără link**. Angajatul poate salva oricum (`force`), ca acum.
- **Dublu clic pe „Salvează” sau pe mutare**: butonul se dezactivează până vine răspunsul, ca acum.
- **Fără internet**: mesajele de eroare actuale ale panoului. Nimic nu se pierde din ecranul de verificare până la închidere.
- **Telegram vechi, fără `requestFullscreen`**: rămâne `expand()`, iar aplicația funcționează normal.
- **Limita de 30 de recunoașteri pe oră** e comună pentru toți (proprietar și angajați). La depășire apare mesajul actual (429).

## Date și drepturi de acces
- **Tabele noi: niciuna. Migrări:** doar `2026-10-30-telegram-autor.sql`, adăugată ulterior (vezi „Pe scurt”). Sursele scanerului rămân cele existente: `carte_vizita`, `chestionar`, `manual`; avizele și chitanțele rămân cheltuieli.
- **Date personale primite de la Telegram:** se folosesc `user.id` (pentru rol) și numele. Pentru clienții adăugați și pentru schimbările de etapă din Mini App se salvează autorul („@username” sau numele), în `created_by` și `status_actor`. ID-ul membrilor echipei nu se salvează în baza de date.
- **Variabile noi în Vercel:**
  - `TELEGRAM_APP_BOT_TOKEN`: tokenul botului nou;
  - `TG_OWNER_IDS`: ID-uri numerice, separate prin virgulă;
  - `TG_STAFF_IDS`: ID-uri numerice, separate prin virgulă, poate fi gol.
  Spațiile și valorile nenumerice se ignoră.

### Ce schimbăm în `_lib/auth.js`
- `requireAdmin(req, res, { staff = false } = {})` întoarce rolul (`'owner'` sau `'staff'`) sau `false` (și răspunde cu eroarea):
  - cookie-ul cu parolă valid → `owner`;
  - altfel, antetul `X-Telegram-Init-Data` verificat → rolul după liste;
  - rolul `staff` pe o rută fără `{ staff: true }` → 403 `forbidden`.
- **Implicit, rutele sunt doar pentru proprietar.** Doar `requests/index`, `requests/[id]` și `docs/[action]` primesc `{ staff: true }`.
- Cookie-ul nu se folosește în Telegram: cookie-ul actual e SameSite=Strict și nu e sigur în fereastra Telegram, de aceea datele se trimit în antet.

### Ce schimbăm în API (fără rute noi)
- **`GET /api/admin/requests`** (lista și `all=1`) pentru `staff`:
  - fără `contract_value`, `currency`, `paid_total` și `overdue`;
  - fără `receivablesWithState`;
  - `payments(amount)` nu se cere deloc din bază.
- **`POST /api/admin/requests`**: la fel pentru ambele roluri.
- **`GET /api/admin/requests/:id`** pentru `staff`:
  - `item` fără `contract_value` și `currency`;
  - fără `payments`, `receivables` și documentele grupurilor de rate;
  - `documents` doar cele cu `request_id`.
- **`PATCH /api/admin/requests/:id`** pentru `staff`: sunt permise doar `status`, `comment` și `notes`. Dacă apare `contract_value` sau `currency` → 403 `forbidden`, fără nicio salvare. Anunțul de plată la „Avans” sau „Plătit” rămâne neschimbat.
- **`docs/[action]`** pentru `staff`:
  - `upload`, `cancel`: neschimbate;
  - `read`: refuzul `owner_only` descris la erori; la cheltuieli, duplicatele fără `id` și `amount_total`;
  - `save`: doar `carte_vizita`, `chestionar`, `aviz`, `chitanta`, altfel 403 `owner_only`;
  - `open`: doar documentele cu `request_id` completat, altfel 404.
- **`expenses`, `report`, `dues`, `catalog`, `payments`, `telegram-chats`**: 403 pentru `staff` (prin regula implicită).

### Ce schimbăm în interfață
- `admin.html` încarcă `https://telegram.org/js/telegram-web-app.js`.
- `api()` din `admin.js` adaugă antetul `X-Telegram-Init-Data` când `Telegram.WebApp.initData` nu e gol.
- La pornire, în Telegram, se apelează o rută permisă ambelor roluri (de exemplu lista), iar răspunsul spune rolul (`role` în JSON).
  - În funcție de rol se ascund: bara de secțiuni, sumele de pe carduri și din fișă, plățile, ratele, „Restant”, câmpul „Valoare contract” din „Client nou” și tipurile de documente doar pentru proprietar.
  - La `staff` nu se apelează `LUXDUES.refreshCount()` (altfel ar primi 403 la fiecare navigare).
- `vercel.json`: **nu se adaugă** `X-Frame-Options` sau `frame-ancestors` care ar bloca `/admin`. Telegram Web și Desktop deschid Mini App într-un iframe (o pagină încadrată în alta).

## Servicii externe
- **Telegram (botul nou):** e folosit doar pentru butonul de meniu și pentru semnătura `initData`. Serverul nu cheamă API-ul Telegram, verificarea e locală, deci o pană Telegram nu afectează panoul din browser.
- **Telegram (botul vechi):** notificările, neschimbate.
- **Claude, Supabase, Storage:** neschimbate. Erorile lor apar ca acum.

## Ce nu intră în această sarcină
- Partea pentru clienți în botul CRM. Cererea clienților are un bot separat și specificația ei: `docs/specs/2026-11-02-mini-app-clienti.md`. Catalogul, contul, rezervarea și fidelitatea rămân în afara sarcinii.
- Funcții Vercel noi, comasarea funcțiilor, upgrade la Vercel Pro.
- Webhook pentru vreun bot și comenzi în chat (`/start` cu răspuns etc.).
- Tabele noi, liste de angajați în bază, roluri mai fine decât `owner` și `staff`.
- Schimbarea panoului din browser (în afara ascunderilor legate de Telegram).

## Întrebări rămase (le rezolvă programatorul)
- Camera (`capture="environment"`) în Telegram pe iOS și Android: de testat pe ambele. Dacă pe o platformă nu deschide camera, „Fotografiază” se ascunde acolo și rămâne „Alege fișier” (care oferă oricum camera în meniul sistemului).
- Unde se pune `role` în răspuns (un câmp în lista clienților este suficient) și cum se reține în `admin.js`.
- `CLAUDE.md` are încă adresa veche (`atelier-temelia.vercel.app`). Adresa Mini App folosește `https://luxarch.vercel.app/admin`; merită corectat `CLAUDE.md`.
