/* ==========================================================
   LUXARCH — Mini App-ul clienților (botul de clienți, nu cel al echipei).
   Un singur ecran: serviciul, telefonul, mesajul, acordul. Trimite la /api/contact?action=tg-request.
   Numele și ID-ul le ia serverul din initData verificat; aici numele e doar afișat.
   ========================================================== */
(function () {
  // Username-ul botului de clienți, pentru ecranul „Deschide în Telegram”. Pe site, același link e în index.html (rândul Telegram).
  const CLIENT_BOT = 'luxarch_client_bot';
  const WHATSAPP = 'https://wa.me/37368133945';
  const TG = window.Telegram && window.Telegram.WebApp;
  const inTg = !!(TG && TG.initData);
  const $ = id => document.getElementById(id);

  // Textele serviciilor: RO stă aici, RU și EN vin din i18n.js (f.s1–f.s6), aceleași ca în formularul de pe site
  const SERVICES = [['arh_rez', 1], ['arh', 2], ['rez', 3], ['design', 5], ['management', 6], ['nu_stiu', 4]];
  const RO_SERVICES = { 1: 'Arhitectură + Rezistență', 2: 'Doar arhitectură', 3: 'Doar rezistență', 4: 'Nu știu încă', 5: 'Design interior', 6: 'Management de proiect' };

  const T = {
    ro: {
      title: 'Trimite o cerere', from: 'Trimiți ca', service: 'Ce serviciu te interesează?', contactBtn: 'Trimite numărul meu',
      phone: 'Telefon', phoneHint: 'Scrie numărul aici', message: 'Mesaj (opțional)', consent: 'Sunt de acord cu', policy: 'politica de confidențialitate',
      send: 'Trimite', sending: 'Se trimite…', whatsapp: 'Scrie-ne pe WhatsApp', close: 'Închide', doneTitle: 'Cerere trimisă',
      thanks: 'Mulțumim, {name}! Am primit cererea și te contactăm în curând.',
      e_service: 'Alege un serviciu.', e_phone: 'Scrie un număr de telefon valid (cel puțin 6 cifre).', e_message: 'Mesajul e prea lung (maximum 3000 de caractere).', e_consent: 'Bifează acordul ca să poți trimite.',
      off: 'Momentan nu putem primi cereri aici.', bad: 'Închide aplicația și deschide-o din nou.', expired: 'Sesiunea a expirat. Închide aplicația și deschide-o din nou.',
      rate: 'Ai trimis mai multe cereri. Încearcă peste o oră sau scrie-ne pe WhatsApp.', fail: 'Cererea nu s-a putut trimite. Încearcă din nou sau scrie-ne pe WhatsApp.', net: 'Verifică internetul și încearcă din nou.', invalid: 'Verifică câmpurile marcate.',
      noTgTitle: 'Deschide în Telegram', noTgText: 'Această pagină funcționează doar în aplicația Telegram.', noTgBtn: 'Deschide în Telegram',
    },
    ru: {
      title: 'Отправить заявку', from: 'Отправляете как', service: 'Какая услуга вас интересует?', contactBtn: 'Отправить мой номер',
      phone: 'Телефон', phoneHint: 'Напишите номер здесь', message: 'Сообщение (необязательно)', consent: 'Я соглашаюсь с', policy: 'политикой конфиденциальности',
      send: 'Отправить', sending: 'Отправляем…', whatsapp: 'Написать в WhatsApp', close: 'Закрыть', doneTitle: 'Заявка отправлена',
      thanks: 'Спасибо, {name}! Мы получили заявку и скоро свяжемся с вами.',
      e_service: 'Выберите услугу.', e_phone: 'Укажите правильный номер телефона (не менее 6 цифр).', e_message: 'Сообщение слишком длинное (максимум 3000 символов).', e_consent: 'Отметьте согласие, чтобы отправить заявку.',
      off: 'Сейчас мы не можем принимать заявки здесь.', bad: 'Закройте приложение и откройте его снова.', expired: 'Сессия истекла. Закройте приложение и откройте его снова.',
      rate: 'Вы отправили несколько заявок. Попробуйте через час или напишите нам в WhatsApp.', fail: 'Не удалось отправить заявку. Попробуйте снова или напишите нам в WhatsApp.', net: 'Проверьте интернет и попробуйте снова.', invalid: 'Проверьте отмеченные поля.',
      noTgTitle: 'Откройте в Telegram', noTgText: 'Эта страница работает только в приложении Telegram.', noTgBtn: 'Открыть в Telegram',
    },
    en: {
      title: 'Send a request', from: 'Sending as', service: 'Which service are you interested in?', contactBtn: 'Send my number',
      phone: 'Phone', phoneHint: 'Type your number here', message: 'Message (optional)', consent: 'I agree to the', policy: 'privacy policy',
      send: 'Send', sending: 'Sending…', whatsapp: 'Message us on WhatsApp', close: 'Close', doneTitle: 'Request sent',
      thanks: 'Thank you, {name}! We received your request and will contact you soon.',
      e_service: 'Choose a service.', e_phone: 'Enter a valid phone number (at least 6 digits).', e_message: 'The message is too long (3000 characters at most).', e_consent: 'Tick the box to send your request.',
      off: 'We cannot receive requests here at the moment.', bad: 'Close the app and open it again.', expired: 'The session has expired. Close the app and open it again.',
      rate: 'You have sent several requests. Try again in an hour or message us on WhatsApp.', fail: 'The request could not be sent. Try again or message us on WhatsApp.', net: 'Check your connection and try again.', invalid: 'Check the highlighted fields.',
      noTgTitle: 'Open in Telegram', noTgText: 'This page only works in the Telegram app.', noTgBtn: 'Open in Telegram',
    },
  };
  const CODES = { tg_client_off: ['off', true], tg_bad: ['bad', false], tg_expired: ['expired', false], rate: ['rate', true], invalid: ['invalid', false] };

  // Ce e pe ecran se ține aici, ca schimbarea limbii să refacă textele fără să atingă câmpurile
  const state = { lang: 'en', errors: [], notice: null, sending: false, contactRaw: '', contactDigits: '' };
  const user = (inTg && TG.initDataUnsafe && TG.initDataUnsafe.user) || {};

  const pickLang = code => {
    const l = String(code || '').toLowerCase().split('-')[0];
    return T[l] ? l : 'en';
  };
  const digits = s => String(s || '').replace(/\D/g, '');
  // Aceeași regulă ca pe server (normPhone): fără 00, 373 și zerourile de la început
  const normPhone = s => {
    let d = digits(s).replace(/^00/, '');
    if (d.startsWith('373')) d = d.slice(3);
    return d.replace(/^0+/, '');
  };
  const serviceText = (lang, n) => (lang !== 'ro' && window.LX_I18N && window.LX_I18N[lang] && window.LX_I18N[lang][`f.s${n}`]) || RO_SERVICES[n];

  // Telegram mai vechi nu are toate metodele: ce lipsește se sare, aplicația merge mai departe
  const tgTry = fn => { try { fn(); } catch (e) { /* metodă lipsă */ } };

  // Linkurile se deschid în afara aplicației, ca formularul completat să nu se piardă
  function openOut(url) {
    if (inTg && TG.openLink) tgTry(() => TG.openLink(url));
    else window.open(url, '_blank', 'noopener');
  }

  /* ---------- Textele ---------- */
  function render() {
    const t = T[state.lang];
    document.documentElement.lang = state.lang;
    document.querySelectorAll('[data-t]').forEach(el => { el.textContent = t[el.dataset.t]; });
    document.querySelectorAll('#lang [data-lang]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.lang === state.lang)));
    SERVICES.forEach(([key, n]) => { $(`s-${key}`).textContent = serviceText(state.lang, n); });
    if (state.sending) $('send').textContent = t.sending;
    ['service', 'phone', 'message', 'consent'].forEach(f => {
      const bad = state.errors.includes(f);
      $(`f-${f}`).classList.toggle('bad', bad);
      $(`e-${f}`).hidden = !bad;
      $(`e-${f}`).textContent = bad ? t[`e_${f}`] : '';
    });
    $('notice').hidden = !state.notice;
    if (state.notice) {
      $('noticeText').textContent = t[state.notice.key];
      $('noticeWa').hidden = !state.notice.wa;
    }
    $('doneText').textContent = t.thanks.replace('{name}', () => user.first_name || '').replace(' ,', ',');
    $('policy').href = `/confidentialitate?lang=${state.lang}`;
  }

  function buildServices() {
    $('services').innerHTML = SERVICES.map(([key]) =>
      `<label class="service"><input type="radio" name="service" value="${key}"><span id="s-${key}"></span></label>`).join('');
  }

  /* ---------- Telefonul ---------- */
  // Omul a refuzat sau numărul n-a sosit în cele 3 secunde ale scriptului Telegram. Fereastra nu se mai deschide singură.
  function phoneByHand() {
    $('phoneHint').hidden = false;
    $('phone').focus();
  }

  function askContact() {
    try {
      TG.requestContact((sent, ev) => {
        const raw = sent && ev && typeof ev.response === 'string' ? ev.response : '';
        const contact = raw && ev.responseUnsafe && ev.responseUnsafe.contact;
        const number = digits(contact && contact.phone_number);
        if (!number) return phoneByHand();
        $('phone').value = `+${number}`;
        $('phoneHint').hidden = true;
        // Doar textul brut merge la server: el verifică semnătura; responseUnsafe nu dovedește nimic
        state.contactRaw = raw;
        state.contactDigits = number;
        clearError('phone');
      });
    } catch (e) {
      phoneByHand();
    }
  }

  /* ---------- Trimiterea ---------- */
  function clearError(f) {
    if (state.errors.includes(f)) {
      state.errors = state.errors.filter(x => x !== f);
      render();
    }
  }

  function setNotice(key, wa) {
    state.notice = key ? { key, wa: !!wa } : null;
    render();
    if (key) $('notice').scrollIntoView({ block: 'center' });
  }

  function values() {
    const checked = document.querySelector('input[name="service"]:checked');
    return {
      service: checked ? checked.value : '',
      phone: $('phone').value.trim(),
      message: $('message').value.trim(),
      consent: $('consent').checked,
    };
  }

  function localErrors(v) {
    const errors = [];
    if (!v.service) errors.push('service');
    if (v.phone.length > 30 || normPhone(v.phone).length < 6) errors.push('phone');
    if (v.message.length > 3000) errors.push('message');
    if (!v.consent) errors.push('consent');
    return errors;
  }

  function focusFirstError() {
    const first = ['service', 'phone', 'message', 'consent'].find(f => state.errors.includes(f));
    if (first) $(`f-${first}`).scrollIntoView({ block: 'center' });
  }

  async function submit(e) {
    e.preventDefault();
    if (state.sending) return;
    const v = values();
    state.errors = localErrors(v);
    state.notice = null;
    if (state.errors.length) {
      render();
      focusFirstError();
      return;
    }
    state.sending = true;
    $('send').disabled = true;
    render();
    let status = 0, data = {};
    try {
      const body = { ...v, lang: state.lang };
      // Numărul schimbat de mână nu mai are dovadă
      if (state.contactRaw && digits(v.phone) === state.contactDigits) body.contact_raw = state.contactRaw;
      const r = await fetch('/api/contact?action=tg-request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Telegram-Init-Data': TG.initData },
        body: JSON.stringify(body),
      });
      status = r.status;
      data = await r.json().catch(() => ({}));
    } catch (err) {
      status = 0;
    }
    state.sending = false;
    $('send').disabled = false;
    if (status === 200 && data.ok) return showDone();
    if (status === 400 && Array.isArray(data.fields)) state.errors = data.fields;
    render();
    if (status === 0) return setNotice('net');
    const [key, wa] = CODES[data.error] || ['fail', true];
    setNotice(key, wa);
  }

  function showDone() {
    tgTry(() => TG.HapticFeedback.notificationOccurred('success'));
    $('form').hidden = true;
    $('done').hidden = false;
    render();
    window.scrollTo(0, 0);
  }

  /* ---------- Pornirea ---------- */
  function startTelegram() {
    tgTry(() => TG.ready());
    tgTry(() => TG.expand());
    // Antetul și fundalul Telegramului iau culoarea paginii; derularea nu trebuie să închidă aplicația
    tgTry(() => TG.setHeaderColor('#0D0B09'));
    tgTry(() => TG.setBackgroundColor('#0D0B09'));
    tgTry(() => TG.setBottomBarColor('#0D0B09'));
    tgTry(() => { if (TG.disableVerticalSwipes) TG.disableVerticalSwipes(); });
  }

  function init() {
    document.querySelectorAll('#lang [data-lang]').forEach(b => b.addEventListener('click', () => {
      state.lang = b.dataset.lang;
      render();
    }));
    buildServices();

    if (!inTg) {
      state.lang = pickLang(navigator.language);
      $('noTg').hidden = false;
      $('openTg').href = `https://t.me/${CLIENT_BOT}`;
      render();
      return;
    }

    state.lang = pickLang(user.language_code);
    startTelegram();
    $('form').hidden = false;
    $('who').textContent = [user.first_name, user.last_name].filter(Boolean).join(' ');

    // Butonul apare doar dacă Telegramul îl suportă; câmpul scris de mână există mereu
    const canContact = typeof TG.requestContact === 'function' && TG.isVersionAtLeast && TG.isVersionAtLeast('6.9');
    $('contactBtn').hidden = !canContact;
    if (canContact) $('contactBtn').addEventListener('click', askContact);

    $('form').addEventListener('submit', submit);
    $('services').addEventListener('change', () => clearError('service'));
    $('phone').addEventListener('input', () => { $('phoneHint').hidden = true; clearError('phone'); });
    $('message').addEventListener('input', () => clearError('message'));
    $('consent').addEventListener('change', () => clearError('consent'));
    $('policy').addEventListener('click', e => {
      e.preventDefault();
      openOut(new URL($('policy').getAttribute('href'), location.href).href);
    });
    $('noticeWa').addEventListener('click', e => { e.preventDefault(); openOut(WHATSAPP); });
    $('close').addEventListener('click', () => TG.close());
    render();
  }

  init();
})();
