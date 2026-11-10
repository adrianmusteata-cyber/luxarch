/* Recunoașterea documentelor prin Claude: cărți de vizită și chestionare → CRM, avize și chitanțe → cheltuieli,
   facturi / contracte → scadențe, liste de prețuri → catalog.
   POST /api/admin/docs/upload { files: [{ page, mime, size }] } → { token, uploads: [{ page, url }] }
        — linkuri semnate; browserul urcă fișierele direct în Storage, în tmp/<token>/
   POST /api/admin/docs/read   { token, doc_type? } → { doc_type, supported, fields, duplicates }
        — Claude stabilește tipul (sau îl primește forțat) și citește câmpurile.
          La lista de prețuri, fields.rows sunt deja comparate cu catalogul furnizorului (status, match_product_id…).
          413 too_long / 504 timeout: lista nu încape într-o citire (vezi MAX_TOKENS în _lib/claude.js)
   POST /api/admin/docs/save   { token, doc_type, fields, force? } → { id } sau 409 { duplicates }
        — lista de prețuri: fields = { supplier: { id } | { name, idno }, list_date, currency, note,
          rows: [{ include, code, name, unit, price, resolve: '' | 'new' | <product_id> }] } → { id: furnizorul, list_id, summary }
   POST /api/admin/docs/cancel { token } — șterge fișierele temporare
   GET  /api/admin/docs/open?id=<document> → { url } — link de citire valabil 5 minute
   Angajatul (Mini App Telegram): citește și salvează doar cărți de vizită, chestionare, avize și chitanțe.
   Celelalte tipuri → { supported: false, reason: 'owner_only' } la read (fără citire dacă tipul e ales de el)
   și 403 owner_only la save; duplicatele cheltuielilor vin fără sumă și fără id; open doar pentru documentele clienților.
   Din Telegram, clientul creat dintr-un document primește created_by (autorul din initData verificat).
   Vizualizare proiect (schiță cu Cloudflare Workers AI sau Gemini, vezi _lib/imagegen.js), pentru proprietar și angajat, în browser și în Mini App:
   POST /api/admin/docs/viz-upload   { files: [{ page, mime, size }], request_id?, kind? } → { token, uploads }
        — rezervă o generare (5 pe zi de om: tg:<id> sau „owner” din browser) și dă linkurile spre tmp/<token>/
   POST /api/admin/docs/viz-generate { token, kind, wishes } → { id, url, model } (link de 5 minute)
        — 504 timeout / 502 service: se poate încerca din nou cu același token cât rezervarea e valabilă (15 minute)
   POST /api/admin/docs/viz-cancel   { token } — renunțarea înainte de generare: pozele se șterg, rezervarea nu se mai numără
   GET  /api/admin/docs/viz-list?request_id=<id> | ?general=1 [&mine=1] → { items, used, limit, enabled, max_side, model }
   GET  /api/admin/docs/viz-open?id=<generare>&what=output|input-<n> → { url } (5 minute)
   POST /api/admin/docs/viz-delete   { id } — rândul și fișierele; angajatul șterge doar generările lui
   Facturile clienților (doar proprietarul; angajatul → 403 forbidden), vezi _lib/invoices.js:
   POST /api/admin/docs/invoice-create { request_id, service, qty, price, due_days } → { invoice, invoices, pdf_error? }
   GET  /api/admin/docs/invoice-open?id=<factură> → { url } — PDF-ul, link de 5 minute (409 no_pdf dacă lipsește)
   POST /api/admin/docs/invoice-send { id } → { invoice, invoices, sent_via, reason } — Telegram / email / proprietar;
        502 send_failed dacă nici proprietarul nu l-a primit (sent_at rămâne gol)
   POST /api/admin/docs/invoice-paid { id } → { invoices, moved } — plata + status atomic; a doua oară 409 already_paid
   POST /api/admin/docs/invoice-pdf  { id } → { invoice, invoices } — reface PDF-ul cu același număr */
const crypto = require('crypto');
const { rest } = require('../../_lib/db');
const { allow, jsonBody } = require('../../_lib/http');
const { requireAdmin, actorOf } = require('../../_lib/auth');
const { TYPES, SERVICES, STATUSES, DOC_TYPES } = require('../../_lib/labels');
const { countHits, addHit } = require('../../_lib/rate');
const { readDocument } = require('../../_lib/claude');
const store = require('../../_lib/storage');
const expenses = require('../../_lib/expenses');
const dues = require('../../_lib/dues');
const catalog = require('../../_lib/catalog');
const { STAFF_DOC_TYPES, expenseDupes } = require('../../_lib/staff');
const viz = require('../../_lib/imagegen');
const invoices = require('../../_lib/invoices');

// Tipurile care devin cheltuieli; restul (carte de vizită, chestionar) devin clienți în CRM
const EXPENSE_TYPES = ['aviz', 'chitanta'];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'application/pdf': 'pdf' };
const MIME = Object.fromEntries(Object.entries(EXT).map(([m, e]) => [e, m]));
const MAX_IMAGES = 5;
const MAX_IMAGE = 15 * 1024 * 1024;
const MAX_PDF = 10 * 1024 * 1024;
// Listele de prețuri pot fi PDF-uri mai mari: un PDF între 10 și 20 MB se citește doar ca listă de prețuri
const MAX_PDF_LIST = 20 * 1024 * 1024;
const MAX_PDF_PAGES = 20;
const OCR_PER_HOUR = 30;
const LIMITS = { name: 100, phone: 30, email: 150, message: 5000, notes: 5000 };

const str = v => (typeof v === 'string' ? v.trim() : '');
const tmpDir = token => `tmp/${token}`;

/* ---------- Câmpurile pentru CRM ---------- */

// Din argumentele uneltei lui Claude → câmpurile ecranului de verificare
function toFields(docType, input) {
  const s = k => str(input[k]);
  const arr = k => (Array.isArray(input[k]) ? input[k].map(str).filter(Boolean) : []);
  const notes = [];
  const add = (label, v) => { if (v) notes.push(`${label}: ${v}`); };
  const f = { name: s('name'), phone: s('phone'), email: s('email'), type: '', service: '', message: '', notes: '' };

  if (docType === 'carte_vizita') {
    add('Firma', s('company'));
    add('Funcția', s('position'));
    add('Adresa', s('address'));
    add('Site', s('website'));
    add('Alte telefoane', arr('other_phones').join(', '));
    add('Alte emailuri', arr('other_emails').join(', '));
    add('Altele', s('other'));
  } else {
    f.type = TYPES[s('type')] ? s('type') : '';
    f.service = SERVICES[s('service')] ? s('service') : '';
    f.message = s('message');
    if (!f.type) add('Tip proiect (scris)', s('type_written'));
    if (!f.service) add('Serviciu (scris)', s('service_written'));
    (Array.isArray(input.answers) ? input.answers : []).forEach(a => a && add(str(a.question) || 'Răspuns', str(a.answer)));
  }
  // Un email greșit sau un telefon prea lung nu se pierd: ajung în note
  if (f.email && !EMAIL_RE.test(f.email)) { add('Email (citit)', f.email); f.email = ''; }
  if (f.phone.length > LIMITS.phone) { add('Telefon (citit)', f.phone); f.phone = f.phone.slice(0, LIMITS.phone); }
  f.notes = notes.join('\n');
  return f;
}

function validate(body) {
  const f = body && typeof body === 'object' ? body : {};
  const data = {};
  for (const k of ['name', 'phone', 'email', 'type', 'service', 'message', 'notes']) data[k] = str(f[k]);
  const errors = [];
  if (!data.name) errors.push('name');
  if (!data.phone && !data.email) errors.push('contact');
  if (data.email && !EMAIL_RE.test(data.email)) errors.push('email');
  for (const [k, max] of Object.entries(LIMITS)) if (data[k].length > max) errors.push(k);
  if (data.type && !TYPES[data.type]) errors.push('type');
  if (data.service && !SERVICES[data.service]) errors.push('service');
  return errors.length ? { errors } : { data };
}

// Același email (fără diferență de litere) sau aceleași ultimele 8 cifre ale telefonului
const last8 = p => String(p || '').replace(/\D/g, '').slice(-8);
async function findDuplicates({ phone, email }) {
  const p = last8(phone), e = str(email).toLowerCase();
  if (p.length < 8 && !e) return [];
  const rows = await rest('requests?select=id,name,status,phone,email&order=created_at.desc&limit=5000');
  return rows
    .filter(r => (p.length === 8 && last8(r.phone) === p) || (e && str(r.email).toLowerCase() === e))
    .slice(0, 5)
    .map(r => ({ id: r.id, name: r.name, status: STATUSES[r.status] || r.status }));
}

/* ---------- Fișierele temporare ---------- */

async function tmpFiles(token) {
  const rows = await store.list(tmpDir(token));
  return rows.filter(r => r.id && /^\d\.(jpg|png|webp|pdf)$/.test(r.name))
    .map(r => ({ name: r.name, page: Number(r.name[0]), mime: MIME[r.name.split('.')[1]], size: Number(r.metadata?.size || 0) }));
}

async function dropTmp(token) {
  const files = await store.list(tmpDir(token)).catch(() => []);
  await store.remove(files.map(f => `${tmpDir(token)}/${f.name}`)).catch(() => {});
}

// Curățenie ocazională: încărcările abandonate mai vechi de o zi
async function sweepOld() {
  const dirs = (await store.list('tmp')).filter(d => !d.id && UUID_RE.test(d.name)).slice(0, 20);
  const old = Date.now() - 864e5;
  for (const d of dirs) {
    const files = await store.list(tmpDir(d.name));
    if (files.length && files.every(f => Date.parse(f.created_at) < old)) await dropTmp(d.name);
  }
}

// Numărul de pagini ale unui PDF, estimat fără bibliotecă
const pdfPages = buf => (buf.toString('latin1').match(/\/Type\s*\/Page(?!s)/g) || []).length;

/* ---------- Acțiuni ---------- */

async function upload(body, res) {
  const files = Array.isArray(body.files) ? body.files : [];
  const pdf = files.some(f => f && f.mime === 'application/pdf');
  const okFile = f => f && EXT[f.mime] && Number.isInteger(f.size) && f.size > 0 &&
    f.size <= (f.mime === 'application/pdf' ? MAX_PDF_LIST : MAX_IMAGE);
  const pages = files.map(f => f && f.page);
  if (!files.length || files.length > (pdf ? 1 : MAX_IMAGES) || !files.every(okFile) ||
      new Set(pages).size !== files.length || !pages.every(p => Number.isInteger(p) && p >= 1 && p <= MAX_IMAGES)) {
    return res.status(400).json({ ok: false, error: 'files' });
  }
  const token = crypto.randomUUID();
  const uploads = await Promise.all(files.map(async f => ({
    page: f.page,
    url: await store.signUpload(`${tmpDir(token)}/${f.page}.${EXT[f.mime]}`),
  })));
  if (Math.random() < 0.1) await sweepOld().catch(e => console.error('Curățarea tmp a eșuat:', e.message));
  return res.status(200).json({ ok: true, token, uploads });
}

// Tipul pe care angajatul nu îl poate salva: fișierele temporare se șterg, câmpurile nu pleacă spre el
async function ownerOnly(token, docType, res) {
  await dropTmp(token);
  return res.status(200).json({ ok: true, doc_type: docType, supported: false, reason: 'owner_only' });
}

async function read(body, res, staff) {
  const started = Date.now();
  let forced = body.doc_type ? String(body.doc_type) : null;
  if (forced && !DOC_TYPES[forced]) return res.status(400).json({ ok: false, error: 'doc_type' });

  const files = await tmpFiles(body.token);
  if (!files.length) return res.status(404).json({ ok: false, error: 'nofiles' });
  if (files.some(f => f.size > (f.mime === 'application/pdf' ? MAX_PDF_LIST : MAX_IMAGE))) {
    await dropTmp(body.token);
    return res.status(400).json({ ok: false, error: 'files' });
  }
  // PDF peste 10 MB: acceptat doar ca listă de prețuri (celelalte tipuri păstrează limita din Etapa 1)
  if (files.some(f => f.mime === 'application/pdf' && f.size > MAX_PDF)) {
    if (forced && forced !== 'lista_preturi') return res.status(400).json({ ok: false, error: 'files' });
    forced = 'lista_preturi';
  }
  // Tipul ales de angajat (sau PDF-ul mare, deci listă de prețuri): refuzul vine înainte de citirea cu Claude
  if (staff && forced && !STAFF_DOC_TYPES.includes(forced)) return ownerOnly(body.token, forced, res);

  if (await countHits('ocr', 3600e3) >= OCR_PER_HOUR) return res.status(429).json({ ok: false, error: 'rate' });

  const pages = await Promise.all(files.map(async f => ({ mime: f.mime, data: await store.download(`${tmpDir(body.token)}/${f.name}`) })));
  if (pages[0].mime === 'application/pdf' && pdfPages(pages[0].data) > MAX_PDF_PAGES) {
    return res.status(400).json({ ok: false, error: 'pages' });
  }

  await addHit('ocr');
  let result;
  try {
    // Funcția are 60 s în total: Claude primește ce rămâne după descărcare, cu 4 s pentru potrivirea cu catalogul
    result = await readDocument(pages, forced, Math.max(15000, 56000 - (Date.now() - started)));
  } catch (e) {
    console.error('Citirea cu Claude a eșuat:', e.message);
    // Răspuns tăiat sau prea lent (de obicei o listă de prețuri lungă): utilizatorul încarcă mai puține pagini
    if (e.code === 'too_long') return res.status(413).json({ ok: false, error: 'too_long' });
    if (e.code === 'timeout') return res.status(504).json({ ok: false, error: 'timeout' });
    // Detaliul (fără cheie) îl vede doar adminul, ca să se poată afla cauza fără jurnalele Vercel
    return res.status(502).json({ ok: false, error: 'claude', detail: e.message.slice(0, 300) });
  }

  if (!result.doc_type) {
    await dropTmp(body.token);
    return res.status(200).json({ ok: true, doc_type: null });
  }
  if (staff && !STAFF_DOC_TYPES.includes(result.doc_type)) return ownerOnly(body.token, result.doc_type, res);
  if (!DOC_TYPES[result.doc_type].ready) {
    return res.status(200).json({ ok: true, doc_type: result.doc_type, supported: false });
  }
  if (result.doc_type === 'lista_preturi') {
    const fields = await catalog.reviewFields(result.input);
    return res.status(200).json({ ok: true, doc_type: result.doc_type, supported: true, fields, duplicates: [] });
  }
  if (result.doc_type === 'de_platit') {
    const fields = dues.payableFromClaude(result.input);
    const duplicates = fields.supplier && fields.doc_date
      ? await dues.findPayableDuplicates({ ...fields, amount_total: Number(fields.amount_total) }) : [];
    return res.status(200).json({ ok: true, doc_type: result.doc_type, supported: true, fields, duplicates });
  }
  if (result.doc_type === 'de_incasat') {
    const fields = dues.receivableFromClaude(result.input);
    const client_matches = await dues.clientMatches(fields.counterparty);
    return res.status(200).json({ ok: true, doc_type: result.doc_type, supported: true, fields, duplicates: [], client_matches });
  }
  if (EXPENSE_TYPES.includes(result.doc_type)) {
    const fields = expenses.fieldsFromClaude(result.input);
    const check = expenses.validate(fields);
    const found = check.data ? await expenses.findDuplicates(check.data) : [];
    const duplicates = staff ? expenseDupes(found) : found;
    return res.status(200).json({ ok: true, doc_type: result.doc_type, supported: true, fields, duplicates });
  }
  const fields = toFields(result.doc_type, result.input);
  const duplicates = await findDuplicates(fields);
  return res.status(200).json({ ok: true, doc_type: result.doc_type, supported: true, fields, duplicates });
}

// actor = „@username” din initData verificat (sau ''): clienții creați din documente îl primesc în created_by
async function save(body, res, staff, actor = '') {
  const docType = String(body.doc_type || '');
  if (!DOC_TYPES[docType] || !DOC_TYPES[docType].ready) return res.status(400).json({ ok: false, error: 'doc_type' });
  if (staff && !STAFF_DOC_TYPES.includes(docType)) return res.status(403).json({ ok: false, error: 'owner_only' });

  // Lista de prețuri: importul atomic în catalog, apoi documentul se leagă de lista creată
  if (docType === 'lista_preturi') {
    const r = await catalog.importList(body.fields);
    if (!r.result) return res.status(r.status).json(r.body);
    const { supplier_id: id, price_list_id: listId, ...summary } = r.result;
    try {
      await attachFiles(body.token, docType, listId, { price_list_id: listId });
    } catch (e) {
      console.error('Mutarea fișierelor documentului a eșuat:', e.message);
      return res.status(201).json({ ok: true, id, kind: 'catalog', list_id: listId, summary, filesError: true });
    }
    return res.status(201).json({ ok: true, id, kind: 'catalog', list_id: listId, summary });
  }

  // Scadențe: documentul de plătit sau ratele de încasat
  if (docType === 'de_platit' || docType === 'de_incasat') {
    let id, owner, kind;
    if (docType === 'de_platit') {
      const { data, items, installments, errors } = dues.validatePayable(body.fields);
      if (errors) return res.status(400).json({ ok: false, error: 'invalid', fields: errors });
      if (!body.force) {
        const duplicates = await dues.findPayableDuplicates(data);
        if (duplicates.length) return res.status(409).json({ ok: false, error: 'duplicate', duplicates });
      }
      id = (await dues.createPayable(data, items, installments)).id;
      owner = { payable_id: id };
      kind = 'payable';
    } else {
      const r = await dues.createReceivables(body.fields, actor);
      if (r.errors) return res.status(400).json({ ok: false, error: 'invalid', fields: r.errors });
      if (r.notfound) return res.status(404).json({ ok: false, error: 'notfound' });
      id = r.request_id;
      owner = { receivable_group: r.group_id };
      kind = 'receivable';
    }
    try {
      await attachFiles(body.token, docType, owner.payable_id || owner.receivable_group, owner);
    } catch (e) {
      console.error('Mutarea fișierelor documentului a eșuat:', e.message);
      return res.status(201).json({ ok: true, id, kind, filesError: true });
    }
    return res.status(201).json({ ok: true, id, kind });
  }

  const isExpense = EXPENSE_TYPES.includes(docType);
  const lib = isExpense ? expenses : { validate, findDuplicates };
  const { data, items, errors } = lib.validate(body.fields);
  if (errors) return res.status(400).json({ ok: false, error: 'invalid', fields: errors });

  if (!body.force) {
    const duplicates = await lib.findDuplicates(data);
    if (duplicates.length) {
      return res.status(409).json({ ok: false, error: 'duplicate', duplicates: staff && isExpense ? expenseDupes(duplicates) : duplicates });
    }
  }

  let id, owner;
  if (isExpense) {
    id = (await expenses.createExpense(data, items, docType)).id;
    owner = { expense_id: id };
  } else {
    const [item] = await rest('requests', {
      method: 'POST',
      // Sursa rămâne tipul documentului (carte_vizita, chestionar); autorul doar în created_by
      body: { ...data, status: 'noua', source: docType, channel: '', created_by: actor, status_actor: actor },
      prefer: 'return=representation',
    });
    id = item.id;
    owner = { request_id: id };
  }

  // Întâi înregistrarea, apoi fișierele: dacă pasul cu fișierele eșuează, înregistrarea rămâne
  try {
    await attachFiles(body.token, docType, id, owner);
  } catch (e) {
    console.error('Mutarea fișierelor documentului a eșuat:', e.message);
    return res.status(201).json({ ok: true, id, kind: isExpense ? 'expense' : 'client', filesError: true });
  }
  return res.status(201).json({ ok: true, id, kind: isExpense ? 'expense' : 'client' });
}

// Mută fișierele din tmp/<token>/ în <tip>/<id>/ și le leagă de înregistrare
async function attachFiles(token, docType, id, owner) {
  const files = await tmpFiles(token);
  for (const f of files) {
    const path = `${docType}/${id}/${f.name}`;
    await store.move(`${tmpDir(token)}/${f.name}`, path);
    await rest('documents', {
      method: 'POST',
      body: { doc_type: docType, ...owner, page: f.page, path, mime: f.mime, size_bytes: f.size },
      prefer: 'return=minimal',
    });
  }
}

async function open(req, res, staff) {
  const id = String(req.query.id || '');
  if (!/^\d{1,18}$/.test(id)) return res.status(404).json({ ok: false, error: 'notfound' });
  const [doc] = await rest(`documents?select=path,request_id&id=eq.${id}`);
  // Angajatul deschide doar originalele legate de un client (carte de vizită, chestionar)
  if (!doc || (staff && !doc.request_id)) return res.status(404).json({ ok: false, error: 'notfound' });
  return res.status(200).json({ ok: true, url: await store.signRead(doc.path, 300) });
}

/* ---------- Vizualizare proiect (echipa) ---------- */

// Cheia limitei și autorul: omul din Mini App (initData verificat) sau proprietarul din browser
const teamKey = req => (req.tgUser ? `tg:${req.tgUser.id}` : 'owner');
const teamActor = req => actorOf(req) || 'owner';
const VIZ_SECONDS = 300;

async function vizUpload(req, body, res) {
  if (!viz.configured()) return res.status(503).json({ ok: false, error: 'viz_off' });
  if (!viz.validFiles(body.files)) return res.status(400).json({ ok: false, error: 'files' });
  let requestId = null;
  if (body.request_id) {
    requestId = String(body.request_id);
    if (!UUID_RE.test(requestId)) return res.status(404).json({ ok: false, error: 'notfound' });
    const [r] = await rest(`requests?select=id&id=eq.${requestId}`);
    if (!r) return res.status(404).json({ ok: false, error: 'notfound' });
  }
  const key = teamKey(req);
  if (await viz.teamLimit(key)) return res.status(429).json({ ok: false, error: 'limit_team', limit: viz.TEAM_PER_DAY });
  const kind = viz.KINDS[body.kind] ? body.kind : 'casa_noua';
  const r = await viz.reserve({ origin: 'team', kind, request_id: requestId, actor: teamActor(req), actor_key: key, files: body.files });
  if (Math.random() < 0.1) await viz.sweep().catch(e => console.error('Curățarea vizualizărilor a eșuat:', e.message));
  return res.status(200).json({ ok: true, token: r.token, uploads: r.uploads, max_side: viz.maxSide() });
}

// Rezervarea omului care cere (a altcuiva = „nu există”)
async function ownReservation(req, body, res) {
  const token = String(body.token || '');
  if (!UUID_RE.test(token)) { res.status(400).json({ ok: false, error: 'token' }); return null; }
  const row = await viz.findByToken(token);
  if (!row || row.origin !== 'team' || row.actor_key !== teamKey(req)) { res.status(404).json({ ok: false, error: 'notfound' }); return null; }
  return row;
}

async function vizGenerate(req, body, res) {
  const started = Date.now();
  if (!viz.configured()) return res.status(503).json({ ok: false, error: 'viz_off' });
  const kind = String(body.kind || '');
  const wishes = str(body.wishes);
  if (!viz.KINDS[kind]) return res.status(400).json({ ok: false, error: 'kind' });
  if (wishes.length > viz.MAX_WISHES) return res.status(400).json({ ok: false, error: 'wishes' });
  const row = await ownReservation(req, body, res);
  if (!row) return;
  // Dublu clic după o reușită: aceeași schiță
  if (row.status === 'done') return res.status(200).json({ ok: true, id: row.id, url: await store.signRead(row.output_path, VIZ_SECONDS), model: row.model });
  if (row.status === 'rejected') return res.status(422).json({ ok: false, error: 'rejected' });
  if (viz.isExpired(row)) return res.status(410).json({ ok: false, error: 'expired' });
  if (row.status === 'pending' && row.started_at) return res.status(409).json({ ok: false, error: 'busy' });
  if (!(await viz.tryHit(teamKey(req)))) return res.status(429).json({ ok: false, error: 'limit_tries' });

  const { files, error } = await viz.tmpFiles(row.token);
  if (error) return res.status(400).json({ ok: false, error: 'files' });
  if (!files.length) return res.status(409).json({ ok: false, error: 'nofiles' });
  // „Încearcă din nou” după un eșec: eșecul nu se număra, deci limita zilei se verifică din nou
  if (row.status === 'failed' && await viz.teamLimit(row.actor_key)) {
    return res.status(429).json({ ok: false, error: 'limit_team', limit: viz.TEAM_PER_DAY });
  }
  const claimed = await viz.claim(row, { kind, wishes });
  if (!claimed) return res.status(409).json({ ok: false, error: 'busy' });

  const out = await viz.run(claimed, files, started);
  if (out.status === 'done') {
    return res.status(200).json({ ok: true, id: out.row.id, url: await store.signRead(out.row.output_path, VIZ_SECONDS), model: out.model });
  }
  if (out.status === 'rejected') return res.status(422).json({ ok: false, error: 'rejected' });
  // Detaliul (fără cheie) îl vede echipa, ca să se poată afla cauza fără jurnalele Vercel
  return res.status(out.code === 'timeout' ? 504 : out.code === 'quota' ? 503 : 502).json({ ok: false, error: out.code, detail: out.detail || '' });
}

async function vizCancel(req, body, res) {
  const row = await ownReservation(req, body, res);
  if (!row) return;
  if (row.status === 'pending' && !row.started_at) {
    await rest(`generations?id=eq.${row.id}&status=eq.pending&started_at=is.null`, {
      method: 'PATCH', body: { status: 'failed', error: 'anulat', token: null }, prefer: 'return=minimal',
    });
    await viz.dropTmp(row.token);
  } else if (row.status === 'failed') {
    await rest(`generations?id=eq.${row.id}&status=eq.failed`, { method: 'PATCH', body: { token: null }, prefer: 'return=minimal' });
    await viz.dropTmp(row.token);
  }
  return res.status(200).json({ ok: true });
}

// Angajatul vede tot ce vede pe fișe (toți clienții) și toată lista generală; fără bani, deci nimic de ascuns
async function vizList(req, res, staff) {
  const key = teamKey(req);
  let filter;
  if (req.query.request_id) {
    const id = String(req.query.request_id);
    if (!UUID_RE.test(id)) return res.status(404).json({ ok: false, error: 'notfound' });
    filter = `request_id=eq.${id}`;
  } else if (req.query.general) {
    filter = 'request_id=is.null';
  } else {
    return res.status(400).json({ ok: false, error: 'filter' });
  }
  if (req.query.mine) filter += `&actor_key=eq.${encodeURIComponent(key)}`;
  const [rows, used] = await Promise.all([
    rest(`generations?select=id,created_at,request_id,origin,kind,wishes,actor,actor_key,output_path,input_paths&status=eq.done&${filter}&order=created_at.desc&limit=60`),
    viz.teamUsed(key),
  ]);
  const urls = await store.signReadMany(rows.map(r => r.output_path).filter(Boolean), VIZ_SECONDS).catch(() => ({}));
  const items = rows.map(r => ({
    id: r.id, created_at: r.created_at, origin: r.origin, kind: r.kind, wishes: r.wishes, actor: r.actor,
    inputs: (r.input_paths || []).length, thumb: urls[r.output_path] || '',
    can_delete: !staff || r.actor_key === key,
  }));
  return res.status(200).json({ ok: true, enabled: viz.configured(), items, used, limit: viz.TEAM_PER_DAY, max_side: viz.maxSide(), model: viz.modelName() });
}

async function vizOpen(req, res) {
  const id = String(req.query.id || ''), what = String(req.query.what || 'output');
  if (!UUID_RE.test(id) || !/^(output|input-[1-3])$/.test(what)) return res.status(404).json({ ok: false, error: 'notfound' });
  const [row] = await rest(`generations?select=output_path,input_paths&id=eq.${id}&status=eq.done`);
  if (!row) return res.status(404).json({ ok: false, error: 'notfound' });
  const path = what === 'output' ? row.output_path
    : (row.input_paths || []).find(p => p.split('/').pop().startsWith(`${what}.`));
  if (!path) return res.status(404).json({ ok: false, error: 'notfound' });
  return res.status(200).json({ ok: true, url: await store.signRead(path, VIZ_SECONDS) });
}

// Proprietarul șterge orice generare; angajatul doar pe ale lui (după cheia autorului, nu după numele afișat)
async function vizDelete(req, body, res, staff) {
  const id = String(body.id || '');
  if (!UUID_RE.test(id)) return res.status(404).json({ ok: false, error: 'notfound' });
  const [row] = await rest(`generations?select=id,actor_key,output_path,input_paths,token&id=eq.${id}`);
  if (!row) return res.status(404).json({ ok: false, error: 'notfound' });
  if (staff && row.actor_key !== teamKey(req)) return res.status(403).json({ ok: false, error: 'forbidden' });
  await viz.removeGeneration(row);
  return res.status(200).json({ ok: true });
}

async function vizAction(action, req, res, body, staff) {
  if (action === 'viz-list') return vizList(req, res, staff);
  if (action === 'viz-open') return vizOpen(req, res);
  if (action === 'viz-upload') return vizUpload(req, body, res);
  if (action === 'viz-generate') return vizGenerate(req, body, res);
  if (action === 'viz-cancel') return vizCancel(req, body, res);
  if (action === 'viz-delete') return vizDelete(req, body, res, staff);
  return res.status(404).json({ ok: false, error: 'notfound' });
}

/* ---------- Facturile clienților (doar proprietarul) ---------- */

const INVOICE_FULL = 'id,request_id,number,issued_at,due_date,currency,items,subtotal,vat_rate,vat,total,client,company,is_test,status,pdf_path,sent_via,sent_at,auto';

async function findInvoice(id) {
  if (!/^\d{1,18}$/.test(String(id || ''))) return null;
  const [inv] = await rest(`invoices?select=${INVOICE_FULL}&id=eq.${id}`);
  return inv || null;
}

async function invoiceCreate(req, body, res) {
  const requestId = String(body.request_id || '');
  if (!UUID_RE.test(requestId)) return res.status(404).json({ ok: false, error: 'notfound' });
  const { data, errors } = invoices.validate(body);
  if (errors) return res.status(400).json({ ok: false, error: 'invalid', fields: errors });
  const [r] = await rest(`requests?select=id,name,phone,email,currency&id=eq.${requestId}`);
  if (!r) return res.status(404).json({ ok: false, error: 'notfound' });
  const inv = await invoices.issue(r, data, { actor: actorOf(req) });
  return res.status(201).json({
    ok: true, invoice: invoices.listItem(inv), invoices: await invoices.listFor(requestId), ...(inv.pdf_path ? {} : { pdf_error: true }),
  });
}

async function invoiceAction(action, req, res, body) {
  if (action === 'invoice-create') return invoiceCreate(req, body, res);
  const inv = await findInvoice(action === 'invoice-open' ? req.query.id : body.id);
  if (!inv) return res.status(404).json({ ok: false, error: 'notfound' });

  if (action === 'invoice-open') {
    if (!inv.pdf_path) return res.status(409).json({ ok: false, error: 'no_pdf' });
    return res.status(200).json({ ok: true, url: await store.signRead(inv.pdf_path, 300) });
  }
  if (action === 'invoice-pdf') {
    try {
      inv.pdf_path = await invoices.savePdf(inv);
    } catch (e) {
      console.error(`Refacerea PDF-ului ${inv.number} a eșuat:`, e.message);
      return res.status(502).json({ ok: false, error: 'pdf' });
    }
    return res.status(200).json({ ok: true, invoice: invoices.listItem(inv), invoices: await invoices.listFor(inv.request_id) });
  }
  if (action === 'invoice-send') {
    const [r] = await rest(`requests?select=id,name,email,tg_user_id&id=eq.${inv.request_id}`);
    if (!r) return res.status(404).json({ ok: false, error: 'notfound' });
    let out;
    try {
      out = await invoices.send(inv, r);
    } catch (e) {
      console.error(`Trimiterea facturii ${inv.number} a eșuat:`, e.message);
      return res.status(502).json({ ok: false, error: 'send_failed' });
    }
    await rest(`invoices?id=eq.${inv.id}`, { method: 'PATCH', body: { sent_via: out.sent_via, sent_at: new Date().toISOString() }, prefer: 'return=minimal' });
    const list = await invoices.listFor(inv.request_id);
    return res.status(200).json({ ok: true, invoice: list.find(x => x.id === inv.id), invoices: list, ...out });
  }
  if (action === 'invoice-paid') {
    const out = await invoices.markPaid(inv.id, actorOf(req));
    if (out.error === 'already_paid') return res.status(409).json({ ok: false, error: 'already_paid' });
    if (out.error) return res.status(404).json({ ok: false, error: 'notfound' });
    return res.status(200).json({ ok: true, moved: out.moved, invoices: await invoices.listFor(inv.request_id) });
  }
  return res.status(404).json({ ok: false, error: 'notfound' });
}

const GET_ACTIONS = ['open', 'viz-list', 'viz-open', 'invoice-open'];

module.exports = async function handler(req, res) {
  const action = String(req.query.action || '');
  if (!allow(req, res, GET_ACTIONS.includes(action) ? ['GET'] : ['POST'])) return;
  // Scanerul e deschis și angajaților, cu tipurile și câmpurile limitate mai sus
  const role = requireAdmin(req, res, { staff: true });
  if (!role) return;
  const staff = role === 'staff';
  const body = jsonBody(req) || {};

  try {
    if (action === 'open') return await open(req, res, staff);
    if (action === 'upload') return await upload(body, res);
    if (action.startsWith('viz-')) return await vizAction(action, req, res, body, staff);
    // Facturile sunt bani: angajatul (și proprietarul în „Vezi ca angajat”) nu are acces
    if (action.startsWith('invoice-')) {
      if (staff) return res.status(403).json({ ok: false, error: 'forbidden' });
      return await invoiceAction(action, req, res, body);
    }
    if (!['read', 'save', 'cancel'].includes(action)) return res.status(404).json({ ok: false, error: 'notfound' });
    if (!UUID_RE.test(String(body.token || ''))) return res.status(400).json({ ok: false, error: 'token' });
    if (action === 'read') return await read(body, res, staff);
    if (action === 'save') return await save(body, res, staff, actorOf(req));
    await dropTmp(body.token);
    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error(`Documente (${action}) a eșuat:`, e.message);
    return res.status(502).json({ ok: false, error: 'db', detail: e.message.slice(0, 300) });
  }
};
module.exports.toFields = toFields;
module.exports.validate = validate;
