/* Sesiunea de administrare, într-o singură funcție (Vercel Hobby are maximum 12 funcții în api/).
   POST /api/admin/login { password } — deschide sesiunea; maximum 5 parole greșite în 15 minute de pe același IP.
   POST /api/admin/logout — închide sesiunea.
   Adresele vechi rămân: vercel.json le trimite aici cu ?op=login / ?op=logout. */
const { jsonBody, ipKey, allow } = require('../_lib/http');
const { checkPassword, setSession, clearSession } = require('../_lib/auth');
const { countHits, addHit, clearHits } = require('../_lib/rate');

const MAX_FAILS = 5;
const WINDOW_MS = 15 * 60 * 1000;

async function login(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const key = ipKey('login', req);
  try {
    if (await countHits(key, WINDOW_MS) >= MAX_FAILS) return res.status(429).json({ ok: false, error: 'rate' });
    const body = jsonBody(req) || {};
    if (!checkPassword(body.password)) {
      await addHit(key);
      return res.status(401).json({ ok: false, error: 'password' });
    }
    await clearHits(key);
    setSession(res);
    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error('Autentificarea a eșuat:', e.message);
    return res.status(500).json({ ok: false, error: 'server' });
  }
}

module.exports = async function handler(req, res) {
  if (!allow(req, res, ['POST'])) return;
  const op = String(req.query.op || '');
  if (op === 'login') return login(req, res);
  if (op === 'logout') {
    clearSession(res);
    return res.status(200).json({ ok: true });
  }
  return res.status(404).json({ ok: false, error: 'notfound' });
};
