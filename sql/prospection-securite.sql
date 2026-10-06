-- ParcLive — durcissement sécurité (Prospection / Marketing / RDV)
-- Idempotent : peut être rejoué sans risque. Ne modifie AUCUNE donnée.
--
-- 1. Les fonctions d'appartenance (is_prospection_*, is_marketing_member) n'ont pas à être appelables
--    par un visiteur non connecté : on ne les laisse qu'aux comptes connectés.
-- 2. Les fonctions de déclencheur « updated_at » : search_path figé + plus d'appel direct par l'API.
-- 3. prospection_cibles : un non-importeur (commercial qui ajoute une entreprise à sa prospection)
--    ne peut modifier QUE les colonnes de lien (prospect_id, ajoute_par, ajoute_le, ajoute_commercial).
--    Avant : tout éditeur pouvait réécrire n'importe quelle colonne d'une cible (SIRET, adresse, campagne…).

-- 1) Fonctions d'appartenance
do $$
declare f text;
begin
  foreach f in array array['public.is_prospection_member()', 'public.is_prospection_editor()', 'public.is_prospection_importer()', 'public.is_marketing_member()']
  loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

-- 2) Fonctions de déclencheur
alter function public.prospects_touch_updated_at() set search_path = public;
alter function public.marketing_touch_updated_at() set search_path = public;
revoke execute on function public.prospects_touch_updated_at() from public, anon, authenticated;
revoke execute on function public.marketing_touch_updated_at() from public, anon, authenticated;
do $$
begin
  if to_regprocedure('public.rdv_objectifs_touch()') is not null then
    revoke execute on function public.rdv_objectifs_touch() from public, anon, authenticated;
  end if;
end $$;

-- 3) Garde-fou sur les cibles de campagne
create or replace function public.prospection_cibles_update_guard()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  link_cols text[] := array['prospect_id', 'ajoute_par', 'ajoute_le', 'ajoute_commercial'];
begin
  if public.is_prospection_importer() then
    return new;
  end if;
  if (to_jsonb(new) - link_cols) is distinct from (to_jsonb(old) - link_cols) then
    raise exception 'Seuls les importeurs peuvent modifier les données d''une cible de campagne'
      using errcode = '42501';
  end if;
  return new;
end $$;
revoke execute on function public.prospection_cibles_update_guard() from public, anon, authenticated;

drop trigger if exists prospection_cibles_update_guard on public.prospection_cibles;
create trigger prospection_cibles_update_guard
  before update on public.prospection_cibles
  for each row execute function public.prospection_cibles_update_guard();
