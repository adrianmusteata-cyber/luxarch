/* GET   /api/admin/requests/:id  — fișa clientului, cu istoricul etapelor, plățile și (doar proprietarul) facturile
   PATCH /api/admin/requests/:id { status?, comment?, notes?, contract_value?, currency? }
         — mută clientul în altă etapă (la „respins” motivul e obligatoriu),
           îi salvează notele și/sau valoarea contractului și moneda. Istoricul îl scrie trigger-ul din baza de date.
         La schimbarea etapei, status_actor = „@username” (sau numele) din initData verificat; din browser ''.
         Trigger-ul îl copiază în status_history.actor. Notele nu cer autor.
         Trecerea în „Procesat” emite factura automată (o singură dată pe fișă, vezi _lib/invoices.js).
   Angajatul (Mini App Telegram): fișa fără bani (fără valoare, monedă, plăți, rate, facturi și documentele ratelor);
   la PATCH doar status, comment și notes — contract_value sau currency → 403, fără nicio salvare.
   DELETE /api/admin/requests/:id — doar proprietarul: șterge clientul cu tot ce ține de el. Fișierele din Storage
         (vizualizările, originalele documentelor, documentele ratelor, PDF-urile facturilor) se șterg ÎNAINTE de rând;
         rândurile legate (istoric, plăți, rate, documente, generări, facturi) dispar prin „on delete cascade”. Angajatul → 403. */
const { rest } = require('../../_lib/db');
const { allow, jsonBody } = require('../../_lib/http');
const { requireAdmin, actorOf } = require('../../_lib/auth');
const { STATUSES } = require('../../_lib/labels');
const { CURRENCIES, parseAmount } = require('../../_lib/money');
const { receivablesWithState } = require('../../_lib/dues');
const { stripMoney } = require('../../_lib/staff');
const store = require('../../_lib/storage');
const { filesOfRequest } = require('../../_lib/imagegen');
const invoices = require('../../_lib/invoices');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const history = id => rest(`status_history?select=from_status,to_status,comment,actor,at&request_id=eq.${id}&order=at.asc,id.asc`);
const payments = id => rest(`payments?select=id,paid_on,amount,note&request_id=eq.${id}&order=paid_on.asc,id.asc`);
// Originalele (carte de vizită, chestionar); dacă tabelul încă lipsește, fișa merge și fără ele
const documents = id => rest(`documents?select=id,doc_type,page,mime,created_at&request_id=eq.${id}&order=page.asc`).catch(() => []);

// PDF-urile facturilor: tot dosarul facturi/<id>/ (prinde și un PDF urcat a cărui cale n-a ajuns pe factură) plus căile salvate
async function invoiceFiles(id) {
  const [listed, rows] = await Promise.all([
    store.list(`facturi/${id}`).catch(() => []),
    rest(`invoices?select=pdf_path&request_id=eq.${id}`).catch(() => []),
  ]);
  return listed.filter(f => f.id).map(f => `facturi/${id}/${f.name}`).concat(rows.map(r => r.pdf_path).filter(Boolean));
}

// Ștergerea clientului: întâi fișierele, apoi rândul (dacă Storage nu răspunde, clientul rămâne, fără fișiere „orfane”)
async function removeRequest(id, res) {
  const [item] = await rest(`requests?select=id&id=eq.${id}`);
  if (!item) return res.status(404).json({ ok: false, error: 'notfound' });
  const groups = [...new Set((await rest(`receivables?select=group_id&request_id=eq.${id}`).catch(() => []))
    .map(r => r.group_id).filter(Boolean))];
  const groupFilter = groups.length ? `receivable_group=in.(${groups.join(',')})` : '';
  const [docs, groupDocs, vizFiles, invFiles] = await Promise.all([
    rest(`documents?select=path&request_id=eq.${id}`).catch(() => []),
    groupFilter ? rest(`documents?select=path&${groupFilter}`).catch(() => []) : [],
    filesOfRequest(id),
    invoiceFiles(id),
  ]);
  await store.remove([...new Set([...docs, ...groupDocs].map(d => d.path).concat(vizFiles, invFiles))]);
  // Documentele ratelor sunt legate de grup, nu de client: nu au cascadă, se șterg aici
  if (groupFilter) await rest(`documents?${groupFilter}`, { method: 'DELETE' });
  await rest(`requests?id=eq.${id}`, { method: 'DELETE' });
  return res.status(200).json({ ok: true });
}

module.exports = async function handler(req, res) {
  if (!allow(req, res, ['GET', 'PATCH', 'DELETE'])) return;
  const role = requireAdmin(req, res, { staff: true });
  if (!role) return;
  const staff = role === 'staff';

  const id = String(req.query.id || '');
  if (!UUID_RE.test(id)) return res.status(404).json({ ok: false, error: 'notfound' });

  try {
    if (req.method === 'DELETE') {
      if (staff) return res.status(403).json({ ok: false, error: 'forbidden' });
      return await removeRequest(id, res);
    }
    if (req.method === 'GET' && staff) {
      // Doar ce ține de pâlnie: datele clientului, istoricul și originalele legate direct de el
      const [[item], hist, docs] = await Promise.all([rest(`requests?select=*&id=eq.${id}`), history(id), documents(id)]);
      if (!item) return res.status(404).json({ ok: false, error: 'notfound' });
      return res.status(200).json({ ok: true, role, item: stripMoney(item), history: hist, documents: docs });
    }
    if (req.method === 'GET') {
      // Facturile: doar proprietarul; dacă tabelul încă lipsește (migrarea nerulată), fișa merge și fără ele
      const [[item], hist, pays, docs, recs, invs] = await Promise.all([
        rest(`requests?select=*&id=eq.${id}`), history(id), payments(id), documents(id),
        receivablesWithState([id]).catch(() => []),
        invoices.listFor(id).catch(() => null),
      ]);
      if (!item) return res.status(404).json({ ok: false, error: 'notfound' });
      // Documentele ratelor de încasat (contract / factură emisă de noi), legate de grupul ratelor
      const groups = [...new Set(recs.map(r => r.group_id).filter(Boolean))];
      const groupDocs = groups.length
        ? await rest(`documents?select=id,doc_type,page,mime,created_at,receivable_group&receivable_group=in.(${groups.join(',')})&order=page.asc`).catch(() => [])
        : [];
      return res.status(200).json({
        ok: true, role, item, history: hist, payments: pays, documents: [...docs, ...groupDocs], receivables: recs,
        invoices: invs || [], invoices_ready: !!invs, invoice_defaults: invoices.defaults(item), vat_rate: invoices.VAT_RATE,
      });
    }

    const body = jsonBody(req) || {};
    // Angajatul nu schimbă banii: cererea întreagă e refuzată, deci nici etapa sau notele din ea nu se salvează
    if (staff && ('contract_value' in body || 'currency' in body)) return res.status(403).json({ ok: false, error: 'forbidden' });
    const patch = {};
    if ('notes' in body) {
      if (typeof body.notes !== 'string') return res.status(400).json({ ok: false, error: 'notes' });
      patch.notes = body.notes.trim().slice(0, 5000);
    }
    if ('status' in body) {
      const status = body.status;
      const comment = typeof body.comment === 'string' ? body.comment.trim().slice(0, 1000) : '';
      if (!STATUSES[status]) return res.status(400).json({ ok: false, error: 'status' });
      if (status === 'respins' && !comment) return res.status(400).json({ ok: false, error: 'comment' });
      // status_actor se scrie mereu (și '' din browser), ca trigger-ul să nu copieze autorul trecerii anterioare
      Object.assign(patch, { status, status_comment: comment, status_updated_at: new Date().toISOString(), status_actor: actorOf(req) });
    }
    if ('contract_value' in body) {
      // Gol = fără valoare de contract
      const empty = body.contract_value === null || body.contract_value === '';
      const value = empty ? null : parseAmount(body.contract_value, { allowZero: true });
      if (!empty && value === null) return res.status(400).json({ ok: false, error: 'contract_value' });
      patch.contract_value = value;
    }
    if ('currency' in body) {
      if (!CURRENCIES.includes(body.currency)) return res.status(400).json({ ok: false, error: 'currency' });
      patch.currency = body.currency;
    }
    if (!Object.keys(patch).length) return res.status(400).json({ ok: false, error: 'empty' });

    // Etapa de dinainte: anunțul de plată (Avans / Plătit) și factura automată (Procesat) doar la o trecere reală
    let before = null;
    if (patch.status) [before] = await rest(`requests?select=status&id=eq.${id}`);

    const [item] = await rest(`requests?id=eq.${id}`, { method: 'PATCH', body: patch, prefer: 'return=representation' });
    if (!item) return res.status(404).json({ ok: false, error: 'notfound' });
    if (before) await invoices.afterStatusChange(before.status, item, actorOf(req));
    return res.status(200).json({ ok: true, item: staff ? stripMoney(item) : item, history: await history(id) });
  } catch (e) {
    console.error('Operația pe cerere a eșuat:', e.message);
    return res.status(502).json({ ok: false, error: 'db' });
  }
};
