/* POST /api/mcp — serverul MCP al CRM-ului (Streamable HTTP, fără stare, fără dependențe).
   Acces doar cu antetul Authorization: Bearer <MCP_TOKEN>; fără token sau cu altul → 401, fără nicio citire din baza de date.
   Uneltele:
     lista_cereri   — cererile dintr-o perioadă (implicit azi, ora Moldovei), opțional dintr-o singură etapă
     cauta_client   — după nume, telefon sau email
     schimba_etapa  — mută clientul în altă etapă; istoricul îl scrie trigger-ul, cu autorul „MCP”
   La trecerea în Avans / Plătit pleacă același anunț pe Telegram ca din admin. */
const crypto = require('crypto');
const { rest } = require('./_lib/db');
const { jsonBody } = require('./_lib/http');
const { STATUSES, SOURCES } = require('./_lib/labels');
const { paymentText, isPayment, sendPayment, notifySafely } = require('./_lib/notify');

const ACTOR = 'MCP';
const TZ = 'Europe/Chisinau';
const MAX_ROWS = 100;
const PROTOCOLS = ['2025-06-18', '2025-03-26', '2024-11-05'];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const FIELDS = 'id,created_at,name,phone,email,status,source,status_updated_at';

function authorized(req) {
  const expected = (process.env.MCP_TOKEN || '').trim();
  const m = /^Bearer\s+(.+)$/i.exec(String(req.headers.authorization || ''));
  if (!expected || !m) return false;
  const a = crypto.createHash('sha256').update(m[1].trim()).digest();
  const b = crypto.createHash('sha256').update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}

// Data de azi și începutul unei zile calendaristice, în ora Moldovei
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date());
const PARTS = new Intl.DateTimeFormat('en-US', {
  timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric',
});
// Diferența față de UTC în acel moment (ora de vară inclusă), independent de fusul serverului
function offsetAt(date) {
  const p = Object.fromEntries(PARTS.formatToParts(date).map(x => [x.type, Number(x.value)]));
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute) - Math.floor(date.getTime() / 60000) * 60000;
}
function dayStart(date) {
  const [y, m, d] = date.split('-').map(Number);
  const midnightUtc = Date.UTC(y, m - 1, d);
  // A doua trecere corectează zilele în care se schimbă ora
  const guess = midnightUtc - offsetAt(new Date(midnightUtc));
  return new Date(midnightUtc - offsetAt(new Date(guess)));
}
const nextDay = date => {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
};
const localTime = iso => new Date(iso).toLocaleString('ro-RO', { timeZone: TZ, dateStyle: 'short', timeStyle: 'short' });

// Etapa se poate da cu cheia („platit”) sau cu numele din CRM („Plătit”), fără diacritice și majuscule
const plain = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
function statusKey(input) {
  const p = plain(input).replace(/\s+/g, '_');
  return Object.keys(STATUSES).find(k => k === p || plain(STATUSES[k]).replace(/\s+/g, '_') === p) || null;
}

const describe = r => ({
  id: r.id,
  nume: r.name,
  telefon: r.phone,
  email: r.email,
  etapa: STATUSES[r.status] || r.status,
  sursa: SOURCES[r.source] || r.source,
  creata: localTime(r.created_at),
  in_etapa_din: localTime(r.status_updated_at),
});

const STATUS_LIST = Object.values(STATUSES).join(', ');

const TOOLS = [
  {
    name: 'lista_cereri',
    title: 'Cererile dintr-o perioadă',
    description: `Cererile (clienții) din CRM-ul LUXARCH create într-o perioadă, cele mai noi primele. Fără date: doar azi (ora Moldovei). Etapele: ${STATUS_LIST}.`,
    inputSchema: {
      type: 'object',
      properties: {
        de_la: { type: 'string', description: 'Prima zi, AAAA-LL-ZZ (inclusiv). Implicit azi.' },
        pana_la: { type: 'string', description: 'Ultima zi, AAAA-LL-ZZ (inclusiv). Implicit aceeași cu de_la.' },
        etapa: { type: 'string', description: 'Opțional: doar cererile aflate acum în această etapă.' },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'cauta_client',
    title: 'Caută un client',
    description: 'Caută clienți în CRM după o parte din nume, telefon sau email. Întoarce id-ul de folosit la schimba_etapa.',
    inputSchema: {
      type: 'object',
      properties: { text: { type: 'string', description: 'Numele, telefonul sau emailul (măcar 2 caractere).' } },
      required: ['text'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'schimba_etapa',
    title: 'Schimbă etapa clientului',
    description: `Mută un client în altă etapă a pâlniei. Clientul se dă prin id sau prin nume (dacă numele găsește mai mulți clienți, nu se schimbă nimic). Etapele: ${STATUS_LIST}. La „Respins” motivul e obligatoriu. Trecerea apare în istoricul fișei cu marcajul MCP.`,
    inputSchema: {
      type: 'object',
      properties: {
        client: { type: 'string', description: 'Id-ul clientului sau numele lui.' },
        etapa: { type: 'string', description: 'Etapa nouă, de ex. „Plătit”.' },
        comentariu: { type: 'string', description: 'Opțional; obligatoriu la „Respins”.' },
      },
      required: ['client', 'etapa'],
      additionalProperties: false,
    },
    annotations: { destructiveHint: false, idempotentHint: true },
  },
];

class ToolError extends Error {}

async function listRequests({ de_la, pana_la, etapa } = {}) {
  const from = de_la || today();
  const to = pana_la || from;
  if (!DATE_RE.test(from) || !DATE_RE.test(to)) throw new ToolError('Datele se dau ca AAAA-LL-ZZ.');
  if (to < from) throw new ToolError('pana_la e înainte de de_la.');
  const filters = [
    `created_at=gte.${dayStart(from).toISOString()}`,
    `created_at=lt.${dayStart(nextDay(to)).toISOString()}`,
  ];
  if (etapa) {
    const key = statusKey(etapa);
    if (!key) throw new ToolError(`Etapă necunoscută: „${etapa}”. Etapele: ${STATUS_LIST}.`);
    filters.push(`status=eq.${key}`);
  }
  const rows = await rest(`requests?select=${FIELDS}&${filters.join('&')}&order=created_at.desc&limit=${MAX_ROWS + 1}`);
  return {
    perioada: from === to ? from : `${from} – ${to}`,
    total: rows.length > MAX_ROWS ? `peste ${MAX_ROWS}` : rows.length,
    cereri: rows.slice(0, MAX_ROWS).map(describe),
  };
}

async function findClients(text) {
  const q = String(text || '').trim().slice(0, 100);
  if (q.length < 2) throw new ToolError('Scrie măcar 2 caractere.');
  // Caracterele cu rol în sintaxa PostgREST se scot, ca textul să rămână doar un text de căutat
  const safe = q.replace(/[,()*%\\:"']/g, ' ').trim();
  if (!safe) throw new ToolError('Textul nu conține nimic de căutat.');
  const pattern = encodeURIComponent(`*${safe}*`);
  const digits = safe.replace(/\D/g, '');
  const conds = [`name.ilike.${pattern}`, `email.ilike.${pattern}`, `phone.ilike.${pattern}`];
  if (digits.length >= 3) conds.push(`phone.ilike.${encodeURIComponent(`*${digits}*`)}`);
  return rest(`requests?select=${FIELDS}&or=(${conds.join(',')})&order=created_at.desc&limit=20`);
}

async function changeStatus({ client, etapa, comentariu } = {}) {
  const key = statusKey(etapa);
  if (!key) throw new ToolError(`Etapă necunoscută: „${etapa}”. Etapele: ${STATUS_LIST}.`);
  const comment = typeof comentariu === 'string' ? comentariu.trim().slice(0, 1000) : '';
  if (key === 'respins' && !comment) throw new ToolError('La „Respins” motivul (comentariu) e obligatoriu.');

  const ref = String(client || '').trim();
  let found;
  if (UUID_RE.test(ref)) found = await rest(`requests?select=${FIELDS}&id=eq.${ref}`);
  else found = await findClients(ref);
  if (!found.length) throw new ToolError(`Nu am găsit niciun client pentru „${ref}”.`);
  if (found.length > 1) {
    return { schimbat: false, motiv: 'Mai mulți clienți se potrivesc; alege id-ul unuia.', clienti: found.map(describe) };
  }
  const before = found[0];
  if (before.status === key) return { schimbat: false, motiv: `Clientul e deja în etapa „${STATUSES[key]}”.`, client: describe(before) };

  // status_actor = „MCP”: trigger-ul îl copiază în status_history.actor
  const patch = { status: key, status_comment: comment, status_updated_at: new Date().toISOString(), status_actor: ACTOR };
  const [item] = await rest(`requests?id=eq.${before.id}`, { method: 'PATCH', body: patch, prefer: 'return=representation' });
  if (!item) throw new ToolError('Clientul nu mai există.');
  if (isPayment(key)) {
    const paid = await rest(`payments?select=amount&request_id=eq.${item.id}`)
      .then(rows => rows.reduce((s, p) => s + Number(p.amount), 0))
      .catch(() => null);
    await notifySafely([sendPayment(paymentText(item, paid))]);
  }
  return { schimbat: true, din: STATUSES[before.status] || before.status, in: STATUSES[key], marcaj_istoric: ACTOR, client: describe(item) };
}

async function callTool(name, args) {
  if (name === 'lista_cereri') return listRequests(args);
  if (name === 'cauta_client') {
    const rows = await findClients(args && args.text);
    return { gasiti: rows.length, clienti: rows.map(describe) };
  }
  if (name === 'schimba_etapa') return changeStatus(args);
  throw new ToolError(`Unealtă necunoscută: ${name}`);
}

const ok = (id, result) => ({ jsonrpc: '2.0', id, result });
const fail = (id, code, message) => ({ jsonrpc: '2.0', id, error: { code, message } });

async function handle(msg) {
  if (!msg || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') return fail(msg && msg.id !== undefined ? msg.id : null, -32600, 'Invalid Request');
  const { id, method, params = {} } = msg;
  // Notificările (fără id) nu primesc răspuns
  if (id === undefined || id === null) return null;
  switch (method) {
    case 'initialize':
      return ok(id, {
        protocolVersion: PROTOCOLS.includes(params.protocolVersion) ? params.protocolVersion : PROTOCOLS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'luxarch-crm', title: 'CRM LUXARCH', version: '1.0.0' },
        instructions: 'CRM-ul biroului de arhitectură LUXARCH: cererile clienților și etapele pâlniei de vânzări. Datele și orele sunt în ora Moldovei.',
      });
    case 'ping':
      return ok(id, {});
    case 'tools/list':
      return ok(id, { tools: TOOLS });
    case 'tools/call':
      try {
        const data = await callTool(params.name, params.arguments || {});
        return ok(id, { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }], structuredContent: data });
      } catch (e) {
        if (!(e instanceof ToolError)) console.error('MCP: unealta a eșuat:', e.message);
        const text = e instanceof ToolError ? e.message : 'Baza de date nu a răspuns. Încearcă din nou.';
        return ok(id, { content: [{ type: 'text', text }], isError: true });
      }
    default:
      return fail(id, -32601, `Metodă necunoscută: ${method}`);
  }
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (!authorized(req)) {
    res.setHeader('WWW-Authenticate', 'Bearer realm="luxarch-crm"');
    return res.status(401).json({ jsonrpc: '2.0', id: null, error: { code: -32001, message: 'Acces interzis: lipsește tokenul sau e greșit.' } });
  }
  // Fără flux SSE: serverul răspunde doar la POST
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ jsonrpc: '2.0', id: null, error: { code: -32000, message: 'Doar POST.' } });
  }
  const body = Array.isArray(req.body) ? req.body : jsonBody(req);
  if (!body) return res.status(400).json(fail(null, -32700, 'Parse error'));
  const replies = (await Promise.all((Array.isArray(body) ? body : [body]).map(handle))).filter(Boolean);
  if (!replies.length) return res.status(202).end();
  return res.status(200).json(Array.isArray(body) ? replies : replies[0]);
};
