-- ==========================================================
-- LUXARCH (fost Atelier Temelia) — schema pentru cererile din formular.
-- Se rulează o singură dată în Supabase: SQL Editor → New query → Run.
-- Accesul se face doar de pe server (cheia service_role); RLS e activat
-- fără nicio politică, deci tabelele nu pot fi citite din browser.
-- ==========================================================

create table if not exists public.requests (
  id                uuid primary key default gen_random_uuid(),
  created_at        timestamptz not null default now(),
  name              text not null,
  phone             text not null,
  email             text not null,
  type              text not null,
  service           text not null,
  message           text not null default '',
  lang              text not null default 'ro' check (lang in ('ro', 'ru', 'en')),
  status            text not null default 'noua'
                    check (status in ('noua', 'contactata', 'in_lucru', 'procesat', 'avans', 'platit', 'incheiat', 'respins', 'inchisa')),
  status_comment    text not null default '',   -- motivul, obligatoriu la „respins”
  status_updated_at timestamptz not null default now(),
  source            text not null default 'site'
                    constraint requests_source_check check (source in ('site', 'manual', 'carte_vizita', 'chestionar', 'document', 'telegram', 'vizualizare', 'voce')),
  channel           text not null default '' check (channel in ('', 'apel', 'intalnire')),  -- doar la „manual”
  notes             text not null default '',   -- notele interne din CRM
  created_by        text not null default '',   -- cine l-a creat din Mini App Telegram („@username” sau numele); gol din browser
  status_actor      text not null default '',   -- cine a schimbat ultima dată etapa (copiat de trigger în status_history.actor)
  contract_value    numeric(12, 2) check (contract_value is null or contract_value >= 0),
  currency          text not null default 'MDL' check (currency in ('MDL', 'EUR')),
  -- Telefonul poate lipsi (carte de vizită doar cu email), dar nu ambele
  constraint requests_phone_or_email check (phone <> '' or email <> '')
);

create index if not exists requests_created_at_idx on public.requests (created_at desc);
create index if not exists requests_status_idx on public.requests (status, created_at desc);

-- Contor pentru limite (5 cereri/oră, 5 parole greșite/15 min). Nu păstrează IP-ul în clar.
create table if not exists public.rate_hits (
  id   bigint generated always as identity primary key,
  key  text not null,
  at   timestamptz not null default now()
);

create index if not exists rate_hits_key_at_idx on public.rate_hits (key, at desc);

-- Istoricul trecerilor între etape, scris de trigger la creare și la fiecare schimbare de etapă
create table if not exists public.status_history (
  id          bigint generated always as identity primary key,
  request_id  uuid not null references public.requests (id) on delete cascade,
  from_status text,                      -- null = clientul a fost creat direct în această etapă
  to_status   text not null,
  comment     text not null default '',
  actor       text not null default '',      -- „@username” din Telegram; gol = din browser
  at          timestamptz not null default now()
);

create index if not exists status_history_request_idx on public.status_history (request_id, at);

create or replace function public.log_status_change() returns trigger
language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    insert into public.status_history (request_id, from_status, to_status, comment, actor, at)
    values (new.id, null, new.status, new.status_comment, new.status_actor, new.created_at);
  elsif new.status is distinct from old.status then
    insert into public.status_history (request_id, from_status, to_status, comment, actor, at)
    values (new.id, old.status, new.status, new.status_comment, new.status_actor, new.status_updated_at);
  end if;
  return new;
end $$;

drop trigger if exists requests_status_log on public.requests;
create trigger requests_status_log
  after insert or update of status on public.requests
  for each row execute function public.log_status_change();

-- Plățile primite de la client, în moneda clientului
create table if not exists public.payments (
  id         bigint generated always as identity primary key,
  request_id uuid not null references public.requests (id) on delete cascade,
  paid_on    date not null,
  amount     numeric(12, 2) not null check (amount > 0),
  note       text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists payments_request_idx on public.payments (request_id, paid_on);

-- Originalele documentelor recunoscute de Claude (poze / PDF în Storage, bucketul privat „documente”)
create table if not exists public.documents (
  id         bigint generated always as identity primary key,
  doc_type   text not null check (doc_type in ('carte_vizita', 'chestionar', 'aviz', 'chitanta', 'de_platit', 'de_incasat', 'lista_preturi')),
  request_id uuid references public.requests (id) on delete cascade,
  expense_id bigint,               -- legătura cu o cheltuială (Etapa 2); cheia externă e adăugată după tabelul expenses
  page       smallint not null default 1,
  path       text not null,
  mime       text not null,
  size_bytes integer not null,
  created_at timestamptz not null default now(),
  constraint documents_one_owner check (num_nonnulls(request_id, expense_id) = 1)
);

create index if not exists documents_request_idx on public.documents (request_id);

insert into storage.buckets (id, name, public) values ('documente', 'documente', false)
on conflict (id) do nothing;

-- Cheltuielile (Etapa 2) și articolele lor
create table if not exists public.expenses (
  id            bigint generated always as identity primary key,
  source        text not null check (source in ('aviz', 'chitanta', 'manual', 'de_platit')),
  supplier      text not null,
  supplier_idno text not null default '',
  doc_number    text not null default '',
  doc_date      date not null,
  currency      text not null default 'MDL' check (currency in ('MDL', 'EUR')),
  amount_net    numeric(12, 2) check (amount_net is null or amount_net >= 0),
  vat           numeric(12, 2) not null default 0 check (vat >= 0),
  amount_total  numeric(12, 2) not null check (amount_total > 0),
  category      text not null check (category in ('materiale', 'echipamente', 'software', 'transport', 'chirie', 'subcontractori', 'birou', 'taxe', 'altele')),
  note          text not null default '',
  created_at    timestamptz not null default now()
);

create index if not exists expenses_date_idx on public.expenses (doc_date desc);
create index if not exists expenses_dup_idx on public.expenses (lower(supplier), doc_number, doc_date);

-- Rândurile cu articole ale unei cheltuieli
create table if not exists public.expense_items (
  id         bigint generated always as identity primary key,
  expense_id bigint not null references public.expenses (id) on delete cascade,
  pos        smallint not null,
  name       text not null,
  code       text not null default '',
  unit       text not null default '',
  qty        numeric(14, 3),
  unit_price numeric(12, 2),
  line_total numeric(12, 2)
);

create index if not exists expense_items_expense_idx on public.expense_items (expense_id, pos);

alter table public.documents drop constraint if exists documents_expense_id_fkey;
alter table public.documents add constraint documents_expense_id_fkey foreign key (expense_id) references public.expenses (id) on delete cascade;
create index if not exists documents_expense_idx on public.documents (expense_id);

alter table public.expenses       enable row level security;
alter table public.expense_items  enable row level security;
alter table public.documents      enable row level security;
alter table public.payments       enable row level security;
alter table public.requests       enable row level security;
alter table public.rate_hits      enable row level security;
alter table public.status_history enable row level security;

-- ==========================================================
-- Etapa 3: Scadențe (De plătit / De încasat). Identic cu migrations/2026-10-30-ocr-etapa3.sql
-- ==========================================================
-- Documentul de plătit (factură / contract primit)
create table if not exists public.payables (
  id            bigint generated always as identity primary key,
  supplier      text not null,
  supplier_idno text not null default '',
  doc_number    text not null default '',
  doc_date      date not null,
  currency      text not null default 'MDL' check (currency in ('MDL', 'EUR')),
  amount_net    numeric(12, 2) check (amount_net is null or amount_net >= 0),
  vat           numeric(12, 2) not null default 0 check (vat >= 0),
  amount_total  numeric(12, 2) not null check (amount_total > 0),
  category      text not null check (category in ('materiale', 'echipamente', 'software', 'transport', 'chirie', 'subcontractori', 'birou', 'taxe', 'altele')),
  note          text not null default '',
  created_at    timestamptz not null default now()
);

create table if not exists public.payable_items (
  id         bigint generated always as identity primary key,
  payable_id bigint not null references public.payables (id) on delete cascade,
  pos        smallint not null,
  name       text not null,
  code       text not null default '',
  unit       text not null default '',
  qty        numeric(14, 3),
  unit_price numeric(12, 2),
  line_total numeric(12, 2)
);
create index if not exists payable_items_payable_idx on public.payable_items (payable_id, pos);

-- Cheltuiala creată la plată păstrează legătura cu documentul de plătit
alter table public.expenses add column if not exists payable_id bigint references public.payables (id) on delete set null;

-- Ratele de plătit; o rată se plătește o singură dată
create table if not exists public.payable_installments (
  id          bigint generated always as identity primary key,
  payable_id  bigint not null references public.payables (id) on delete cascade,
  due_date    date not null,
  amount      numeric(12, 2) not null check (amount > 0),
  paid_on     date,
  paid_amount numeric(12, 2) check (paid_amount is null or paid_amount > 0),
  expense_id  bigint references public.expenses (id) on delete set null,
  check ((paid_on is null) = (paid_amount is null))
);
create index if not exists payable_installments_due_idx on public.payable_installments (due_date);
create index if not exists payable_installments_payable_idx on public.payable_installments (payable_id);

-- Ratele de încasat de la clienți (în moneda clientului); starea se calculează din plățile clientului
create table if not exists public.receivables (
  id         bigint generated always as identity primary key,
  request_id uuid not null references public.requests (id) on delete cascade,
  doc_number text not null default '',
  doc_date   date,
  due_date   date not null,
  amount     numeric(12, 2) not null check (amount > 0),
  note       text not null default '',
  group_id   uuid,
  created_at timestamptz not null default now()
);
create index if not exists receivables_request_idx on public.receivables (request_id, due_date);

-- Documentele originale se pot lega și de un document de plătit sau de un grup de rate de încasat
alter table public.documents add column if not exists payable_id bigint references public.payables (id) on delete cascade;
alter table public.documents add column if not exists receivable_group uuid;
alter table public.documents drop constraint if exists documents_one_owner;
alter table public.documents add constraint documents_one_owner
  check (num_nonnulls(request_id, expense_id, payable_id, receivable_group) = 1);
create index if not exists documents_payable_idx on public.documents (payable_id);
create index if not exists documents_receivable_idx on public.documents (receivable_group);

-- Plata unei rate: rata devine plătită și se creează cheltuiala, totul sau nimic
create or replace function public.pay_installment(p_id bigint, p_paid_on date, p_amount numeric)
returns bigint language plpgsql as $$
declare
  i public.payable_installments;
  p public.payables;
  n int;
  share numeric;
  exp_id bigint;
begin
  select * into i from public.payable_installments where id = p_id for update;
  if not found then raise exception 'notfound'; end if;
  if i.paid_on is not null then raise exception 'already_paid'; end if;
  select * into p from public.payables where id = i.payable_id;
  select count(*) into n from public.payable_installments where payable_id = p.id;
  share := p_amount / p.amount_total;
  insert into public.expenses (source, supplier, supplier_idno, doc_number, doc_date, currency, amount_net, vat, amount_total, category, note, payable_id)
  values ('de_platit', p.supplier, p.supplier_idno, p.doc_number, p_paid_on, p.currency,
          case when p.amount_net is null then null else round(p.amount_net * share, 2) end,
          round(p.vat * share, 2), p_amount, p.category, p.note, p.id)
  returning id into exp_id;
  -- Articolele se copiază doar când documentul are o singură rată
  if n = 1 then
    insert into public.expense_items (expense_id, pos, name, code, unit, qty, unit_price, line_total)
    select exp_id, pos, name, code, unit, qty, unit_price, line_total from public.payable_items where payable_id = p.id;
  end if;
  update public.payable_installments set paid_on = p_paid_on, paid_amount = p_amount, expense_id = exp_id where id = p_id;
  return exp_id;
end $$;

-- Anularea plății: rata redevine neplătită, cheltuiala creată automat se șterge
create or replace function public.unpay_installment(p_id bigint)
returns void language plpgsql as $$
declare
  i public.payable_installments;
begin
  select * into i from public.payable_installments where id = p_id for update;
  if not found then raise exception 'notfound'; end if;
  update public.payable_installments set paid_on = null, paid_amount = null, expense_id = null where id = p_id;
  if i.expense_id is not null then delete from public.expenses where id = i.expense_id; end if;
end $$;

-- Funcțiile se cheamă doar de pe server (cheia service_role)
revoke execute on function public.pay_installment(bigint, date, numeric) from public, anon, authenticated;
revoke execute on function public.unpay_installment(bigint) from public, anon, authenticated;
grant execute on function public.pay_installment(bigint, date, numeric), public.unpay_installment(bigint) to service_role;

alter table public.payables             enable row level security;
alter table public.payable_items        enable row level security;
alter table public.payable_installments enable row level security;
alter table public.receivables          enable row level security;

-- ==========================================================
-- Etapa 4: Catalog (liste de prețuri). Identic cu migrations/2026-10-30-ocr-etapa4.sql
-- ==========================================================
create table if not exists public.suppliers (
  id         bigint generated always as identity primary key,
  name       text not null,
  idno       text not null default '',
  created_at timestamptz not null default now()
);
create unique index if not exists suppliers_idno_key on public.suppliers (idno) where idno <> '';
create index if not exists suppliers_name_idx on public.suppliers (lower(name));

-- O listă de prețuri încărcată (documentul original e în documents.price_list_id)
create table if not exists public.price_lists (
  id          bigint generated always as identity primary key,
  supplier_id bigint not null references public.suppliers (id) on delete cascade,
  list_date   date not null,
  currency    text not null check (currency in ('MDL', 'EUR')),
  rows_count  integer not null,
  note        text not null default '',
  created_at  timestamptz not null default now()
);
create index if not exists price_lists_supplier_idx on public.price_lists (supplier_id, list_date desc);

-- Produsul cu prețul actual; last_list_id = ultima listă care i-a dat prețul actual
create table if not exists public.products (
  id           bigint generated always as identity primary key,
  supplier_id  bigint not null references public.suppliers (id) on delete cascade,
  code         text not null default '',
  name         text not null,
  unit         text not null default '',
  price        numeric(12, 2) not null check (price > 0),
  currency     text not null check (currency in ('MDL', 'EUR')),
  price_date   date not null,
  last_list_id bigint references public.price_lists (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create unique index if not exists products_code_key on public.products (supplier_id, lower(code)) where code <> '';
create unique index if not exists products_name_key on public.products (supplier_id, lower(name)) where code = '';
create index if not exists products_name_idx on public.products (lower(name));

-- Istoricul prețurilor: un rând la fiecare import și la fiecare preț schimbat manual
create table if not exists public.price_history (
  id            bigint generated always as identity primary key,
  product_id    bigint not null references public.products (id) on delete cascade,
  price         numeric(12, 2) not null,
  currency      text not null,
  price_date    date not null,
  price_list_id bigint references public.price_lists (id) on delete set null,
  created_at    timestamptz not null default now()
);
create index if not exists price_history_product_idx on public.price_history (product_id, price_date desc);

-- Documentele originale se pot lega și de o listă de prețuri
alter table public.documents add column if not exists price_list_id bigint references public.price_lists (id) on delete cascade;
alter table public.documents drop constraint if exists documents_one_owner;
alter table public.documents add constraint documents_one_owner
  check (num_nonnulls(request_id, expense_id, payable_id, receivable_group, price_list_id) = 1);
create index if not exists documents_price_list_idx on public.documents (price_list_id);

/* Importul unei liste de prețuri, totul sau nimic.
   p = { supplier_id | null, supplier_name, supplier_idno, list_date, currency, note,
         rows: [{ product_id | null, code, name, unit, price }] }
   Prețul actual se schimbă doar dacă lista e la fel de nouă sau mai nouă decât prețul actual;
   altfel prețul ajunge doar în istoric. Moneda nouă înlocuiește moneda produsului. */
create or replace function public.import_price_list(p jsonb)
returns jsonb language plpgsql as $$
declare
  sup_id  bigint := nullif(p->>'supplier_id', '')::bigint;
  d       date := (p->>'list_date')::date;
  cur     text := p->>'currency';
  list_id bigint;
  r       jsonb;
  prod    public.products;
  pid     bigint;
  v_price numeric;
  n_new int := 0; n_upd int := 0; n_same int := 0; n_old int := 0;
begin
  if sup_id is null then
    -- Furnizor nou; dacă IDNO-ul există deja, se folosește furnizorul acela
    if coalesce(p->>'supplier_idno', '') <> '' then
      select id into sup_id from public.suppliers where idno = p->>'supplier_idno';
    end if;
    if sup_id is null then
      insert into public.suppliers (name, idno) values (p->>'supplier_name', coalesce(p->>'supplier_idno', '')) returning id into sup_id;
    end if;
  elsif not exists (select 1 from public.suppliers where id = sup_id) then
    raise exception 'notfound';
  end if;

  insert into public.price_lists (supplier_id, list_date, currency, rows_count, note)
  values (sup_id, d, cur, jsonb_array_length(p->'rows'), coalesce(p->>'note', ''))
  returning id into list_id;

  for r in select value from jsonb_array_elements(p->'rows') loop
    v_price := (r->>'price')::numeric;
    if coalesce(r->>'product_id', '') = '' then
      insert into public.products (supplier_id, code, name, unit, price, currency, price_date, last_list_id)
      values (sup_id, coalesce(r->>'code', ''), r->>'name', coalesce(r->>'unit', ''), v_price, cur, d, list_id)
      returning id into pid;
      n_new := n_new + 1;
    else
      select * into prod from public.products where id = (r->>'product_id')::bigint and supplier_id = sup_id for update;
      if not found then raise exception 'product % notfound', r->>'product_id'; end if;
      pid := prod.id;
      if d >= prod.price_date then
        if prod.price = v_price and prod.currency = cur then n_same := n_same + 1; else n_upd := n_upd + 1; end if;
        update public.products
           set price = v_price, currency = cur, price_date = d, last_list_id = list_id, updated_at = now(),
               unit = case when prod.unit = '' then coalesce(r->>'unit', '') else prod.unit end
         where id = pid;
      else
        n_old := n_old + 1;
      end if;
    end if;
    insert into public.price_history (product_id, price, currency, price_date, price_list_id)
    values (pid, v_price, cur, d, list_id);
  end loop;

  return jsonb_build_object('supplier_id', sup_id, 'price_list_id', list_id,
    'created', n_new, 'updated', n_upd, 'unchanged', n_same, 'older', n_old);
end $$;

-- Funcția se cheamă doar de pe server (cheia service_role)
revoke execute on function public.import_price_list(jsonb) from public, anon, authenticated;
grant execute on function public.import_price_list(jsonb) to service_role;

alter table public.suppliers     enable row level security;
alter table public.price_lists   enable row level security;
alter table public.products      enable row level security;
alter table public.price_history enable row level security;

-- ==========================================================
-- Mini App Telegram: sursa „telegram” și autorul acțiunilor. Identic cu migrations/2026-10-30-telegram-autor.sql
-- (pentru o bază creată înainte; pe o bază nouă coloanele și regula există deja din create table de mai sus)
-- ==========================================================
alter table public.requests drop constraint if exists requests_source_check;
alter table public.requests add constraint requests_source_check
  check (source in ('site', 'manual', 'carte_vizita', 'chestionar', 'document', 'telegram'));
alter table public.requests add column if not exists created_by   text not null default '';
alter table public.requests add column if not exists status_actor text not null default '';
alter table public.status_history add column if not exists actor text not null default '';

-- ==========================================================
-- Vizualizare proiect (Gemini). Identic cu migrations/2026-10-30-vizualizare.sql
-- ==========================================================
-- Sursă nouă: cererea lăsată din formularul „Vedeți-vă viitoarea casă” (toate sursele existente rămân)
alter table public.requests drop constraint if exists requests_source_check;
alter table public.requests add constraint requests_source_check
  check (source in ('site', 'manual', 'carte_vizita', 'chestionar', 'document', 'telegram', 'vizualizare'));

-- O generare = o schiță. Rândul „pending” se creează înainte de apelul la Gemini (rezervarea),
-- ca două cereri simultane să nu treacă amândouă peste limită.
create table if not exists public.generations (
  id               uuid primary key default gen_random_uuid(),
  created_at       timestamptz not null default now(),
  request_id       uuid references public.requests (id) on delete cascade,  -- gol = lista generală a echipei
  origin           text not null check (origin in ('public', 'team')),
  kind             text not null check (kind in ('casa_noua', 'fatada', 'interior')),
  wishes           text not null default '' check (char_length(wishes) <= 1000),
  status           text not null default 'pending' check (status in ('pending', 'done', 'failed', 'rejected')),
  error            text not null default '',
  model            text not null default '',
  input_paths      text[] not null default '{}',
  output_path      text not null default '',
  actor            text not null default '',   -- „@username” din Mini App, „owner” din browser, gol pentru vizitator
  actor_key        text not null default '',   -- cheia limitei: tg:<id>, owner sau amprenta IP-ului
  phone_key        text not null default '',   -- telefonul normalizat, doar la public
  token            text unique,                -- dosarul tmp/<token>/ cu pozele încărcate; gol după curățenie
  token_expires_at timestamptz,
  started_at       timestamptz                 -- începutul apelului la Gemini (oprește dublul clic)
);

create index if not exists generations_origin_idx  on public.generations (origin, created_at);
create index if not exists generations_actor_idx   on public.generations (actor_key, created_at);
create index if not exists generations_phone_idx   on public.generations (phone_key);
create index if not exists generations_request_idx on public.generations (request_id);

-- Acces doar de pe server (cheia service_role), ca restul tabelelor
alter table public.generations enable row level security;

-- ==========================================================
-- Mini App-ul clienților. Identic cu migrations/2026-11-02-tg-clienti.sql
-- ==========================================================
-- Mini App-ul clienților: ID-ul Telegram al celui care a trimis cererea, ca o cerere repetată să se adauge la cea din „Nouă”.
alter table public.requests add column if not exists tg_user_id bigint;
create index if not exists requests_tg_user_idx on public.requests (tg_user_id) where tg_user_id is not null;

-- ==========================================================
-- Facturi PDF. Identic cu migrations/2026-11-10-facturi.sql
-- ==========================================================
-- Contorul numerelor, pe ani: LUX-AAAA-NNNN începe de la 0001 în fiecare an
create table if not exists public.invoice_counters (
  year integer primary key,
  last integer not null default 0
);

create table if not exists public.invoices (
  id         bigint generated always as identity primary key,
  request_id uuid not null references public.requests (id) on delete cascade,
  number     text not null unique,               -- LUX-2026-0001
  year       integer not null,
  seq        integer not null,
  issued_at  timestamptz not null default now(),
  due_date   date not null,
  currency   text not null check (currency in ('MDL', 'EUR')),
  items      jsonb not null,                     -- [{ name, qty, unit_price, line_total }]
  subtotal   numeric(12, 2) not null check (subtotal > 0),
  vat_rate   numeric(5, 2) not null default 20,
  vat        numeric(12, 2) not null,
  total      numeric(12, 2) not null,
  client     jsonb not null default '{}',        -- copia numelui, telefonului și emailului la emitere
  company    jsonb not null default '{}',        -- copia rechizitelor folosite
  is_test    boolean not null default false,     -- rechizite de test: PDF-ul poartă marcajul „fără valoare fiscală”
  auto       boolean not null default false,     -- emisă automat la trecerea în „Procesat”
  status     text not null default 'neachitata' check (status in ('neachitata', 'achitata')),
  paid_on    date,
  payment_id bigint references public.payments (id) on delete set null,
  pdf_path   text not null default '',           -- gol = PDF lipsă (se reface cu același număr)
  sent_via   text not null default '' check (sent_via in ('', 'telegram', 'email', 'proprietar')),
  sent_at    timestamptz,
  created_by text not null default '',
  created_at timestamptz not null default now(),
  unique (year, seq)
);

-- Cel mult o factură automată pe fișă: păzită de bază, nu doar de cod
create unique index if not exists invoices_auto_key on public.invoices (request_id) where auto;
create index if not exists invoices_request_idx on public.invoices (request_id, issued_at desc);

-- Emiterea: într-o singură operație mărește contorul anului și scrie factura.
-- p = { request_id, auto, due_days, currency, items, subtotal, vat_rate, vat, total, client, company, is_test, created_by }
-- Întoarce factura (jsonb) sau null dacă fișa are deja o factură automată (fără să consume vreun număr).
create or replace function public.issue_invoice(p jsonb)
returns jsonb language plpgsql as $$
declare
  is_auto boolean := coalesce((p->>'auto')::boolean, false);
  rid uuid := (p->>'request_id')::uuid;
  local_day date := (now() at time zone 'Europe/Chisinau')::date;
  y integer := extract(year from local_day)::integer;
  n integer;
  inv public.invoices;
begin
  if is_auto and exists (select 1 from public.invoices where request_id = rid and auto) then
    return null;
  end if;
  begin
    insert into public.invoice_counters (year, last) values (y, 1)
    on conflict (year) do update set last = public.invoice_counters.last + 1
    returning last into n;
    insert into public.invoices (request_id, number, year, seq, due_date, currency, items, subtotal, vat_rate, vat, total,
                                 client, company, is_test, auto, created_by)
    values (rid, 'LUX-' || y || '-' || lpad(n::text, 4, '0'), y, n,
            local_day + (p->>'due_days')::integer, p->>'currency', p->'items',
            (p->>'subtotal')::numeric, (p->>'vat_rate')::numeric, (p->>'vat')::numeric, (p->>'total')::numeric,
            coalesce(p->'client', '{}'), coalesce(p->'company', '{}'), coalesce((p->>'is_test')::boolean, false),
            is_auto, coalesce(p->>'created_by', ''))
    returning * into inv;
  exception when unique_violation then
    -- Două treceri simultane în „Procesat”: a doua e ignorată, iar numărul ei se anulează odată cu ea
    if is_auto then return null; end if;
    raise;
  end;
  return to_jsonb(inv);
end $$;

-- Marcarea ca achitată: statusul și plata (suma facturii, data dată) se fac împreună sau deloc.
-- A doua marcare → excepția already_paid. Mutarea fișei în „Plătit” o face serverul, după.
create or replace function public.pay_invoice(p_id bigint, p_paid_on date)
returns jsonb language plpgsql as $$
declare
  inv public.invoices;
  pay_id bigint;
begin
  select * into inv from public.invoices where id = p_id for update;
  if not found then raise exception 'notfound'; end if;
  if inv.status = 'achitata' then raise exception 'already_paid'; end if;
  insert into public.payments (request_id, paid_on, amount, note)
  values (inv.request_id, p_paid_on, inv.total, 'Factura ' || inv.number)
  returning id into pay_id;
  update public.invoices set status = 'achitata', paid_on = p_paid_on, payment_id = pay_id where id = p_id;
  return jsonb_build_object('request_id', inv.request_id, 'number', inv.number, 'total', inv.total, 'payment_id', pay_id);
end $$;

-- Funcțiile se cheamă doar de pe server (cheia service_role)
revoke execute on function public.issue_invoice(jsonb) from public, anon, authenticated;
revoke execute on function public.pay_invoice(bigint, date) from public, anon, authenticated;
grant execute on function public.issue_invoice(jsonb), public.pay_invoice(bigint, date) to service_role;

-- Acces doar de pe server, ca restul tabelelor
alter table public.invoice_counters enable row level security;
alter table public.invoices         enable row level security;

-- ==========================================================
-- Agent vocal (ElevenLabs): sursa „voce”. Identic cu migrations/2026-11-10-sursa-voce.sql
-- ==========================================================
alter table public.requests drop constraint if exists requests_source_check;
alter table public.requests add constraint requests_source_check
  check (source in ('site', 'manual', 'carte_vizita', 'chestionar', 'document', 'telegram', 'vizualizare', 'voce'));
