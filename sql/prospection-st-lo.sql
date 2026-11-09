-- ParcLive · Prospection pour Ford Saint-Lô (en plus de Caen).
-- Ajouts uniquement, relançable sans risque. Aucune donnée existante n'est modifiée : tous les prospects actuels restent « Ford Caen ».
--
-- 1. Chaque prospect appartient à un site (Ford Caen par défaut, ou Ford St-Lô).
-- 2. Chaque membre de la prospection a une liste de sites (prospection_members.sites, défaut : Ford Caen).
--    Un membre ne voit et ne modifie que les prospects de ses sites (politique « restrictive » en plus des politiques existantes).
-- 3. Campagnes / cibles / ouvertures (fichiers Datanéo de Caen) : visibles seulement des membres qui ont Ford Caen.
-- 4. Mathys Levavasseur : commercial BtoB de Saint-Lô (site St-Lô uniquement, lecture + écriture).
--    Steven et Ophélie : Caen + Saint-Lô (Ophélie reste en lecture seule). Jean-Baptiste Lebon : Caen seulement.

alter table public.prospects add column if not exists site text not null default 'Ford Caen';
do $$ begin
  alter table public.prospects add constraint prospects_site_check check (site in ('Ford Caen', 'Ford St-Lô'));
exception when duplicate_object then null; end $$;
create index if not exists prospects_site_idx on public.prospects (site);

alter table public.prospection_members add column if not exists sites text[] not null default array['Ford Caen']::text[];

create or replace function public.prospection_sites()
returns text[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select sites from public.prospection_members where user_id = auth.uid()), array[]::text[]);
$$;
revoke all on function public.prospection_sites() from public, anon;
grant execute on function public.prospection_sites() to authenticated;

do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'prospects' and policyname = 'prospects_sites_restrict') then
    create policy prospects_sites_restrict on public.prospects as restrictive for all
      using (site = any (public.prospection_sites()))
      with check (site = any (public.prospection_sites()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'prospect_actions' and policyname = 'prospect_actions_sites_restrict') then
    create policy prospect_actions_sites_restrict on public.prospect_actions as restrictive for all
      using (exists (select 1 from public.prospects p where p.id = prospect_actions.prospect_id and p.site = any (public.prospection_sites())))
      with check (exists (select 1 from public.prospects p where p.id = prospect_actions.prospect_id and p.site = any (public.prospection_sites())));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'prospection_campagnes' and policyname = 'campagnes_caen_only') then
    create policy campagnes_caen_only on public.prospection_campagnes as restrictive for select using ('Ford Caen' = any (public.prospection_sites()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'prospection_cibles' and policyname = 'cibles_caen_only') then
    create policy cibles_caen_only on public.prospection_cibles as restrictive for select using ('Ford Caen' = any (public.prospection_sites()));
  end if;
  if to_regclass('public.prospection_ouvertures') is not null and not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'prospection_ouvertures' and policyname = 'ouvertures_caen_only') then
    create policy ouvertures_caen_only on public.prospection_ouvertures as restrictive for select using ('Ford Caen' = any (public.prospection_sites()));
  end if;
end $$;

-- Steven et Ophélie voient Caen + Saint-Lô
update public.prospection_members
set sites = array['Ford Caen', 'Ford St-Lô']
where user_id in (
  select id from auth.users
  where lower(email) in ('steven.beaumont@groupe-legrand.fr', 'ophelie.bouland@groupe-legrand.fr')
);

-- Mathys Levavasseur : membre, Saint-Lô uniquement
insert into public.prospection_members (user_id, sites)
select u.id, array['Ford St-Lô']::text[] from auth.users u
where lower(u.email) = 'mathys.levavasseur@groupe-legrand.fr'
  and not exists (select 1 from public.prospection_members pm where pm.user_id = u.id);

update public.prospection_members
set sites = array['Ford St-Lô']
where user_id in (select id from auth.users where lower(email) = 'mathys.levavasseur@groupe-legrand.fr');

-- Vérification
-- select u.email, pm.sites, pm.lecture_seule, pm.peut_importer from public.prospection_members pm join auth.users u on u.id = pm.user_id order by 1;
