-- ParcLive · Prospection : critères du parc + statut « Prospect »
-- À coller dans Supabase > SQL Editor puis exécuter (relançable sans risque).
--
-- Ajoute sur la table public.prospects :
--   marques                 marques du parc, séparées par des virgules   ex. « Ford, Renault »
--   energies                énergies du parc, séparées par des virgules  ex. « Gazole, Électrique »
--   decideur                nom + fonction du décideur
--   renouvellement_mois     périodicité de renouvellement du parc (en mois) -> sert aux dates de rappel
--   dernier_renouvellement  date du dernier renouvellement, si connue
-- (la taille du parc reste la colonne existante « flotte »)
-- et autorise le nouveau statut « Prospect » (cartes de visite / flyers déposés).

alter table public.prospects
  add column if not exists marques text,
  add column if not exists energies text,
  add column if not exists decideur text,
  add column if not exists renouvellement_mois integer,
  add column if not exists dernier_renouvellement date;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'prospects_renouvellement_mois_check' and conrelid = 'public.prospects'::regclass) then
    alter table public.prospects
      add constraint prospects_renouvellement_mois_check
      check (renouvellement_mois is null or renouvellement_mois between 1 and 240);
  end if;
end $$;

-- Statut : ajout de « Prospect » à la liste autorisée.
alter table public.prospects drop constraint if exists prospects_statut_check;
alter table public.prospects
  add constraint prospects_statut_check
  check (statut = any (array['À contacter','Prospect','Contacté','RDV fixé','Offre envoyée','Gagné','Perdu']));

-- Vérification
select column_name, data_type
from information_schema.columns
where table_schema = 'public' and table_name = 'prospects'
  and column_name in ('marques','energies','decideur','renouvellement_mois','dernier_renouvellement')
order by column_name;
