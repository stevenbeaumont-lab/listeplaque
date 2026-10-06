-- ParcLive · Prospection : critères du parc, 4 statuts, motif de perte, dernière proposition
-- À coller dans Supabase > SQL Editor puis exécuter (relançable sans risque).
--
-- 1) Colonnes ajoutées sur public.prospects :
--      marques                 marques du parc, séparées par des virgules   ex. « Ford, Renault »
--      energies                énergies du parc, séparées par des virgules  ex. « Gazole, Électrique »
--      decideur                nom + fonction du décideur
--      renouvellement_mois     périodicité de renouvellement du parc (en mois) -> date de relance des Prospects
--      dernier_renouvellement  date du dernier renouvellement, si connue
--      derniere_proposition    date de la dernière proposition envoyée (relance en général à 5 jours)
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

-- Vérification : répartition par statut + colonnes ajoutées
select statut, count(*) as nb from public.prospects group by statut order by statut;
select column_name, data_type
from information_schema.columns
where table_schema = 'public' and table_name = 'prospects'
  and column_name in ('marques','energies','decideur','renouvellement_mois','dernier_renouvellement','derniere_proposition','motif_perte')
order by column_name;
