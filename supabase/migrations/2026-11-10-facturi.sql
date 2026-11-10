-- Facturi PDF din fișa clientului (docs/specs/2026-11-10-facturi-pdf.md).
-- Rulat o singură dată în Supabase (SQL Editor) ÎNAINTE de a publica codul nou.
-- Se poate rula de mai multe ori fără efecte în plus. Fără migrare, fișa merge ca până acum, fără facturi.

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
