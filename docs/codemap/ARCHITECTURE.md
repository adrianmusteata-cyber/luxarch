# Architecture — LUXARCH

Static site + Vercel serverless functions (CommonJS, no framework, no build) + Supabase (Postgres via PostgREST, Storage).
Comments and UI strings in code are Romanian. Detailed feature specs: `docs/specs/*.md`.

## Modules
| Area | Files | Role |
|---|---|---|
| Public site | `index.html`, `styles.css`, `script.js`, `i18n.js` | One-page site, GSAP animations (CDN), contact form, project visualization form, ElevenLabs widget |
| Client Mini App | `tg-client.html`, `tg-client.js` | Telegram Mini App for clients (separate bot) → leaves a request |
| Admin | `admin.html`, `admin.js` (+ `admin-fin.js`, `admin-dues.js`, `admin-cat.js`, `admin-viz.js`), `admin.css` | CRM funnel, payments, invoices, expenses, dues, catalog, OCR scanner, visualizations; works in browser (password) and as team Telegram Mini App |
| Public API | `api/contact.js` | Contact form + `?action=` sub-routes: `viz-status/start/generate`, `tg-request`, `voice-lead` |
| Admin API | `api/admin/**` | `session` (login/logout via rewrites), `requests/index` + `requests/[id]`, `payments`, `expenses`, `dues`, `catalog`, `report`, `docs/[action]` (OCR + viz), `telegram-chats` |
| MCP server | `api/mcp.js` | Stateless Streamable HTTP MCP for the CRM (`lista_cereri`, `cauta_client`, `schimba_etapa`, `cereri_blocate`), Bearer `MCP_TOKEN` |
| Shared lib | `api/_lib/` | `db` (PostgREST `rest()`), `auth` (cookie + Telegram initData, roles), `http` (body, IP, `allow`), `rate` (rate_hits), `labels` (statuses/sources/types — single source of enum labels), `notify` (Telegram + Resend email texts), `invoices` + `invoice-pdf` (pdf-lib, fonts in `_lib/fonts`), `claude` (Anthropic OCR), `imagegen` (Cloudflare Workers AI / Gemini), `storage` (signed URLs, bucket `documente`), `turnstile`, `catalog`, `dues`, `expenses`, `money`, `staff` (money-field stripping) |
| DB | `supabase/schema.sql`, `supabase/migrations/*.sql` | Tables: requests, status_history (trigger-written), payments, documents, expenses(+items), payables(+items, installments), receivables, suppliers, price_lists, products, price_history, generations, invoices, invoice_counters, rate_hits |
| Tooling | `scripts/elevenlabs-agent.js` | Idempotent setup of the ElevenLabs agent/tools (run locally with node) |

## Data flows
1. **Site form:** `script.js` → `POST /api/contact` → validate + honeypot/min-fill-time + rate limit (`rate_hits`) → insert `requests` (status `noua`, source `site`) → Telegram (`TELEGRAM_BOT_TOKEN`/`TELEGRAM_CHAT_ID`) and optional email (Resend). Without Supabase env it still sends Telegram only.
2. **Voice agent:** ElevenLabs widget in `index.html` (`agent-id` is public) → ElevenLabs server tool `save_lead` → `POST /api/contact?action=voice-lead` with header `X-Webhook-Secret` = `ELEVENLABS_WEBHOOK_SECRET` → request with source `voce`, `created_by = 'Agent vocal'` → Telegram “🎙 Voce”. Limits: 5/h per phone, 30/day, duplicate within 10 min ignored. Agent prompt/tools live in `scripts/elevenlabs-agent.js`, not in the request path.
3. **Client Mini App:** `tg-client.js` → `POST /api/contact?action=tg-request` with `X-Telegram-Init-Data` (verified HMAC) → new request or append to existing “Nouă” one → Telegram + email.
4. **Project visualization:** `viz-start` (Turnstile, saves lead first, signed upload URLs) → browser PUTs photos to Storage → `viz-generate` → `imagegen` → output in Storage, read URL valid 1h.
5. **Admin:** `admin.js` `fetch` → `/api/admin/*` → `requireAdmin()` → `rest()` to Supabase. Status changes are logged by DB trigger into `status_history`; moving to Avans/Plătit sends Telegram payment notice; reaching “Procesat” auto-issues an invoice (`_lib/invoices.afterStatusChange`) — same path from admin and MCP.
6. **OCR:** `docs/upload` (signed URLs to `tmp/<token>/`) → `docs/read` (Claude chooses doc type + extracts fields) → `docs/save` (CRM client / expense / payable / price list).

## Entry points
- Pages: `/` (index), `/admin`, `/tg-client`, `/confidentialitate` (cleanUrls).
- Functions: every file under `api/` except `api/_lib/` is a route; `[id]`/`[action]` are dynamic segments.
- Config: `vercel.json` (rewrites, `maxDuration` 60 s for `contact` and `docs/[action]`, `includeFiles` fonts for invoice routes).

## Where to add things
- New public text: RO in `index.html` with `data-i18n="key"`, RU+EN for the same key in `i18n.js`.
- New public endpoint: prefer a new `?action=` in `api/contact.js` or a new file in `api/`; reuse `_lib/http`, `_lib/rate`, `_lib/notify`.
- New admin endpoint: file under `api/admin/`, start with `requireAdmin(req, res)` (owner only) or `{ staff: true }` + `stripMoney` for staff.
- New status/source/type: `api/_lib/labels.js` + a migration (check constraint) + admin UI.
- Schema change: new `supabase/migrations/YYYY-MM-DD-name.sql` and mirror it in `schema.sql`; the user runs SQL manually in Supabase before deploying code.
- New spec: `docs/specs/YYYY-MM-DD-name.md`.

## Pitfalls
- No tests, no type checking, no build — verify manually (`vercel dev`, phone width 375px, no horizontal scroll).
- Secrets only in Vercel env (`.env*` git-ignored); never expose the Supabase service-role key to the browser — browser gets only signed URLs.
- RLS is on with no policies: any client-side Supabase access would fail by design; all DB access goes through `api/`.
- `created_by`/actor come only from verified Telegram initData; never trust them from the request body.
- `X-View-As: staff` may only lower privileges; keep staff responses free of money fields.
- Function time limit: Claude OCR and image generation are bounded by 60 s (`TIMEOUT` 55 s in `_lib/claude.js`).
- Invoice routes need `includeFiles: api/_lib/fonts/**` in `vercel.json`, or PDF rendering breaks in production.
- Migrations must run before the code that depends on them is pushed (auto-deploy on every push to `main`).
- Three Telegram bot tokens: notifications (`TELEGRAM_BOT_TOKEN` → `TELEGRAM_CHAT_ID`, payments → `TELEGRAM_PAYMENTS_CHAT_ID`), team admin Mini App (`TELEGRAM_APP_BOT_TOKEN`, initData verification) and client Mini App (`TELEGRAM_CLIENT_BOT_TOKEN`). Don't mix them up when verifying initData.
