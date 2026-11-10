# Facturi PDF din fișa clientului

> Stare: Confirmată (10.11.2026), după runda 1 de întrebări. Termen: 11.11.2026, 23:59 (tema N3, blocul 6).

## Pe scurt
Proprietarul emite din fișa clientului o factură PDF, fie cu butonul „Emite factura”, fie automat, o singură dată, când fișa trece în etapa „Procesat”. Factura are un număr unic (LUX-2026-0001), se salvează în Storage, apare în lista facturilor clientului, se trimite clientului cu un buton (pe Telegram sau pe email) și se marchează ca „Achitată”. La marcare se adaugă o plată în fișă și fișa trece în „Plătit”.

## Utilizatori
- **Proprietarul** (panoul `/admin` din browser): emite, deschide, trimite și marchează facturile.
- **Angajatul** (Mini App Telegram): nu vede nimic despre facturi, cum nu vede nici banii. Dacă încearcă vreo acțiune pe facturi, primește 403. Totuși, când el mută o fișă în „Procesat”, factura automată se emite.
- **Clientul**: primește PDF-ul pe Telegram sau pe email. Nu are acces la CRM.

## Cum se folosește
1. Proprietarul deschide fișa unui client. Fișa are o secțiune nouă, „Facturi”: lista facturilor și butonul „Emite factura”.
2. Butonul deschide un mic formular completat din fișă:
   - denumirea serviciului, luată din eticheta serviciului fișei (`SERVICES[service]`), cu tipul proiectului dacă există;
   - cantitatea 1;
   - prețul unitar egal cu valoarea contractului;
   - termenul de plată de 10 zile.
   Toate câmpurile se pot corecta. Formularul arată pe loc subtotalul, TVA 20% și totalul.
3. La „Emite”, serverul dă numărul următor, salvează factura, face PDF-ul și îl urcă în Storage. Factura apare în listă ca „Neachitată”.
4. În listă, fiecare factură are numărul, data, totalul și moneda, termenul, statusul și butoanele „Deschide PDF”, „Trimite clientului” și „Marchează achitată”.
5. „Trimite clientului”:
   - dacă fișa are `tg_user_id`, PDF-ul pleacă pe Telegram la client;
   - altfel, dacă are email, pleacă pe email;
   - dacă nu poate pleca nicăieri, PDF-ul ajunge pe Telegram la proprietar, cu textul „Nu s-a putut trimite clientului: <motiv>. Trimiteți-l manual.”
   Pe factură se notează unde și când a plecat.
6. „Marchează achitată” cere o confirmare. Apoi factura devine „Achitată”, în plățile fișei se adaugă o plată egală cu totalul facturii, cu data de azi și nota „Factura LUX-2026-0001”, iar fișa trece în „Plătit” (regula de etapă e mai jos).
7. **Varianta automată:** orice trecere a fișei în „Procesat”, din panou, din Mini App sau din MCP, emite o factură cu valorile implicite din pasul 2, dar numai dacă fișa nu are deja o factură automată.

## Ce trebuie să meargă
### Obligatoriu în prima versiune
- [ ] Tabel nou `invoices` și numerotare fără repetări. Numerele merg pe ani (LUX-AAAA-NNNN, cu 4 cifre și de la 0001 în fiecare an) și le dă baza de date, într-o singură operație. Două emiteri în același timp nu pot primi același număr.
- [ ] Butonul „Emite factura”, cu formularul care se poate corecta (serviciu, cantitate > 0, preț ≥ 0,01, termen de 1–365 zile).
- [ ] Emitere automată la trecerea în „Procesat”, în trei locuri: `PATCH /api/admin/requests/:id`, schimbarea etapei din `api/mcp.js` și crearea unui client direct în „Procesat” (`requests/index.js`). Logica e una singură, în `api/_lib/invoices.js`.
- [ ] Fără dubluri la emiterea automată: cel mult o factură automată pe fișă, păzită de un index unic în bază, nu doar de cod. A doua trecere în „Procesat” nu face nimic. Butonul poate emite oricând facturi în plus.
- [ ] PDF-ul în română, cu diacritice corecte (ă, â, î, ș, ț), în moneda fișei (MDL sau EUR). Conține:
  - titlul „FACTURĂ nr. LUX-2026-0001” și data emiterii (ora Moldovei);
  - furnizorul: denumirea, IDNO, codul TVA, adresa, IBAN-ul și banca;
  - clientul: numele, telefonul și emailul din fișă;
  - tabelul pozițiilor (nr., serviciu, cantitate, preț unitar, sumă);
  - subtotalul, TVA 20% și totalul;
  - „Termen de plată: ZZ.LL.AAAA”.
- [ ] TVA = subtotal × 0,20, rotunjit la 2 zecimale. Total = subtotal + TVA.
- [ ] Rechizitele firmei vin din variabilele de mediu Vercel: `COMPANY_NAME`, `COMPANY_IDNO`, `COMPANY_VAT_CODE`, `COMPANY_ADDRESS`, `COMPANY_IBAN`, `COMPANY_BANK`. Dacă lipsește oricare, se folosesc datele de test din cod (de exemplu „LUXARCH SRL (TEST)”, IDNO 1000000000000), iar pe PDF scrie vizibil „DATE DE TEST, FACTURĂ FĂRĂ VALOARE FISCALĂ”.
- [ ] PDF-ul se salvează în bucketul `documente`, la `facturi/<request_id>/<număr>.pdf`, și se deschide din fișă printr-un link de 5 minute, ca documentele existente.
- [ ] Lista facturilor vine în răspunsul `GET /api/admin/requests/:id`, doar pentru proprietar, cea mai nouă prima. Răspunsul pentru angajat nu conține deloc facturile.
- [ ] „Trimite clientului” merge doar la buton:
  - pe Telegram, prin `sendDocument` la `tg_user_id`;
  - pe email, prin Resend cu PDF-ul atașat, de la `MAIL_FROM`, către emailul fișei;
  - dacă nu se poate, PDF-ul ajunge pe Telegram la proprietar (`TELEGRAM_CHAT_ID`).
  Se salvează `sent_via` (`telegram` / `email` / `proprietar`) și `sent_at`.
- [ ] „Marchează achitată” face trei lucruri: schimbă statusul facturii, adaugă plata și mută fișa. Pentru mutarea fișei se refolosește logica din `requests/[id].js`, inclusiv anunțul din chatul „Achitări”. O factură achitată nu mai poate fi marcată a doua oară.
- [ ] Regula de etapă la marcare: fișa trece în „Plătit”, cu excepția cazului în care e deja în „Plătit” sau „Încheiat”. Atunci etapa rămâne cum e. În istoric, comentariul e „Factura LUX-… achitată”.
- [ ] Nu se adaugă nicio funcție Vercel: limita e 12 și e atinsă. Rutele noi intră în `api/admin/docs/[action].js`, ca acțiuni:
  - `POST invoice-create { request_id, service, qty, price, due_days }`
  - `GET invoice-open?id=`
  - `POST invoice-send { id }`
  - `POST invoice-paid { id }`
  - `POST invoice-pdf { id }`, care reface PDF-ul lipsă, cu același număr.
- [ ] La ștergerea clientului (`removeRequest`) se șterg și PDF-urile facturilor din Storage. Rândurile dispar singure, prin legătura cu fișa (`on delete cascade`).
- [ ] Migrare SQL în `supabase/migrations/2026-11-10-facturi.sql`, adăugată și în `schema.sql`. Proprietarul o rulează din SQL Editor.

### Bine de avut
- Când trimiterea a căzut pe proprietar, butonul se vede ca „Trimisă proprietarului” și se poate apăsa din nou.
- În fișă, sub listă, un rând cu totalul facturilor neachitate.

### Mai târziu
- O pagină „Setări firmă” în CRM, în locul variabilelor de mediu.
- PDF în rusă sau engleză, după limba clientului.
- Mai multe poziții pe o factură.
- Anularea sau corectarea unei facturi (factură de stornare) și anularea marcajului „Achitată”.
- Plată parțială pe o factură.
- Legătura facturilor cu ratele de încasat (`receivables`).
- Trimitere automată la emitere și memento-uri pentru facturile ajunse la scadență.

## Erori și cazuri limită
| Situație | Ce se întâmplă |
|---|---|
| Emitere automată, dar fișa nu are valoarea contractului (sau e 0) | Nu se emite nimic. Proprietarul primește pe Telegram: „Factura automată pentru <nume> nu s-a emis: lipsește valoarea contractului.” Etapa se schimbă oricum. |
| Emitere automată eșuată (baza sau PDF-ul) | Schimbarea etapei nu se strică: eroarea doar se scrie în log, ca la notificări (`notifySafely`). |
| PDF-ul nu s-a putut face sau urca după ce s-a dat numărul | Factura rămâne cu numărul ei și `pdf_path` gol. În listă apare „PDF lipsă” și butonul „Refă PDF-ul”. Numărul nu se pierde și nu se refolosește. |
| Dublu clic pe „Emite” | Butonul se blochează până vine răspunsul. Un clic în plus produce o factură în plus, care se vede în listă. Nu se șterge în prima versiune. |
| Dublu clic pe „Marchează achitată” | Serverul verifică statusul în aceeași operație: a doua cerere primește 409 `already_paid` și nu se adaugă a doua plată. |
| Două treceri simultane în „Procesat” | Indexul unic lasă o singură factură automată. A doua încercare e ignorată fără eroare. |
| Clientul a blocat botul sau Telegram dă eroare | Încearcă emailul, dacă există. Altfel PDF-ul merge la proprietar, cu motivul. |
| Lipsește `RESEND_API_KEY`, domeniul nu e verificat sau Resend dă eroare | PDF-ul merge la proprietar, cu motivul „emailul nu poate pleca”. |
| Clientul nu are nici Telegram, nici email | PDF-ul merge la proprietar. |
| Nici Telegramul proprietarului nu răspunde | Mesaj în panou: „Factura nu s-a putut trimite. Încercați din nou.” `sent_at` rămâne gol. |
| Valoarea contractului se schimbă după emitere | Facturile emise nu se schimbă. |
| Moneda fișei se schimbă după emitere | Factura își păstrează moneda de la emitere. |
| Angajatul cheamă o acțiune de factură | 403 `forbidden`. |

## Date și acces
Tabelul `invoices`, cu RLS pornit și fără politici, deci accesibil doar de pe server, ca restul tabelelor:
- `id`, `request_id` (legat de fișă, cu `on delete cascade`);
- `number` (text, unic), `year`, `seq`;
- `issued_at`, `due_date`;
- `currency`;
- `items` (jsonb: `[{ name, qty, unit_price, line_total }]`), `subtotal`, `vat_rate` (20), `vat`, `total`;
- `client` (jsonb, o copie a numelui, telefonului și emailului la momentul emiterii);
- `company` (jsonb, o copie a rechizitelor folosite), `is_test`;
- `auto` (bool);
- `status` (`neachitata` / `achitata`), `paid_on`, `payment_id`;
- `pdf_path`;
- `sent_via`, `sent_at`, `created_by`.

Index unic pe `(request_id) where auto`. Numărul vine dintr-un contor pe ani (`invoice_counters(year, last)`) și dintr-o funcție SQL care, într-o singură operație, mărește contorul și scrie factura. Marcarea ca achitată e tot o funcție SQL, în care schimbarea statusului și plata se fac împreună sau deloc. Funcțiile se pot chema doar de pe server (cu cheia `service_role`), ca `pay_installment`.

Datele personale sunt numele, telefonul și emailul clientului: le vede doar proprietarul. PDF-urile stau în bucketul privat, iar browserul primește doar linkuri temporare.

## Servicii externe
- **Supabase** (baza și Storage). Dacă nu răspunde, panoul arată eroarea, iar emiterea automată e sărită și scrisă în log.
- **Telegram Bot API** (`sendDocument`, trimis ca `multipart/form-data`): la client și, de rezervă, la proprietar.
- **Resend** (email cu PDF-ul atașat în base64). La clienți merge abia după verificarea domeniului lh47arch.com. Până atunci intră în acțiune rezerva prin proprietar.

## Nu intră în prima versiune
Anularea sau ștergerea facturilor, facturile de corectare, mai multe poziții, PDF în alte limbi, setările firmei din CRM, plățile parțiale pe o factură, trimiterea automată, memento-urile, legătura cu ratele de încasat, facturile în Mini App, rapoartele pe facturi și verificarea domeniului în Resend (o face proprietarul, separat).

## De lămurit la implementare
- **Cum se face PDF-ul:** proiectul nu are `package.json`. Variante:
  - adăugăm `package.json` cu o bibliotecă PDF (de exemplu `pdf-lib` și un font TTF cu diacritice pus în `api/_lib/`); Vercel o instalează singur;
  - scriem PDF-ul de mână, fără biblioteci.
  De ales varianta care se termină sigur până pe 11.11. Trebuie verificat că funcția intră în limita de mărime și că se încadrează în `maxDuration: 60` din `docs/[action].js`.
- **Afișarea secțiunii „Facturi”:** în `admin.js` și în stilurile panoului. Trebuie să meargă fără scroll orizontal la lățimea de 375px.
- **Rechizitele reale:** proprietarul pune variabilele `COMPANY_*` în Vercel. Până atunci facturile ies marcate ca test.
