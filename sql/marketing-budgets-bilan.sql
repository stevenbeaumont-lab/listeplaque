-- ParcLive · Marketing : accès par concession, budget annuel par site, bilan des opérations (leads / RDV / propositions / ventes).
-- Relançable sans risque.
--
-- Accès (lu dans dsr:vendeurs-list > e-mail, site, rôle, permOverrides) :
--   marketingVoir   (défaut : Directeur de plaque, Chef des ventes, Responsable de site) → consulte projets, tâches, dépenses,
--                   budget et bilan de SON site (+ actions « Multi site »), en lecture seule.
--   marketingBudget (défaut : Directeur de plaque, Responsable de site) → renseigne le budget annuel de SON site.
-- marketing_members (Steven, Ophélie) : accès complet à tous les sites, saisie du bilan des opérations.

create or replace function public.marketing_viewer_sites()
returns text[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(array_agg(distinct e ->> 'site') filter (where coalesce(e ->> 'site', '') <> ''), '{}'::text[])
  from jsonb_array_elements(
         coalesce((select value::jsonb from public.parclive_data where key = 'dsr:vendeurs-list'), '[]'::jsonb)
       ) e
  where coalesce(auth.jwt() ->> 'email', '') <> ''
    and lower(coalesce(e ->> 'email', '')) = lower(auth.jwt() ->> 'email')
    and (
      public.parclive_perm(e, 'marketingVoir', e ->> 'role' in ('Directeur de plaque', 'Chef des ventes', 'Responsable de site'))
      or public.parclive_perm(e, 'marketingBudget', e ->> 'role' in ('Directeur de plaque', 'Responsable de site'))
    );
$$;

create or replace function public.marketing_budget_sites()
returns text[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(array_agg(distinct e ->> 'site') filter (where coalesce(e ->> 'site', '') <> ''), '{}'::text[])
  from jsonb_array_elements(
         coalesce((select value::jsonb from public.parclive_data where key = 'dsr:vendeurs-list'), '[]'::jsonb)
       ) e
  where coalesce(auth.jwt() ->> 'email', '') <> ''
    and lower(coalesce(e ->> 'email', '')) = lower(auth.jwt() ->> 'email')
    and public.parclive_perm(e, 'marketingBudget', e ->> 'role' in ('Directeur de plaque', 'Responsable de site'));
$$;

create or replace function public.is_marketing_viewer()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select cardinality(public.marketing_viewer_sites()) > 0;
$$;

create or replace function public.marketing_can_see_site(s text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_marketing_member()
      or (s = 'Multi site' and public.is_marketing_viewer())
      or s = any(public.marketing_viewer_sites());
$$;

revoke all on function public.marketing_viewer_sites() from public, anon;
revoke all on function public.marketing_budget_sites() from public, anon;
revoke all on function public.marketing_can_see_site(text) from public, anon;
grant execute on function public.marketing_viewer_sites() to authenticated;
grant execute on function public.marketing_budget_sites() to authenticated;
grant execute on function public.marketing_can_see_site(text) to authenticated;

-- Lecture limitée au site du consultant.
drop policy if exists marketing_projects_viewers_read on public.marketing_projects;
create policy marketing_projects_viewers_read on public.marketing_projects for select using (public.marketing_can_see_site(site));

drop policy if exists marketing_tasks_viewers_read on public.marketing_tasks;
create policy marketing_tasks_viewers_read on public.marketing_tasks for select using (public.marketing_can_see_site(site));

drop policy if exists marketing_expenses_viewers_read on public.marketing_expenses;
create policy marketing_expenses_viewers_read on public.marketing_expenses for select using (
  exists (select 1 from public.marketing_projects p where p.id = project_id and public.marketing_can_see_site(p.site))
);

drop policy if exists marketing_comments_viewers_read on public.marketing_comments;
create policy marketing_comments_viewers_read on public.marketing_comments for select using (
  exists (select 1 from public.marketing_tasks t where t.id = task_id and public.marketing_can_see_site(t.site))
);

drop policy if exists marketing_links_viewers_read on public.marketing_links;
create policy marketing_links_viewers_read on public.marketing_links for select using (
  exists (select 1 from public.marketing_projects p where p.id = project_id and public.marketing_can_see_site(p.site))
  or exists (select 1 from public.marketing_tasks t where t.id = task_id and public.marketing_can_see_site(t.site))
);

-- Budget annuel par concession.
create table if not exists public.marketing_budgets_annuels (
  site text not null check (site in ('Ford Caen','Ford Lisieux','Ford Bernay','Ford Pont-Audemer','Ford St-Lô','Ford Cherbourg')),
  annee int not null check (annee between 2020 and 2100),
  montant numeric not null check (montant >= 0),
  updated_by text,
  updated_at timestamptz not null default now(),
  primary key (site, annee)
);
alter table public.marketing_budgets_annuels enable row level security;
drop policy if exists marketing_budgets_members_all on public.marketing_budgets_annuels;
create policy marketing_budgets_members_all on public.marketing_budgets_annuels for all using (public.is_marketing_member()) with check (public.is_marketing_member());
drop policy if exists marketing_budgets_viewers_read on public.marketing_budgets_annuels;
create policy marketing_budgets_viewers_read on public.marketing_budgets_annuels for select using (site = any(public.marketing_viewer_sites()));
drop policy if exists marketing_budgets_editors_insert on public.marketing_budgets_annuels;
create policy marketing_budgets_editors_insert on public.marketing_budgets_annuels for insert with check (site = any(public.marketing_budget_sites()));
drop policy if exists marketing_budgets_editors_update on public.marketing_budgets_annuels;
create policy marketing_budgets_editors_update on public.marketing_budgets_annuels for update using (site = any(public.marketing_budget_sites())) with check (site = any(public.marketing_budget_sites()));

-- Résultats par opération (projet) : saisis par l'équipe Marketing, consultables par le site concerné.
create table if not exists public.marketing_results (
  project_id uuid primary key references public.marketing_projects(id) on delete cascade,
  leads int check (leads >= 0),
  rdv int check (rdv >= 0),
  propositions int check (propositions >= 0),
  ventes int check (ventes >= 0),
  updated_by text,
  updated_at timestamptz not null default now()
);
alter table public.marketing_results enable row level security;
drop policy if exists marketing_results_members_all on public.marketing_results;
create policy marketing_results_members_all on public.marketing_results for all using (public.is_marketing_member()) with check (public.is_marketing_member());
drop policy if exists marketing_results_viewers_read on public.marketing_results;
create policy marketing_results_viewers_read on public.marketing_results for select using (
  exists (select 1 from public.marketing_projects p where p.id = project_id and public.marketing_can_see_site(p.site))
);

grant select, insert, update, delete on public.marketing_budgets_annuels, public.marketing_results to authenticated;

do $$
begin
  begin alter publication supabase_realtime add table public.marketing_budgets_annuels; exception when others then null; end;
  begin alter publication supabase_realtime add table public.marketing_results; exception when others then null; end;
end $$;

-- Budget par service (VN / VO / APV) : service du projet + budget annuel par site et par service.
-- Les budgets saisis avant cette évolution (sans service) deviennent le « Global » du site.
alter table public.marketing_projects add column if not exists service text;
alter table public.marketing_projects drop constraint if exists marketing_projects_service_check;
alter table public.marketing_projects add constraint marketing_projects_service_check check (service is null or service in ('VN','VO','APV'));

alter table public.marketing_budgets_annuels add column if not exists service text not null default 'Global';
alter table public.marketing_budgets_annuels drop constraint if exists marketing_budgets_annuels_service_check;
alter table public.marketing_budgets_annuels add constraint marketing_budgets_annuels_service_check check (service in ('Global','VN','VO','APV'));
alter table public.marketing_budgets_annuels drop constraint if exists marketing_budgets_annuels_pkey;
alter table public.marketing_budgets_annuels add primary key (site, annee, service);
