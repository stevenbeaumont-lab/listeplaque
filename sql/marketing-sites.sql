-- ParcLive · Marketing sur plusieurs sites (Caen + Saint-Lô) et consultation par les managers.
-- Ajouts uniquement : les projets et tâches existants passent en « Ford Caen ». Relançable sans risque.
--
-- 1. Chaque projet et chaque tâche appartient à un site : Ford Caen ou Ford St-Lô.
-- 2. Gestion (création / modification) : toujours réservée à marketing_members (Steven, Ophélie).
-- 3. Consultation seule : les comptes « Chef des ventes » et « Responsable de site » de Ford Caen ou
--    Ford St-Lô (rôle et site lus dans la liste des vendeurs de ParcLive, rapprochés par e-mail).
--    Ces managers voient les projets des deux sites ; les autres sites n'ont aucun accès.

-- 1. Site -----------------------------------------------------------------------
alter table public.marketing_projects
  add column if not exists site text not null default 'Ford Caen';
alter table public.marketing_tasks
  add column if not exists site text not null default 'Ford Caen';

do $$ begin
  alter table public.marketing_projects
    add constraint marketing_projects_site_check check (site in ('Ford Caen', 'Ford St-Lô'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.marketing_tasks
    add constraint marketing_tasks_site_check check (site in ('Ford Caen', 'Ford St-Lô'));
exception when duplicate_object then null; end $$;

create index if not exists marketing_projects_site_idx on public.marketing_projects (site);
create index if not exists marketing_tasks_site_idx on public.marketing_tasks (site);

-- Une tâche rattachée à un projet suit toujours le site de ce projet.
create or replace function public.marketing_task_follow_project_site()
returns trigger language plpgsql as $$
begin
  if new.project_id is not null then
    select site into new.site from public.marketing_projects where id = new.project_id;
  end if;
  return new;
end; $$;

drop trigger if exists marketing_tasks_site on public.marketing_tasks;
create trigger marketing_tasks_site before insert or update of project_id on public.marketing_tasks
  for each row execute function public.marketing_task_follow_project_site();

-- Si un projet change de site, ses tâches le suivent.
create or replace function public.marketing_project_site_cascade()
returns trigger language plpgsql as $$
begin
  if new.site is distinct from old.site then
    update public.marketing_tasks set site = new.site where project_id = new.id;
  end if;
  return new;
end; $$;

drop trigger if exists marketing_projects_site on public.marketing_projects;
create trigger marketing_projects_site after update of site on public.marketing_projects
  for each row execute function public.marketing_project_site_cascade();

-- 2. Consultation seule pour les managers de Caen et Saint-Lô ----------------------
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
      and e ->> 'role' in ('Chef des ventes', 'Responsable de site')
      and e ->> 'site' in ('Ford Caen', 'Ford St-Lô')
  );
$$;

-- Niveau d'accès du compte connecté : 'member' (gestion), 'viewer' (lecture seule) ou ''.
create or replace function public.marketing_access()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when public.is_marketing_member() then 'member'
    when public.is_marketing_viewer() then 'viewer'
    else ''
  end;
$$;

revoke all on function public.is_marketing_viewer() from public, anon;
revoke all on function public.marketing_access() from public, anon;
grant execute on function public.is_marketing_viewer() to authenticated;
grant execute on function public.marketing_access() to authenticated;

-- Lecture seule : aucune policy d'écriture pour les viewers.
drop policy if exists "marketing_members_viewers_read" on public.marketing_members;
create policy "marketing_members_viewers_read" on public.marketing_members
  for select using (public.is_marketing_viewer());
drop policy if exists "marketing_projects_viewers_read" on public.marketing_projects;
create policy "marketing_projects_viewers_read" on public.marketing_projects
  for select using (public.is_marketing_viewer());
drop policy if exists "marketing_tasks_viewers_read" on public.marketing_tasks;
create policy "marketing_tasks_viewers_read" on public.marketing_tasks
  for select using (public.is_marketing_viewer());
drop policy if exists "marketing_comments_viewers_read" on public.marketing_comments;
create policy "marketing_comments_viewers_read" on public.marketing_comments
  for select using (public.is_marketing_viewer());
drop policy if exists "marketing_links_viewers_read" on public.marketing_links;
create policy "marketing_links_viewers_read" on public.marketing_links
  for select using (public.is_marketing_viewer());
drop policy if exists "marketing_expenses_viewers_read" on public.marketing_expenses;
create policy "marketing_expenses_viewers_read" on public.marketing_expenses
  for select using (public.is_marketing_viewer());

-- Vérification : qui est consultant aujourd'hui ?
-- select e ->> 'nom' as nom, e ->> 'role' as role, e ->> 'site' as site
-- from jsonb_array_elements((select value::jsonb from public.parclive_data where key = 'dsr:vendeurs-list')) e
-- where e ->> 'role' in ('Chef des ventes', 'Responsable de site') and e ->> 'site' in ('Ford Caen', 'Ford St-Lô');
