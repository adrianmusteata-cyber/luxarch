-- Rulat o singură dată în Supabase (SQL Editor) ÎNAINTE de a publica codul nou.
-- Fără coloană, cererile din Telegram nu se salvează în CRM: pleacă doar pe Telegram, cu avertismentul „NU a fost salvată în panou”.
-- Se poate rula de mai multe ori fără efecte în plus. Regula requests_phone_or_email și lista de surse nu se schimbă.

-- Mini App-ul clienților: ID-ul Telegram al celui care a trimis cererea, ca o cerere repetată să se adauge la cea din „Nouă”.
alter table public.requests add column if not exists tg_user_id bigint;
create index if not exists requests_tg_user_idx on public.requests (tg_user_id) where tg_user_id is not null;
