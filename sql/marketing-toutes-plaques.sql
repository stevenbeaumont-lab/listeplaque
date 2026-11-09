-- ParcLive · Marketing pour toutes les plaques Ford.
-- Sites acceptés : Ford Caen, Lisieux, Bernay, Pont-Audemer, St-Lô, Cherbourg + « Multi site ».
-- Consultation (lecture seule) : tout compte dont marketingVoir est vrai (défaut Chef des ventes / Responsable de site), quel que soit le site.
-- La gestion reste réservée à marketing_members. Relançable sans risque.

alter table public.marketing_projects drop constraint if exists marketing_projects_site_check;
alter table public.marketing_projects
  add constraint marketing_projects_site_check
  check (site in ('Ford Caen','Ford Lisieux','Ford Bernay','Ford Pont-Audemer','Ford St-Lô','Ford Cherbourg','Multi site'));

alter table public.marketing_tasks drop constraint if exists marketing_tasks_site_check;
alter table public.marketing_tasks
  add constraint marketing_tasks_site_check
  check (site in ('Ford Caen','Ford Lisieux','Ford Bernay','Ford Pont-Audemer','Ford St-Lô','Ford Cherbourg','Multi site'));

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
      and public.parclive_perm(e, 'marketingVoir', e ->> 'role' in ('Chef des ventes', 'Responsable de site'))
  );
$$;
