# Mini App Telegram pentru clienți: cerere care intră direct în CRM

> **Stare: confirmată de utilizator pe 2026-11-02 și implementată.**

## Pe scurt
Un bot Telegram nou, separat de @luxarch_crm_bot, deschide o pagină cu o singură cerere. Clientul alege un serviciu, dă telefonul, poate scrie un mesaj, bifează acordul și trimite. Cererea apare în CRM în etapa „Nouă”, cu sursa „Telegram” și cu numele luat din Telegram, iar proprietarul primește anunț.

Botul CRM al echipei și panoul `/admin` rămân neschimbate. Nu se adaugă funcții Vercel: rămânem la 12 din 12.

## Pentru cine e
- **Clientul:** oricine are Telegram. Nu are cont și nu vede alte date din CRM.
- **Proprietarul și angajații:** văd cererea în CRM, ca pe celelalte. Dacă deschid botul de clienți, sunt tratați tot drept clienți, fără niciun drept în plus.

Presupunere de volum: zeci de cereri pe lună, deci nu e nevoie de măsuri speciale de performanță.

## Pașii principali

### Pregătirea, o singură dată
**Ordinea contează:** întâi migrarea, apoi botul și tokenul, apoi publicarea codului. Butonul de pe site are nevoie de username-ul botului.

1. Utilizatorul rulează din clipboard migrarea `supabase/migrations/2026-11-02-tg-clienti.sql` (vezi „Date și drepturi de acces”).
2. La **@BotFather**, `/newbot`:
   - numele afișat: `LUXARCH`;
   - username-ul: de exemplu `luxarch_bot`, iar dacă e ocupat, altul care se termină în `bot`. Nu conține „crm”.
3. BotFather trimite tokenul. Utilizatorul îl copiază, nu îl scrie în chat, iar tokenul ajunge în Vercel din clipboard ca `TELEGRAM_CLIENT_BOT_TOKEN`. Urmează o republicare (Redeploy), fără de care variabila nu are efect.
4. În @BotFather, `/mybots` → botul nou → **Bot Settings**:
   - **Menu Button**: adresa `https://luxarch.vercel.app/tg-client`, textul `Cerere`;
   - **Description** (textul afișat înainte de Start), de exemplu: „Trimite o cerere către biroul de arhitectură LUXARCH: apasă butonul «Cerere». Mesajele scrise aici nu sunt citite. Pentru întrebări: WhatsApp +373 68 133 945.”;
   - **About**: o frază scurtă despre LUXARCH.
5. Tot în @BotFather se configurează **Main Mini App** cu aceeași adresă. Fără ea, linkul direct `https://t.me/<username>?startapp` nu deschide aplicația. Denumirile din meniu pot diferi puțin între versiunile BotFather.
6. În `index.html` se pune username-ul real în linkul de la „Scrie-ne pe Telegram”.

**Botul nu are webhook** (adresa la care Telegram trimite mesajele primite de bot). La Start nu răspunde nimic, iar mesajele scrise în chat nu ajung la nimeni. De aceea descrierea de la pasul 4 spune asta clar.

### Clientul trimite o cerere
1. Clientul apasă pe site „Scrie-ne pe Telegram” sau un link primit și ajunge la bot sau direct în aplicație. Din chatul botului, apasă butonul de meniu „Cerere”.
2. Se deschide `/tg-client`, în limba Telegramului lui. Pe un singur ecran vede, de sus în jos:
   - titlul și numele lui din Telegram, needitabil;
   - cele 6 servicii, de apăsat, fără prețuri;
   - butonul „Trimite numărul meu” și, sub el, câmpul de telefon scris de mână;
   - mesajul opțional;
   - bifa de acord, nebifată, cu link spre politica de confidențialitate;
   - butonul „Trimite”;
   - comutatorul RO / RU / EN, sus.
3. Clientul completează și apasă „Trimite”.
4. Vede confirmarea: „Mulțumim, <prenume>! Am primit cererea și te contactăm în curând.” și butonul „Închide”.
5. În CRM apare cererea în etapa „Nouă”, iar în chatul principal apare anunțul.

## Ce trebuie să funcționeze

### Obligatoriu în prima versiune

**Pagina**
- [ ] `/tg-client` e o pagină proprie (`tg-client.html` și `tg-client.js`), care nu încarcă `admin.js` și nu cheamă nicio rută `/api/admin/*`.
- [ ] Serviciile sunt exact cele din `SERVICES` (`arh_rez`, `arh`, `rez`, `design`, `management`, `nu_stiu`), cu textele din `f.s1`–`f.s6` din `i18n.js` pentru RU și EN. Niciun preț, nimic din tabelul `products`.
- [ ] La început niciun serviciu nu e ales, iar alegerea unuia e obligatorie. Se poate alege un singur serviciu.
- [ ] Limba inițială vine din `language_code`: `ro`, `ru`, `en`, iar orice altceva → EN. Comutatorul schimbă textele pe loc, fără să șteargă ce s-a completat. Limba afișată la trimitere se salvează în `requests.lang`.
- [ ] Pe telefon: `ready()` și `expand()`, zonele sigure respectate, culorile LUXARCH, cu antetul și fundalul Telegram potrivite.
- [ ] Fără derulare orizontală la 375px și 320px, în toate cele trei limbi. Butoanele au cel puțin 44×44px, iar câmpurile au `font-size` de cel puțin 16px.
- [ ] `vercel.json`: `/tg-client` primește `X-Robots-Tag: noindex, nofollow` și `Cache-Control: no-store`, fără `X-Frame-Options` sau `frame-ancestors` (Telegram Web și Desktop deschid aplicația într-un iframe).

**Telefonul**
- [ ] „Trimite numărul meu” apelează `requestContact`, doar dacă Telegramul îl suportă (`isVersionAtLeast('6.9')`). Altfel butonul e ascuns.
- [ ] Dacă numărul sosește, câmpul se completează cu el și rămâne editabil.
- [ ] Dacă omul refuză sau numărul nu sosește în cele 3 secunde ale scriptului Telegram, câmpul rămâne gol și primește focus, cu textul „Scrie numărul aici”. Fereastra nu se mai deschide singură.
- [ ] Telefonul e obligatoriu: maximum 30 de caractere și cel puțin 6 cifre după normalizare (ca `viz.normPhone`). Regula `requests_phone_or_email` nu se schimbă.
- [ ] **Serverul consideră un număr confirmat doar dacă poate dovedi asta.** Toate condițiile trebuie îndeplinite:
  1. `contact_raw` (textul brut al răspunsului Telegram) are semnătura validă, verificată cu `TELEGRAM_CLIENT_BOT_TOKEN`;
  2. `auth_date` din el are cel mult 24 de ore;
  3. `contact.user_id` e egal cu `user.id` din `initData` verificat;
  4. cifrele din `contact.phone_number` sunt aceleași cu cifrele din `phone` trimis.
- [ ] Dacă orice condiție pică, inclusiv când `contact_raw` lipsește, numărul se tratează ca **scris de mână**: cererea nu e refuzată, iar în jurnal nu se scrie numărul. `responseUnsafe` nu ajunge niciodată la server ca dovadă.
- [ ] Anunțul scrie „(confirmat de Telegram)” doar la un număr dovedit, altfel „(scris de client)”. Această informație nu se salvează în baza de date.

**Ruta `POST /api/contact?action=tg-request`**
- [ ] Antet: `X-Telegram-Init-Data`. Corp: `{ service, phone, contact_raw?, message?, lang, consent }`.
- [ ] `initData` se verifică cu `verifyInitData(raw, TELEGRAM_CLIENT_BOT_TOKEN)`. Numele, @username-ul și ID-ul vin doar de aici. Dacă apar în corp `name`, `tg_user_id` sau `created_by`, se ignoră.
- [ ] Validare: `service` din `SERVICES`, telefon valid, `message` de maximum 3000 de caractere, `lang` din `ro/ru/en` (altfel `ro`), `consent === true`. O eroare întoarce 400 `{ error: 'invalid', fields: [...] }`.
- [ ] Limită: 5 cereri pe oră pe ID, cu cheia `tg-request:<id>` în `rate.js`. Se numără doar cererile valide. Peste limită: 429 `{ error: 'rate' }`.
- [ ] Răspunsul reușit este `{ ok: true, appended: true|false }`, fără alte date din CRM. Ruta are `Cache-Control: no-store`.
- [ ] Acțiunea se tratează în `handler` înainte de `vizHandler`, care respinge acțiunile necunoscute, și nu depinde de `vizEnabled()`.
- [ ] Numărul de funcții din `api/` rămâne 12.

**Cererea în CRM**
- [ ] Cerere nouă, cu aceste valori:
  - `name`: prenume + nume din Telegram, maximum 100 de caractere;
  - `phone`, `service`, `message`, `lang`: din formular;
  - `email`: `''` și `type`: `''` (coloanele nu acceptă lipsa valorii și nu au valoare implicită);
  - `status`: `noua`, `source`: `telegram`, `channel`: `''`;
  - `tg_user_id`: ID-ul;
  - `created_by` și `status_actor`: „@username”, iar fără username, numele.
- [ ] **Cerere repetată:** dacă același `tg_user_id` are deja o cerere în etapa `noua`, nu se creează un card nou. La `message` se adaugă, cu data în ora Chișinăului, serviciul, mesajul și telefonul, dacă diferă. Numele, telefonul și serviciul din cerere nu se suprascriu. În orice altă etapă se creează o cerere nouă.
- [ ] Pe tablă și în listă apare eticheta „Telegram”, fără canal, deci se deosebește de „Telegram · Apel” (client adăugat de echipă).
- [ ] Pe fișă, când `tg_user_id` există:
  - scrie „Cerere de la client: @username” în loc de „Adăugat de”;
  - @username e link spre `https://t.me/<username>` (doar dacă are forma corectă);
  - apare și limba cererii, ca la sursa `site`.

**Anunțurile**
- [ ] Prin `sendTelegram` (botul vechi), în chatul principal: „🏠 Cerere nouă din Telegram” sau „✏️ Completare la o cerere din Telegram”, cu numele, @username-ul, telefonul și mențiunea lui, serviciul, mesajul, limba, ora și linkul spre fișă. Tot ce vine de la client trece prin `esc`.
- [ ] Dacă e configurat, se trimite și emailul către proprietar, ca la cererile de pe site.
- [ ] Un anunț eșuat nu pierde cererea și nu schimbă răspunsul pentru client (se scrie în jurnal).
- [ ] Botul de clienți nu trimite mesaje clientului.

**Site și confidențialitate**
- [ ] În `index.html`, secțiunea de contact, sub rândul WhatsApp: rândul „Telegram” cu linkul „Scrie-ne pe Telegram” spre `https://t.me/<username>?startapp`, cu cheia nouă `c.tg` în RU și EN în `i18n.js`. Fără derulare orizontală la 375px.
- [ ] Linkul direct se poate trimite oricui și deschide aplicația.
- [ ] Bifa de acord e obligatorie, ca pe site, și nu se salvează, tot ca pe site. Linkul se deschide cu `Telegram.WebApp.openLink`, ca formularul să nu se piardă.
- [ ] `confidentialitate.html`, în RO, RU și EN:
  - la „Ce date”: pentru cererile din Telegram, numele, @username-ul, ID-ul Telegram și telefonul;
  - la „Unde ajung”: Telegram nu mai e doar notificarea către noi, ci și aplicația prin care se trimite cererea.

### De dorit
- [ ] O vibrație scurtă la trimitere (`HapticFeedback`).
- [ ] Butonul principal al Telegramului (`MainButton`) în locul butonului „Trimite” din pagină, dacă se vede mai bine pe telefon.

### Mai târziu
- Un mesaj de la bot către client după trimitere (cere încă o permisiune, `requestWriteAccess`).
- Webhook și răspuns la Start sau la mesajele din chat.
- Cod QR pentru materiale tipărite și urmărirea de unde vine clientul (`startapp=<sursă>`).
- Păstrarea textului scris după închiderea aplicației.
- Salvarea datei acordului în baza de date.
- Catalog cu descrieri sau prețuri, istoricul cererilor și contul clientului.

## Erori și cazuri limită

| Situația | Ce se întâmplă |
|---|---|
| `/tg-client` deschis în browser obișnuit (`initData` gol) | Ecranul „Deschide în Telegram”, cu linkul direct. Formularul nu apare. |
| Lipsește `TELEGRAM_CLIENT_BOT_TOKEN` sau e identic cu `TELEGRAM_APP_BOT_TOKEN` | 503 `{ error: 'tg_client_off' }`. Mesajul „Momentan nu putem primi cereri aici” și linkul WhatsApp. Nu se salvează nimic. |
| `initData` fals sau `initData` din botul CRM | 401 `{ error: 'tg_bad' }`, fără nicio salvare. Mesajul: „Închide aplicația și deschide-o din nou.” |
| `initData` mai vechi de 24 de ore | 401 `{ error: 'tg_expired' }`. Mesajul: „Sesiunea a expirat. Închide aplicația și deschide-o din nou.” Textul rămâne pe ecran, ca omul să-l poată copia. |
| Câmp lipsă sau greșit | Mesaj lângă câmp, în limba aleasă. Ce s-a completat rămâne. |
| Dublu clic pe „Trimite” | Butonul e dezactivat până vine răspunsul. |
| Peste 5 cereri pe oră | Mesajul „Ai trimis mai multe cereri. Încearcă peste o oră sau scrie-ne pe WhatsApp”. Textul rămâne. |
| Baza de date nu răspunde sau migrarea lipsește | Ca la `contact.js`: cererea pleacă pe Telegram cu avertismentul „NU a fost salvată în panou”, iar clientul vede confirmarea. |
| Nici baza, nici Telegram nu răspund | 502, mesaj de eroare, link WhatsApp. Textul rămâne. |
| Fără internet | Mesajul „Verifică internetul și încearcă din nou”. Textul rămâne. |
| Nume cu emoji, HTML sau poreclă | Se salvează curățat de caractere de control și scurtat. Se afișează escapat. Echipa îl vede așa cum e în Telegram. |
| Client fără @username | `created_by` e numele, fără link. Echipa folosește telefonul, care e obligatoriu. |
| Clientul scrie în chatul botului | Nu răspunde nimeni, iar mesajul nu e citit. Descrierea botului spune asta. |
| Clientul apasă „Trimite numărul” | Telegram pune contactul și în chatul cu botul. Nu citim chatul. |
| Telegramul nu oferă `requestContact` | Rămâne câmpul scris de mână. |

## Date și drepturi de acces
- **Migrare nouă** `supabase/migrations/2026-11-02-tg-clienti.sql`, adăugată identic și în `supabase/schema.sql`:
  - coloana `requests.tg_user_id bigint` (poate fi goală);
  - un index pe ea, pentru căutarea cererii din etapa „Nouă”.
  Nu se schimbă regula `requests_phone_or_email` și nici lista de surse.
- **Variabilă nouă în Vercel:** `TELEGRAM_CLIENT_BOT_TOKEN`.
- **Date personale salvate:** numele, @username-ul, ID-ul Telegram, telefonul, serviciul, mesajul și limba. Se păstrează la fel ca celelalte cereri, până la cererea de ștergere.
- **Cine le vede:** proprietarul și angajații, în CRM, ca pe orice client, și participanții la chatul principal de notificări.
- **Clientul** nu citește nimic din CRM: ruta lui doar primește o cerere. Nu vede nici măcar cererea anterioară, deși textul nou se adaugă la ea.
- **Separarea de panou:** tokenul diferit face ca `initData` de client să primească 401 pe `/api/admin/*`, iar `initData` din botul CRM să primească 401 pe `tg-request`. `requireAdmin` și `telegramRole` nu se modifică și nu apare rolul „client”.

### Verificări de securitate
- [ ] `initData` din botul de clienți la `GET /api/admin/requests?me=1` → 401, fără date.
- [ ] `initData` din botul CRM la `tg-request` → 401, nimic salvat.
- [ ] Un proprietar din `TG_OWNER_IDS` care deschide botul de clienți nu primește niciun drept de admin.
- [ ] Un `name` sau `tg_user_id` trimis în corp nu ajunge în baza de date.
- [ ] Un `contact_raw` modificat, sau al altui utilizator Telegram, nu produce mențiunea „(confirmat de Telegram)”.
- [ ] Ecranul cu ID-ul și „Copiază ID-ul” din botul CRM funcționează ca înainte.
- [ ] `/admin` în browser arată ecranul cu parolă.

## Servicii externe
- **Telegram (botul de clienți):** butonul de meniu, semnătura `initData` și `requestContact`. Serverul nu cheamă API-ul Telegram, verificarea e locală. Dacă Telegram nu merge, aplicația nu se deschide, iar pe site rămân formularul și WhatsApp.
- **Telegram (botul vechi):** anunțurile. Dacă nu merge, cererea rămâne salvată în CRM.
- **Supabase:** dacă nu merge, cererea pleacă pe Telegram, ca la formularul de pe site.
- **Resend:** opțional, ca acum.

## Ce nu intră în această sarcină
- Orice modificare a botului CRM sau a drepturilor echipei.
- Funcții Vercel noi sau upgrade la Vercel Pro.
- Webhook, comenzi în chat, mesaje de la bot către client.
- Prețuri și tabelul `products` pentru clienți.
- Cont de client, istoric, statusul cererii.
- Slăbirea regulii `requests_phone_or_email`.

## Întrebări rămase (le rezolvă programatorul)
- **Verificarea semnăturii lui `contact_raw`.** Documentația oficială spune doar că `requestContact` întoarce da/nu. Răspunsul cu contactul apare în codul `telegram-web-app.js`, iar SDK-ul tma.js arată un text semnat de forma `contact=...&auth_date=...&hash=...`. Formula exactă nu e confirmată oficial. Se testează cu un răspuns real: dacă formula de la `initData` nu îl validează, **nu se caută o ocolire**. Toate numerele rămân „(scris de client)”, cererea funcționează oricum, iar butonul doar completează câmpul. `verifyInitData` cere `user`, deci contactul are nevoie de o verificare proprie.
- **`requestContact` pe iOS, Android, Desktop și Web:** de testat pe toate. Câmpul scris de mână acoperă orice lipsă.
- **Forma numărului de la Telegram:** poate veni fără `+`. Se salvează cu `+` în față când e dovedit.
- **Limba politicii de confidențialitate:** de verificat dacă `confidentialitate.html` poate fi deschisă direct în limba aleasă.
- **Refolosirea codului:** `tgName` nu e exportat din `auth.js`, iar `i18n.js` are textele RU și EN, dar RO stă în HTML. Pagina nouă are nevoie de propriile texte RO, plus cele noi în toate limbile.
