-- ParcLive · Rapports RDV (BÊTA) — Ford Caen
-- Steven (administrateur) crée les rendez-vous ; chaque commercial ne voit que les siens et ne remplit que le suivi.
-- À exécuter une fois dans Supabase > SQL Editor. Sans risque de le relancer (idempotent).
-- Données clients : tables protégées par RLS (rien n'est lisible sans compte autorisé).

-- 1. Comptes autorisés ---------------------------------------------------------
create table if not exists public.rdv_members (
  user_id uuid primary key references auth.users(id) on delete cascade,
  nom text not null,                                   -- identique au nom du vendeur dans ParcLive (ex. "LEROY Anthony")
  email text,
  role text not null default 'commercial' check (role in ('admin', 'commercial')),
  added_at timestamptz not null default now()
);
alter table public.rdv_members enable row level security;

create or replace function public.rdv_is_member() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.rdv_members where user_id = auth.uid());
$$;
create or replace function public.rdv_is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.rdv_members where user_id = auth.uid() and role = 'admin');
$$;
create or replace function public.rdv_my_nom() returns text
language sql stable security definer set search_path = public as $$
  select nom from public.rdv_members where user_id = auth.uid();
$$;
revoke all on function public.rdv_is_member(), public.rdv_is_admin(), public.rdv_my_nom() from public, anon;
grant execute on function public.rdv_is_member(), public.rdv_is_admin(), public.rdv_my_nom() to authenticated;

drop policy if exists "rdv_members_read" on public.rdv_members;
create policy "rdv_members_read" on public.rdv_members
  for select to authenticated using (user_id = auth.uid() or public.rdv_is_admin());
-- Pas de policy d'écriture : les accès se gèrent avec les fonctions ci-dessous (administrateur uniquement).

create or replace function public.rdv_add_member(p_email text, p_nom text) returns boolean
language plpgsql security definer set search_path = public as $$
declare uid uuid;
begin
  if not public.rdv_is_admin() then raise exception 'Réservé à l''administrateur'; end if;
  select id into uid from auth.users where lower(email) = lower(trim(p_email));
  if uid is null then return false; end if;
  insert into public.rdv_members (user_id, nom, email, role)
  values (uid, trim(p_nom), lower(trim(p_email)), 'commercial')
  on conflict (user_id) do update set nom = excluded.nom, email = excluded.email
  where public.rdv_members.role <> 'admin';
  return true;
end;
$$;
create or replace function public.rdv_remove_member(p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.rdv_is_admin() then raise exception 'Réservé à l''administrateur'; end if;
  delete from public.rdv_members where user_id = p_user and role = 'commercial';
end;
$$;
revoke all on function public.rdv_add_member(text, text), public.rdv_remove_member(uuid) from public, anon;
grant execute on function public.rdv_add_member(text, text), public.rdv_remove_member(uuid) to authenticated;

-- 2. Rendez-vous ---------------------------------------------------------------
create table if not exists public.rdv (
  id uuid primary key default gen_random_uuid(),
  -- Renseigné par l'administrateur
  client_nom text not null,
  tel text,
  commercial text not null,                            -- nom du vendeur (réattribuable)
  date_rdv timestamptz not null,
  type_rdv text not null default 'Showroom' check (type_rdv in ('Showroom', 'Reprise', 'Essai', 'Livraison', 'Autre')),
  source text,
  vehicule_vise text,
  vehicule_ref text,                                   -- n° de commande si choisi dans le stock
  consigne text,                                       -- contexte / consigne pour le commercial
  deleted_at timestamptz,                              -- corbeille (récupérable 30 jours)
  -- Renseigné par le commercial (suivi)
  statut text not null default 'À venir' check (statut in ('À venir', 'Honoré', 'Absent', 'Vendu', 'Perdu')),
  commentaire text,
  relance date,
  motif_perte text check (motif_perte is null or motif_perte in ('Prix', 'Pas de reprise', 'Financement refusé', 'Délai', 'Injoignable', 'Autre')),
  dossier_numero text,                                 -- dossier MyAna quand le statut est « Vendu »
  -- Calculé automatiquement
  venu boolean not null default false,
  suivi_at timestamptz,                                -- 1re saisie d'un résultat (réactivité)
  updated_by uuid,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists rdv_commercial_date_idx on public.rdv (commercial, date_rdv);
create index if not exists rdv_date_idx on public.rdv (date_rdv);
create index if not exists rdv_deleted_idx on public.rdv (deleted_at) where deleted_at is not null;

create table if not exists public.rdv_history (
  id bigint generated always as identity primary key,
  rdv_id uuid not null references public.rdv(id) on delete cascade,
  at timestamptz not null default now(),
  by_user uuid,
  by_nom text,
  action text not null,
  changes jsonb not null default '{}'::jsonb
);
create index if not exists rdv_history_rdv_idx on public.rdv_history (rdv_id, at desc);

create table if not exists public.rdv_objectifs (
  commercial text primary key,
  rdv_semaine integer check (rdv_semaine is null or rdv_semaine >= 0),
  honore_pct integer check (honore_pct is null or honore_pct between 0 and 100),
  vente_pct integer check (vente_pct is null or vente_pct between 0 and 100),
  updated_at timestamptz not null default now()
);

-- Statistiques mensuelles conservées après la suppression des rendez-vous de plus de 24 mois (sans aucun nom de client).
create table if not exists public.rdv_archive_mensuel (
  mois date not null,
  commercial text not null,
  source text not null default '',
  type_rdv text not null,
  nb_rdv integer not null default 0,
  nb_venu integer not null default 0,
  nb_absent integer not null default 0,
  nb_vendu integer not null default 0,
  nb_perdu integer not null default 0,
  primary key (mois, commercial, source, type_rdv)
);

-- 3. Règles d'écriture (déclencheurs) -------------------------------------------
create or replace function public.rdv_before_write() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if not public.rdv_is_admin() then raise exception 'Seul l''administrateur peut créer un rendez-vous'; end if;
    new.created_by := auth.uid();
    new.created_at := now();
    new.venu := new.statut in ('Honoré', 'Vendu');
    new.suivi_at := case when new.statut <> 'À venir' then now() end;
  else
    -- Un commercial ne peut modifier que le suivi : tout le reste est figé.
    if not public.rdv_is_admin() then
      if (new.client_nom, new.tel, new.commercial, new.date_rdv, new.type_rdv, new.source, new.vehicule_vise, new.vehicule_ref, new.consigne, new.deleted_at, new.created_by, new.created_at)
         is distinct from
         (old.client_nom, old.tel, old.commercial, old.date_rdv, old.type_rdv, old.source, old.vehicule_vise, old.vehicule_ref, old.consigne, old.deleted_at, old.created_by, old.created_at) then
        raise exception 'Seul le suivi (statut, commentaire, relance, motif, dossier) est modifiable';
      end if;
    end if;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
    new.venu := case
      when new.statut in ('Honoré', 'Vendu') then true
      when new.statut = 'Absent' then false
      else old.venu end;
    new.suivi_at := coalesce(old.suivi_at, case when new.statut <> 'À venir' then now() end);
  end if;
  new.updated_at := now();
  new.updated_by := auth.uid();
  if new.statut <> 'Perdu' then new.motif_perte := null; end if;
  return new;
end;
$$;

create or replace function public.rdv_after_write() returns trigger
language plpgsql security definer set search_path = public as $$
declare diff jsonb; act text;
begin
  if tg_op = 'INSERT' then
    insert into public.rdv_history (rdv_id, by_user, by_nom, action, changes)
    values (new.id, auth.uid(), coalesce(public.rdv_my_nom(), 'Administrateur'), 'création', '{}'::jsonb);
    return new;
  end if;
  select coalesce(jsonb_object_agg(n.key, jsonb_build_array(o.value, n.value)), '{}'::jsonb) into diff
  from jsonb_each(to_jsonb(new)) n
  join jsonb_each(to_jsonb(old)) o using (key)
  where n.value is distinct from o.value
    and n.key not in ('updated_at', 'updated_by', 'suivi_at', 'venu');
  if diff = '{}'::jsonb then return new; end if;
  act := case
    when old.deleted_at is null and new.deleted_at is not null then 'suppression'
    when old.deleted_at is not null and new.deleted_at is null then 'restauration'
    when diff ? 'commercial' then 'réattribution'
    else 'modification' end;
  insert into public.rdv_history (rdv_id, by_user, by_nom, action, changes)
  values (new.id, auth.uid(), coalesce(public.rdv_my_nom(), 'Administrateur'), act, diff);
  return new;
end;
$$;
revoke all on function public.rdv_before_write(), public.rdv_after_write() from public, anon, authenticated;

drop trigger if exists rdv_before_write_trg on public.rdv;
create trigger rdv_before_write_trg before insert or update on public.rdv
  for each row execute function public.rdv_before_write();
drop trigger if exists rdv_after_write_trg on public.rdv;
create trigger rdv_after_write_trg after insert or update on public.rdv
  for each row execute function public.rdv_after_write();

-- Objectifs : mise à jour de la date
create or replace function public.rdv_objectifs_touch() returns trigger
language plpgsql set search_path = public as $$
begin new.updated_at = now(); return new; end;
$$;
drop trigger if exists rdv_objectifs_touch_trg on public.rdv_objectifs;
create trigger rdv_objectifs_touch_trg before update on public.rdv_objectifs
  for each row execute function public.rdv_objectifs_touch();

-- 4. Sécurité (RLS) ------------------------------------------------------------
alter table public.rdv enable row level security;
alter table public.rdv_history enable row level security;
alter table public.rdv_objectifs enable row level security;
alter table public.rdv_archive_mensuel enable row level security;

drop policy if exists "rdv_select" on public.rdv;
create policy "rdv_select" on public.rdv for select to authenticated
  using (public.rdv_is_admin() or (deleted_at is null and commercial = public.rdv_my_nom()));
drop policy if exists "rdv_insert" on public.rdv;
create policy "rdv_insert" on public.rdv for insert to authenticated
  with check (public.rdv_is_admin());
drop policy if exists "rdv_update" on public.rdv;
create policy "rdv_update" on public.rdv for update to authenticated
  using (public.rdv_is_admin() or (deleted_at is null and commercial = public.rdv_my_nom()))
  with check (public.rdv_is_admin() or (deleted_at is null and commercial = public.rdv_my_nom()));
-- Aucune policy de suppression : la suppression passe par la corbeille (deleted_at) puis rdv_purge().

drop policy if exists "rdv_history_select" on public.rdv_history;
create policy "rdv_history_select" on public.rdv_history for select to authenticated
  using (public.rdv_is_admin() or exists (
    select 1 from public.rdv r where r.id = rdv_history.rdv_id and r.deleted_at is null and r.commercial = public.rdv_my_nom()));

drop policy if exists "rdv_objectifs_select" on public.rdv_objectifs;
create policy "rdv_objectifs_select" on public.rdv_objectifs for select to authenticated
  using (public.rdv_is_admin() or commercial = public.rdv_my_nom());
drop policy if exists "rdv_objectifs_admin_write" on public.rdv_objectifs;
create policy "rdv_objectifs_admin_write" on public.rdv_objectifs for all to authenticated
  using (public.rdv_is_admin()) with check (public.rdv_is_admin());

drop policy if exists "rdv_archive_select" on public.rdv_archive_mensuel;
create policy "rdv_archive_select" on public.rdv_archive_mensuel for select to authenticated
  using (public.rdv_is_admin());

-- 5. Purge : rendez-vous > 24 mois (statistiques mensuelles conservées) et corbeille > 30 jours ----
create or replace function public.rdv_purge() returns integer
language plpgsql security definer set search_path = public as $$
declare n integer := 0; m integer := 0;
begin
  if not public.rdv_is_admin() then raise exception 'Réservé à l''administrateur'; end if;
  insert into public.rdv_archive_mensuel as a (mois, commercial, source, type_rdv, nb_rdv, nb_venu, nb_absent, nb_vendu, nb_perdu)
  select date_trunc('month', date_rdv at time zone 'Europe/Paris')::date, commercial, coalesce(source, ''), type_rdv,
         count(*), count(*) filter (where venu), count(*) filter (where not venu and statut in ('Absent', 'Perdu')),
         count(*) filter (where statut = 'Vendu'), count(*) filter (where statut = 'Perdu')
  from public.rdv
  where deleted_at is null and date_rdv < now() - interval '24 months'
  group by 1, 2, 3, 4
  on conflict (mois, commercial, source, type_rdv) do update set
    nb_rdv = a.nb_rdv + excluded.nb_rdv, nb_venu = a.nb_venu + excluded.nb_venu, nb_absent = a.nb_absent + excluded.nb_absent,
    nb_vendu = a.nb_vendu + excluded.nb_vendu, nb_perdu = a.nb_perdu + excluded.nb_perdu;
  delete from public.rdv where date_rdv < now() - interval '24 months';
  get diagnostics n = row_count;
  delete from public.rdv where deleted_at is not null and deleted_at < now() - interval '30 days';
  get diagnostics m = row_count;
  return n + m;
end;
$$;
revoke all on function public.rdv_purge() from public, anon;
grant execute on function public.rdv_purge() to authenticated;

-- 6. Temps réel ----------------------------------------------------------------
do $$ begin
  alter publication supabase_realtime add table public.rdv;
exception when duplicate_object then null; end $$;

-- 7. Donner l'accès administrateur à Steven (les commerciaux s'ajoutent depuis l'onglet, section « Gestion ») ----
insert into public.rdv_members (user_id, nom, email, role)
select id, 'BEAUMONT Steven', lower(email), 'admin' from auth.users where lower(email) = 'steven.beaumont@groupe-legrand.fr'
on conflict (user_id) do update set role = 'admin', nom = excluded.nom;

-- Vérification : doit afficher 1 ligne (Steven, admin).
-- select nom, role from public.rdv_members;
