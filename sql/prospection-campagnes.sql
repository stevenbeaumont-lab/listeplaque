-- ParcLive · Prospection : CAMPAGNES Datanéo (import, sélection, ajout à la prospection)
-- À coller dans Supabase > SQL Editor puis exécuter (relançable sans risque).
-- Prérequis : prospection-tout.sql déjà exécuté (accès, lecture seule, statuts).
--
-- Ce que ça crée :
--   prospection_campagnes : une ligne par campagne importée (nom, but écrit à la main, mois…)
--   prospection_cibles    : les entreprises d'une campagne (contact, parc, adresse retrouvée par SIRET…)
--   droit « import »      : colonne prospection_members.peut_importer (Ophélie et Steven)
--
-- Droits :
--   lire les campagnes ........ tous les membres de la Prospection
--   importer / supprimer ...... uniquement les membres « peut_importer » (Ophélie, Steven)
--   cocher « cible du mois »,
--   ajouter à la prospection .. les membres avec droit d'écriture (commerciaux) et les importeurs
-- Ophélie reste en LECTURE SEULE sur les fiches prospects : elle n'écrit que sur les campagnes.

begin;

-- 1) Droit d'importer
alter table public.prospection_members
  add column if not exists peut_importer boolean not null default false;

create or replace function public.is_prospection_importer()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.prospection_members
    where user_id = auth.uid() and peut_importer
  );
$$;
grant execute on function public.is_prospection_importer() to authenticated;

-- 2) Campagnes
create table if not exists public.prospection_campagnes (
  id          uuid primary key default gen_random_uuid(),
  nom         text not null,
  source      text not null default 'Datanéo',
  mois        date,                       -- 1er jour du mois ciblé (facultatif)
  but         text,                       -- objectif de la campagne, écrit à la main
  fichier     text,                       -- nom du fichier importé
  archivee    boolean not null default false,
  created_by  uuid default auth.uid(),
  created_at  timestamptz not null default now()
);

-- 3) Cibles (entreprises) d'une campagne
create table if not exists public.prospection_cibles (
  id            uuid primary key default gen_random_uuid(),
  campagne_id   uuid not null references public.prospection_campagnes(id) on delete cascade,
  id_dataneo    text,
  siret         text,
  code_naf      text,
  libelle_naf   text,
  societe       text not null,
  code_postal   text,
  commune       text,
  adresse       text,
  lat           double precision,
  lng           double precision,
  adresse_source text,                    -- 'siret' (annuaire des entreprises) ou 'geocodage'
  adresse_essai_le timestamptz,           -- dernière tentative de recherche d'adresse (même sans résultat)
  civilite      text,
  nom           text,
  prenom        text,
  fonction      text,
  email         text,
  tel           text,
  vp_ford       integer,
  vu_ford       integer,
  parc_vp       integer,
  parc_vu       integer,
  vp_elec       integer,
  extra         jsonb not null default '{}'::jsonb,   -- colonnes Datanéo non reconnues (ex. PLIB)
  cible_mois    boolean not null default false,       -- une des 2 cibles qualifiées du mois
  prospect_id   uuid references public.prospects(id) on delete set null,
  ajoute_par    text,
  ajoute_le     timestamptz,
  created_at    timestamptz not null default now()
);
create unique index if not exists prospection_cibles_campagne_siret_uq
  on public.prospection_cibles (campagne_id, siret) where siret is not null;
create index if not exists prospection_cibles_campagne_idx on public.prospection_cibles (campagne_id);
create index if not exists prospection_cibles_siret_idx on public.prospection_cibles (siret);
create index if not exists prospection_cibles_prospect_idx on public.prospection_cibles (prospect_id);

-- 4) Sécurité (RLS)
alter table public.prospection_campagnes enable row level security;
alter table public.prospection_cibles enable row level security;

drop policy if exists campagnes_members_select on public.prospection_campagnes;
drop policy if exists campagnes_importers_insert on public.prospection_campagnes;
drop policy if exists campagnes_importers_update on public.prospection_campagnes;
drop policy if exists campagnes_importers_delete on public.prospection_campagnes;
create policy campagnes_members_select  on public.prospection_campagnes for select using (public.is_prospection_member());
create policy campagnes_importers_insert on public.prospection_campagnes for insert with check (public.is_prospection_importer());
create policy campagnes_importers_update on public.prospection_campagnes for update using (public.is_prospection_importer()) with check (public.is_prospection_importer());
create policy campagnes_importers_delete on public.prospection_campagnes for delete using (public.is_prospection_importer());

drop policy if exists cibles_members_select on public.prospection_cibles;
drop policy if exists cibles_importers_insert on public.prospection_cibles;
drop policy if exists cibles_writers_update on public.prospection_cibles;
drop policy if exists cibles_importers_delete on public.prospection_cibles;
create policy cibles_members_select  on public.prospection_cibles for select using (public.is_prospection_member());
create policy cibles_importers_insert on public.prospection_cibles for insert with check (public.is_prospection_importer());
create policy cibles_writers_update on public.prospection_cibles for update
  using (public.is_prospection_importer() or public.is_prospection_editor())
  with check (public.is_prospection_importer() or public.is_prospection_editor());
create policy cibles_importers_delete on public.prospection_cibles for delete using (public.is_prospection_importer());

grant select, insert, update, delete on public.prospection_campagnes to authenticated;
grant select, insert, update, delete on public.prospection_cibles to authenticated;

-- 5) Qui peut importer : Ophélie (marketing) et Steven. Ophélie reste en lecture seule sur les fiches.
update public.prospection_members
set peut_importer = true
where user_id in (
  select id from auth.users
  where lower(email) in ('ophelie.bouland@groupe-legrand.fr', 'steven.beaumont@groupe-legrand.fr')
);

commit;

-- Vérification : qui a quels droits
select u.email,
       case when pm.lecture_seule then 'lecture seule' else 'lecture + écriture' end as fiches,
       case when pm.peut_importer then 'oui' else 'non' end as import_campagnes
from public.prospection_members pm
join auth.users u on u.id = pm.user_id
order by pm.lecture_seule, u.email;
