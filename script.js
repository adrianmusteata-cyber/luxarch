(() => {
  const $ = (s, c = document) => c.querySelector(s);
  const $$ = (s, c = document) => [...c.querySelectorAll(s)];
  const root = document.documentElement;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const I = window.LX_I18N || { ru: {}, en: {}, extra: {} };

  // Animațiile pornesc doar dacă GSAP s-a încărcat; altfel pagina rămâne statică și completă
  const anim = !!(window.gsap && window.ScrollTrigger) && root.classList.contains('js-anim');
  if (!anim) root.classList.remove('js-anim', 'intro');
  if (anim) gsap.registerPlugin(ScrollTrigger);

  /* ---------- Limbi: RO e citit din HTML, RU/EN vin din i18n.js ---------- */
  const LANGS = ['ro', 'ru', 'en'];
  const RO = {}, RO_PH = {}, RO_ALT = {}, RO_ARIA = {};
  $$('[data-i18n]').forEach(el => { RO[el.dataset.i18n] = el.innerHTML; });
  $$('[data-i18n-ph]').forEach(el => { RO_PH[el.dataset.i18nPh] = el.placeholder; });
  $$('[data-i18n-alt]').forEach(el => { RO_ALT[el.dataset.i18nAlt] = el.alt; });
  $$('[data-i18n-aria]').forEach(el => { RO_ARIA[el.dataset.i18nAria] = el.getAttribute('aria-label'); });
  let lang = 'ro';
  const dict = () => (lang === 'ro' ? RO : I[lang] || {});
  const t = k => dict()[k] ?? RO[k] ?? '';
  const X = () => (I.extra && (I.extra[lang] || I.extra.ro)) || {};
  const langHooks = [];

  function buildMarquee() {
    const words = X().marquee || [];
    const chunk = words.map(w => `<span>${w}</span><span class="dot" aria-hidden="true">✦</span>`).join('');
    $('#marquee').innerHTML = chunk + chunk;
  }

  function setLang(l) {
    lang = LANGS.includes(l) ? l : 'ro';
    root.lang = lang;
    const d = dict();
    $$('[data-i18n]').forEach(el => { const v = d[el.dataset.i18n] ?? RO[el.dataset.i18n]; if (v != null) el.innerHTML = v; });
    $$('[data-i18n-ph]').forEach(el => { el.placeholder = d[el.dataset.i18nPh] ?? RO_PH[el.dataset.i18nPh]; });
    $$('[data-i18n-alt]').forEach(el => { el.alt = (lang === 'ro' ? RO_ALT : d)[el.dataset.i18nAlt] ?? RO_ALT[el.dataset.i18nAlt]; });
    $$('[data-i18n-aria]').forEach(el => { el.setAttribute('aria-label', d[el.dataset.i18nAria] ?? RO_ARIA[el.dataset.i18nAria]); });
    $$('#lang [data-lang]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.lang === lang)));
    document.title = X().title || document.title;
    const desc = $('meta[name="description"]');
    if (desc && X().desc) desc.content = X().desc;
    $('#cursorLabel').textContent = X().cursor || '';
    buildMarquee();
    langHooks.forEach(fn => fn());
    try { localStorage.setItem('temelia-lang', lang); } catch (e) { /* stocare indisponibilă */ }
  }

  // Prima vizită: limba browserului (ru → RU, ro/mo → RO, altfel EN)
  function detectLang() {
    let saved = null;
    try { saved = localStorage.getItem('temelia-lang'); } catch (e) { /* stocare indisponibilă */ }
    if (LANGS.includes(saved)) return saved;
    const nav = (navigator.language || '').toLowerCase();
    if (nav.startsWith('ru')) return 'ru';
    if (nav.startsWith('ro') || nav.startsWith('mo')) return 'ro';
    return 'en';
  }
  $$('#lang [data-lang]').forEach(b => b.addEventListener('click', () => setLang(b.dataset.lang)));
  setLang(detectLang());

  /* ---------- Meniu mobil ---------- */
  const burger = $('#burger');
  const setMenu = open => {
    document.body.classList.toggle('menu-open', open);
    burger.setAttribute('aria-expanded', String(open));
  };
  burger.addEventListener('click', () => setMenu(!document.body.classList.contains('menu-open')));
  $$('#navLinks a').forEach(a => a.addEventListener('click', () => setMenu(false)));
  addEventListener('keydown', e => { if (e.key === 'Escape' && document.body.classList.contains('menu-open')) { setMenu(false); burger.focus(); } });

  /* ---------- Nav: fundal după scroll, se ascunde la derulare în jos ---------- */
  const nav = $('#nav');
  let lastY = scrollY, ticking = false;
  addEventListener('scroll', () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      const y = scrollY;
      nav.classList.toggle('scrolled', y > 40);
      nav.classList.toggle('away', y > 300 && y > lastY && !document.body.classList.contains('menu-open'));
      lastY = y;
      ticking = false;
    });
  }, { passive: true });

  /* ---------- Poze care nu se încarcă: rămâne un bloc de culoare ---------- */
  $$('.project-media img, .hero-media img').forEach(img => {
    const fail = () => img.parentElement.classList.add('broken');
    if (img.complete && !img.naturalWidth) fail(); else img.addEventListener('error', fail);
  });

  /* ---------- Filtre proiecte ---------- */
  const track = $('#track');
  $$('#filters .filter').forEach(btn => btn.addEventListener('click', () => {
    const f = btn.dataset.filter;
    $$('#filters .filter').forEach(b => b.setAttribute('aria-pressed', String(b === btn)));
    $$('.project', track).forEach(p => p.classList.toggle('is-hidden', f !== 'all' && p.dataset.cat !== f));
    if (anim) {
      ScrollTrigger.refresh();
      gsap.fromTo($$('.project:not(.is-hidden)', track), { opacity: 0, y: 30 }, { opacity: 1, y: 0, duration: .7, stagger: .06, ease: 'power3.out', clearProps: 'transform' });
    }
  }));

  /* ---------- Galerie pe tot ecranul ---------- */
  // [lățime, înălțime] pentru fiecare poză din img/projects/<slug>/<n>-{800,1400,2000}.webp
  const GALLERY = {
    'vila-apa': [[2048, 1377], [2048, 1377], [2048, 1377], [2048, 1377]],
    'casa-copac': [[1500, 1100], [1500, 1100], [1500, 1100], [1500, 1100]],
    'hotel-panta': [[1875, 2500], [2560, 1536], [2500, 1749], [1875, 2500]],
    'vitraje': [[1250, 875], [1750, 2500], [1250, 750], [850, 1250]],
    'casa-piatra': [[1500, 900], [1500, 1012], [1500, 1024], [1500, 1196]],
    'nistru': [[1500, 1125], [1500, 750], [1250, 962], [1500, 900]],
    'sase-corpuri': [[1920, 1526], [1920, 1528], [2560, 2035], [2560, 2035]],
    'sportiv': [[1276, 851], [1440, 960], [1404, 936], [1328, 886]],
    'data-center': [[1920, 1080], [1920, 1080], [1920, 1440]],
    'crama': [[1088, 1143], [2429, 1249], [1039, 1151]],
  };
  // Ordinea în galerie: pentru hotel-panta și crama, poza de copertă e a 2-a de pe disc
  const ORDER = { 'hotel-panta': [2, 1, 3, 4], 'crama': [2, 1, 3] };
  const srcsetFor = (slug, n, w) => {
    const base = `img/projects/${slug}/${n}`;
    const parts = [`${base}-800.webp 800w`, `${base}-1400.webp ${Math.min(1400, w)}w`];
    if (w > 1400) parts.push(`${base}-2000.webp ${Math.min(2000, w)}w`);
    return parts.join(', ');
  };

  const lb = $('#lb'), lbImg = $('#lbImg'), lbStage = $('#lbStage');
  let lbSlug = null, lbIndex = 0, lbOpener = null;

  function lbShow(i) {
    const list = GALLERY[lbSlug];
    lbIndex = (i + list.length) % list.length;
    const order = ORDER[lbSlug] || list.map((_, k) => k + 1);
    const n = order[lbIndex], [w, h] = list[n - 1];
    const card = $(`.project[data-slug="${lbSlug}"]`);
    const title = $('.project-title', card).textContent;
    lbStage.classList.remove('broken');
    lbImg.onerror = () => lbStage.classList.add('broken');
    lbImg.width = w; lbImg.height = h;
    lbImg.sizes = '100vw';
    lbImg.srcset = srcsetFor(lbSlug, n, w);
    lbImg.src = `img/projects/${lbSlug}/${n}-1400.webp`;
    lbImg.alt = `${title} — ${lbIndex + 1}`;
    $('#lbTitle').textContent = title;
    $('#lbMeta').textContent = $('.project-meta', card).textContent;
    $('#lbCount').textContent = `${String(lbIndex + 1).padStart(2, '0')} ${X().lbOf || '/'} ${String(list.length).padStart(2, '0')}`;
    if (anim) gsap.fromTo(lbImg, { opacity: 0, scale: 1.04 }, { opacity: 1, scale: 1, duration: .7, ease: 'power3.out' });
  }

  function lbOpen(slug, opener) {
    lbSlug = slug; lbOpener = opener;
    lb.hidden = false;
    root.classList.add('lb-open');
    lbShow(0);
    history.pushState({ lb: 1 }, '');
    if (anim) gsap.fromTo(lb, { clipPath: 'inset(100% 0 0 0)' }, { clipPath: 'inset(0% 0 0 0)', duration: .8, ease: 'expo.inOut' });
    $('#lbClose').focus();
  }

  function lbHide() {
    if (lb.hidden) return;
    const done = () => {
      lb.hidden = true;
      root.classList.remove('lb-open');
      lbImg.removeAttribute('src'); lbImg.removeAttribute('srcset');
      if (lbOpener) lbOpener.focus();
    };
    if (anim) gsap.to(lb, { clipPath: 'inset(0 0 100% 0)', duration: .6, ease: 'expo.inOut', onComplete: done });
    else done();
  }
  // Închiderea trece prin istoric, ca butonul „înapoi” al telefonului să închidă galeria
  const lbClose = () => (history.state && history.state.lb ? history.back() : lbHide());
  addEventListener('popstate', lbHide);

  $$('.project-open').forEach(b => b.addEventListener('click', () => lbOpen(b.closest('.project').dataset.slug, b)));
  $('#lbClose').addEventListener('click', lbClose);
  $('#lbPrev').addEventListener('click', () => lbShow(lbIndex - 1));
  $('#lbNext').addEventListener('click', () => lbShow(lbIndex + 1));
  lbStage.addEventListener('click', e => { if (e.target === lbStage) lbClose(); });
  lb.addEventListener('keydown', e => {
    if (e.key === 'Escape') lbClose();
    else if (e.key === 'ArrowRight') lbShow(lbIndex + 1);
    else if (e.key === 'ArrowLeft') lbShow(lbIndex - 1);
    else if (e.key === 'Tab') {
      // focusul rămâne în galerie
      const f = [$('#lbClose'), $('#lbPrev'), $('#lbNext')];
      const i = f.indexOf(document.activeElement);
      e.preventDefault();
      f[(i + (e.shiftKey ? -1 : 1) + f.length) % f.length].focus();
    }
  });
  let touchX = null;
  lbStage.addEventListener('touchstart', e => { touchX = e.touches[0].clientX; }, { passive: true });
  lbStage.addEventListener('touchend', e => {
    if (touchX == null) return;
    const dx = e.changedTouches[0].clientX - touchX;
    if (Math.abs(dx) > 40) lbShow(lbIndex + (dx < 0 ? 1 : -1));
    touchX = null;
  });

  /* ---------- Formular → /api/contact (Supabase + Telegram) ---------- */
  const form = $('#contactForm');
  const msg = $('#formMsg');
  const sendBtn = $('#formSend');
  const sendLabel = $('[data-i18n="f.send"]', sendBtn);
  const fallback = $('#formFallback');
  const done = $('#formDone');
  $('#formAgain').addEventListener('click', () => {
    done.hidden = true;
    form.hidden = false;
    form.elements.name.focus();
  });
  const startedAt = Date.now();
  let sending = false;

  const markInvalid = (el, bad) => (el.closest('.field') || el.closest('.consent')).classList.toggle('invalid', bad);
  $$('[required]', form).forEach(inp => inp.addEventListener(inp.type === 'checkbox' ? 'change' : 'input', () => {
    if (inp.checkValidity()) markInvalid(inp, false);
  }));

  // Textul cererii, gata de trimis pe WhatsApp dacă serverul nu răspunde
  function whatsappText() {
    const opt = name => form.elements[name].selectedOptions[0]?.textContent.trim() || '';
    return [
      X().waHello,
      `${t('f.name')}: ${form.elements.name.value.trim()}`,
      `${t('f.phone')}: ${form.elements.phone.value.trim()}`,
      `Email: ${form.elements.email.value.trim()}`,
      `${t('f.type')}: ${opt('type')}`,
      `${t('f.service')}: ${opt('service')}`,
      `${t('f.msg')}: ${form.elements.message.value.trim()}`,
    ].join('\n');
  }

  function setSending(on) {
    sending = on;
    sendBtn.disabled = on;
    sendLabel.textContent = on ? X().sending : t('f.send');
  }

  form.addEventListener('submit', async e => {
    e.preventDefault();
    if (sending) return;
    fallback.hidden = true;
    let ok = true;
    $$('[required]', form).forEach(inp => {
      const bad = !inp.checkValidity();
      markInvalid(inp, bad);
      if (bad) ok = false;
    });
    if (!ok) { msg.textContent = X().err; return; }

    const f = form.elements;
    const payload = {
      name: f.name.value, phone: f.phone.value, email: f.email.value,
      type: f.type.value, service: f.service.value, message: f.message.value,
      consent: f.consent.checked, website: f.website.value, lang, startedAt,
    };
    msg.textContent = '';
    setSending(true);
    try {
      const r = await fetch('/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(15000),
      });
      const res = await r.json().catch(() => ({}));
      if (r.ok && res.ok) {
        // formularul dispare; rămâne doar confirmarea
        form.reset();
        msg.textContent = '';
        form.hidden = true;
        done.hidden = false;
        done.focus({ preventScroll: true });
        done.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'center' });
        if (anim) gsap.fromTo(done.children, { opacity: 0, y: 24 }, { opacity: 1, y: 0, duration: .9, stagger: .1, ease: 'expo.out' });
      } else if (r.status === 400 && Array.isArray(res.fields) && res.fields.length) {
        res.fields.forEach(n => { if (f[n]) markInvalid(f[n], true); });
        msg.textContent = X().err;
      } else {
        throw new Error(`HTTP ${r.status}`);
      }
    } catch (err) {
      $('#waPrefill').href = 'https://wa.me/37368133945?text=' + encodeURIComponent(whatsappText());
      fallback.hidden = false;
    } finally {
      setSending(false);
    }
  });

  /* ---------- Vizualizare proiect → /api/contact?action=viz-* (generarea rulează doar pe server) ---------- */
  (() => {
    const vf = $('#vizForm');
    if (!vf) return;
    const V = () => X().viz || {};
    const vmsg = $('#vizMsg'), vbtn = $('#vizSend'), vlabel = $('#vizSendLabel'), photoMsg = $('#vizPhotoMsg');
    const result = $('#vizResult');
    const MAX = 3, MAX_SIZE = 10 * 1024 * 1024;
    let SIDE = 2048; // latura mare după micșorare: o spune serverul (modelul Cloudflare primește doar poze sub 512 px)
    const OK_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
    const vizStartedAt = Date.now();
    // photos: [{ blob, url }]; token/uploads: rezervarea de pe server (valabilă 15 minute)
    const st = { photos: [], token: null, uploads: null, uploaded: false, busy: false, phone: '', tsToken: '', tsId: null, siteKey: '' };

    // Formularul apare doar dacă serverul are cheile (serviciul de imagini + Turnstile); altfel rămâne trimiterea spre contact
    fetch('/api/contact?action=viz-status', { signal: AbortSignal.timeout(8000) })
      .then(r => r.json())
      .then(d => {
        if (!d || !d.enabled || !d.site_key) return;
        st.siteKey = d.site_key;
        if (Number(d.max_side) >= 256) SIDE = Number(d.max_side);
        $('#vizOff').hidden = true;
        vf.hidden = false;
        loadTurnstile();
        if (anim) ScrollTrigger.refresh();
      })
      .catch(() => { /* rămâne trimiterea spre formularul de contact */ });

    /* Turnstile (Cloudflare): scriptul se încarcă doar când formularul e activ */
    function loadTurnstile() {
      window.lxTurnstileReady = renderTurnstile;
      const s = document.createElement('script');
      s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=lxTurnstileReady';
      s.async = true;
      document.head.appendChild(s);
    }
    function renderTurnstile() {
      const box = $('#vizTs');
      try {
        st.tsId = window.turnstile.render(box, {
          sitekey: st.siteKey, theme: 'dark', language: lang,
          // Pe ecranele foarte înguste (320 px) varianta normală de 300 px nu încape
          size: box.clientWidth && box.clientWidth < 300 ? 'compact' : 'flexible',
          callback: tok => { st.tsToken = tok; },
          'expired-callback': () => { st.tsToken = ''; },
          // Codul erorii Turnstile se arată sub buton, ca să se poată afla cauza (domeniu, browser, rețea)
          'error-callback': code => { st.tsToken = ''; st.tsError = String(code || ''); return true; },
        });
      } catch (e) { /* widgetul lipsește: trimiterea va cere reîncărcarea paginii */ }
    }
    // Tokenul Turnstile e de unică folosință: după fiecare „start” se cere unul nou
    function resetTurnstile() {
      st.tsToken = '';
      try { if (window.turnstile && st.tsId != null) window.turnstile.reset(st.tsId); } catch (e) { /* fără widget */ }
    }

    // Pozele, tipul sau dorințele s-au schimbat: rezervarea veche nu mai e bună
    const dropReservation = () => { st.token = null; st.uploads = null; st.uploaded = false; };
    vf.addEventListener('change', e => { if (e.target.name === 'kind') dropReservation(); });
    vf.elements.wishes.addEventListener('input', dropReservation);

    // Poza se micșorează în browser: latura mare ≤ SIDE (2048 px sau cât cere modelul), JPEG ~0,85
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
      const k = Math.min(1, SIDE / Math.max(w, h));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(w * k); canvas.height = Math.round(h * k);
      canvas.getContext('2d').drawImage(src, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise(ok => canvas.toBlob(ok, 'image/jpeg', 0.85));
      if (!blob) throw new Error('canvas');
      return blob;
    }

    function renderPhotos() {
      $('#vizThumbs').innerHTML = st.photos.map((p, i) => `<li>
        <img src="${p.url}" alt="${V().photo || ''} ${i + 1}">
        <button type="button" class="viz-del" data-i="${i}" aria-label="${V().remove || ''} ${i + 1}">×</button>
      </li>`).join('');
      $('#vizPhotos').classList.toggle('is-full', st.photos.length >= MAX);
    }
    langHooks.push(renderPhotos);

    $('#vizFile').addEventListener('change', async e => {
      const picked = [...e.target.files];
      e.target.value = '';
      if (st.busy || !picked.length) return;
      photoMsg.textContent = '';
      $('#vizPhotos').classList.remove('invalid');
      if (st.photos.length + picked.length > MAX) { photoMsg.textContent = V().max; return; }
      if (picked.some(f => (f.type && !OK_TYPES.includes(f.type)) || f.size > MAX_SIZE)) { photoMsg.textContent = V().bad; return; }
      photoMsg.textContent = V().prep;
      try {
        for (const f of picked) {
          const blob = await shrink(f);
          st.photos.push({ blob, url: URL.createObjectURL(blob) });
        }
        photoMsg.textContent = '';
      } catch (err) {
        photoMsg.textContent = V().unreadable;
      }
      dropReservation();
      renderPhotos();
    });
    $('#vizThumbs').addEventListener('click', e => {
      const b = e.target.closest('.viz-del');
      if (!b || st.busy) return;
      URL.revokeObjectURL(st.photos.splice(Number(b.dataset.i), 1)[0].url);
      dropReservation();
      renderPhotos();
    });

    function setBusy(on) {
      st.busy = on;
      vbtn.disabled = on;
      vlabel.textContent = on ? V().busy : t('viz.send');
      vf.classList.toggle('is-busy', on);
    }

    async function post(action, body, ms) {
      const r = await fetch('/api/contact?action=' + action, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(ms),
      });
      return { ok: r.ok, status: r.status, data: await r.json().catch(() => ({})) };
    }

    const FIELD_BOX = { kind: '#vizKinds', files: '#vizPhotos' };
    const markBox = (name, bad) => {
      const el = FIELD_BOX[name] ? $(FIELD_BOX[name])
        : name === 'consent' ? vf.elements.consent.closest('.consent')
          : vf.elements[name] && vf.elements[name].closest('.field');
      if (el) el.classList.toggle('invalid', bad);
    };
    ['name', 'phone', 'email', 'consent'].forEach(n => vf.elements[n].addEventListener(n === 'consent' ? 'change' : 'input', () => markBox(n, false)));
    vf.addEventListener('change', e => {
      if (e.target.name !== 'kind') return;
      markBox('kind', false);
      // Clasa dublează :has(input:checked) pentru browserele mai vechi
      $$('.viz-kind', vf).forEach(l => l.classList.toggle('is-on', l.querySelector('input').checked));
    });

    // Răspunsul cu eroare de la server → mesajul pentru vizitator
    function failed(r) {
      const code = r.data.error || '';
      if (code === 'invalid') {
        (r.data.fields || []).forEach(n => markBox(n, true));
        vmsg.textContent = V().err;
      } else if (code === 'viz_off') {
        vf.hidden = true; $('#vizOff').hidden = false;
      } else if (code === 'turnstile') {
        vmsg.textContent = V().robot + (st.tsError ? ` (Turnstile ${st.tsError})` : '');
      } else if (code === 'save') {
        vmsg.textContent = '';
        $('#vizFallback').hidden = false;
      } else if (code === 'expired') {
        dropReservation(); vmsg.textContent = V().expired;
      } else if (code === 'nofiles') {
        st.uploaded = false; vmsg.textContent = V().upload;
      } else if (code === 'rejected') {
        dropReservation(); vmsg.textContent = V().rejected;
      } else if (code === 'files') {
        dropReservation(); vmsg.textContent = V().bad;
      } else if (/^limit_/.test(code)) {
        dropReservation(); vmsg.textContent = V()[code] || V().service;
      } else {
        vmsg.textContent = V()[code] || (r.status === 504 ? V().timeout : V().service);
      }
    }

    function showResult(url) {
      $('#vizImg').src = url;
      $('#vizDownload').href = url + (url.includes('?') ? '&' : '?') + 'download=luxarch-schita';
      $('#vizThanks').textContent = (V().thanks || '').replace('{phone}', st.phone);
      vf.hidden = true;
      result.hidden = false;
      result.focus({ preventScroll: true });
      result.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
    }

    $('#vizAgain').addEventListener('click', () => {
      st.photos.forEach(p => URL.revokeObjectURL(p.url));
      st.photos = [];
      dropReservation();
      renderPhotos();
      vf.elements.wishes.value = '';
      vmsg.textContent = '';
      result.hidden = true;
      $('#vizImg').removeAttribute('src');
      vf.hidden = false;
      resetTurnstile();
      vf.elements.wishes.focus();
    });

    vf.addEventListener('submit', async e => {
      e.preventDefault();
      if (st.busy) return; // dublu clic: o singură generare
      $('#vizFallback').hidden = true;
      const f = vf.elements;
      const bad = {
        kind: !f.kind.value,
        files: !st.photos.length,
        name: !f.name.value.trim(),
        phone: !f.phone.value.trim(),
        email: !!f.email.value.trim() && !f.email.checkValidity(),
        consent: !f.consent.checked,
      };
      Object.entries(bad).forEach(([k, v]) => markBox(k, v));
      if (Object.values(bad).some(Boolean)) { vmsg.textContent = bad.files && !bad.name && !bad.phone ? V().needPhoto : V().err; return; }
      if (!st.token && !st.tsToken) {
        vmsg.textContent = V().robot + (st.tsError ? ` (Turnstile ${st.tsError})` : window.turnstile ? ' (Turnstile: fără răspuns)' : ' (Turnstile nu s-a încărcat)');
        return;
      }

      setBusy(true);
      vmsg.textContent = '';
      try {
        // Pasul „start”: cererea în CRM, limitele, rezervarea și linkurile de încărcare
        if (!st.token) {
          const r = await post('viz-start', {
            kind: f.kind.value, wishes: f.wishes.value, name: f.name.value, phone: f.phone.value, email: f.email.value,
            consent: f.consent.checked, website: f.website.value, startedAt: vizStartedAt, lang, turnstile: st.tsToken,
            files: st.photos.map((p, i) => ({ page: i + 1, mime: 'image/jpeg', size: p.blob.size })),
          }, 20000);
          resetTurnstile();
          if (!r.ok) return failed(r);
          if (!r.data.token) { vmsg.textContent = ''; return; } // răspunsul pentru roboți
          st.token = r.data.token; st.uploads = r.data.uploads; st.uploaded = false; st.phone = f.phone.value.trim();
        }
        // Pozele merg direct în Storage, cu linkurile semnate (reîncercarea folosește aceeași rezervare)
        if (!st.uploaded) {
          try {
            await Promise.all(st.uploads.map(async u => {
              const p = st.photos[u.page - 1];
              const up = await fetch(u.url, { method: 'PUT', headers: { 'Content-Type': 'image/jpeg' }, body: p.blob });
              if (!up.ok) throw new Error('upload');
            }));
          } catch (err) {
            vmsg.textContent = V().upload;
            return;
          }
          st.uploaded = true;
        }
        // Pasul „generate”: serverul are 60 s; dacă pagina se închide, schița ajunge oricum pe fișă
        const g = await post('viz-generate', { token: st.token }, 75000);
        if (g.ok && g.data.url) return showResult(g.data.url);
        failed(g);
      } catch (err) {
        // Rețeaua a căzut sau răspunsul a întârziat: reîncercarea întoarce schița, dacă s-a terminat între timp
        vmsg.textContent = st.token ? V().timeout : V().service;
      } finally {
        setBusy(false);
      }
    });
  })();

  /* ---------- Agentul vocal ElevenLabs: limba widgetului și unealta navigate ---------- */
  const voice = $('elevenlabs-convai');
  if (voice) {
    const VOICE_SECTIONS = ['top', 'manifest', 'servicii', 'proiecte', 'proces', 'vizualizare', 'intrebari', 'contact'];
    // Textele butonului și limba convorbirii (următoarea convorbire, dacă limba se schimbă în timpul uneia)
    const voiceLang = () => {
      voice.setAttribute('override-language', lang);
      voice.setAttribute('text-contents', JSON.stringify(X().voice || {}));
    };
    voiceLang();
    langHooks.push(voiceLang);
    // Butonul a apărut (scriptul lor s-a încărcat): WhatsApp-ul urcă deasupra lui
    if (window.customElements) customElements.whenDefined('elevenlabs-convai').then(() => root.classList.add('has-voice'));

    // Derulează lin la secțiune, fără reîncărcare; #proiecte e fixat cu ScrollTrigger pe desktop, deci ținta e începutul fixării
    const navigate = ({ section } = {}) => {
      const id = String(section || '').trim().toLowerCase().replace(/^#/, '');
      const el = VOICE_SECTIONS.includes(id) ? document.getElementById(id) : null;
      if (!el) return 'not_found';
      setMenu(false);
      const behavior = reduce ? 'auto' : 'smooth';
      const st = id === 'proiecte' && anim ? ScrollTrigger.getAll().find(s => s.pin && s.trigger && s.trigger.id === 'projectsPin') : null;
      if (st) scrollTo({ top: st.start, behavior });
      else if (id === 'top') scrollTo({ top: 0, behavior });
      else el.scrollIntoView({ behavior, block: 'start' });
      return `ok: ${id}`;
    };
    voice.addEventListener('elevenlabs-convai:call', e => {
      if (e.detail && e.detail.config) e.detail.config.clientTools = { navigate };
    });
  }

  $('#year').textContent = new Date().getFullYear();

  if (!anim) return;

  /* ==========================================================
     ANIMAȚII (doar cu GSAP și fără prefers-reduced-motion)
     ========================================================== */
  const ease = 'expo.out';

  /* ---------- Intro + Hero ---------- */
  const heroTl = gsap.timeline({ defaults: { ease } });
  if (root.classList.contains('intro')) {
    try { sessionStorage.setItem('lx-intro', '1'); } catch (e) { /* stocare indisponibilă */ }
    heroTl
      .fromTo('.loader-word span', { yPercent: 110, y: 0 }, { yPercent: 0, y: 0, duration: .7, stagger: .05 })
      .fromTo('.loader-line span', { scaleX: 0 }, { scaleX: 1, duration: .6, ease: 'power2.inOut' }, '<.1')
      .to('#loader', { yPercent: -100, duration: .7, ease: 'expo.inOut' }, '+=.05')
      .add(() => root.classList.remove('intro'));
  }
  heroTl
    .fromTo('.hero-title .line > span', { yPercent: 110, y: 0 }, { yPercent: 0, y: 0, duration: 1.3, stagger: .1 }, root.classList.contains('intro') ? '-=.35' : 0)
    .to('.hero [data-anim]', { opacity: 1, y: 0, duration: 1, stagger: .08 }, '-=1')
    .fromTo('.hero-media', { clipPath: 'inset(100% 0% 0% 0%)' }, { clipPath: 'inset(0% 0% 0% 0%)', duration: 1.5, ease: 'expo.inOut' }, '-=1.1')
    .from('.hero-media img', { scale: 1.25, duration: 2, ease }, '<')
    .from('.hero-facts li', { opacity: 0, y: 20, duration: .8, stagger: .08 }, '-=1.2');

  // Parallax pe poza mare din Hero
  gsap.to('.hero-media img', {
    yPercent: 10, ease: 'none',
    scrollTrigger: { trigger: '.hero-media', start: 'top bottom', end: 'bottom top', scrub: true },
  });

  /* ---------- Apariții la scroll ---------- */
  ScrollTrigger.batch('[data-anim]:not(.hero [data-anim])', {
    start: 'top 88%',
    once: true,
    onEnter: els => gsap.to(els, { opacity: 1, y: 0, duration: 1.1, stagger: .1, ease }),
  });
  $$('.split-title').forEach(h => {
    gsap.from(h, { yPercent: 40, opacity: 0, duration: 1.3, ease, scrollTrigger: { trigger: h, start: 'top 88%', once: true } });
  });

  /* ---------- Manifest: cuvintele se aprind pe rând la scroll ---------- */
  const manifest = $('#manifestText');
  let manifestTween = null;
  function buildManifest() {
    if (manifestTween) { manifestTween.scrollTrigger.kill(); manifestTween.kill(); }
    manifest.innerHTML = manifest.textContent.trim().split(/\s+/).map(w => `<span class="w">${w}</span>`).join(' ');
    manifestTween = gsap.fromTo($$('.w', manifest), { opacity: .14 }, {
      opacity: 1, stagger: .1, ease: 'none',
      scrollTrigger: { trigger: manifest, start: 'top 80%', end: 'bottom 40%', scrub: true },
    });
  }
  buildManifest();
  langHooks.push(buildManifest);

  /* ---------- Proiecte: bandă orizontală fixată (desktop), cortine (telefon) ---------- */
  const mm = gsap.matchMedia();
  mm.add('(min-width: 1024px)', () => {
    const dist = () => Math.max(0, track.scrollWidth - innerWidth);
    gsap.to(track, {
      x: () => -dist(), ease: 'none',
      scrollTrigger: {
        trigger: '#projectsPin', start: 'top top', end: () => '+=' + dist(),
        pin: true, scrub: 1, invalidateOnRefresh: true, anticipatePin: 1,
      },
    });
    gsap.fromTo('.project-media', { clipPath: 'inset(0% 0% 100% 0%)' }, {
      clipPath: 'inset(0% 0% 0% 0%)', duration: 1.4, stagger: .12, ease: 'expo.inOut',
      scrollTrigger: { trigger: '#projectsPin', start: 'top 70%', once: true },
    });
  });
  mm.add('(max-width: 1023.98px)', () => {
    $$('.project-media').forEach(m => gsap.fromTo(m, { clipPath: 'inset(0% 0% 100% 0%)' }, {
      clipPath: 'inset(0% 0% 0% 0%)', duration: 1.3, ease: 'expo.inOut',
      scrollTrigger: { trigger: m, start: 'top 90%', once: true },
    }));
  });

  /* ---------- Proces: linia verticală se desenează ---------- */
  gsap.fromTo('#steps', { '--line': 0 }, {
    '--line': 1, ease: 'none',
    scrollTrigger: { trigger: '#steps', start: 'top 75%', end: 'bottom 60%', scrub: true },
  });

  /* ---------- Cuvântul uriaș din subsol ---------- */
  gsap.from('.footer-word', {
    yPercent: 60, opacity: 0, duration: 1.4, ease,
    scrollTrigger: { trigger: '.footer', start: 'top 95%', once: true },
  });

  /* ---------- Cercul „Vezi” peste proiecte (doar mouse) ---------- */
  if (matchMedia('(hover: hover) and (pointer: fine)').matches) {
    const cursor = $('#cursor');
    root.classList.add('has-cursor');
    const xTo = gsap.quickTo(cursor, 'x', { duration: .5, ease: 'power3' });
    const yTo = gsap.quickTo(cursor, 'y', { duration: .5, ease: 'power3' });
    addEventListener('pointermove', e => { xTo(e.clientX); yTo(e.clientY); cursor.classList.add('on'); }, { passive: true });
    document.addEventListener('pointerleave', () => cursor.classList.remove('on'));
    $$('[data-cursor]').forEach(el => {
      el.addEventListener('pointerenter', () => cursor.classList.add('view'));
      el.addEventListener('pointerleave', () => cursor.classList.remove('view'));
    });
  }

  // Fonturile și pozele schimbă înălțimile: recalculăm pozițiile
  if (document.fonts) document.fonts.ready.then(() => ScrollTrigger.refresh());
  addEventListener('load', () => ScrollTrigger.refresh());
})();
