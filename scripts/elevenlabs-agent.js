/* ==========================================================
   Agentul vocal LUXARCH în ElevenLabs (vezi docs/specs/2026-11-10-agent-vocal.md).
   Rulare locală: node scripts/elevenlabs-agent.js
   Citește ELEVENLABS_API_KEY, ELEVENLABS_WEBHOOK_SECRET și SITE_URL (implicit https://luxarch.vercel.app)
   din mediu sau din .env.local. Idempotent: secretul, uneltele și agentul se caută după nume
   și se actualizează; se creează doar dacă lipsesc. La final afișează agent_id (public, merge în index.html).
   Cheile nu se afișează niciodată.
   ========================================================== */
const fs = require('fs');
const path = require('path');

// Vocea: Sarah (premade, feminină, calmă și liniștitoare), cu modelul multilingv Flash v2.5 (RO, RU, EN)
const VOICE_ID = 'EXAVITQu4vr4xnSDxMaL';
const TTS_MODEL = 'eleven_flash_v2_5';
// Modelul de limbaj: rapid și bun în RO/RU/EN
const LLM = 'gemini-3.5-flash';

const AGENT_NAME = 'LUXARCH — agent vocal';
const SECRET_NAME = 'luxarch_voice_webhook_secret';
const NAVIGATE = 'navigate';
const SAVE_LEAD = 'save_lead';
const SECTIONS = ['top', 'manifest', 'servicii', 'proiecte', 'proces', 'vizualizare', 'intrebari', 'contact'];
const API = 'https://api.elevenlabs.io';

// .env.local: doar completează ce lipsește din mediu
function loadEnvLocal() {
  const file = path.join(__dirname, '..', '.env.local');
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').replace(/^﻿/, '').split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!m || process.env[m[1]]) continue;
    let v = m[2].trim();
    if (/^".*"$/.test(v) || /^'.*'$/.test(v)) v = v.slice(1, -1);
    process.env[m[1]] = v;
  }
}
loadEnvLocal();

const KEY = process.env.ELEVENLABS_API_KEY;
const SECRET = process.env.ELEVENLABS_WEBHOOK_SECRET;
const SITE = (process.env.SITE_URL || 'https://luxarch.vercel.app').replace(/\/$/, '');
if (!KEY || !SECRET) {
  console.error('Lipsesc ELEVENLABS_API_KEY / ELEVENLABS_WEBHOOK_SECRET (în mediu sau în .env.local).');
  process.exit(1);
}

// Erorile pot cita corpul cererii: secretul se ascunde
const hide = s => String(s).split(SECRET).join('***').split(KEY).join('***');

async function api(method, p, body) {
  const r = await fetch(API + p, {
    method,
    headers: { 'xi-api-key': KEY, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30000),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`${method} ${p} → ${r.status}: ${hide(text).slice(0, 1500)}`);
  return text ? JSON.parse(text) : null;
}

/* ---------- Promptul de sistem, cu baza de cunoștințe din site ---------- */
const PROMPT = `You are the voice assistant of LUXARCH, an architecture and structural engineering studio in Chișinău (Moldova) that also works in Romania. You speak with visitors of the website ${SITE}.

# Language
- Always answer in the language the visitor speaks: Romanian, Russian or English. If the visitor switches language, switch too (use the language_detection tool).
- Keep answers short and natural for speech: 1–3 sentences, no lists read aloud, no markdown, no emojis.
- Never mix languages inside an answer. Every word, including numbers, must be in the current conversation language.
- Never write numbers as digits: always spell them out as words in the current language, otherwise the voice reads them in English. Phone numbers are spelled digit by digit, in groups of two or three separated by commas. Examples for the office phone +373 68 133 945:
  - Romanian: "plus trei șapte trei, șase opt, unu trei trei, nouă patru cinci"
  - Russian: "плюс три семь три, шесть восемь, один три три, девять четыре пять"
  - English: "plus three seven three, six eight, one three three, nine four five"

# Strict rules
- Answer ONLY from the knowledge base below. Never invent facts, prices, deadlines, office hours, names or projects. If you don't know, say so and offer to leave a request (save_lead) or to call the office at +373 68 133 945.
- Prices: never give any figure or range, not even an estimate. Explain that the price depends on the surface, complexity and the phases needed, that LUXARCH sends a clear offer broken down by stages within 48 hours after a first discussion, then offer to take a request.
- Office hours: never state hours. Say only: "we answer the same working day".
- Off-topic questions (anything not about LUXARCH, architecture, structure, interiors or the visitor's project): politely decline in one sentence and bring the conversation back to the visitor's project.
- The conversation is limited to 5 minutes, so if the visitor wants an offer, collect the details early.

# Showing parts of the page (tool "navigate")
- When the visitor asks to see something, call navigate with one of: top, manifest, servicii, proiecte, proces, vizualizare, intrebari, contact. Then describe briefly what is now on screen and continue the conversation.
- Synonyms: "works", "portfolio", "projects", "lucrări", "portofoliu", "работы", "портфолио" = proiecte; "prices", "cost", "prețuri", "цены" = intrebari (the FAQ "How much does a project cost?") or contact when they want an offer; "contacts", "address", "phone", "contacte", "adresă", "контакты", "адрес" = contact; "how do you work", "process", "steps", "cum lucrați", "как вы работаете" = proces; "services", "servicii", "услуги" = servicii; "about you", "philosophy", "manifest" = manifest; "questions", "FAQ", "întrebări", "вопросы" = intrebari; "visualisation", "see my future house", "vizualizare", "визуализация" = vizualizare; "beginning", "home", "start" = top.
- If the tool returns "not_found", say that the site has no such section and suggest the closest one.

# Leaving a request (tool "save_lead")
1. Ask for the visitor's name. Ask what the project is about (type of building, service) if not already clear.
2. Ask for the phone number and invite the visitor to say it slowly, digit by digit. Expected formats: Moldova 0 followed by 8 digits (for example 0 6x xxx xxx) or +373 followed by 8 digits; Romania 07xx xxx xxx or +40 followed by 9 digits. If you heard fewer digits than that or you are unsure, do not guess: say which part you got and ask only for the missing or unclear part.
3. Repeat the whole number back spelled out in words, in groups (see the Language rules), and ask "Is that correct?". If the visitor corrects it, repeat the corrected number again until they confirm.
4. Ask explicitly for consent: that LUXARCH may use their name, phone and the summary of this conversation only to answer their request (the voice conversation is processed by ElevenLabs).
5. ONLY after an explicit "yes", call save_lead with: name, phone (digits only, with + and country code if given), a short summary of the project in Romanian (what they want, location if mentioned, surface if mentioned, wishes), lang (the language the conversation is in now: ro, ru or en), service and type if they are clear, consent = true.
6. If the visitor refuses consent, do NOT call save_lead; give them the office phone +373 68 133 945 (also WhatsApp).
7. Tool results: ok true → confirm: "We will contact you within 48 hours at most", ask if there is anything else, then end the call politely with end_call when the visitor has nothing more. error "invalid" with fields ["phone"] → ask them to repeat the phone number; other fields → ask again for that detail. error "rate" → say there have been too many requests and ask them to call the office at +373 68 133 945. error "save" or any other failure → apologise and give the phone +373 68 133 945 and WhatsApp on the same number.
- Never call save_lead twice for the same visitor.

# Knowledge base (from the website)
## About
- LUXARCH: architecture & structural engineering, Chișinău. Designs houses, residential complexes, hotels and commercial buildings.
- The architect and the structural engineer work in the same team: one single contact person, from the first sketch to the final acceptance (recepție).
- Works in Moldova and Romania; has signing rights in Romania (OAR).
- Offer within 48 hours at most. The first discussion is free. We answer the same working day.
- Manifesto: a beautiful building starts with a correct calculation; the architect and the structural engineer draw at the same table from day one, so light, form and strength grow together, without surprises on site.

## The 4 services
1. Architectural design: spaces adapted to the plot, budget and way of living or working. Feasibility studies and concept; permit documentation for Moldova and Romania; execution project (PTh) and details; 3D exterior visualisations; technical assistance on site.
2. Structural design: safe, efficient, economical structures that resist over time and earthquakes. Reinforced concrete, steel and timber structures; seismic calculation according to Moldovan and Romanian norms; technical expertise of existing buildings; consolidation, rehabilitation and adding floors; optimisation of construction costs.
3. Interior design: warm, functional interiors designed together with the architecture. Concept and layout plan; photorealistic 3D visualisations; selection of materials, finishes and lighting; custom furniture and execution details; supervision of implementation.
4. Project management: coordinating the project for the client (deadlines, budget, teams), one contact person from idea to acceptance. Planning stages, budget and deadlines; coordinating specialists (installations, networks, landscaping); obtaining approvals and the building permit; selecting contractors and analysing offers; following the works on site until acceptance.

## The process in 5 steps
1. Initial discussion: the client tells what they want; LUXARCH analyses the plot, documents and budget — free of charge.
2. Concept: sketches, volumes and first visualisations, checked structurally from day one.
3. Permit: documentation and guidance through approvals up to the building permit. Moldova: urban planning certificate (certificat de urbanism) and documentation for the building permit. Romania: CU (certificat de urbanism), DTAC, AC (building permit).
4. Execution project: complete plans, architecture and structure perfectly correlated. Moldova: execution project. Romania: PTh + execution details.
5. On site: technical assistance and checks at the determining phases, until acceptance.

## Selected projects (10)
1. Waterside villa with atrium — private house, 2025, under construction.
2. House built around a living tree — private house, 2025, under construction.
3. Underground hotel on a slope — tourist complex, 2025, under construction.
4. Residential complex with panoramic glazing — residential complex, 2025, under construction.
5. Contemporary stone house — private house, 2024, in progress (design).
6. Hotel complex on the bank of the Dniester (Nistru) — hotel, 2025, under construction.
7. Residential complex of six buildings with green loggias — residential complex, 2025, under construction.
8. Solar-powered sports complex — sports complex, 2025, completed.
9. Data centre with aluminium façade — industrial building, 2025, under construction.
10. Brick winery with panoramic windows — winery, 2022, completed.
The projects section can be filtered: All, Houses, Residential, Tourism, Commercial.

## Project visualisation (section "vizualizare")
On the site the visitor can upload 1–3 photos (plot, façade or room), write their wishes and get an indicative sketch in about 30 seconds (new house on the plot, façade/exterior renovation, interior). It is an automatically generated sketch, not a project.

## FAQ
- How much does a project cost? It depends on the surface, complexity and phases needed. After a first discussion LUXARCH sends a clear offer, broken down by stages, with no hidden costs.
- How long until I get the building permit? The permit documentation is prepared after the client approves the concept; the exact term is set in the offer, depending on the project. The duration of approvals and the permit then depends on the city hall, both in Moldova and in Romania.
- Why is it better to have architecture and structure done by the same team? Because the structure is designed together with the space: you avoid redesigns, delays and costs that appear when two separate designers don't coordinate.
- Do you do only the structural project if I already have an architect? Yes. LUXARCH often works with other architects and offices, doing the structural project and technical expertise for them.
- Do you work outside Chișinău? Yes. In all of Moldova and in Romania, where LUXARCH has signing rights (OAR). Site visits are scheduled together with the client.

## Contacts
- Phone and WhatsApp: +373 68 133 945.
- Telegram: @luxarch_client_bot.
- Email: adrian.musteata@lh47arch.com.
- Office: Str. Eugen Doga 2, Chișinău.
- The website also has a contact form; offer within 48 hours.

## Values for save_lead
- service: arh_rez (architecture + structure), arh (architecture only), rez (structure only), design (interior design), management (project management), nu_stiu (not sure yet).
- type: casa (single-family house), ansamblu (residential complex), birouri (office / commercial building), hala (hall / industrial), expertiza (expertise / consolidation), altceva (something else).`;

const FIRST = {
  ro: 'Salut! Cu ce vă pot ajuta?',
  ru: 'Здравствуйте! Чем могу помочь?',
  en: 'Hello! How can I help you?',
};
// Numerele scrise în cuvinte: cifrele le-ar citi vocea în engleză
const END_MSG = {
  ro: 'Timpul convorbirii s-a încheiat. Ne puteți suna la plus trei șapte trei, șase opt, unu trei trei, nouă patru cinci. Mulțumim!',
  ru: 'Время разговора закончилось. Позвоните нам: плюс три семь три, шесть восемь, один три три, девять четыре пять. Спасибо!',
  en: 'Our time is up. You can call us at plus three seven three, six eight, one three three, nine four five. Thank you!',
};

/* ---------- Uneltele ---------- */
const navigateTool = {
  type: 'client',
  name: NAVIGATE,
  description: 'Scrolls the website page to a section so the visitor can see it. Use it whenever the visitor asks to see or open a part of the site. Returns "ok: <section>" or "not_found".',
  expects_response: true,
  response_timeout_secs: 5,
  parameters: {
    type: 'object',
    required: ['section'],
    properties: {
      section: {
        type: 'string',
        enum: SECTIONS,
        description: 'Section anchor: top (beginning), manifest (philosophy), servicii (services), proiecte (projects/portfolio), proces (5-step process), vizualizare (sketch from photos), intrebari (FAQ, prices question), contact (contacts and offer form).',
      },
    },
  },
};

const str = description => ({ type: 'string', description });
const saveLeadTool = secretId => ({
  type: 'webhook',
  name: SAVE_LEAD,
  description: 'Saves the visitor\'s request for an offer in the LUXARCH CRM and notifies the team. Call it only once, only after the visitor confirmed the phone number and gave explicit consent.',
  response_timeout_secs: 20,
  api_schema: {
    url: `${SITE}/api/contact?action=voice-lead`,
    method: 'POST',
    content_type: 'application/json',
    request_headers: { 'X-Webhook-Secret': { secret_id: secretId } },
    request_body_schema: {
      type: 'object',
      description: 'The visitor\'s request.',
      required: ['name', 'phone', 'summary', 'lang', 'consent'],
      properties: {
        name: str('Visitor\'s name, as they said it (max 100 characters).'),
        phone: str('Visitor\'s phone number, confirmed by the visitor, with country code if given (max 30 characters).'),
        summary: str('Short summary of the visitor\'s project and wishes, written in Romanian (max 1000 characters).'),
        lang: { type: 'string', enum: ['ro', 'ru', 'en'], description: 'Language the conversation is in at the end.' },
        service: { type: 'string', enum: ['arh_rez', 'arh', 'rez', 'design', 'management', 'nu_stiu'], description: 'Requested service; nu_stiu if not clear.' },
        type: { type: 'string', enum: ['casa', 'ansamblu', 'birouri', 'hala', 'expertiza', 'altceva'], description: 'Type of project; altceva if not clear.' },
        consent: { type: 'boolean', description: 'true only if the visitor explicitly agreed that LUXARCH may use their data to answer the request.' },
      },
    },
  },
});

/* ---------- Căutare după nume, apoi actualizare sau creare ---------- */
async function ensureSecret() {
  const { secrets = [] } = await api('GET', `/v1/convai/secrets?search=${encodeURIComponent(SECRET_NAME)}`);
  const found = secrets.find(s => s.name === SECRET_NAME);
  if (found) {
    await api('PATCH', `/v1/convai/secrets/${found.secret_id}`, { type: 'update', name: SECRET_NAME, value: SECRET });
    console.log('Secret actualizat:', SECRET_NAME);
    return found.secret_id;
  }
  const r = await api('POST', '/v1/convai/secrets', { type: 'new', name: SECRET_NAME, value: SECRET });
  console.log('Secret creat:', SECRET_NAME);
  return r.secret_id;
}

async function ensureTool(config) {
  const { tools = [] } = await api('GET', `/v1/convai/tools?search=${encodeURIComponent(config.name)}&page_size=100`);
  const found = tools.find(t => t.tool_config && t.tool_config.name === config.name && t.tool_config.type === config.type);
  if (found) {
    await api('PATCH', `/v1/convai/tools/${found.id}`, { tool_config: config });
    console.log(`Unealtă actualizată: ${config.name} (${found.id})`);
    return found.id;
  }
  const r = await api('POST', '/v1/convai/tools', { tool_config: config });
  console.log(`Unealtă creată: ${config.name} (${r.id})`);
  return r.id;
}

const systemTool = name => ({ type: 'system', name, description: '', params: { system_tool_type: name } });

function agentBody(toolIds) {
  const preset = l => ({ overrides: { agent: { language: l, first_message: FIRST[l], max_conversation_duration_message: END_MSG[l] } } });
  return {
    name: AGENT_NAME,
    tags: ['luxarch', 'site'],
    conversation_config: {
      agent: {
        language: 'ro',
        first_message: FIRST.ro,
        max_conversation_duration_message: END_MSG.ro,
        prompt: {
          prompt: PROMPT,
          llm: LLM,
          timezone: 'Europe/Chisinau',
          tool_ids: toolIds,
          built_in_tools: { language_detection: systemTool('language_detection'), end_call: systemTool('end_call') },
        },
      },
      tts: { model_id: TTS_MODEL, voice_id: VOICE_ID, stability: 0.6, speed: 1 },
      // Recunoașterea vorbirii la calitate înaltă; răbdare la pauze, ca numărul dictat să nu fie tăiat
      asr: { quality: 'high' },
      turn: { turn_timeout: 10, turn_eagerness: 'patient' },
      // client_tool_call: fără el, widgetul nu primește apelul uneltei navigate
      conversation: {
        max_duration_seconds: 300,
        client_events: ['conversation_initiation_metadata', 'audio', 'interruption', 'user_transcript', 'agent_response', 'agent_response_correction', 'client_tool_call', 'agent_tool_response'],
      },
      language_presets: { ru: preset('ru'), en: preset('en') },
    },
    platform_settings: {
      auth: { enable_auth: false, allowlist: [{ hostname: 'luxarch.vercel.app' }, { hostname: 'localhost:3000' }] },
      overrides: { conversation_config_override: { agent: { language: true, first_message: true } } },
      widget: {
        variant: 'compact',
        placement: 'bottom-right',
        bg_color: '#15120F', text_color: '#EFE8DC', btn_color: '#E9B872', btn_text_color: '#0D0B09',
        border_color: '#3a332b', focus_color: '#E9B872',
        avatar: { type: 'orb', color_1: '#E9B872', color_2: '#F4D7A8' },
        language_selector: false,
        text_input_enabled: false,
      },
    },
  };
}

async function ensureAgent(body) {
  const { agents = [] } = await api('GET', `/v1/convai/agents?search=${encodeURIComponent(AGENT_NAME)}&page_size=100`);
  const found = agents.find(a => a.name === AGENT_NAME);
  if (found) {
    await api('PATCH', `/v1/convai/agents/${found.agent_id}`, body);
    console.log('Agent actualizat.');
    return found.agent_id;
  }
  const r = await api('POST', '/v1/convai/agents/create', body);
  console.log('Agent creat.');
  return r.agent_id;
}

(async () => {
  const secretId = await ensureSecret();
  const toolIds = [await ensureTool(navigateTool), await ensureTool(saveLeadTool(secretId))];
  const agentId = await ensureAgent(agentBody(toolIds));
  console.log(`\nagent_id: ${agentId}\nPune-l în index.html: <elevenlabs-convai agent-id="${agentId}">`);
})().catch(e => { console.error(hide(e.message)); process.exit(1); });
