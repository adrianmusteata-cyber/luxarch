-- Agent vocal (ElevenLabs): sursă nouă „voce” pentru cererile lăsate prin convorbirea de pe site.
-- Rulat o singură dată în Supabase (SQL Editor) ÎNAINTE de a publica codul nou:
-- fără ea, cererea vocală nu se salvează (pleacă totuși pe Telegram, cu avertisment).
-- Se poate rula de mai multe ori fără efecte în plus. Toate sursele existente rămân.
alter table public.requests drop constraint if exists requests_source_check;
alter table public.requests add constraint requests_source_check
  check (source in ('site', 'manual', 'carte_vizita', 'chestionar', 'document', 'telegram', 'vizualizare', 'voce'));
