-- ParcLive · Permissions En livraison et Marketing réglables par personne (Réglages > Vendeurs > Personnaliser les permissions).
-- Remplace livraison_droit() (sql/livraisons.sql) et is_marketing_viewer() (sql/marketing-sites.sql). Relançable sans risque.
--
-- Permissions personnalisées lues dans la fiche vendeur (dsr:vendeurs-list > permOverrides), valeur par défaut = rôle :
--   livraisonVoir   (défaut : tous)                                                  voir l'onglet, site Ford St-Lô uniquement
--   livraisonPrepa  (défaut : Préparateur)                                           cocher Prépa et Champagne
--   livraisonGerer  (défaut : Directeur de plaque, Chef des ventes, Responsable de site, Secrétariat)   créer / modifier / supprimer
--   marketingVoir   (défaut : Chef des ventes, Responsable de site)                  consulter Marketing, sites Ford Caen et Ford St-Lô
-- livraison_members (Steven, Florence) reste prioritaire.
-- Ajouter un préparateur : l'ajouter dans Réglages > Vendeurs (site Ford St-Lô, rôle Préparateur, e-mail renseigné).

create or replace function public.parclive_perm(entry jsonb, k text, def boolean)
returns boolean
language sql
immutable
as $$
  select case entry -> 'permOverrides' ->> k when 'true' then true when 'false' then false else def end;
$$;

create or replace function public.is_marketing_viewer()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(auth.jwt() ->> 'email', '') <> '' and exists (
    select 1
    from jsonb_array_elements(
           coalesce((select value::jsonb from public.parclive_data where key = 'dsr:vendeurs-list'), '[]'::jsonb)
         ) e
    where lower(coalesce(e ->> 'email', '')) = lower(auth.jwt() ->> 'email')
      and e ->> 'site' in ('Ford Caen', 'Ford St-Lô')
      and public.parclive_perm(e, 'marketingVoir', e ->> 'role' in ('Chef des ventes', 'Responsable de site'))
  );
$$;

create or replace function public.livraison_droit()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select droit from public.livraison_members where user_id = auth.uid()),
    (
      select case
        when not public.parclive_perm(e, 'livraisonVoir', true) then null
        when public.parclive_perm(e, 'livraisonGerer', e ->> 'role' in ('Directeur de plaque', 'Chef des ventes', 'Responsable de site', 'Secrétariat')) then 'gestion'
        when public.parclive_perm(e, 'livraisonPrepa', e ->> 'role' = 'Préparateur') then 'preparateur'
        else 'lecture'
      end
      from jsonb_array_elements(
             coalesce((select value::jsonb from public.parclive_data where key = 'dsr:vendeurs-list'), '[]'::jsonb)
           ) e
      where coalesce(auth.jwt() ->> 'email', '') <> ''
        and lower(coalesce(e ->> 'email', '')) = lower(auth.jwt() ->> 'email')
        and e ->> 'site' = 'Ford St-Lô'
      limit 1
    ),
    ''
  );
$$;

revoke all on function public.parclive_perm(jsonb, text, boolean) from public, anon;
grant execute on function public.parclive_perm(jsonb, text, boolean) to authenticated;
