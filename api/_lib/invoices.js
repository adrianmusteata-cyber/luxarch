/* Facturile clienților (docs/specs/2026-11-10-facturi-pdf.md): emiterea (la buton sau automat la „Procesat”),
   PDF-ul în Storage, trimiterea către client și marcarea ca achitată. Doar proprietarul le vede; angajatul nu.
   Numărul LUX-AAAA-NNNN îl dă baza (funcția issue_invoice), marcarea e atomică (pay_invoice).
   Rechizitele: COMPANY_NAME, COMPANY_IDNO, COMPANY_VAT_CODE, COMPANY_ADDRESS, COMPANY_IBAN, COMPANY_BANK (+ COMPANY_BIC opțional).
   Dacă lipsește oricare dintre cele șase, se folosesc datele de test de mai jos, iar PDF-ul e marcat „fără valoare fiscală”.
   Trimiterea: Telegram la client (botul clienților, TELEGRAM_CLIENT_BOT_TOKEN), apoi email (RESEND_API_KEY, MAIL_FROM),
   altfel PDF-ul ajunge la proprietar (TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID) cu motivul. */
const { rest } = require('./db');
const store = require('./storage');
const { SERVICES, TYPES } = require('./labels');
const { parseAmount, todayChisinau } = require('./money');
const { clientToken } = require('./auth');
const {
  esc, sendTelegram, sendTelegramDocument, sendEmailWithPdf, paymentText, isPayment, sendPayment, notifySafely,
} = require('./notify');

const VAT_RATE = 20;
const MAX_SUBTOTAL = 99999999.99;
const LIMITS = { service: 300 };
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

// Câmpurile din listă (fără căi din Storage și fără copiile mari)
const LIST_FIELDS = 'id,number,issued_at,due_date,currency,subtotal,vat,total,status,paid_on,pdf_path,sent_via,sent_at,auto,is_test';

const COMPANY_ENV = {
  name: 'COMPANY_NAME', idno: 'COMPANY_IDNO', vat_code: 'COMPANY_VAT_CODE',
  address: 'COMPANY_ADDRESS', iban: 'COMPANY_IBAN', bank: 'COMPANY_BANK',
};
// Evident fictive: nu pot fi confundate cu o firmă reală
const TEST_COMPANY = {
  name: 'LUXARCH SRL (TEST)',
  idno: '1000000000000',
  vat_code: '0000000',
  address: 'mun. Chișinău, str. Exemplu 1 (adresă de test)',
  iban: 'MD00TEST0000000000000000',
  bank: 'Banca de Test SA',
  bic: 'TESTMD00',
};

// Rechizitele folosite acum: { company, isTest }
function companyData(env = process.env) {
  const real = {};
  for (const [k, v] of Object.entries(COMPANY_ENV)) real[k] = String(env[v] || '').trim();
  if (Object.values(real).some(v => !v)) return { company: { ...TEST_COMPANY }, isTest: true };
  const bic = String(env.COMPANY_BIC || '').trim();
  return { company: bic ? { ...real, bic } : real, isTest: false };
}

/* ---------- Sumele ---------- */

// Totul în bani întregi (cenți), ca 0,1 + 0,2 să nu dea 0,30000000000000004
const cents = v => Math.round(Number(v) * 100);
function totals(qty, price) {
  const lineC = Math.round(cents(qty) * cents(price) / 100);
  const vatC = Math.round(lineC * VAT_RATE / 100);
  return { line_total: lineC / 100, subtotal: lineC / 100, vat: vatC / 100, total: (lineC + vatC) / 100 };
}

// Denumirea implicită: eticheta serviciului fișei, cu tipul proiectului dacă există
function defaultService(r) {
  const svc = r.service && r.service !== 'nu_stiu' ? SERVICES[r.service] : '';
  const base = svc || 'Servicii de proiectare';
  return r.type && TYPES[r.type] ? `${base} (${TYPES[r.type]})` : base;
}

// Valorile din formular și din emiterea automată
const defaults = r => ({
  service: defaultService(r),
  qty: 1,
  price: r.contract_value != null ? Number(r.contract_value) : null,
  due_days: 10,
});

// Întoarce { data } sau { errors: [câmpuri greșite] }
function validate(body) {
  const b = body && typeof body === 'object' ? body : {};
  const data = {
    service: typeof b.service === 'string' ? b.service.trim().replace(/\s+/g, ' ') : '',
    qty: parseAmount(b.qty),
    price: parseAmount(b.price),
    due_days: Number(b.due_days),
  };
  const errors = [];
  if (!data.service || data.service.length > LIMITS.service) errors.push('service');
  if (data.qty === null || data.qty > 100000) errors.push('qty');
  if (data.price === null) errors.push('price'); // parseAmount: > 0, deci cel puțin 0,01
  if (!Number.isInteger(data.due_days) || data.due_days < 1 || data.due_days > 365) errors.push('due_days');
  if (!errors.length && totals(data.qty, data.price).subtotal > MAX_SUBTOTAL) errors.push('price');
  return errors.length ? { errors: [...new Set(errors)] } : { data };
}

/* ---------- Emiterea ---------- */

const pdfPath = inv => `facturi/${inv.request_id}/${inv.number}.pdf`;

// Face PDF-ul și îl urcă; abia apoi se scrie calea pe factură. Întoarce calea.
async function savePdf(inv) {
  const { renderInvoice } = require('./invoice-pdf'); // pdf-lib se încarcă doar aici
  const data = await renderInvoice(inv);
  const path = pdfPath(inv);
  await store.upload(path, data, 'application/pdf');
  await rest(`invoices?id=eq.${inv.id}`, { method: 'PATCH', body: { pdf_path: path }, prefer: 'return=minimal' });
  return path;
}

/* r = fișa (id, name, phone, email, currency), input = { service, qty, price, due_days } deja validat.
   Întoarce factura salvată (cu pdf_path gol dacă PDF-ul a eșuat) sau null dacă fișa are deja o factură automată. */
async function issue(r, input, { auto = false, actor = '' } = {}) {
  const t = totals(input.qty, input.price);
  const { company, isTest } = companyData();
  const inv = await rest('rpc/issue_invoice', {
    method: 'POST',
    body: {
      p: {
        request_id: r.id, auto, due_days: input.due_days, currency: r.currency || 'MDL',
        items: [{ name: input.service, qty: input.qty, unit_price: input.price, line_total: t.line_total }],
        subtotal: t.subtotal, vat_rate: VAT_RATE, vat: t.vat, total: t.total,
        client: { name: r.name || '', phone: r.phone || '', email: r.email || '' },
        company, is_test: isTest, created_by: actor || '',
      },
    },
  });
  if (!inv) return null;
  // Numărul e deja dat: dacă PDF-ul cade, factura rămâne cu „PDF lipsă” și se reface cu același număr
  try {
    inv.pdf_path = await savePdf(inv);
  } catch (e) {
    console.error(`PDF-ul facturii ${inv.number} a eșuat:`, e.message);
  }
  return inv;
}

/* Emiterea automată la trecerea în „Procesat” (panou, Mini App, MCP, client creat direct în „Procesat”).
   Nu aruncă niciodată: etapa e deja schimbată, iar orice eroare doar se scrie în log. */
async function autoIssue(item, actor = '') {
  try {
    const [had] = await rest(`invoices?select=id&request_id=eq.${item.id}&auto=is.true&limit=1`);
    if (had) return; // a doua trecere în „Procesat” nu face nimic
    if (!(Number(item.contract_value) > 0)) {
      await sendTelegram(`🧾 Factura automată pentru <b>${esc(item.name)}</b> nu s-a emis: lipsește valoarea contractului.`);
      return;
    }
    const inv = await issue(item, defaults(item), { auto: true, actor });
    if (inv) console.log(`Factura automată ${inv.number} emisă pentru ${item.id}`);
  } catch (e) {
    console.error('Factura automată a eșuat:', e.message);
  }
}

// Suma plăților din fișă, pentru anunțul din „Achitări” (null dacă nu se poate citi)
const paidTotal = id => rest(`payments?select=amount&request_id=eq.${id}`)
  .then(rows => rows.reduce((s, p) => s + Number(p.amount), 0))
  .catch(() => null);

/* După o schimbare reală de etapă (before = etapa veche): anunțul de plată la Avans / Plătit
   și factura automată la „Procesat”. Folosit de requests/[id].js și mcp.js; nu strică niciodată salvarea. */
async function afterStatusChange(before, item, actor = '') {
  if (!before || before === item.status) return;
  const jobs = [];
  if (isPayment(item.status)) jobs.push(paidTotal(item.id).then(paid => sendPayment(paymentText(item, paid))));
  if (item.status === 'procesat') jobs.push(autoIssue(item, actor));
  await notifySafely(jobs);
}

/* ---------- Lista, trimiterea, plata ---------- */

const listItem = ({ pdf_path, ...x }) => ({ ...x, has_pdf: !!pdf_path });
const listFor = requestId => rest(`invoices?select=${LIST_FIELDS}&request_id=eq.${requestId}&order=issued_at.desc,id.desc`)
  .then(rows => rows.map(listItem));

const fileName = inv => `${inv.number}.pdf`;
const fmtMoney = (v, cur) => `${Number(v).toLocaleString('ro-RO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${cur}`;
const fmtDate = d => String(d).slice(0, 10).split('-').reverse().join('.');

// PDF-ul facturii: din Storage sau, dacă lipsește, refăcut acum
async function pdfBytes(inv) {
  if (!inv.pdf_path) inv.pdf_path = await savePdf(inv);
  return store.download(inv.pdf_path);
}

/* Trimite PDF-ul: client pe Telegram → client pe email → proprietar pe Telegram (cu motivul).
   r = fișa (name, email, tg_user_id). Întoarce { sent_via, reason }; aruncă doar dacă nici proprietarul nu-l primește. */
async function send(inv, r) {
  const data = await pdfBytes(inv);
  const company = (inv.company && inv.company.name) || 'LUXARCH';
  const summary = `Total: ${fmtMoney(inv.total, inv.currency)}. Termen de plată: ${fmtDate(inv.due_date)}.`;
  const reasons = [];

  if (r.tg_user_id) {
    const token = clientToken();
    if (!token) reasons.push('botul clienților nu e configurat');
    else {
      try {
        await sendTelegramDocument({
          data, filename: fileName(inv), token, chatId: r.tg_user_id,
          caption: `<b>Factura ${esc(inv.number)}</b> de la ${esc(company)}\n${esc(summary)}`,
        });
        return { sent_via: 'telegram', reason: '' };
      } catch (e) {
        console.error(`Factura ${inv.number} pe Telegram la client a eșuat:`, e.message);
        reasons.push(/403/.test(e.message) ? 'clientul a blocat botul pe Telegram' : 'Telegram nu a primit mesajul');
      }
    }
  }

  const email = String(r.email || '').trim();
  if (email && EMAIL_RE.test(email)) {
    try {
      await sendEmailWithPdf({
        to: email, filename: fileName(inv), data,
        subject: `Factura ${inv.number} de la ${company}`,
        html: `<p style="font-family:Arial,sans-serif;font-size:14px">Bună ziua${r.name ? `, ${esc(r.name)}` : ''}!</p>
          <p style="font-family:Arial,sans-serif;font-size:14px">Vă trimitem factura <b>${esc(inv.number)}</b> (atașată, PDF).<br>${esc(summary)}</p>
          <p style="font-family:Arial,sans-serif;font-size:14px">Cu respect,<br>${esc(company)}</p>`,
      });
      return { sent_via: 'email', reason: '' };
    } catch (e) {
      console.error(`Factura ${inv.number} pe email a eșuat:`, e.message);
      reasons.push('emailul nu poate pleca');
    }
  } else if (!r.tg_user_id) {
    reasons.push('clientul nu are nici Telegram, nici email');
  } else if (!email) {
    reasons.push('clientul nu are email');
  } else {
    reasons.push('emailul clientului nu e valid');
  }

  const reason = reasons.join('; ');
  await sendTelegramDocument({
    data, filename: fileName(inv),
    caption: `🧾 <b>Factura ${esc(inv.number)}</b> · ${esc(r.name || '')}\n${esc(summary)}\n\nNu s-a putut trimite clientului: ${esc(reason)}. Trimiteți-l manual.`,
  });
  return { sent_via: 'proprietar', reason };
}

/* Marcarea ca achitată: plata și statusul în aceeași operație (pay_invoice), apoi fișa în „Plătit”
   (dacă nu e deja în Plătit / Încheiat), cu anunțul obișnuit din „Achitări”.
   Întoarce { result, moved } sau { error: 'already_paid' | 'notfound' }. */
async function markPaid(id, actor = '') {
  let result;
  try {
    result = await rest('rpc/pay_invoice', { method: 'POST', body: { p_id: Number(id), p_paid_on: todayChisinau() } });
  } catch (e) {
    if (/already_paid/.test(e.message)) return { error: 'already_paid' };
    if (/notfound/.test(e.message)) return { error: 'notfound' };
    throw e;
  }
  // Plata e salvată: dacă mutarea fișei cade, factura rămâne achitată, iar etapa se poate muta din fișă
  let moved = false;
  try {
    const [item] = await rest(`requests?id=eq.${result.request_id}&status=not.in.(platit,incheiat)`, {
      method: 'PATCH',
      body: { status: 'platit', status_comment: `Factura ${result.number} achitată`, status_updated_at: new Date().toISOString(), status_actor: actor },
      prefer: 'return=representation',
    });
    if (item) {
      moved = true;
      await notifySafely([paidTotal(item.id).then(paid => sendPayment(paymentText(item, paid)))]);
    }
  } catch (e) {
    console.error(`Mutarea fișei după factura ${result.number} a eșuat:`, e.message);
  }
  return { result, moved };
}

module.exports = {
  VAT_RATE, companyData, totals, defaults, validate, issue, savePdf, autoIssue, afterStatusChange,
  listFor, listItem, send, markPaid, LIST_FIELDS,
};
