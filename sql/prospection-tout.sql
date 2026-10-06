-- ParcLive · Prospection — TOUS les nouveaux scripts SQL en un seul (à coller dans Supabase > SQL Editor, puis Run).
-- Partie 1 : 4 statuts + 5 critères du parc + motif de perte + dernière proposition.
-- Partie 2 : accès en lecture seule pour Ophélie et Jean-Baptiste Lebon.
-- Relançable sans risque.

-- ================= PARTIE 1 : statuts et critères =================
-- ParcLive · Prospection : critères du parc, 4 statuts, motif de perte, dernière proposition
-- À coller dans Supabase > SQL Editor puis exécuter (relançable sans risque).
--
-- 1) Colonnes ajoutées sur public.prospects :
--      marques                 marques du parc, séparées par des virgules   ex. « Ford, Renault »
--      energies                énergies du parc, séparées par des virgules  ex. « Gazole, Électrique »
--      decideur                nom + fonction du décideur
--      renouvellement_mois     périodicité de renouvellement du parc (en mois) -> date de relance des Prospects
--      dernier_renouvellement  date du dernier renouvellement, si connue
--      derniere_proposition    date de la dernière proposition envoyée (relance en général à 72 h)
--      motif_perte             pourquoi le prospect est perdu (ex. ne veut plus entendre parler de la marque)
--    (la taille du parc reste la colonne existante « flotte »)
-- 2) Statuts ramenés à 4 : Prospect, Proposition envoyée, Gagné, Perdu.
--    Anciens statuts repris : À contacter / Contacté / RDV fixé -> Prospect ; Offre envoyée -> Proposition envoyée.
-- 3) « Prochaine action » supprimée de l'appli : le texte déjà saisi est recopié dans les Notes (rien n'est perdu).

alter table public.prospects
  add column if not exists marques text,
  add column if not exists energies text,
  add column if not exists decideur text,
  add column if not exists renouvellement_mois integer,
  add column if not exists dernier_renouvellement date,
  add column if not exists derniere_proposition date,
  add column if not exists motif_perte text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'prospects_renouvellement_mois_check' and conrelid = 'public.prospects'::regclass) then
    alter table public.prospects
      add constraint prospects_renouvellement_mois_check
      check (renouvellement_mois is null or renouvellement_mois between 1 and 240);
  end if;
end $$;

-- « Prochaine action » -> Notes (une seule fois : la colonne est vidée après la copie).
update public.prospects
set notes = concat_ws(E'\n', nullif(notes, ''), 'Prochaine action : ' || prochaine),
    prochaine = null
where prochaine is not null and btrim(prochaine) <> '';

-- Statuts : on retire l'ancienne contrainte, on reprend les anciennes valeurs, puis on pose la nouvelle.
alter table public.prospects drop constraint if exists prospects_statut_check;

update public.prospects set statut = 'Proposition envoyée' where statut = 'Offre envoyée';
update public.prospects set statut = 'Prospect' where statut not in ('Prospect', 'Proposition envoyée', 'Gagné', 'Perdu');
alter table public.prospects alter column statut set default 'Prospect';

alter table public.prospects
  add constraint prospects_statut_check
  check (statut = any (array['Prospect','Proposition envoyée','Gagné','Perdu']));


-- ================= PARTIE 2 : lecture seule =================
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
