-- ParcLive · Prospection : accès en LECTURE SEULE (consulter sans modifier)
-- Donne l'accès à Ophélie (marketing) et à Jean-Baptiste Lebon en lecture seule.
-- À coller dans Supabase > SQL Editor puis exécuter (relançable sans risque).
-- Les commerciaux déjà membres gardent leurs droits complets (lecture + écriture).
--
-- Chacun doit ensuite recharger ParcLive : l'onglet Prospection apparaît dans « Commercial ».

begin;

-- 1) Colonne « lecture seule » sur la liste des membres
alter table public.prospection_members
  add column if not exists lecture_seule boolean not null default false;

-- 2) Droits : tout membre peut LIRE ; seuls les membres non « lecture seule » peuvent écrire
create or replace function public.is_prospection_editor()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.prospection_members
    where user_id = auth.uid() and not lecture_seule
  );
$$;
grant execute on function public.is_prospection_editor() to authenticated;

-- prospects
drop policy if exists prospects_members_all on public.prospects;
drop policy if exists prospects_members_select on public.prospects;
drop policy if exists prospects_editors_insert on public.prospects;
drop policy if exists prospects_editors_update on public.prospects;
drop policy if exists prospects_editors_delete on public.prospects;
create policy prospects_members_select on public.prospects for select using (public.is_prospection_member());
create policy prospects_editors_insert on public.prospects for insert with check (public.is_prospection_editor());
create policy prospects_editors_update on public.prospects for update using (public.is_prospection_editor()) with check (public.is_prospection_editor());
create policy prospects_editors_delete on public.prospects for delete using (public.is_prospection_editor());

-- prospect_actions
drop policy if exists prospect_actions_members_all on public.prospect_actions;
drop policy if exists prospect_actions_members_select on public.prospect_actions;
drop policy if exists prospect_actions_editors_insert on public.prospect_actions;
drop policy if exists prospect_actions_editors_update on public.prospect_actions;
drop policy if exists prospect_actions_editors_delete on public.prospect_actions;
create policy prospect_actions_members_select on public.prospect_actions for select using (public.is_prospection_member());
create policy prospect_actions_editors_insert on public.prospect_actions for insert with check (public.is_prospection_editor());
create policy prospect_actions_editors_update on public.prospect_actions for update using (public.is_prospection_editor()) with check (public.is_prospection_editor());
create policy prospect_actions_editors_delete on public.prospect_actions for delete using (public.is_prospection_editor());

-- 3) Ophélie et Jean-Baptiste Lebon : membres en lecture seule
insert into public.prospection_members (user_id)
select u.id from auth.users u
where lower(u.email) in (
  'ophelie.bouland@groupe-legrand.fr',   -- Ophélie (marketing)
  'jb.lebon@groupe-legrand.fr'           -- Jean-Baptiste Lebon
)
and not exists (select 1 from public.prospection_members pm where pm.user_id = u.id);

update public.prospection_members
set lecture_seule = true
where user_id in (
  select id from auth.users
  where lower(email) in ('ophelie.bouland@groupe-legrand.fr', 'jb.lebon@groupe-legrand.fr')
);

commit;

-- Vérification : membres et type d'accès
select u.email,
       case when pm.lecture_seule then 'lecture seule' else 'lecture + écriture' end as acces,
       pm.added_at
from public.prospection_members pm
join auth.users u on u.id = pm.user_id
order by pm.lecture_seule, pm.added_at;
