/* ==========================================================
   Panoul de administrare (CRM): autentificare, tabla pâlniei de vânzări,
   listă cu filtru, client nou adăugat manual, fișa clientului.
   Starea stă în adresă: /admin (tabla), /admin?view=list&status=noua,
   /admin?new=1 sau /admin?id=<uuid>
   În Mini App Telegram (Telegram.WebApp.initData nu e gol) nu există parolă: fiecare cerere trimite
   initData în antet, iar serverul spune rolul — proprietarul vede tot, angajatul doar pâlnia și scanerul.
   ========================================================== */
(() => {
  const $ = (s, c = document) => c.querySelector(s);

  const TG = window.Telegram && window.Telegram.WebApp;
  const inTg = !!(TG && TG.initData);
  // În browser există doar parola, deci proprietarul; în Telegram rolul vine de la server la pornire
  let role = inTg ? null : 'owner';
  const isStaff = () => role === 'staff';
  // „Vezi ca angajat”: proprietarul vede panoul exact ca un angajat. Alegerea ține cât fereastra (sessionStorage),
  // fiecare cerere trimite antetul X-View-As, iar serverul îl ia în seamă doar pentru proprietar (`preview` în ?me=1)
  const VIEW_KEY = 'luxarch-view-as';
  function storeViewAs(on) {
    try {
      if (on) sessionStorage.setItem(VIEW_KEY, 'staff'); else sessionStorage.removeItem(VIEW_KEY);
      return true;
    } catch (e) { return false; } // fereastră privată sau stocare blocată
  }
  let viewAsStaff = (() => { try { return sessionStorage.getItem(VIEW_KEY) === 'staff'; } catch (e) { return false; } })();
  let preview = false;
  // Telegram mai vechi nu are toate metodele: ce lipsește se sare, aplicația merge mai departe
  const tgCall = (method, ...args) => { try { if (inTg && typeof TG[method] === 'function') TG[method](...args); } catch (e) { /* versiune veche */ } };
  const tgAtLeast = v => inTg && typeof TG.isVersionAtLeast === 'function' && TG.isVersionAtLeast(v);
  const haptic = () => { if (tgAtLeast('6.1')) try { TG.HapticFeedback.notificationOccurred('success'); } catch (e) { /* fără vibrație */ } };
  // Tipurile pe care angajatul le poate salva (serverul refuză oricum restul)
  const STAFF_DOC_TYPES = ['carte_vizita', 'chestionar', 'aviz', 'chitanta'];

  // Etapele pâlniei, în ordine; „Respins” și „Închisă” sunt ieșirile din pâlnie
  const STATUSES = { noua: 'Nouă', contactata: 'Contactată', in_lucru: 'În lucru', procesat: 'Procesat', avans: 'Avans', platit: 'Plătit', incheiat: 'Încheiat', respins: 'Respins', inchisa: 'Închisă' };
  const TYPES = { casa: 'Casă unifamilială', ansamblu: 'Ansamblu rezidențial', birouri: 'Clădire de birouri / comercială', hala: 'Hală / industrial', expertiza: 'Expertiză / consolidare', altceva: 'Altceva' };
  const SERVICES = { arh_rez: 'Arhitectură + Rezistență', arh: 'Doar arhitectură', rez: 'Doar rezistență', design: 'Design interior', management: 'Management de proiect', nu_stiu: 'Nu știu încă' };
  const SOURCES = { site: 'Site web', manual: 'Manual', carte_vizita: 'Carte de vizită', chestionar: 'Chestionar', document: 'Document', telegram: 'Telegram' };
  // Tipurile de documente; `ready` = secțiunea lor există (restul vin în etapele următoare)
  const DOC_TYPES = {
    carte_vizita: { label: 'Carte de vizită', ready: true },
    chestionar: { label: 'Chestionar', ready: true },
    aviz: { label: 'Aviz de expediere', ready: true },
    chitanta: { label: 'Chitanță / factură achitată', ready: true },
    de_platit: { label: 'Factură / contract de plătit', ready: true },
    de_incasat: { label: 'Factură / contract de încasat', ready: true },
    lista_preturi: { label: 'Listă de prețuri', ready: true },
  };
  const CHANNELS = { apel: 'Apel', intalnire: 'Întâlnire' };
  const FIELD_NAMES = { name: 'nume', phone: 'telefon', channel: 'cum a venit', email: 'email', type: 'tip proiect', service: 'servicii', status: 'etapă', notes: 'note', contact: 'telefon sau email', message: 'despre proiect' };

  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = d => new Date(d).toLocaleString('ro-RO', { timeZone: 'Europe/Chisinau', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  const fmtDay = d => new Date(d).toLocaleDateString('ro-RO', { timeZone: 'Europe/Chisinau', day: '2-digit', month: '2-digit', year: 'numeric' });
  const badge = s => `<span class="badge s-${esc(s)}">${esc(STATUSES[s] || s)}</span>`;
  // „Site web” sau „Manual · Apel” / „Manual · Întâlnire” / „Telegram · Apel”
  const srcText = r => (SOURCES[r.source] || r.source) + (r.channel ? ` · ${CHANNELS[r.channel] || r.channel}` : '');
  const srcTag = r => `<span class="src src-${esc(r.source)}">${esc(srcText(r))}</span>`;
  const label = (map, k) => (k ? esc(map[k] || k) : '—');
  // Autorul din Mini App („@username” sau numele), salvat de server din initData verificat; gol = din browser
  // „MCP” = etapa schimbată din Claude Code prin serverul /api/mcp; restul autorilor vin din Telegram
  const byTg = who => (who === 'MCP' ? 'MCP (Claude Code)' : who ? `${esc(who)} (Telegram)` : '');
  // Cererea trimisă de client din botul lui: @username devine link spre Telegram doar dacă are forma corectă
  const tgClientLink = who => (/^@[A-Za-z0-9_]{4,32}$/.test(who || '')
    ? `<a href="https://t.me/${esc(who.slice(1))}" target="_blank" rel="noopener">${esc(who)}</a>` : esc(who));

  // Sume: „12 500”, „3 000,50” (spațiu nedespărțitor la mii, zecimale doar când există)
  const num = v => {
    const [i, d] = Number(v).toFixed(2).split('.');
    return i.replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + (d === '00' ? '' : ',' + d);
  };
  const money = (v, cur) => `${num(v)} ${cur}`;
  const hasContract = r => r.contract_value !== null && r.contract_value !== undefined;
  const fullyPaid = (r, paid) => hasContract(r) && Number(r.contract_value) > 0 && paid >= Number(r.contract_value);
  // Pe carte și în listă: „Plătit 5 000 / 12 000 MDL”, „Plătit 5 000 MDL” sau nimic
  function payText(r) {
    const paid = Number(r.paid_total || 0);
    if (hasContract(r)) return `Plătit ${num(paid)} / ${money(r.contract_value, r.currency)}`;
    return paid > 0 ? `Plătit ${money(paid, r.currency)}` : '';
  }
  // „12 500,5” sau „12500.50” → 12500.5; altfel null
  const parseMoney = s => {
    const t = String(s).replace(/[\s ]/g, '').replace(',', '.');
    return /^\d{1,8}(\.\d{1,2})?$/.test(t) ? Number(t) : null;
  };
  const today = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Chisinau' });
  const fmtPayDay = d => d.split('-').reverse().join('.');
  const digits = p => String(p).replace(/[^\d+]/g, '');
  const options = (map, selected, empty) =>
    (empty ? `<option value="">${esc(empty)}</option>` : '') +
    Object.entries(map).map(([k, l]) => `<option value="${k}"${k === selected ? ' selected' : ''}>${esc(l)}</option>`).join('');

  const views = { login: $('#view-login'), tg: $('#view-tg'), board: $('#view-board'), list: $('#view-list'), new: $('#view-new'), detail: $('#view-detail'), fin: $('#view-fin'), dues: $('#view-dues'), cat: $('#view-cat'), viz: $('#view-viz') };
  let current = '';
  function show(name) {
    current = name;
    const out = name === 'login' || name === 'tg';
    Object.entries(views).forEach(([k, el]) => { el.hidden = k !== name; });
    $('#logout').hidden = out || inTg; // în Telegram nu există sesiune cu parolă
    $('#docBtn').hidden = out;
    // Antetul: CRM și Vizualizări pentru toți; secțiunile cu bani și „Vezi ca angajat” doar pentru proprietar
    $('#barNav').hidden = out;
    $('#barNav').querySelectorAll('a[data-sec="fin"], a[data-sec="dues"], a[data-sec="cat"]').forEach(a => { a.hidden = role !== 'owner'; });
    $('#viewAsBtn').hidden = role !== 'owner' || !viewAsOk;
    $('#previewBand').hidden = out || !preview;
    const sec = ['fin', 'dues', 'cat', 'viz'].includes(name) ? name : 'crm';
    $('#barNav').querySelectorAll('a').forEach(a => a.classList.toggle('is-on', a.dataset.sec === sec));
    if (name === 'fin') document.title = 'Financiar — LUXARCH';
    if (name === 'dues') document.title = 'Scadențe — LUXARCH';
    if (name === 'cat') document.title = 'Catalog — LUXARCH';
    if (name === 'viz') document.title = 'Vizualizări — LUXARCH';
    $('#toolbar').hidden = name !== 'board' && name !== 'list';
    $('#main').classList.toggle('is-wide', name === 'board');
    $('#viewSwitch').querySelectorAll('a').forEach(a => a.classList.toggle('is-on', a.dataset.view === name));
    syncBack();
  }

  class AuthError extends Error {}
  // Telegram: initData respins (expirat, fals, ID scos din listă, bot neconfigurat); ecranul e deja afișat
  class TgError extends AuthError {}
  async function api(path, opts = {}) {
    const headers = {};
    if (opts.body) headers['Content-Type'] = 'application/json';
    if (inTg) headers['X-Telegram-Init-Data'] = TG.initData;
    if (viewAsStaff) headers['X-View-As'] = 'staff'; // doar scade drepturile; la angajat serverul îl ignoră
    const r = await fetch(path, {
      ...opts,
      headers: Object.keys(headers).length ? headers : undefined,
      credentials: 'same-origin',
    });
    if (r.status === 401 && !inTg) throw new AuthError();
    const data = await r.json().catch(() => ({}));
    // În Telegram nu apare niciodată ecranul cu parola: orice 401 înseamnă initData vechi sau greșit
    if (inTg && (r.status === 401 || /^tg_/.test(data.error || ''))) {
      tgScreen(r.status === 401 && !/^tg_/.test(data.error || '') ? 'tg_expired' : data.error, data.tg_id);
      throw new TgError();
    }
    if (!r.ok) throw Object.assign(new Error(data.error || `HTTP ${r.status}`), { status: r.status, fields: data.fields || [], data });
    return data;
  }

  const clearScreens = () => { $('#list').innerHTML = ''; $('#board').innerHTML = ''; $('#detail').innerHTML = ''; $('#fin').innerHTML = ''; $('#cat').innerHTML = ''; $('#vizList').innerHTML = ''; };

  // Orice 401 golește ecranul și cere parola din nou (în Telegram: ecranul cu motivul, fără parolă)
  function onError(err, fallback) {
    if (err instanceof TgError) { clearScreens(); return; }
    if (err instanceof AuthError) {
      clearScreens();
      show('login'); $('#pw').focus();
      return;
    }
    fallback(err);
  }

  /* ---------- Mini App Telegram ---------- */
  const TG_SCREENS = {
    tg_denied: ['Acces refuzat', 'Nu ai încă acces. Trimite proprietarului ID-ul tău Telegram:'],
    tg_expired: ['Sesiunea a expirat', 'Sesiunea a expirat. Închide aplicația și deschide-o din nou din butonul CRM.'],
    tg_bad: ['Sesiunea a expirat', 'Datele Telegram nu au putut fi verificate. Închide aplicația și deschide-o din nou din butonul CRM.'],
    tg_config: ['Mini App nu e gata', 'Mini App nu e configurată încă (lipsește tokenul botului).'],
  };
  function tgScreen(code, tgId) {
    const [title, text] = TG_SCREENS[code] || TG_SCREENS.tg_bad;
    document.querySelectorAll('dialog[open]').forEach(d => d.close());
    $('#tgTitle').textContent = title;
    $('#tgText').textContent = text;
    // ID-ul vine de la server (verificat); dacă lipsește, din datele deschise ale Telegramului
    const id = code === 'tg_denied' ? String(tgId || TG.initDataUnsafe?.user?.id || '') : '';
    $('#tgId').textContent = id;
    $('#tgId').hidden = !id;
    $('#tgCopy').hidden = !id;
    $('#tgCopy').textContent = 'Copiază ID-ul';
    $('#tgRetry').hidden = true;
    $('#toolbar').hidden = true;
    show('tg');
  }

  // Copierea merge și unde clipboard-ul modern e blocat (fereastra Telegram): textarea + execCommand
  $('#tgCopy').addEventListener('click', async e => {
    const text = $('#tgId').textContent, btn = e.currentTarget;
    let ok = false;
    try { await navigator.clipboard.writeText(text); ok = true; } catch (err) {
      const t = document.createElement('textarea');
      t.value = text; t.setAttribute('readonly', ''); t.style.position = 'fixed'; t.style.opacity = '0';
      document.body.appendChild(t); t.select();
      try { ok = document.execCommand('copy'); } catch (err2) { ok = false; }
      t.remove();
    }
    btn.textContent = ok ? 'Copiat' : 'Ține apăsat pe ID ca să-l copiezi';
  });

  // Butonul Back al Telegramului: vizibil oriunde în afară de pâlnie (sau când un dialog e deschis)
  const anyDialog = () => document.querySelector('dialog[open]');
  function syncBack() {
    if (!tgAtLeast('6.1')) return;
    const visible = !!anyDialog() || !['board', 'tg', 'login', ''].includes(current);
    try { TG.BackButton[visible ? 'show' : 'hide'](); } catch (e) { /* versiune veche */ }
  }
  // Face exact ce face „Înapoi” din panou: închide dialogul, altfel linkul „← Înapoi” al ecranului, altfel pâlnia
  function tgBack() {
    const open = anyDialog();
    if (open) { open.close(); return; }
    const link = views[current] && views[current].querySelector('a.back');
    go(link ? (link.getAttribute('href').split('?')[1] || '') : '');
  }

  function tgSetup() {
    document.documentElement.classList.add('is-tg');
    tgCall('ready');
    tgCall('expand');
    // Tot ecranul pe telefon (Bot API 8.0+); pe Telegram vechi rămâne expand()
    if (['ios', 'android'].includes(TG.platform) && tgAtLeast('8.0')) tgCall('requestFullscreen');
    // Derularea în jos nu închide aplicația din greșeală (7.7+)
    if (tgAtLeast('7.7')) tgCall('disableVerticalSwipes');
    // Antetul și fundalul Telegramului iau culoarea panoului (tema rămâne deschisă și în tema întunecată)
    const bg = getComputedStyle(document.body).getPropertyValue('--bg').trim() || '#F4F0E8';
    if (tgAtLeast('6.1')) { tgCall('setHeaderColor', bg); tgCall('setBackgroundColor', bg); }
    if (tgAtLeast('7.10')) tgCall('setBottomBarColor', bg);
    if (tgAtLeast('6.1')) try { TG.BackButton.onClick(tgBack); } catch (e) { /* fără Back */ }
    // Scanerul: „Fotografiază” (camera din spate) și „Alege fișier” (poze sau PDF)
    $('#docCamLabel').hidden = false;
    $('#docFileText').textContent = 'Alege fișier';
  }

  // Rolul primit de la server: angajatul nu vede secțiunile cu bani și tipurile de documente ale proprietarului
  function applyRole() {
    document.body.classList.toggle('is-staff', isStaff());
    const types = Object.entries(DOC_TYPES).filter(([k]) => !isStaff() || STAFF_DOC_TYPES.includes(k));
    $('#docType').innerHTML = types.map(([k, t]) => `<option value="${k}">${esc(t.label)}</option>`).join('');
  }

  // Pornirea: în browser direct la ecranul cerut; în Telegram (sau în previzualizare) întâi rolul,
  // dintr-o rută permisă ambelor roluri
  async function boot() {
    if (!inTg && !viewAsStaff) return route();
    if (inTg) tgSetup();
    try {
      const me = await api('/api/admin/requests?me=1');
      role = me.role;
      preview = !!me.preview;
      // Antetul a fost ignorat (nu ești proprietar): alegerea veche nu mai are rost
      if (viewAsStaff && !preview) { viewAsStaff = false; storeViewAs(false); }
      applyRole();
      route();
    } catch (err) {
      onError(err, () => {
        tgScreen('tg_bad');
        $('#tgTitle').textContent = 'Nu s-a putut porni';
        $('#tgText').textContent = 'Nu am putut încărca panoul. Verifică internetul și reîncearcă.';
        $('#tgRetry').hidden = false;
      });
    }
  }
  $('#tgRetry').addEventListener('click', boot);

  // Comutarea reîncarcă pagina pe pâlnie: pe ecran nu rămân date de proprietar (nici invers).
  // În Telegram, telegram-web-app.js își reia initData din sessionStorage după reîncărcare.
  function switchView(on) {
    if (!storeViewAs(on)) return;
    location.replace('/admin');
  }
  // Fără sessionStorage alegerea nu ar supraviețui reîncărcării: butonul nu apare
  const viewAsOk = storeViewAs(viewAsStaff);
  if (!viewAsOk) $('#viewAsBtn').hidden = true;
  $('#viewAsBtn').addEventListener('click', () => switchView(true));
  $('#previewExit').addEventListener('click', () => switchView(false));

  /* ---------- Navigare ---------- */
  const params = () => new URLSearchParams(location.search);
  function go(qs, replace) {
    history[replace ? 'replaceState' : 'pushState'](null, '', '/admin' + (qs ? '?' + qs : ''));
    route();
  }
  function route() {
    const p = params();
    // Angajatul nu are Financiar, Scadențe și Catalog: o adresă veche duce la pâlnie
    if (isStaff() && (p.get('fin') || p.get('due') || p.get('cat'))) return go('', true);
    // Numărul de restanțe din antet, la fiecare navigare (doar proprietarul; angajatul ar primi 403)
    if (role === 'owner') window.LUXDUES.refreshCount();
    if (p.get('fin')) { ++loadSeq; window.LUXFIN.route(p); }
    else if (p.get('due')) { ++loadSeq; window.LUXDUES.route(p); }
    else if (p.get('cat')) { ++loadSeq; window.LUXCAT.route(p); }
    else if (p.get('viz')) { ++loadSeq; window.LUXVIZ.route(p); } // și angajatul
    else if (p.get('id')) loadDetail(p.get('id'));
    else if (p.get('new')) showNew();
    else if (p.get('view') === 'list') loadList(true);
    else loadBoard();
  }
  window.addEventListener('popstate', route);

  // Linkurile interne merg fără reîncărcare (Ctrl/Cmd + clic deschide în tab nou)
  function internal(e, a) {
    if (!a || e.metaKey || e.ctrlKey || e.shiftKey || e.button) return false;
    e.preventDefault();
    go(a.getAttribute('href').split('?')[1] || '');
    return true;
  }

  // Unde duce „Înapoi”: pagina de unde s-a deschis fișa (tabla sau lista filtrată)
  function backQs() {
    const p = params();
    p.delete('id'); p.delete('new');
    return p.toString();
  }
  // Fișa păstrează în adresă de unde a fost deschisă
  function detailQs(id) {
    const p = params();
    p.delete('new');
    p.set('id', id);
    return p.toString();
  }

  /* ---------- Autentificare ---------- */
  $('#showPw').addEventListener('change', e => { $('#pw').type = e.target.checked ? 'text' : 'password'; });

  $('#loginForm').addEventListener('submit', async e => {
    e.preventDefault();
    const btn = $('#loginBtn'), msg = $('#loginMsg');
    btn.disabled = true; msg.textContent = '';
    try {
      await api('/api/admin/login', { method: 'POST', body: JSON.stringify({ password: $('#pw').value }) });
      $('#pw').value = '';
      boot(); // cu previzualizarea pornită, întâi rolul de la server
    } catch (err) {
      msg.textContent = err.status === 429 ? 'Prea multe încercări, reveniți în 15 minute.'
        : err instanceof AuthError ? 'Parolă incorectă.'
        : 'Nu am putut verifica parola. Reîncercați.';
    } finally {
      btn.disabled = false;
    }
  });

  $('#logout').addEventListener('click', async () => {
    await fetch('/api/admin/logout', { method: 'POST' }).catch(() => {});
    // Ieșirea oprește și previzualizarea; după o nouă parolă panoul pornește ca proprietar
    storeViewAs(false); viewAsStaff = false; preview = false; role = 'owner'; applyRole();
    $('#list').innerHTML = ''; $('#board').innerHTML = ''; $('#detail').innerHTML = ''; $('#fin').innerHTML = ''; $('#cat').innerHTML = '';
    history.replaceState(null, '', '/admin');
    show('login');
  });

  $('#toolbar').addEventListener('click', e => internal(e, e.target.closest('a[href^="/admin"]')));
  $('#barNav').addEventListener('click', e => internal(e, e.target.closest('a')));

  const setTitle = n => { document.title = `${n ? `(${n}) ` : ''}Clienți — LUXARCH`; };

  /* ---------- Motivul respingerii ---------- */
  // Întoarce motivul scris sau null, dacă s-a renunțat
  function askReason(who) {
    const dlg = $('#rejectDlg'), form = $('#rejectDlgForm'), text = $('#rejectDlgText'), msg = $('#rejectDlgMsg');
    $('#rejectDlgWho').textContent = who;
    text.value = ''; msg.textContent = '';
    dlg.showModal(); text.focus(); syncBack();
    return new Promise(resolve => {
      function done(value) {
        form.removeEventListener('submit', onSubmit);
        dlg.removeEventListener('close', onClose);
        if (dlg.open) dlg.close();
        syncBack();
        resolve(value);
      }
      function onSubmit(e) {
        e.preventDefault();
        if (e.submitter && e.submitter.value === 'cancel') return done(null);
        if (!text.value.trim()) { msg.textContent = 'Motivul e obligatoriu la „Respins”.'; text.focus(); return; }
        done(text.value.trim());
      }
      const onClose = () => done(null); // Esc
      form.addEventListener('submit', onSubmit);
      dlg.addEventListener('close', onClose);
    });
  }

  // Doar ultima încărcare pornită are voie să scrie pe ecran:
  // clicuri repetate nu mai dublează rândurile
  let loadSeq = 0;

  /* ---------- Tabla pâlniei ---------- */
  const board = $('#board');
  const boardItems = new Map();

  function cardHtml(r) {
    const moves = Object.entries(STATUSES).filter(([k]) => k !== r.status)
      .map(([k, l]) => `<option value="${k}">${esc(l)}</option>`).join('');
    return `<article class="card${r.status === 'noua' ? ' is-new' : ''}" draggable="true" data-id="${esc(r.id)}">
      <a class="card-name" href="/admin?id=${esc(r.id)}">${esc(r.name)}</a>
      <span class="card-meta">${esc(r.phone || r.email)}</span>
      ${payText(r) ? `<span class="card-pay${fullyPaid(r, r.paid_total) ? ' is-paid' : ''}">${esc(payText(r))}</span>` : ''}
      ${r.overdue ? '<span class="due-tag is-overdue">Restant</span>' : ''}
      <span class="card-foot">${srcTag(r)}<span>${esc(fmtDay(r.created_at))}</span></span>
      <select class="card-move" aria-label="Mută „${esc(r.name)}” în altă etapă">
        <option value="" selected>Mută în…</option>${moves}
      </select>
    </article>`;
  }

  // Telegram pe telefon: o singură etapă pe ecran, aleasă din rândul de sus și păstrată în adresă (?stage=)
  const phoneMq = window.matchMedia('(max-width: 700px)');
  const stageOf = () => (STATUSES[params().get('stage')] ? params().get('stage') : 'noua');
  function markStage() {
    const s = stageOf();
    board.querySelectorAll('.col').forEach(col => col.classList.toggle('is-current', col.dataset.status === s));
    $('#stageTabs').querySelectorAll('a').forEach(a => a.classList.toggle('is-on', a.dataset.stage === s));
  }

  function renderBoard() {
    const items = [...boardItems.values()];
    board.innerHTML = Object.keys(STATUSES).map(s => `
      <section class="col" data-status="${s}" aria-label="${esc(STATUSES[s])}">
        <header class="col-head">${badge(s)}<span class="count"></span></header>
        <div class="col-body">${items.filter(r => r.status === s).map(cardHtml).join('')}</div>
      </section>`).join('');
    $('#stageTabs').innerHTML = inTg ? Object.entries(STATUSES).map(([k, l]) =>
      `<a class="filter" href="/admin?stage=${k}" data-stage="${k}">${esc(l)}<span class="count"></span></a>`).join('') : '';
    markStage();
    updateCounts();
  }

  // Alegerea etapei nu reîncarcă tabla: doar adresa (ca Back din fișă să revină aici) și coloana afișată
  $('#stageTabs').addEventListener('click', e => {
    const a = e.target.closest('a[data-stage]');
    if (!a) return;
    e.preventDefault();
    history.replaceState(null, '', '/admin?stage=' + a.dataset.stage);
    markStage();
    a.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  });

  function updateCounts() {
    board.querySelectorAll('.col').forEach(col => {
      const n = col.querySelectorAll('.card').length;
      col.querySelector('.count').textContent = n;
      col.classList.toggle('is-empty', !n);
      const tab = $(`#stageTabs a[data-stage="${col.dataset.status}"] .count`);
      if (tab) tab.textContent = n;
    });
    setTitle([...boardItems.values()].filter(r => r.status === 'noua').length);
  }

  // Pune cartea clientului (din nou) în coloana etapei lui, sus
  function placeCard(r) {
    board.querySelector(`.card[data-id="${CSS.escape(r.id)}"]`)?.remove();
    board.querySelector(`.col[data-status="${r.status}"] .col-body`).insertAdjacentHTML('afterbegin', cardHtml(r));
    updateCounts();
  }

  async function moveCard(id, next) {
    const r = boardItems.get(id), msg = $('#boardMsg');
    if (!r || r.status === next || !STATUSES[next]) return;
    let comment = '';
    if (next === 'respins') {
      comment = await askReason(r.name);
      if (comment === null) { // cartea rămâne unde era, selectorul revine la „Mută în…”
        const sel = board.querySelector(`.card[data-id="${CSS.escape(id)}"] .card-move`);
        if (sel) sel.value = '';
        return;
      }
    }
    const prev = r.status;
    r.status = next; placeCard(r); // se mută imediat; revine dacă salvarea eșuează
    msg.textContent = '';
    try {
      const { item } = await api('/api/admin/requests/' + encodeURIComponent(id), {
        method: 'PATCH', body: JSON.stringify({ status: next, comment }),
      });
      Object.assign(r, item);
      haptic();
    } catch (err) {
      r.status = prev; placeCard(r);
      onError(err, () => { msg.textContent = `Nu am putut muta „${r.name}”. Reîncercați.`; });
    }
  }

  async function loadBoard() {
    const seq = ++loadSeq, msg = $('#boardMsg');
    if (!boardItems.size) msg.textContent = 'Se încarcă…';
    try {
      const { items } = await api('/api/admin/requests?all=1');
      if (seq !== loadSeq) return;
      boardItems.clear();
      items.forEach(r => boardItems.set(r.id, r));
      show('board');
      renderBoard();
      msg.textContent = items.length ? '' : 'Niciun client încă. Cererile de pe site apar aici automat, în „Nouă”.';
    } catch (err) {
      if (seq !== loadSeq) return;
      onError(err, () => {
        show('board');
        msg.innerHTML = 'Nu am putut încărca clienții. <button class="btn btn-sm btn-ghost" id="retryB">Reîncearcă</button>';
        $('#retryB').onclick = loadBoard;
      });
    }
  }

  // Trage cu mouse-ul: drag & drop între coloane
  let dragId = null;
  board.addEventListener('dragstart', e => {
    const card = e.target.closest('.card');
    if (!card) return;
    // În Telegram pe telefon se mută doar din „Mută în…”: tragerea ar lupta cu derularea
    if (inTg && phoneMq.matches) { e.preventDefault(); return; }
    dragId = card.dataset.id;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', dragId);
    card.classList.add('is-drag');
  });
  board.addEventListener('dragend', () => {
    dragId = null;
    board.querySelectorAll('.is-drag, .is-over').forEach(el => el.classList.remove('is-drag', 'is-over'));
  });
  board.addEventListener('dragover', e => {
    const col = e.target.closest('.col');
    if (!col || !dragId) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    board.querySelectorAll('.col.is-over').forEach(c => c !== col && c.classList.remove('is-over'));
    col.classList.add('is-over');
  });
  board.addEventListener('dragleave', e => {
    const col = e.target.closest('.col');
    if (col && !col.contains(e.relatedTarget)) col.classList.remove('is-over');
  });
  board.addEventListener('drop', e => {
    const col = e.target.closest('.col');
    if (!col || !dragId) return;
    e.preventDefault();
    col.classList.remove('is-over');
    moveCard(dragId, col.dataset.status);
  });

  // Pe telefon (și din tastatură): selectorul „Mută în…” de pe carte
  board.addEventListener('change', e => {
    const sel = e.target.closest('.card-move');
    if (sel && sel.value) moveCard(sel.closest('.card').dataset.id, sel.value);
  });

  // Clic pe carte (oriunde, în afară de selector) → fișa clientului
  board.addEventListener('click', e => {
    if (e.target.closest('.card-move')) return;
    const card = e.target.closest('.card');
    if (!card || (e.target.closest('a') && (e.metaKey || e.ctrlKey))) return;
    e.preventDefault();
    go(detailQs(card.dataset.id)); // păstrează etapa aleasă (?stage=), pentru „Înapoi”
  });

  /* ---------- Lista ---------- */
  let cursor = null;
  let loadingMore = false;

  function renderFilter(counts, current) {
    const opts = [['toate', 'Toate'], ...Object.entries(STATUSES)];
    $('#filter').innerHTML = opts.map(([k, l]) => {
      const href = k === 'toate' ? '/admin?view=list' : `/admin?view=list&status=${k}`;
      return `<a class="filter${k === current ? ' is-on' : ''}" href="${href}">${esc(l)}<span class="count">${counts[k] ?? 0}</span></a>`;
    }).join('');
  }

  function rowHtml(r) {
    return `<li><a class="req${r.status === 'noua' ? ' is-new' : ''}" href="/admin?${detailQs(r.id)}">
      <span class="req-name">${esc(r.name)}</span>
      ${badge(r.status)}
      <span class="req-meta">${esc(fmt(r.created_at))} · ${esc(r.phone || r.email)} ·${esc(srcText(r))}${r.type ? ` · ${esc(TYPES[r.type] || r.type)}` : ''}${payText(r) ? ` · ${esc(payText(r))}` : ''}</span>
    </a></li>`;
  }

  async function loadList(reset) {
    if (!reset && (loadingMore || !cursor)) return;
    const seq = ++loadSeq;
    const status = STATUSES[params().get('status')] ? params().get('status') : 'toate';
    const msg = $('#listMsg');
    if (reset) { cursor = null; $('#list').innerHTML = ''; }
    msg.textContent = reset ? 'Se încarcă…' : '';
    $('#more').hidden = true;
    loadingMore = !reset;
    try {
      const qs = new URLSearchParams({ status });
      if (!reset && cursor) qs.set('cursor', cursor);
      const data = await api('/api/admin/requests?' + qs);
      if (seq !== loadSeq) return;
      show('list');
      renderFilter(data.counts, status);
      if (reset) $('#list').innerHTML = '';
      $('#list').insertAdjacentHTML('beforeend', data.items.map(rowHtml).join(''));
      cursor = data.nextCursor;
      $('#more').hidden = !cursor;
      const empty = !$('#list').children.length;
      msg.textContent = empty ? (status === 'toate' ? 'Niciun client încă.' : 'Niciun client în această etapă.') : '';
      setTitle(data.counts.noua);
    } catch (err) {
      if (seq !== loadSeq) return;
      onError(err, () => {
        show('list');
        msg.innerHTML = 'Nu am putut încărca clienții. <button class="btn btn-sm btn-ghost" id="retry">Reîncearcă</button>';
        $('#retry').onclick = () => loadList(true);
      });
    } finally {
      if (seq === loadSeq) loadingMore = false;
    }
  }

  $('#more').addEventListener('click', () => loadList(false));
  $('#filter').addEventListener('click', e => internal(e, e.target.closest('a')));
  $('#list').addEventListener('click', e => internal(e, e.target.closest('a.req')));

  /* ---------- Client nou (manual) ---------- */
  const newForm = $('#newForm');
  // „Respins” cere motiv, deci se alege abia din fișa clientului
  $('#newStatus').innerHTML = options(Object.fromEntries(Object.entries(STATUSES).filter(([k]) => k !== 'respins')), 'noua');
  $('#newChannel').innerHTML = options(CHANNELS, '', '— alegeți —');
  $('#newType').innerHTML = options(TYPES, '', '— nespecificat —');
  $('#newService').innerHTML = options(SERVICES, '', '— nespecificat —');

  function showNew() {
    ++loadSeq;
    $('#backNew').href = '/admin' + (backQs() ? '?' + backQs() : '');
    $('#newMsg').textContent = '';
    show('new');
    newForm.elements.name.focus();
  }

  newForm.addEventListener('submit', async e => {
    e.preventDefault();
    const btn = $('#newBtn'), msg = $('#newMsg');
    const data = Object.fromEntries(new FormData(newForm));
    const missing = ['name', 'phone', 'channel'].find(k => !(data[k] || '').trim());
    if (missing) {
      msg.textContent = 'Numele, telefonul și „Cum a venit” sunt obligatorii.';
      newForm.elements[missing].focus();
      return;
    }
    btn.disabled = true; msg.textContent = '';
    try {
      const { item } = await api('/api/admin/requests', { method: 'POST', body: JSON.stringify(data) });
      newForm.reset();
      go(`id=${encodeURIComponent(item.id)}`, true); // „Înapoi” din fișă duce la tablă, nu la formular
    } catch (err) {
      onError(err, e2 => {
        msg.textContent = e2.status === 400 && e2.fields.length
          ? `Verificați: ${e2.fields.map(f => FIELD_NAMES[f] || f).join(', ')}.`
          : 'Nu am putut salva clientul. Reîncercați.';
      });
    } finally {
      btn.disabled = false;
    }
  });
  $('#backNew').addEventListener('click', e => internal(e, e.currentTarget));

  /* ---------- Fișa clientului ---------- */
  function historyHtml(h) {
    if (!h.length) return '<li class="muted">Fără înregistrări.</li>';
    return h.map(x => `<li>
      <time>${esc(fmt(x.at))}</time>
      <span class="history-step">${x.from_status ? `${badge(x.from_status)} <span aria-label="în">→</span> ` : '<span class="muted">Creat în</span> '}${badge(x.to_status)}${x.actor ? `<span class="history-actor">· ${byTg(x.actor)}</span>` : ''}</span>
      ${x.comment ? `<span class="history-note">Motiv: ${esc(x.comment)}</span>` : ''}
    </li>`).join('');
  }

  async function loadDetail(id) {
    const seq = ++loadSeq; // anulează și o încărcare de listă rămasă în curs
    $('#back').href = '/admin' + (backQs() ? '?' + backQs() : '');
    $('#detail').innerHTML = '<p class="admin-msg">Se încarcă…</p>';
    show('detail');
    try {
      const { item: r, history: hist, payments: pays, documents: docs = [], receivables: recs = [], ...inv } = await api('/api/admin/requests/' + encodeURIComponent(id));
      // Ratele de încasat ale clientului, cu starea calculată din plăți
      const recsHtml = `<p class="admin-label rec-title">Scadențe (de încasat)</p>
        ${recs.length ? `<ul class="due-list">${recs.map(x => `<li class="due-row is-${esc(x.state)}">
          <div class="due-main"><time>${esc(fmtPayDay(x.due_date))}</time><span class="due-who">${x.doc_number ? `nr. ${esc(x.doc_number)}` : 'Rată'}</span><b class="due-sum">${esc(money(x.amount, x.currency))}</b></div>
          <div class="due-meta">${window.LUXDUES.stateTag(x, 'get')}</div></li>`).join('')}</ul>` : '<p class="muted">Nicio scadență.</p>'}
        <a class="btn btn-sm btn-ghost" href="/admin?due=get&new=1&rid=${esc(r.id)}" data-due-new>+ Adaugă scadență</a>`;
      if (seq !== loadSeq) return;
      const phone = digits(r.phone);
      // „Carte de vizită — pagina 2” / „Chestionar — PDF”
      const docName = d => `${DOC_TYPES[d.doc_type]?.label || d.doc_type} — ${d.mime === 'application/pdf' ? 'PDF' : `pagina ${d.page}`}`;
      $('#detail').innerHTML = `
        <article class="detail-card">
          <h1>${esc(r.name)}</h1>
          <p class="muted">${srcTag(r)} Creat la ${esc(fmt(r.created_at))}${r.source === 'site' || r.tg_user_id ? ` · ${({ en: 'Engleză', ru: 'Rusă' })[r.lang] || 'Română'}` : ''}</p>
          ${r.tg_user_id ? `<p class="muted detail-author">Cerere de la client: ${tgClientLink(r.created_by)}</p>`
            : r.created_by ? `<p class="muted detail-author">Adăugat de ${byTg(r.created_by)}</p>` : ''}
          <div class="detail-actions">
            ${phone ? `<a class="btn btn-sm" href="tel:${esc(phone)}">Sună</a>
            <a class="btn btn-sm btn-clay" href="https://wa.me/${esc(phone.replace('+', ''))}" target="_blank" rel="noopener">WhatsApp</a>` : ''}
            ${r.email ? `<a class="btn btn-sm btn-ghost" href="mailto:${esc(r.email)}">Email</a>` : ''}
          </div>
          <dl class="detail-grid">
            <dt>Etapă</dt>
            <dd>
              <div class="status-box">
                <select class="status-select" id="statusSel" aria-label="Etapă">${options(STATUSES, r.status)}</select>
                <span class="status-note" id="statusNote">Schimbat la ${esc(fmt(r.status_updated_at))}</span>
              </div>
              <p class="status-comment" id="statusComment"${r.status === 'respins' && r.status_comment ? '' : ' hidden'}>Motiv: ${esc(r.status_comment || '')}</p>
            </dd>
            <dt>Telefon</dt><dd>${phone ? `<a href="tel:${esc(phone)}">${esc(r.phone)}</a>` : '—'}</dd>
            <dt>Sursă</dt><dd>${esc(srcText(r))}</dd>
            <dt>Creat</dt><dd>${esc(fmt(r.created_at))}</dd>
            <dt>Email</dt><dd>${r.email ? `<a href="mailto:${esc(r.email)}">${esc(r.email)}</a>` : '—'}</dd>
            <dt>Tip proiect</dt><dd>${label(TYPES, r.type)}</dd>
            <dt>Servicii</dt><dd>${label(SERVICES, r.service)}</dd>
            ${docs.length ? `<dt>Documente</dt><dd><ul class="doc-links">${docs.map(d =>
              `<li><button class="link-btn" type="button" data-doc="${esc(d.id)}">${esc(docName(d))}</button></li>`).join('')}</ul></dd>` : ''}
            <dt>Vizualizări</dt><dd class="viz-box" id="vizBox"></dd>
            ${r.source === 'site' || r.message ? `<dt>Despre proiect</dt><dd class="detail-msg">${r.message ? esc(r.message) : '—'}</dd>` : ''}
            <dt><label for="notes">Note</label></dt>
            <dd>
              <textarea class="admin-input notes" id="notes" rows="4" maxlength="5000" placeholder="Ce s-a discutat, ce urmează…">${esc(r.notes || '')}</textarea>
              <div class="notes-actions">
                <button class="btn btn-sm btn-ghost" id="notesSave" type="button">Salvează notele</button>
                <span class="status-note" id="notesNote"></span>
              </div>
            </dd>
            ${isStaff() ? '' : `<dt>Plăți</dt>
            <dd class="pay">
              <div class="pay-contract">
                <label class="new-field"><span class="admin-label">Valoare contract</span>
                  <input class="admin-input" id="payContract" inputmode="decimal" autocomplete="off" placeholder="ex. 12 500" value="${hasContract(r) ? esc(num(r.contract_value)) : ''}"></label>
                <label class="new-field"><span class="admin-label">Moneda</span>
                  <select class="admin-input" id="payCurrency">${options({ MDL: 'MDL', EUR: 'EUR' }, r.currency)}</select></label>
                <button class="btn btn-sm btn-ghost" id="payContractSave" type="button">Salvează</button>
              </div>
              <p class="status-note" id="payContractNote"></p>
              <div class="pay-totals" id="payTotals"></div>
              <ul class="pay-list" id="payList"></ul>
              <button class="btn btn-sm" id="payAdd" type="button">+ Adaugă plată</button>
              <form class="pay-form" id="payForm" hidden novalidate>
                <div class="pay-fields">
                  <label class="new-field"><span class="admin-label">Data</span><input class="admin-input" name="paid_on" type="date" required></label>
                  <label class="new-field"><span class="admin-label">Suma (<span id="payCur">${esc(r.currency)}</span>)</span><input class="admin-input" name="amount" inputmode="decimal" autocomplete="off" required></label>
                  <label class="new-field pay-note-field"><span class="admin-label">Notă</span><input class="admin-input" name="note" maxlength="200" autocomplete="off" placeholder="numerar, transfer, factura 12…"></label>
                </div>
                <div class="reject-actions">
                  <button class="btn btn-sm" type="submit" id="paySave">Salvează plata</button>
                  <button class="btn btn-sm btn-ghost" type="button" id="payCancel">Anulează</button>
                </div>
                <p class="status-note err" id="payMsg" role="alert"></p>
              </form>
              ${recsHtml}
            </dd>
            <dt>Facturi</dt><dd class="inv" id="invBox"></dd>`}
            <dt>Istoric etape</dt><dd><ol class="history" id="history">${historyHtml(hist)}</ol></dd>
          </dl>
          ${isStaff() ? '' : '<div class="detail-danger"><button class="link-btn danger" type="button" id="delClient">Șterge clientul</button></div>'}
        </article>`;
      const moveTo = bindStatus(r);
      bindNotes(r);
      window.LUXVIZ.box($('#vizBox'), r.id, r.name);
      if (!isStaff()) bindDelete(r);
      // Angajatul nu are plăți și rate (serverul nici nu le trimite)
      if (!isStaff()) bindPayments(r, pays || [], moveTo);
      // Facturile: doar proprietarul (serverul nu le trimite angajatului și refuză acțiunile cu 403)
      if (!isStaff()) bindInvoices(r, inv);
    } catch (err) {
      if (seq !== loadSeq) return;
      onError(err, e => {
        const back = $('#back').getAttribute('href');
        $('#detail').innerHTML = e.status === 404
          ? `<p class="admin-msg">Clientul nu a fost găsit.</p><a class="btn btn-sm btn-ghost" href="${esc(back)}">Înapoi</a>`
          : '<p class="admin-msg">Nu am putut încărca fișa. <button class="btn btn-sm btn-ghost" id="retryD">Reîncearcă</button></p>';
        const retry = $('#retryD');
        if (retry) retry.onclick = () => loadDetail(id);
      });
    }
  }

  // Ștergerea clientului (doar proprietarul): serverul șterge întâi fișierele (documente, vizualizări), apoi rândul
  function bindDelete(r) {
    $('#delClient').addEventListener('click', async e => {
      const btn = e.currentTarget;
      if (!confirm(`Ștergi clientul „${r.name}” cu istoricul, plățile, ratele, documentele și vizualizările lui? Nu se poate anula.`)) return;
      btn.disabled = true;
      try {
        await api('/api/admin/requests/' + encodeURIComponent(r.id), { method: 'DELETE' });
        boardItems.delete(r.id);
        go(backQs(), true);
      } catch (err) {
        btn.disabled = false;
        onError(err, () => alert('Clientul nu s-a șters. Încercați din nou.'));
      }
    });
  }

  function bindStatus(r) {
    const sel = $('#statusSel'), note = $('#statusNote'), shown = $('#statusComment');
    let current = r.status;

    // „Respins” se salvează doar împreună cu motivul; restul etapelor, imediat
    sel.addEventListener('change', async () => {
      const next = sel.value;
      let comment = '';
      if (next === 'respins') {
        comment = await askReason(r.name);
        if (comment === null) { sel.value = current; return; }
      }
      sel.disabled = true;
      note.className = 'status-note'; note.textContent = 'Se salvează…';
      try {
        const { item, history: hist } = await api('/api/admin/requests/' + encodeURIComponent(r.id), {
          method: 'PATCH', body: JSON.stringify({ status: next, comment }),
        });
        current = r.status = item.status;
        shown.hidden = !(item.status === 'respins' && item.status_comment);
        shown.textContent = `Motiv: ${item.status_comment || ''}`;
        $('#history').innerHTML = historyHtml(hist);
        note.className = 'status-note ok'; note.textContent = `✓ Salvat · ${fmt(item.status_updated_at)}`;
      } catch (err) {
        sel.value = current;
        onError(err, () => { note.className = 'status-note err'; note.textContent = 'Nu am putut salva etapa. Reîncercați.'; });
      } finally {
        sel.disabled = false;
      }
    });

    // Folosit de propunerile din „Plăți”: aceeași mutare ca din selector, deci intră și în istoric
    return next => { sel.value = next; sel.dispatchEvent(new Event('change')); };
  }

  function bindNotes(r) {
    const text = $('#notes'), btn = $('#notesSave'), note = $('#notesNote');
    let saved = r.notes || '';
    text.addEventListener('input', () => {
      note.className = 'status-note';
      note.textContent = text.value.trim() === saved.trim() ? '' : 'Modificări nesalvate';
    });
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      note.className = 'status-note'; note.textContent = 'Se salvează…';
      try {
        const { item } = await api('/api/admin/requests/' + encodeURIComponent(r.id), {
          method: 'PATCH', body: JSON.stringify({ notes: text.value }),
        });
        saved = item.notes;
        note.className = 'status-note ok'; note.textContent = '✓ Notele au fost salvate';
      } catch (err) {
        onError(err, () => { note.className = 'status-note err'; note.textContent = 'Nu am putut salva notele. Reîncercați.'; });
      } finally {
        btn.disabled = false;
      }
    });
  }

  /* ---------- Plăți ---------- */
  function bindPayments(r, list, moveTo) {
    const form = $('#payForm'), msg = $('#payMsg'), addBtn = $('#payAdd'), saveBtn = $('#paySave');
    let pays = list;
    let editing = null; // plata care se modifică; null = plată nouă

    const paidSum = () => Math.round(pays.reduce((s, p) => s + Number(p.amount), 0) * 100) / 100;

    function render() {
      const paid = paidSum(), cur = r.currency;
      const rows = [
        ['Contract', hasContract(r) ? money(r.contract_value, cur) : '—', ''],
        ['Plătit', money(paid, cur), ''],
      ];
      if (hasContract(r)) {
        const left = Math.round((Number(r.contract_value) - paid) * 100) / 100;
        rows.push(left >= 0
          ? ['Rămas', money(left, cur), left === 0 && paid > 0 ? 'is-ok' : '']
          : ['Plătit în plus', money(-left, cur), 'is-over']);
      }
      $('#payTotals').innerHTML = rows.map(([k, v, c]) => `<div class="${c}"><span>${k}</span><b>${esc(v)}</b></div>`).join('');
      $('#payList').innerHTML = pays.length ? pays.map(p => `<li data-id="${esc(p.id)}">
          <time>${esc(fmtPayDay(p.paid_on))}</time>
          <b>${esc(money(p.amount, cur))}</b>
          ${p.note ? `<span class="pay-note">${esc(p.note)}</span>` : ''}
          <span class="pay-actions">
            <button class="link-btn" type="button" data-act="edit">Modifică</button>
            <button class="link-btn danger" type="button" data-act="del">Șterge</button>
          </span>
        </li>`).join('') : '<li class="muted">Nicio plată încă.</li>';
      $('#payCur').textContent = cur;
    }

    function openForm(p) {
      editing = p;
      form.elements.paid_on.max = today();
      form.elements.paid_on.value = p ? p.paid_on : today();
      form.elements.amount.value = p ? num(p.amount) : '';
      form.elements.note.value = p ? p.note : '';
      saveBtn.textContent = p ? 'Salvează modificarea' : 'Salvează plata';
      msg.textContent = '';
      form.hidden = false; addBtn.hidden = true;
      form.elements.amount.focus();
    }
    function closeForm() {
      editing = null;
      form.hidden = true; addBtn.hidden = false;
    }

    // Plata a fost ștearsă între timp (de ex. din alt tab): reîncărcăm fișa
    function gone() {
      alert('Plata nu mai există.');
      loadDetail(r.id);
    }

    // Etapa nu se mută singură: doar propunem, după o plată adăugată sau modificată
    function suggest(first) {
      if (r.status === 'respins' || r.status === 'inchisa') return;
      if (fullyPaid(r, paidSum())) {
        if (r.status !== 'platit' && r.status !== 'incheiat' && confirm('Achitat integral. Muți clientul în „Plătit”?')) moveTo('platit');
        return;
      }
      if (first && ['noua', 'contactata', 'in_lucru', 'procesat'].includes(r.status) &&
          confirm('Prima plată înregistrată. Muți clientul în „Avans”?')) moveTo('avans');
    }

    addBtn.addEventListener('click', () => openForm(null));
    $('#payCancel').addEventListener('click', closeForm);

    form.addEventListener('submit', async e => {
      e.preventDefault();
      const paidOn = form.elements.paid_on.value;
      const amount = parseMoney(form.elements.amount.value);
      const note = form.elements.note.value.trim();
      if (!paidOn) { msg.textContent = 'Alegeți data plății.'; form.elements.paid_on.focus(); return; }
      if (paidOn > today()) { msg.textContent = 'Data nu poate fi în viitor.'; form.elements.paid_on.focus(); return; }
      if (!amount) { msg.textContent = 'Introduceți o sumă mai mare ca 0 (cel mult 2 zecimale).'; form.elements.amount.focus(); return; }

      const first = !editing && pays.length === 0;
      saveBtn.disabled = true; msg.textContent = '';
      try {
        const body = JSON.stringify({ request_id: r.id, paid_on: paidOn, amount, note });
        ({ payments: pays } = editing
          ? await api('/api/admin/payments?id=' + encodeURIComponent(editing.id), { method: 'PATCH', body })
          : await api('/api/admin/payments', { method: 'POST', body }));
        closeForm();
        render();
        suggest(first);
      } catch (err) {
        onError(err, e2 => {
          if (e2.status === 404) return gone();
          msg.textContent = e2.status === 400 ? 'Verificați data și suma.' : 'Nu s-a salvat. Încercați din nou.';
        });
      } finally {
        saveBtn.disabled = false;
      }
    });

    $('#payList').addEventListener('click', async e => {
      const btn = e.target.closest('button[data-act]');
      if (!btn) return;
      const p = pays.find(x => String(x.id) === btn.closest('li').dataset.id);
      if (!p) return;
      if (btn.dataset.act === 'edit') return openForm(p);
      if (!confirm(`Ștergi plata de ${money(p.amount, r.currency)} din ${fmtPayDay(p.paid_on)}?`)) return;
      btn.disabled = true;
      try {
        ({ payments: pays } = await api('/api/admin/payments?id=' + encodeURIComponent(p.id), { method: 'DELETE' }));
        if (editing && editing.id === p.id) closeForm();
        render();
      } catch (err) {
        btn.disabled = false;
        onError(err, e2 => (e2.status === 404 ? gone() : alert('Nu s-a șters plata. Încercați din nou.')));
      }
    });

    // Valoarea contractului și moneda
    const note = $('#payContractNote');
    $('#payContractSave').addEventListener('click', async e => {
      const btn = e.currentTarget;
      const raw = $('#payContract').value.trim();
      const value = raw === '' ? null : parseMoney(raw);
      const currency = $('#payCurrency').value;
      if (raw !== '' && value === null) {
        note.className = 'status-note err'; note.textContent = 'Valoarea contractului nu e un număr valid.'; $('#payContract').focus(); return;
      }
      if (currency !== r.currency && pays.length &&
          !confirm('Sumele nu se convertesc, se schimbă doar moneda afișată. Continui?')) {
        $('#payCurrency').value = r.currency; return;
      }
      btn.disabled = true;
      note.className = 'status-note'; note.textContent = 'Se salvează…';
      try {
        const { item } = await api('/api/admin/requests/' + encodeURIComponent(r.id), {
          method: 'PATCH', body: JSON.stringify({ contract_value: value, currency }),
        });
        r.contract_value = item.contract_value; r.currency = item.currency;
        $('#payContract').value = hasContract(r) ? num(r.contract_value) : '';
        render();
        note.className = 'status-note ok'; note.textContent = '✓ Salvat';
      } catch (err) {
        onError(err, () => { note.className = 'status-note err'; note.textContent = 'Nu s-a salvat. Încercați din nou.'; });
      } finally {
        btn.disabled = false;
      }
    });

    render();
  }

  /* ---------- Facturi (doar proprietarul) ---------- */
  const INV_SENT = { telegram: 'Trimisă pe Telegram', email: 'Trimisă pe email', proprietar: 'Trimisă proprietarului' };
  const INV_FIELDS = { service: 'serviciul', qty: 'cantitatea', price: 'prețul', due_days: 'termenul' };
  // Aceleași calcule ca pe server: în cenți, TVA adăugat peste preț
  function invTotals(qty, price, rate) {
    const line = Math.round(Math.round(qty * 100) * Math.round(price * 100) / 100);
    const vat = Math.round(line * rate / 100);
    return { subtotal: line / 100, vat: vat / 100, total: (line + vat) / 100 };
  }

  function bindInvoices(r, data) {
    const box = $('#invBox');
    const rate = data.vat_rate || 20;
    const defs = data.invoice_defaults || {};
    let list = data.invoices || [];
    if (!data.invoices_ready) {
      box.innerHTML = '<p class="muted">Facturile pornesc după migrarea bazei de date (supabase/migrations/2026-11-10-facturi.sql).</p>';
      return;
    }
    box.innerHTML = `<ul class="due-list inv-list" id="invList"></ul>
      <p class="inv-open" id="invOpen"></p>
      <button class="btn btn-sm" id="invAdd" type="button">+ Emite factura</button>
      <form class="pay-form" id="invForm" hidden novalidate>
        <div class="inv-fields">
          <label class="new-field inv-wide"><span class="admin-label">Serviciu</span><input class="admin-input" name="service" maxlength="300" autocomplete="off" required></label>
          <label class="new-field"><span class="admin-label">Cantitate</span><input class="admin-input" name="qty" inputmode="decimal" autocomplete="off" required></label>
          <label class="new-field"><span class="admin-label">Preț unitar, fără TVA (<span id="invCur"></span>)</span><input class="admin-input" name="price" inputmode="decimal" autocomplete="off" required></label>
          <label class="new-field"><span class="admin-label">Termen de plată (zile)</span><input class="admin-input" name="due_days" type="number" inputmode="numeric" min="1" max="365" step="1" required></label>
        </div>
        <div class="pay-totals inv-sum" id="invSum"></div>
        <div class="reject-actions">
          <button class="btn btn-sm" type="submit" id="invSave">Emite</button>
          <button class="btn btn-sm btn-ghost" type="button" id="invCancel">Anulează</button>
        </div>
        <p class="status-note err" id="invMsg" role="alert"></p>
      </form>`;
    const form = $('#invForm'), msg = $('#invMsg'), addBtn = $('#invAdd'), saveBtn = $('#invSave');

    function rowHtml(x) {
      const paid = x.status === 'achitata';
      const late = !paid && x.due_date < today();
      const tags = [
        paid ? `<span class="due-tag is-paid">Achitată ${esc(fmtPayDay(x.paid_on || ''))}</span>`
          : `<span class="due-tag${late ? ' is-overdue' : ''}">${late ? 'Neachitată, termen depășit' : 'Neachitată'}</span>`,
        `<span class="muted">Termen ${esc(fmtPayDay(x.due_date))}</span>`,
        x.auto ? '<span class="due-tag">Automată</span>' : '',
        x.is_test ? '<span class="due-tag is-soon">Date de test</span>' : '',
        x.has_pdf ? '' : '<span class="due-tag is-overdue">PDF lipsă</span>',
        x.sent_at ? `<span class="muted">${esc(INV_SENT[x.sent_via] || 'Trimisă')} · ${esc(fmt(x.sent_at))}</span>` : '',
      ].filter(Boolean).join('');
      const sendLabel = x.sent_via === 'proprietar' ? 'Trimisă proprietarului · trimite din nou' : x.sent_at ? 'Trimite din nou' : 'Trimite clientului';
      return `<li class="due-row inv-row${paid ? ' is-paid' : late ? ' is-overdue' : ''}" data-id="${esc(x.id)}">
        <div class="due-main"><time>${esc(fmtDay(x.issued_at))}</time><span class="due-who">${esc(x.number)}</span><b class="due-sum">${esc(money(x.total, x.currency))}</b></div>
        <div class="due-meta">${tags}</div>
        <div class="due-actions">
          ${x.has_pdf ? '<button class="link-btn" type="button" data-act="open">Deschide PDF</button>'
            : '<button class="link-btn" type="button" data-act="pdf">Refă PDF-ul</button>'}
          <button class="link-btn" type="button" data-act="send">${esc(sendLabel)}</button>
          ${paid ? '' : '<button class="link-btn" type="button" data-act="paid">Marchează achitată</button>'}
        </div>
      </li>`;
    }

    function render() {
      $('#invList').innerHTML = list.length ? list.map(rowHtml).join('') : '<li class="muted">Nicio factură încă.</li>';
      // Totalul neachitat, pe monede (o factură își păstrează moneda de la emitere)
      const open = {};
      list.filter(x => x.status !== 'achitata').forEach(x => { open[x.currency] = (open[x.currency] || 0) + Number(x.total); });
      const parts = Object.entries(open).map(([cur, v]) => money(Math.round(v * 100) / 100, cur));
      $('#invOpen').textContent = parts.length ? `Neachitate: ${parts.join(' + ')}` : '';
    }

    function updateSum() {
      const qty = parseMoney(form.elements.qty.value), price = parseMoney(form.elements.price.value);
      if (!qty || !price) { $('#invSum').innerHTML = '<div><span>Total</span><b>—</b></div>'; return; }
      const t = invTotals(qty, price, rate), cur = r.currency;
      $('#invSum').innerHTML = [['Subtotal', t.subtotal], [`TVA ${rate}%`, t.vat], ['Total', t.total]]
        .map(([k, v]) => `<div><span>${k}</span><b>${esc(money(v, cur))}</b></div>`).join('');
    }

    function openForm() {
      form.elements.service.value = defs.service || '';
      form.elements.qty.value = '1';
      // Prețul vine din valoarea contractului de acum (poate fi schimbată mai sus, în „Plăți”)
      form.elements.price.value = hasContract(r) && Number(r.contract_value) > 0 ? num(r.contract_value) : '';
      form.elements.due_days.value = defs.due_days || 10;
      $('#invCur').textContent = r.currency;
      msg.textContent = '';
      form.hidden = false; addBtn.hidden = true;
      updateSum();
      form.elements.service.focus();
    }
    function closeForm() { form.hidden = true; addBtn.hidden = false; }

    addBtn.addEventListener('click', openForm);
    $('#invCancel').addEventListener('click', closeForm);
    form.addEventListener('input', updateSum);

    form.addEventListener('submit', async e => {
      e.preventDefault();
      const service = form.elements.service.value.trim();
      const qty = parseMoney(form.elements.qty.value);
      const price = parseMoney(form.elements.price.value);
      const dueDays = Number(form.elements.due_days.value);
      if (!service) { msg.textContent = 'Scrieți denumirea serviciului.'; form.elements.service.focus(); return; }
      if (!qty) { msg.textContent = 'Cantitatea trebuie să fie mai mare ca 0 (cel mult 2 zecimale).'; form.elements.qty.focus(); return; }
      if (!price) { msg.textContent = 'Prețul trebuie să fie cel puțin 0,01.'; form.elements.price.focus(); return; }
      if (!Number.isInteger(dueDays) || dueDays < 1 || dueDays > 365) { msg.textContent = 'Termenul: între 1 și 365 de zile.'; form.elements.due_days.focus(); return; }
      // Butonul stă blocat până vine răspunsul
      saveBtn.disabled = true; msg.textContent = '';
      try {
        const res = await api('/api/admin/docs/invoice-create', {
          method: 'POST', body: JSON.stringify({ request_id: r.id, service, qty, price, due_days: dueDays }),
        });
        list = res.invoices;
        closeForm();
        render();
        if (res.pdf_error) alert(`Factura ${res.invoice.number} e emisă, dar PDF-ul nu s-a putut face. Apăsați „Refă PDF-ul”.`);
      } catch (err) {
        onError(err, e2 => {
          msg.textContent = e2.status === 400
            ? `Verificați: ${(e2.fields || []).map(f => INV_FIELDS[f] || f).join(', ')}.`
            : e2.status === 404 ? 'Clientul nu mai există.' : 'Factura nu s-a emis. Încercați din nou.';
        });
      } finally {
        saveBtn.disabled = false;
      }
    });

    $('#invList').addEventListener('click', async e => {
      const btn = e.target.closest('button[data-act]');
      if (!btn) return;
      const x = list.find(i => String(i.id) === btn.closest('li').dataset.id);
      if (!x) return;
      const act = btn.dataset.act;
      if (act === 'open') return openInvoice(x.id);
      if (act === 'send' && x.sent_at && x.sent_via !== 'proprietar' && !confirm(`Factura ${x.number} a fost deja trimisă. O trimiți din nou?`)) return;
      if (act === 'paid' && !confirm(`Marchezi factura ${x.number} (${money(x.total, x.currency)}) ca achitată?\nSe adaugă plata în fișă, iar clientul trece în „Plătit” (dacă nu e deja în „Plătit” sau „Încheiat”).`)) return;
      btn.disabled = true;
      const old = btn.textContent;
      if (act === 'send') btn.textContent = 'Se trimite…';
      try {
        if (act === 'pdf') {
          ({ invoices: list } = await api('/api/admin/docs/invoice-pdf', { method: 'POST', body: JSON.stringify({ id: x.id }) }));
          render();
        } else if (act === 'send') {
          const res = await api('/api/admin/docs/invoice-send', { method: 'POST', body: JSON.stringify({ id: x.id }) });
          list = res.invoices;
          render();
          if (res.sent_via === 'proprietar') alert(`Nu s-a putut trimite clientului: ${res.reason}.\nPDF-ul a ajuns pe Telegram la dumneavoastră. Trimiteți-l manual.`);
        } else if (act === 'paid') {
          await api('/api/admin/docs/invoice-paid', { method: 'POST', body: JSON.stringify({ id: x.id }) });
          loadDetail(r.id); // plata nouă, etapa și istoricul se schimbă: fișa se reîncarcă
        }
      } catch (err) {
        btn.disabled = false; btn.textContent = old;
        onError(err, e2 => {
          if (e2.status === 409 && e2.message === 'already_paid') { alert('Factura e deja achitată.'); loadDetail(r.id); return; }
          if (e2.status === 404) { alert('Factura nu mai există.'); loadDetail(r.id); return; }
          alert(act === 'send' ? 'Factura nu s-a putut trimite. Încercați din nou.'
            : act === 'pdf' ? 'PDF-ul nu s-a putut face. Încercați din nou.' : 'Nu s-a salvat. Încercați din nou.');
        });
      }
    });

    render();
  }

  // PDF-ul facturii: link de 5 minute, ca documentele (fereastra se deschide imediat, adresa vine după)
  async function openInvoice(invId) {
    const w = window.open('', '_blank');
    try {
      const { url } = await api('/api/admin/docs/invoice-open?id=' + encodeURIComponent(invId));
      if (w) { w.opener = null; w.location = url; } else location.href = url;
    } catch (err) {
      if (w) w.close();
      onError(err, e2 => alert(e2.status === 409 ? 'PDF-ul lipsește. Apăsați „Refă PDF-ul”.' : 'Nu am putut deschide factura. Încercați din nou.'));
    }
  }

  $('#back').addEventListener('click', e => internal(e, e.currentTarget));

  // Originalul documentului: link semnat, valabil 5 minute, cerut abia la clic.
  // Fereastra se deschide imediat (altfel browserul o blochează), adresa vine după.
  $('#detail').addEventListener('click', e => {
    const btn = e.target.closest('button[data-doc]');
    if (btn) openDoc(btn.dataset.doc);
    internal(e, e.target.closest('a[data-due-new]'));
  });
  async function openDoc(docId) {
    const w = window.open('', '_blank');
    try {
      const { url } = await api('/api/admin/docs/open?id=' + encodeURIComponent(docId));
      if (w) { w.opener = null; w.location = url; } else location.href = url;
    } catch (err) {
      if (w) w.close();
      onError(err, () => alert('Nu am putut deschide documentul. Încercați din nou.'));
    }
  }

  /* ---------- Document recunoscut de Claude ---------- */
  const dlg = $('#docDlg'), docForm = $('#docForm'), docMsg = $('#docMsg');
  // PDF: 10 MB pentru orice document; între 10 și 20 MB doar o listă de prețuri (serverul îl citește ca listă)
  const MAX_IMAGES = 5, MAX_IMAGE = 15 * 1024 * 1024, MAX_PDF = 10 * 1024 * 1024, MAX_PDF_LIST = 20 * 1024 * 1024, MAX_SIDE = 2000;
  const doc = { files: [], token: null, type: '', forced: null, dupes: [], saved: false };

  $('#docType').innerHTML = Object.entries(DOC_TYPES).map(([k, t]) => `<option value="${k}">${esc(t.label)}</option>`).join('');
  $('#docProjType').innerHTML = options(TYPES, '', '— nespecificat —');
  $('#docService').innerHTML = options(SERVICES, '', '— nespecificat —');

  function step(name) {
    dlg.querySelectorAll('.doc-step').forEach(s => { s.hidden = s.dataset.step !== name; });
    // Telegram: cât timp ecranul de verificare are date nesalvate, închiderea aplicației cere confirmare (6.2+)
    if (tgAtLeast('6.2')) tgCall(name === 'review' ? 'enableClosingConfirmation' : 'disableClosingConfirmation');
  }

  function thumbsHtml(small) {
    return doc.files.map((f, i) => `<li>
      ${f.mime === 'application/pdf' ? '<span class="doc-pdf">PDF</span>' : `<img src="${f.url}" alt="Pagina ${i + 1}">`}
      ${small ? '' : `<span class="doc-thumb-actions">
        ${i ? `<button class="link-btn" type="button" data-act="left" data-i="${i}" aria-label="Mută la stânga">←</button>` : ''}
        ${i < doc.files.length - 1 ? `<button class="link-btn" type="button" data-act="right" data-i="${i}" aria-label="Mută la dreapta">→</button>` : ''}
        <button class="link-btn danger" type="button" data-act="del" data-i="${i}">Șterge</button>
      </span>`}
    </li>`).join('');
  }
  function renderThumbs() {
    $('#docThumbs').innerHTML = thumbsHtml(false);
    $('#docRead').disabled = !doc.files.length;
  }

  // Fișierele s-au schimbat: cele urcate deja nu mai sunt valabile
  function dropUpload() {
    if (doc.token) api('/api/admin/docs/cancel', { method: 'POST', body: JSON.stringify({ token: doc.token }) }).catch(() => {});
    doc.token = null;
  }

  function resetDoc() {
    doc.files.forEach(f => URL.revokeObjectURL(f.url));
    Object.assign(doc, { files: [], token: null, type: '', forced: null, dupes: [], saved: false });
    dlg.classList.remove('is-wide');
    docForm.reset();
    $('#docFile').value = '';
    docMsg.textContent = '';
    renderThumbs();
    step('pick');
  }

  // Poza se micșorează în browser (latura mare ≤ 2000 px, JPEG): încape în cerere și rezolvă HEIC
  async function shrink(file) {
    let src, w, h, url;
    try {
      src = await createImageBitmap(file, { imageOrientation: 'from-image' });
      w = src.width; h = src.height;
    } catch (e) {
      url = URL.createObjectURL(file);
      src = await new Promise((ok, fail) => { const img = new Image(); img.onload = () => ok(img); img.onerror = fail; img.src = url; });
      w = src.naturalWidth; h = src.naturalHeight;
    } finally {
      if (url) URL.revokeObjectURL(url);
    }
    const k = Math.min(1, MAX_SIDE / Math.max(w, h));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(w * k); canvas.height = Math.round(h * k);
    canvas.getContext('2d').drawImage(src, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise(ok => canvas.toBlob(ok, 'image/jpeg', 0.85));
    if (!blob) throw new Error('canvas');
    return blob;
  }

  $('#docBtn').addEventListener('click', () => { resetDoc(); dlg.showModal(); syncBack(); });

  // Aceeași prelucrare pentru „Alege fișier” și pentru „Fotografiază” (camera, doar în Telegram)
  async function onPicked(e) {
    const picked = [...e.target.files];
    e.target.value = '';
    docMsg.textContent = '';
    const pdfs = picked.filter(f => f.type === 'application/pdf');
    if (pdfs.length) {
      if (picked.length > 1 || doc.files.length) { docMsg.textContent = 'Un PDF se încarcă singur, fără alte fișiere.'; return; }
      if (pdfs[0].size > MAX_PDF_LIST) { docMsg.textContent = 'PDF-ul e mai mare de 20 MB.'; return; }
      dropUpload();
      doc.files = [{ mime: 'application/pdf', blob: pdfs[0], url: '' }];
      if (pdfs[0].size > MAX_PDF) docMsg.textContent = 'PDF-ul are peste 10 MB: se citește doar ca listă de prețuri.';
      return renderThumbs();
    }
    if (doc.files.some(f => f.mime === 'application/pdf')) { docMsg.textContent = 'Un PDF se încarcă singur, fără alte fișiere.'; return; }
    if (doc.files.length + picked.length > MAX_IMAGES) { docMsg.textContent = `Cel mult ${MAX_IMAGES} poze pentru un document.`; return; }
    if (picked.some(f => f.size > MAX_IMAGE)) { docMsg.textContent = 'O poză e mai mare de 15 MB.'; return; }
    $('#docRead').disabled = true;
    docMsg.textContent = 'Se pregătesc pozele…';
    try {
      for (const f of picked) {
        const blob = await shrink(f);
        doc.files.push({ mime: 'image/jpeg', blob, url: URL.createObjectURL(blob) });
      }
      docMsg.textContent = '';
    } catch (err) {
      docMsg.textContent = 'Formatul pozei nu e acceptat. Alege o poză JPG sau PNG.';
    }
    dropUpload();
    renderThumbs();
  }
  $('#docFile').addEventListener('change', onPicked);
  $('#docCam').addEventListener('change', onPicked);

  $('#docThumbs').addEventListener('click', e => {
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    const i = Number(btn.dataset.i), f = doc.files;
    if (btn.dataset.act === 'del') URL.revokeObjectURL(f.splice(i, 1)[0].url);
    else { const j = btn.dataset.act === 'left' ? i - 1 : i + 1; [f[i], f[j]] = [f[j], f[i]]; }
    dropUpload();
    renderThumbs();
  });

  // Urcă fișierele direct în Storage (o singură dată pentru aceleași fișiere)
  async function uploadFiles() {
    if (doc.token) return;
    const meta = doc.files.map((f, i) => ({ page: i + 1, mime: f.mime, size: f.blob.size }));
    const { token, uploads } = await api('/api/admin/docs/upload', { method: 'POST', body: JSON.stringify({ files: meta }) });
    await Promise.all(uploads.map(async u => {
      const f = doc.files[u.page - 1];
      const r = await fetch(u.url, { method: 'PUT', headers: { 'Content-Type': f.mime }, body: f.blob });
      if (!r.ok) throw Object.assign(new Error('storage'), { status: 'storage' });
    }));
    doc.token = token;
  }

  function fillForm(fields) {
    docForm.reset();
    Object.entries(fields || {}).forEach(([k, v]) => { if (docForm.elements[k]) docForm.elements[k].value = v || ''; });
  }

  // Formularele tipurilor care nu merg în CRM: cheltuieli (admin-fin.js), scadențe (admin-dues.js)
  // și liste de prețuri (admin-cat.js). Fiecare are html(câmpuri, extra), bind(element), read(element),
  // check(date) și dupes(listă); opțional hint(câmpuri) și errText(eroare, mesaj implicit).
  const DOC_FORMS = () => {
    const F = window.LUXFIN, D = window.LUXDUES;
    const expense = { html: f => F.formHtml(f || { doc_date: today() }), bind: F.bindForm, read: F.readForm, check: F.checkForm, dupes: F.dupesHtml };
    return { aviz: expense, chitanta: expense, de_platit: D.pay, de_incasat: D.get, lista_preturi: window.LUXCAT.review };
  };
  const formOf = t => DOC_FORMS()[t] || null;

  function showReview(type, fields, dupes, extra = {}) {
    $('#docTypePick')?.remove();
    doc.type = type;
    $('#docType').value = type;
    const form = formOf(type);
    $('#docCrmFields').hidden = !!form;
    $('#docExpFields').hidden = !form;
    $('#docReviewThumbs').innerHTML = thumbsHtml(true);
    // Lista de prețuri are nevoie de un dialog lat (tabel pe calculator)
    dlg.classList.toggle('is-wide', type === 'lista_preturi');
    $('#docSave').disabled = false;
    const f = fields || {};
    if (form) {
      $('#docExpFields').innerHTML = form.html(fields, extra);
      form.bind($('#docExpFields'));
      $('#docHint').textContent = form.hint ? form.hint(fields)
        : fields && !f.supplier && !f.amount_total ? 'Nu s-au putut citi datele principale. Completează-le manual.' : '';
    } else {
      $('#docExpFields').innerHTML = '';
      $('#docMessageField').hidden = type !== 'chestionar';
      fillForm(fields);
      $('#docHint').textContent = !fields ? ''
        : !f.name && !f.phone && !f.email ? 'Nu s-au putut citi datele principale. Completează-le manual.'
          : Object.values(f).some(v => String(v).includes('[?]')) ? 'Unele cuvinte nu s-au putut citi — sunt marcate cu [?].' : '';
    }
    showDupes(dupes || []);
    step('review');
  }

  function showDupes(list) {
    doc.dupes = list;
    const box = $('#docDupes'), form = formOf(doc.type);
    box.hidden = !list.length;
    // Angajatul vede cheltuiala existentă fără sumă și fără link (serverul nu le trimite)
    const staffExp = isStaff() && ['aviz', 'chitanta'].includes(doc.type);
    box.innerHTML = !list.length ? '' : staffExp ? `<p><b>Pare să existe deja:</b></p><ul>${list.map(d =>
      `<li>${esc(d.supplier)}${d.doc_number ? `, nr. ${esc(d.doc_number)}` : ''}, ${esc(fmtPayDay(d.doc_date))}</li>`).join('')}</ul>
      <p class="muted">Dacă e alt document, apasă „Salvează oricum”.</p>`
      : form ? form.dupes(list)
      : `<p><b>Există deja:</b></p><ul>${list.map(d =>
        `<li>${esc(d.name)} (${esc(d.status)}) <button class="link-btn" type="button" data-open="${esc(d.id)}">Deschide clientul existent</button></li>`).join('')}</ul>
      <p class="muted">Dacă e altă persoană, apasă „Creează oricum”.</p>`;
    $('#docSave').textContent = !list.length ? 'Salvează' : form ? 'Salvează oricum' : 'Creează oricum';
  }

  // Citirea cu Claude; `forced` = tipul ales de utilizator
  async function readDoc(forced) {
    const btn = $('#docRead');
    btn.disabled = true; btn.textContent = 'Se citește…';
    docMsg.textContent = '';
    doc.forced = forced;
    try {
      await uploadFiles();
      const res = await api('/api/admin/docs/read', { method: 'POST', body: JSON.stringify({ token: doc.token, doc_type: forced || undefined }) });
      if (!res.doc_type) {
        doc.token = null; // serverul a șters deja fișierele
        step('pick');
        docMsg.textContent = 'Nu pare un document. Nu s-a salvat nimic.';
        return;
      }
      if (!res.supported) {
        doc.type = res.doc_type;
        const owner = res.reason === 'owner_only';
        // Angajatul: serverul a șters deja fișierele; „Schimbă tipul” le urcă din nou
        if (owner) doc.token = null;
        $('#docUnsupported').textContent = owner ? 'Doar proprietarul poate salva acest tip de document.'
          : `Tip recunoscut: ${DOC_TYPES[res.doc_type].label}. Secțiunea nu e gata încă, nu s-a salvat nimic.`;
        $('#docAnother').hidden = !owner;
        return step('unsupported');
      }
      showReview(res.doc_type, res.fields, res.duplicates, { matches: res.client_matches || [] });
    } catch (err) {
      if (err instanceof AuthError) dlg.close();
      onError(err, e2 => {
        if (e2.status === 'storage') { step('pick'); docMsg.textContent = 'Nu s-a putut încărca fișierul. Încearcă din nou.'; return; }
        if (e2.status === 429) { step('pick'); docMsg.textContent = 'Prea multe citiri într-o oră. Încearcă mai târziu sau completează manual.'; return; }
        // Răspunsul lui Claude nu a încăput (sau a durat peste limita funcției): de obicei o listă de prețuri lungă
        if (e2.status === 413 || e2.status === 504) {
          step('pick');
          docMsg.textContent = e2.status === 413 || doc.forced === 'lista_preturi'
            ? 'Lista e prea lungă pentru o citire. Încarcă mai puține pagini odată.'
            : 'Citirea a durat prea mult. Încearcă din nou; dacă e o listă de prețuri lungă, încarcă mai puține pagini odată.';
          return;
        }
        if (e2.status === 400) { dropUpload(); step('pick'); docMsg.textContent = e2.message === 'pages' ? 'PDF-ul are mai mult de 20 de pagini.' : 'Fișierul nu e acceptat (tip sau mărime).'; return; }
        $('#docErrDetail').textContent = e2.data?.detail ? `Detaliu tehnic: ${e2.data.detail}` : '';
        step('error');
      });
    } finally {
      btn.disabled = !doc.files.length; btn.textContent = 'Citește';
    }
  }

  $('#docRead').addEventListener('click', () => readDoc(null));
  $('#docRetry').addEventListener('click', () => { step('pick'); readDoc(doc.forced); });
  $('#docManual').addEventListener('click', () => showReview('carte_vizita', null, []));
  // Tipul recunoscut nu are încă secțiune: se alege altul, iar Claude recitește documentul
  $('#docChangeType').addEventListener('click', () => {
    showReview('carte_vizita', null, []);
    doc.type = '';
    $('#docType').insertAdjacentHTML('afterbegin', '<option value="" id="docTypePick">— alegeți tipul —</option>');
    $('#docType').value = '';
    $('#docHint').textContent = 'Alegeți tipul corect; documentul se citește din nou.';
    $('#docType').focus();
  });

  // Alt tip: Claude recitește documentul pentru tipul ales (sau doar se schimbă câmpurile, la completare manuală)
  $('#docType').addEventListener('change', async e => {
    const next = e.target.value;
    if (!next) return;
    if (!DOC_TYPES[next].ready) {
      e.target.value = doc.type;
      $('#docHint').textContent = `„${DOC_TYPES[next].label}”: secțiunea nu e gata încă.`;
      return;
    }
    if (!doc.files.length) { showReview(next, null, []); return; }
    if (doc.type && !confirm('Schimbi tipul? Câmpurile se citesc din nou.')) { e.target.value = doc.type; return; }
    $('#docTypePick')?.remove();
    step('pick');
    await readDoc(next);
  });

  docForm.addEventListener('submit', async e => {
    e.preventDefault();
    if (!doc.type) { docMsg.textContent = 'Alegeți tipul documentului.'; $('#docType').focus(); return; }
    const form = formOf(doc.type);
    let fields;
    if (form) {
      fields = form.read($('#docExpFields'));
      const bad = form.check(fields);
      if (bad) { docMsg.textContent = bad; return; }
    } else {
      fields = Object.fromEntries(new FormData(docForm));
      if (doc.type !== 'chestionar') fields.message = '';
      if (!fields.name.trim()) { docMsg.textContent = 'Numele e obligatoriu.'; docForm.elements.name.focus(); return; }
      if (!fields.phone.trim() && !fields.email.trim()) { docMsg.textContent = 'Completează telefonul sau emailul.'; docForm.elements.phone.focus(); return; }
    }
    const btn = $('#docSave');
    btn.disabled = true; docMsg.textContent = '';
    try {
      if (doc.files.length) await uploadFiles();
      const res = await api('/api/admin/docs/save', {
        method: 'POST',
        body: JSON.stringify({ token: doc.token || crypto.randomUUID(), doc_type: doc.type, fields, force: doc.dupes.length > 0 }),
      });
      doc.saved = true;
      haptic();
      // Angajatul nu are Financiar: rămâne în dialog, cu confirmarea și „Încarcă alt document”
      if (isStaff() && res.kind === 'expense') {
        const amount = parseMoney(fields.amount_total);
        $('#docDoneText').textContent = `Cheltuială salvată: ${fields.supplier}, ${fmtPayDay(fields.doc_date)}, ${amount === null ? fields.amount_total : num(amount)} ${fields.currency}`
          + (res.filesError ? '. Fișierele nu s-au salvat.' : '');
        step('done');
        return;
      }
      dlg.close();
      if (res.filesError) alert('Înregistrarea a fost creată, dar fișierele nu s-au salvat.');
      window.LUXDUES.resetClients();
      // Unde ajunge: cheltuiala, documentul de plătit, pagina furnizorului (cu rezumatul importului)
      // sau fișa clientului (client nou sau rate de încasat)
      const imp = res.summary ? ['created', 'updated', 'unchanged', 'older'].map(k => res.summary[k] || 0).join('-') : '';
      go(res.kind === 'expense' ? `fin=exp&eid=${encodeURIComponent(res.id)}`
        : res.kind === 'payable' ? `due=payd&pid=${encodeURIComponent(res.id)}`
          : res.kind === 'catalog' ? `cat=sup&sid=${encodeURIComponent(res.id)}&imp=${imp}` : `id=${encodeURIComponent(res.id)}`);
    } catch (err) {
      if (err instanceof AuthError) dlg.close();
      onError(err, e2 => {
        if (e2.status === 409) { showDupes(e2.data.duplicates || []); return; }
        docMsg.textContent = e2.status === 'storage' ? 'Nu s-a putut încărca fișierul. Încearcă din nou.'
          : form ? (form.errText || window.LUXFIN.errText)(e2, 'Nu s-a salvat. Încearcă din nou.')
            : e2.status === 400 && e2.fields.length ? `Verificați: ${e2.fields.map(f => FIELD_NAMES[f] || f).join(', ')}.`
              : 'Nu s-a salvat. Încearcă din nou.';
      });
    } finally {
      btn.disabled = false;
    }
  });

  $('#docDupes').addEventListener('click', e => {
    const btn = e.target.closest('button[data-open], a[data-exp], a[data-href]');
    if (!btn) return;
    e.preventDefault();
    dlg.close();
    go(btn.dataset.href || (btn.dataset.exp ? `fin=exp&eid=${encodeURIComponent(btn.dataset.exp)}` : `id=${encodeURIComponent(btn.dataset.open)}`));
  });

  // Ajutoarele comune pentru secțiunea Financiar (admin-fin.js)
  const helpers = { $, esc, num, money, parseMoney, today, api, onError, go, internal, show, options, fmtDay, fmtPayDay, DOC_TYPES, openDoc, inTg, syncBack };
  window.LUXFIN.init(helpers);
  window.LUXDUES.init(helpers);
  window.LUXCAT.init(helpers);
  window.LUXVIZ.init(helpers);

  // Închiderea fără salvare: fișierele temporare se șterg
  ['#docClose', '#docCancel', '#docUnsupportedClose', '#docDoneClose'].forEach(s => $(s).addEventListener('click', () => dlg.close()));
  dlg.addEventListener('close', () => {
    if (!doc.saved) dropUpload();
    if (tgAtLeast('6.2')) tgCall('disableClosingConfirmation');
    syncBack();
  });
  // Încă un document fără să închidă dialogul (după refuzul „owner_only” sau după o cheltuială salvată)
  ['#docAnother', '#docDoneAnother'].forEach(s => $(s).addEventListener('click', () => { if (!doc.saved) dropUpload(); resetDoc(); }));

  boot();
})();
