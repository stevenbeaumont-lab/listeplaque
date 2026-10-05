-- ParcLive · Historique des versions (restauration en un clic)
-- Chaque fois qu'une donnée partagée (parclive_data) est modifiée, l'ANCIENNE valeur est
-- conservée dans parclive_data_history. Ajouts uniquement : aucune donnée existante n'est modifiée.
-- Relançable sans risque (idempotent).

create table if not exists public.parclive_data_history (
  id bigint generated always as identity primary key,
  key text not null,
  value jsonb not null,
  data_updated_at timestamptz,            -- date de la version remplacée
  saved_at timestamptz not null default now(),  -- moment où elle a été remplacée
  saved_by uuid default auth.uid()        -- compte qui a fait la modification
);
create index if not exists parclive_data_history_key_idx on public.parclive_data_history (key, saved_at desc);

-- Lecture réservée aux comptes connectés ; aucune écriture directe (seul le déclencheur écrit).
alter table public.parclive_data_history enable row level security;
drop policy if exists "history_read_authenticated" on public.parclive_data_history;
create policy "history_read_authenticated" on public.parclive_data_history
  for select to authenticated using (true);

create or replace function public.parclive_data_keep_history()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Le journal d'activité change à chaque action et le code d'accès n'a pas à être dupliqué.
  if old.key in ('dsr:activity-log', 'dsr:access-code-hash') then
    return new;
  end if;
  if old.value is not distinct from new.value then
    return new;
  end if;
  insert into public.parclive_data_history (key, value, data_updated_at, saved_by)
  values (old.key, old.value, old.updated_at, auth.uid());
  -- On garde les 100 dernières versions de chaque donnée, et jamais plus de 60 jours.
  delete from public.parclive_data_history
   where key = old.key
     and (saved_at < now() - interval '60 days'
          or id not in (select id from public.parclive_data_history where key = old.key order by saved_at desc limit 100));
  return new;
end;
$$;
revoke all on function public.parclive_data_keep_history() from public, anon, authenticated;

drop trigger if exists parclive_data_history_trg on public.parclive_data;
create trigger parclive_data_history_trg
  before update on public.parclive_data
  for each row execute function public.parclive_data_keep_history();

-- Vérification (doit renvoyer 1 ligne) :
-- select tgname from pg_trigger where tgname = 'parclive_data_history_trg';
