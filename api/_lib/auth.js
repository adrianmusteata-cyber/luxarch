/* Sesiunea de administrare: un cookie semnat cu ADMIN_SECRET, valabil 7 zile.
   Parola vine din ADMIN_PASSWORD. Nu există utilizatori: o singură parolă.
   În Mini App Telegram nu există cookie: fiecare cerere aduce în antetul X-Telegram-Init-Data
   datele semnate de Telegram (initData), verificate cu tokenul botului nou (TELEGRAM_APP_BOT_TOKEN).
   Rolul vine din listele TG_OWNER_IDS (proprietar: tot panoul) și TG_STAFF_IDS (angajat: pâlnia și scanerul). */
const crypto = require('crypto');
const { cookies } = require('./http');

const COOKIE = 'temelia_admin';
const MAX_AGE = 7 * 24 * 3600; // secunde

function secret() {
  const s = process.env.ADMIN_SECRET;
  if (!s || s.length < 12) throw new Error('ADMIN_SECRET lipsește sau e prea scurt (minimum 12 caractere)');
  return s;
}

const sign = exp => crypto.createHmac('sha256', secret()).update(String(exp)).digest('base64url');

// Comparație în timp constant (pe amprente de aceeași lungime)
function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

function checkPassword(pw) {
  // Spațiile de la capete (copiate din greșeală) nu contează
  const expected = (process.env.ADMIN_PASSWORD || '').trim();
  if (!expected) throw new Error('ADMIN_PASSWORD lipsește');
  return typeof pw === 'string' && safeEqual(pw.trim(), expected);
}

function setSession(res) {
  const exp = Math.floor(Date.now() / 1000) + MAX_AGE;
  res.setHeader('Set-Cookie', `${COOKIE}=${exp}.${sign(exp)}; Path=/; Max-Age=${MAX_AGE}; HttpOnly; Secure; SameSite=Strict`);
}

function clearSession(res) {
  res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict`);
}

function isAuthed(req) {
  const [exp, sig] = (cookies(req)[COOKIE] || '').split('.');
  if (!exp || !sig || Number(exp) < Date.now() / 1000) return false;
  try { return safeEqual(sig, sign(exp)); } catch (e) { return false; }
}

/* ---------- Mini App Telegram ---------- */

const TG_HEADER = 'x-telegram-init-data';
const TG_MAX_AGE = 24 * 3600; // secunde: initData mai vechi de o zi nu mai e primit
const appToken = (env = process.env) => String(env.TELEGRAM_APP_BOT_TOKEN || '').trim();
// Tokenul botului de clienți. Gol dacă lipsește sau e identic cu al botului CRM: separarea de panou stă în tokenuri diferite
const clientToken = (env = process.env) => {
  const t = String(env.TELEGRAM_CLIENT_BOT_TOKEN || '').trim();
  return t && t !== appToken(env) ? t : '';
};

// „111, 222,abc” → Set { '111', '222' }: spațiile și valorile nenumerice se ignoră
const idList = v => new Set(String(v || '').split(',').map(s => s.trim()).filter(s => /^\d{1,20}$/.test(s)));

/* Verificarea după documentația Telegram WebApp:
   secret = HMAC_SHA256(cheie "WebAppData", tokenul botului);
   hash   = HMAC_SHA256(cheie secret, data_check_string), unde data_check_string = perechile cheie=valoare
   (toate, fără hash), sortate după cheie și unite cu \n. Întoarce parametrii fără hash sau null. */
function signedParams(raw, token) {
  if (typeof raw !== 'string' || !raw || raw.length > 8192) return null;
  const params = new URLSearchParams(raw);
  const hash = params.get('hash') || '';
  if (!/^[0-9a-f]{64}$/i.test(hash)) return null;
  params.delete('hash');
  const check = [...params.entries()].map(([k, v]) => `${k}=${v}`).sort().join('\n');
  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(token).digest();
  const expected = crypto.createHmac('sha256', secretKey).update(check).digest();
  return crypto.timingSafeEqual(expected, Buffer.from(hash, 'hex')) ? params : null;
}

// 'ok' | 'tg_bad' (auth_date lipsă) | 'tg_expired' (peste 24 de ore; 5 minute toleranță pentru ceas)
function ageState(params, now) {
  const authDate = Number(params.get('auth_date'));
  if (!Number.isInteger(authDate) || authDate <= 0) return 'tg_bad';
  const age = now / 1000 - authDate;
  return age > TG_MAX_AGE || age < -300 ? 'tg_expired' : 'ok';
}

// Întoarce { user } sau { error: 'tg_bad' | 'tg_expired' }
function verifyInitData(raw, token, now = Date.now()) {
  const params = signedParams(raw, token);
  if (!params) return { error: 'tg_bad' };
  // Abia după semnătură: data și utilizatorul vin de la Telegram, nu de la cine a trimis cererea
  const state = ageState(params, now);
  if (state !== 'ok') return { error: state };
  let user;
  try { user = JSON.parse(params.get('user') || ''); } catch (e) { return { error: 'tg_bad' }; }
  if (!user || !Number.isSafeInteger(user.id) || user.id <= 0) return { error: 'tg_bad' };
  return { user };
}

/* Numărul trimis prin requestContact e „dovedit” doar dacă toate condițiile sunt îndeplinite; altfel e „scris de mână”.
   Formatul răspunsului (contact=<JSON>&auth_date=...&hash=...) nu e descris în documentația oficială, și nici semnătura lui.
   Încercăm formula de la initData: dacă Telegram semnează altfel, HMAC-ul nu se potrivește, iar rezultatul e mereu false,
   deci niciodată o mențiune falsă. Un șir initData nu trece: nu are câmpul contact.
   Întoarce true/false și nu scrie nimic în jurnal. */
function verifyContact(raw, token, userId, phone, now = Date.now()) {
  const params = signedParams(raw, token);
  if (!params || ageState(params, now) !== 'ok') return false;
  let contact;
  try { contact = JSON.parse(params.get('contact') || ''); } catch (e) { return false; }
  if (!contact || String(contact.user_id) !== String(userId)) return false;
  const digits = String(contact.phone_number || '').replace(/\D/g, '');
  return !!digits && digits === String(phone || '').replace(/\D/g, '');
}

// Rolul din initData: proprietar (chiar dacă e și în lista angajaților), angajat sau refuzat.
// Întoarce { role, id, user } sau { status, error, tg_id? }
function telegramRole(raw, env = process.env, now = Date.now()) {
  const token = appToken(env);
  if (!token) return { status: 500, error: 'tg_config' };
  const { user, error } = verifyInitData(raw, token, now);
  if (error) return { status: 401, error };
  const id = String(user.id);
  if (idList(env.TG_OWNER_IDS).has(id)) return { role: 'owner', id, user };
  if (idList(env.TG_STAFF_IDS).has(id)) return { role: 'staff', id, user };
  // ID-ul e semnat de Telegram, deci e chiar al lui: îl poate trimite proprietarului
  return { status: 403, error: 'tg_denied', tg_id: id };
}

// Numele din initData verificat: Telegram le semnează, dar tipul și lungimea le controlăm noi
const clip = (v, max) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max) : '');
const tgName = u => ({
  username: clip(u.username, 32).replace(/[^A-Za-z0-9_]/g, ''),
  first_name: clip(u.first_name, 64),
  last_name: clip(u.last_name, 64),
});

/* Autorul unei acțiuni (client creat, etapă schimbată), pentru coloanele created_by și status_actor:
   „@username”, iar fără username numele complet din Telegram. Din browser (parola) → '': pe site nu există utilizatori. */
function actorOf(req) {
  const u = req && req.tgUser;
  if (!u) return '';
  if (u.username) return '@' + u.username;
  return [u.first_name, u.last_name].filter(Boolean).join(' ') || `ID ${u.id}`;
}

/* Folosit de toate rutele /api/admin/*. Întoarce rolul ('owner' | 'staff') sau false, după ce a răspuns cu eroarea.
   Implicit rutele sunt doar pentru proprietar; { staff: true } le deschide și angajaților.
   Cu antetul Telegram contează doar Telegramul; fără el, cookie-ul cu parola (= proprietar), ca până acum.
   „Vezi ca angajat”: antetul X-View-As: staff contează doar după ce rolul real verificat e proprietar;
   atunci cererea e tratată exact ca a unui angajat (req.viewAs = true). Antetul doar scade drepturile, nu le ridică. */
const VIEW_HEADER = 'x-view-as';

function requireAdmin(req, res, { staff = false } = {}) {
  res.setHeader('Cache-Control', 'no-store');
  req.viewAs = false;
  req.tgUser = null; // se completează doar din initData verificat, niciodată din corpul cererii
  const raw = req.headers[TG_HEADER];
  // Fără antet, sau fără token (calea Telegram oprită) dar cu sesiunea cu parola: proprietar
  if ((!raw || !appToken()) && isAuthed(req)) return asRole(req, res, 'owner', staff);
  if (!raw) {
    res.status(401).json({ ok: false, error: 'auth' });
    return false;
  }
  const r = telegramRole(String(raw));
  if (r.error) {
    res.status(r.status).json({ ok: false, error: r.error, ...(r.tg_id ? { tg_id: r.tg_id } : {}) });
    return false;
  }
  // Utilizatorul Telegram verificat: { id, role, username, first_name, last_name }
  req.tgUser = { id: r.id, role: r.role, ...tgName(r.user) };
  return asRole(req, res, r.role, staff);
}

// Rolul efectiv, după rolul real deja verificat: proprietarul cu X-View-As: staff devine angajat
function asRole(req, res, real, staff) {
  const viewAs = real === 'owner' && String(req.headers[VIEW_HEADER] || '').trim().toLowerCase() === 'staff';
  const role = viewAs ? 'staff' : real;
  req.viewAs = viewAs;
  if (req.tgUser) req.tgUser.role = role;
  if (role === 'staff' && !staff) {
    res.status(403).json({ ok: false, error: 'forbidden' });
    return false;
  }
  return role;
}

module.exports = { checkPassword, setSession, clearSession, isAuthed, requireAdmin, verifyInitData, verifyContact, telegramRole, actorOf, clientToken, tgName };
