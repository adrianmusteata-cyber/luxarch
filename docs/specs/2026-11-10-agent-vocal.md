# Agent vocal AI pe site (ElevenLabs Agents)

## Pe scurt
Pe pagina principală apare un buton plutitor „Vorbește”. Vizitatorul vorbește cu un agent vocal ElevenLabs care răspunde despre LUXARCH doar din conținutul site-ului, derulează pagina la secțiunea cerută și, la final, lasă o cerere în CRM (sursa „Voce”) cu nume, telefon și un rezumat. Termen: 11.11.2026, 23:59.

## Pornim de la
- Site static (`index.html`, `script.js`, `i18n.js`), fără CSP: scriptul widgetului se poate încărca fără modificări în `vercel.json`.
- Funcțiile Vercel sunt 12/12: **nu se adaugă funcție nouă**. Webhook-ul intră în `api/contact.js` ca `?action=voice-lead`, lângă `tg-request`.
- Limba vizitatorului: `localStorage['temelia-lang']` (`ro` / `ru` / `en`), schimbată de `setLang()` din `script.js`.
- Cheia `ELEVENLABS_API_KEY` e deja în Vercel (drept Write pe ElevenAgents).

## Utilizatori
- **Vizitatorul site-ului** (RO / RU / EN): întreabă, cere să i se arate secțiuni, lasă cererea.
- **Proprietarul / echipa**: primește anunțul pe Telegram și vede cererea în CRM cu sursa „Voce”.

## Scenariul principal
1. Vizitatorul deschide pagina principală și vede butonul plutitor „Vorbește” (textul e în limba site-ului).
2. Apasă butonul, iar browserul cere acces la microfon. Agentul salută în limba din `temelia-lang`.
3. Vizitatorul întreabă („ce servicii aveți?”, „cât costă?”), iar agentul răspunde din baza de cunoștințe.
4. Vizitatorul spune „arată lucrările”. Agentul cheamă unealta `navigate` cu `section: "proiecte"`, pagina derulează la `#proiecte`, iar agentul spune ce se vede acolo. Convorbirea continuă.
5. Vizitatorul vrea o ofertă. Agentul cere numele, telefonul, repetă telefonul pentru confirmare și cere acordul pentru folosirea datelor.
6. După acord, agentul cheamă unealta `save_lead`. Serverul salvează cererea și trimite anunțul pe Telegram, iar agentul confirmă: „Vă contactăm în maximum 48 de ore”.
7. Convorbirea se încheie singură după cel mult 5 minute.

## Ce trebuie să funcționeze
### Obligatoriu în prima versiune

**A. Agentul în ElevenLabs: scriptul `scripts/elevenlabs-agent.js`**
- [ ] Rulat local cu `node scripts/elevenlabs-agent.js`. Citește `ELEVENLABS_API_KEY`, `ELEVENLABS_WEBHOOK_SECRET` și `SITE_URL` (implicit `https://luxarch.vercel.app`).
- [ ] **Idempotent:** caută agentul după nume (`LUXARCH — agent vocal`). Dacă există, îl actualizează (PATCH). Dacă nu, îl creează. Același lucru face cu uneltele: le caută după nume, le actualizează sau le creează. Rulat de două ori, scriptul nu creează dubluri.
- [ ] La final afișează `agent_id`, care se scrie în `index.html` (agent_id e public, nu e secret).
- [ ] Setări puse prin API:
  - `max_duration_seconds = 300`;
  - limba implicită `ro`, plus limbile suplimentare `ru` și `en`, cu detectarea și schimbarea automată a limbii pornite;
  - voce feminină, calmă, din biblioteca ElevenLabs, cu un model multilingv (`voice_id` stă într-o constantă la începutul scriptului);
  - mesajul de salut în cele 3 limbi;
  - suprascrierea limbii și a primului mesaj din widget e permisă;
  - agentul e public (fără autentificare), iar lista de domenii permise conține `luxarch.vercel.app` și `localhost:3000`.
- [ ] **Promptul de sistem** (în script, în engleză, cu instrucțiunea de a răspunde în limba vizitatorului) conține baza de cunoștințe extrasă din site:
  - **servicii:** cele 4, cu punctele lor: arhitectură, rezistență, design interior, management de proiect;
  - **fapte:** arhitect și inginer în aceeași echipă, Moldova și România, drept de semnătură în România (OAR), ofertă în maximum 48 de ore, prima discuție gratuită, răspuns în aceeași zi lucrătoare;
  - **procesul în 5 pași:** discuția inițială, concept, autorizare (MD: certificat de urbanism și documentație pentru autorizare; RO: CU, DTAC, AC), proiect de execuție, pe șantier;
  - **cele 10 proiecte**, cu tipul și anul lor;
  - **contacte:** +373 68 133 945 (telefon și WhatsApp), Telegram @luxarch_client_bot, adrian.musteata@lh47arch.com, Str. Eugen Doga 2, Chișinău;
  - **răspunsurile din FAQ.**
- [ ] Reguli în prompt:
  - **prețuri:** nicio cifră. Prețul depinde de suprafață, complexitate și faze, oferta defalcată vine în 48 de ore, apoi agentul propune să lase o cerere;
  - **program:** „răspundem în aceeași zi lucrătoare”, fără ore inventate;
  - nu inventează nimic din afara bazei de cunoștințe. Dacă nu știe, propune o cerere sau un apel;
  - întrebările din afara subiectului primesc un refuz politicos, apoi agentul revine la proiectul vizitatorului;
  - cere acordul pentru date înainte de `save_lead` și nu cheamă unealta fără acord explicit.

**B. Unealta de navigare din browser (client tool `navigate`)**
- [ ] Parametru: `section`, cu una din valorile `top`, `manifest`, `servicii`, `proiecte`, `proces`, `vizualizare`, `intrebari`, `contact` (8 ancore; cerința cere minimum 4).
- [ ] Promptul explică sinonimele: „prețuri” = `intrebari` (FAQ-ul „Cât costă un proiect?”) sau `contact` pentru ofertă; „lucrări” / „portofoliu” = `proiecte`; „contacte” / „adresă” = `contact`; „cum lucrați” = `proces`.
- [ ] Unealta e definită în `script.js`, în handlerul evenimentului widgetului `elevenlabs-convai:call` (`event.detail.config.clientTools = { navigate }`). Derulează lin cu `scrollIntoView` la `#<section>` (sau prin ScrollTrigger dacă `#proiecte`, care e fixat la derulare, o cere), închide meniul burger dacă e deschis și **nu reîncarcă pagina**.
- [ ] Unealta întoarce textul `"ok: <section>"`, iar agentul descrie pe scurt ce se vede.
- [ ] Secțiune necunoscută sau element inexistent în pagină: întoarce `"not_found"`, nu derulează nimic, iar agentul spune că pe site nu există o astfel de secțiune și propune una apropiată.
- [ ] După navigare convorbirea continuă: widgetul rămâne deschis, iar microfonul nu se oprește.

**C. Butonul și widgetul pe pagina principală**
- [ ] Doar `index.html` primește `<elevenlabs-convai agent-id="...">` și scriptul `@elevenlabs/convai-widget-embed`, încărcat `async`. Alte pagini nu.
- [ ] Butonul e plutitor, în colțul din dreapta jos, cu textul „Vorbește” / „Поговорить” / „Talk”, după limba site-ului.
- [ ] Limba widgetului vine din `temelia-lang` (prin atributul de suprascriere a limbii). Dacă vizitatorul schimbă limba site-ului, se actualizează și atributul (pentru convorbirea următoare).
- [ ] Pe ecran de 375 px butonul nu acoperă butoanele formularelor și nu provoacă scroll orizontal.

**D. Webhook-ul pentru cerere: `POST /api/contact?action=voice-lead` (server tool `save_lead`)**
- [ ] Antetul `X-Webhook-Secret` trebuie să fie egal cu `ELEVENLABS_WEBHOOK_SECRET`. Comparația se face în timp constant (`crypto.timingSafeEqual`). Dacă lipsește sau e greșit: 401, fără să se salveze nimic. Dacă variabila nu e setată în Vercel: 503 `voice_off`.
- [ ] Corpul cererii:
  - `name`: obligatoriu, maximum 100 de caractere;
  - `phone`: obligatoriu, cel puțin 6 cifre după `viz.normPhone`, maximum 30 de caractere;
  - `summary`: obligatoriu, maximum 1000 de caractere;
  - `lang`: `ro`, `ru` sau `en`;
  - `service`: opțional, cheie din `SERVICES` (implicit `nu_stiu`);
  - `type`: opțional, cheie din `TYPES` (implicit `altceva`);
  - `consent`: obligatoriu `true`.
  Textele trec prin `cleanText`, deja existent.
- [ ] Rândul salvat în `requests`: `name`, `phone`, `email: ''`, `type`, `service`, `message: "Convorbire vocală. Rezumat: <summary>"`, `lang`, `status: 'noua'`, `source: 'voce'`, `created_by: 'Agent vocal'`.
- [ ] Limite (cu `countHits` / `addHit`):
  - **5 pe oră pentru același telefon** și **30 pe zi pentru tot site-ul**. Peste limită: 429, iar agentul spune să sune la telefonul biroului;
  - limita pe IP **nu** se folosește, pentru că serverul nostru primește cererea de la ElevenLabs, nu de la vizitator: toate cererile ar avea același IP. Locul ei îl iau secretul, limita pe telefon și plafonul zilnic.
- [ ] Dubluri: dacă există deja o cerere `voce` cu același telefon creată în ultimele 10 minute, nu se creează alta. Răspunsul e `ok: true`, iar Telegram nu mai primește încă un anunț.
- [ ] Anunțul pe Telegram are forma celui de la formular, cu eticheta „🎙 Voce”: nume, telefon, serviciu, rezumat, limbă, ora (ora Moldovei). Se adaugă funcția `voiceText()` în `api/_lib/notify.js`. Emailul nu se trimite.
- [ ] Răspunsurile sunt scurte, ca agentul să le poată rosti: `{ ok: true }` sau `{ ok: false, error: "invalid" | "rate" | "save" }`, plus `fields` la erorile de validare.

**E. CRM**
- [ ] Sursa nouă `voce` cu eticheta „Voce” se adaugă în `SOURCES` din `api/_lib/labels.js` și în `SOURCES` din `admin.js`.
- [ ] Corectura cerută: se adaugă în `admin.js` și sursa lipsă `vizualizare: 'Site, vizualizare'`.
- [ ] Migrarea se pune la sfârșitul `supabase/schema.sql`, iar utilizatorul o rulează din clipboard:
  ```sql
  alter table public.requests drop constraint if exists requests_source_check;
  alter table public.requests add constraint requests_source_check
    check (source in ('site','manual','carte_vizita','chestionar','document','telegram','vizualizare','voce'));
  ```
- [ ] Fișa cererii afișează limba și pentru `source === 'voce'`.

**F. Configurare**
- [ ] `ELEVENLABS_WEBHOOK_SECRET` (aleator, 32+ caractere) se pune în Vercel, în toate mediile, prin API.
- [ ] Limita de cheltuieli a contului ElevenLabs o pune **utilizatorul** din panoul ElevenLabs. Specificația notează asta doar ca pas manual.
- [ ] Comentariul din antetul `api/contact.js` descrie ruta nouă.

### Ar fi bine să fie
- Agentul închide singur convorbirea după ce a confirmat cererea (unealta de sistem `end_call`).
- Datele vizitatorului rămân completate dacă acesta revine pe pagină după o eroare.

### Mai târziu
- Butonul pe alte pagini.
- Prețuri orientative și program afișate pe site.
- Transcrierea completă a convorbirii pe fișa clientului (prin webhook-ul post-call al ElevenLabs).
- Statistici: câte convorbiri au ajuns cereri.

## Erori și cazuri-limită
- **Microfonul e refuzat:** widgetul afișează mesajul lui. Pe site rămân formularul și numărul de telefon, nu e nevoie de altceva.
- **Scriptul widgetului nu se încarcă** (rețea, blocator de reclame): butonul nu apare, iar pagina merge normal, fără erori în consolă care să strice `script.js`.
- **Secțiunea nu există:** `not_found`, nicio derulare, agentul spune asta.
- **Telefon invalid** (mai puțin de 6 cifre): 400 `fields:['phone']`, iar agentul îl roagă să repete numărul.
- **Vizitatorul refuză acordul:** agentul nu cheamă `save_lead` și îi dă telefonul biroului.
- **Baza de date nu răspunde:** cererea pleacă totuși pe Telegram cu „⚠️ Cererea NU a fost salvată în panou”, iar răspunsul e `ok: true`. Dacă nici Telegram nu merge: 502 `save`, iar agentul îi dă telefonul și WhatsApp-ul.
- **Telegram cade după o salvare reușită:** se notează doar în jurnal, iar vizitatorul primește confirmarea.
- **Webhook-ul e chemat de două ori** (agentul repetă apelul): regula de 10 minute oprește dublura.
- **Convorbirea atinge 5 minute:** ElevenLabs o închide. Dacă cererea nu a fost trimisă, ea nu există. Promptul îi cere agentului să ceară datele din timp.
- **Cineva trimite direct la adresa webhook-ului fără secret:** 401.
- **Limba se schimbă în timpul convorbirii:** agentul trece singur pe limba vizitatorului, iar `lang` din cerere e limba în care s-a încheiat discuția.

## Date și drepturi de acces
- **Ce se salvează:** nume, telefon, rezumatul și limba (date personale), în tabelul existent `requests`, cu aceleași drepturi ca celelalte cereri: doar panoul admin, cu cheia service role.
- **Pe partea ElevenLabs:** convorbirea (audio și transcriere) rămâne în contul ElevenLabs, după setările lor de păstrare a datelor.
- **Acordul:** agentul îl cere verbal, iar `consent: true` e obligatoriu în webhook. În `confidentialitate.html` se adaugă o frază: convorbirea vocală e procesată de ElevenLabs.
- **Secrete:** `ELEVENLABS_API_KEY` și `ELEVENLABS_WEBHOOK_SECRET` stau doar pe server și în script, niciodată în HTML. `agent_id` e public.

## Servicii externe
- **ElevenLabs Agents:** widgetul, vocea și modelul de limbaj. Dacă nu răspunde, butonul nu merge, iar site-ul și formularele funcționează normal.
- **Supabase:** CRM-ul. Dacă cade, rezerva e Telegram (vezi mai sus).
- **Telegram:** anunțul pentru proprietar. Dacă cade, se notează doar în jurnal.

## Ce nu intră
- Funcție Vercel nouă.
- Apeluri telefonice reale.
- Programarea întâlnirilor.
- Trimiterea pe email.
- Butonul pe alte pagini.
- Prețuri sau program inventate.

## Întrebări deschise pentru implementare
- Forma exactă din API-ul ElevenLabs, de verificat în documentația curentă înainte de cod: uneltele sunt resurse separate (`/v1/convai/tools`, legate prin `tool_ids`) sau stau direct în `prompt.tools`; numele câmpurilor pentru limbile suplimentare și pentru suprascrieri (`platform_settings.overrides`). Comportamentul cerut nu se schimbă, doar forma cererilor din script.
- Alegerea concretă a `voice_id`: o voce feminină, calmă, care sună natural în RO, RU și EN. Implementatorul o ascultă în bibliotecă înainte să o fixeze.
- Dacă derularea la `#proiecte` (fixat cu ScrollTrigger) cu `scrollIntoView` ajunge exact la începutul secțiunii. Dacă nu, se derulează prin `ScrollTrigger` / poziția calculată.
