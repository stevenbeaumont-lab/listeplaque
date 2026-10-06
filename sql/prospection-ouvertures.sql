-- ParcLive · Prospection : OUVERTURES des campagnes (zone, attribution, quota, fin de mois)
-- À coller dans Supabase > SQL Editor puis exécuter (relançable sans risque).
-- Prérequis : prospection-campagnes.sql déjà exécuté.
--
-- Principe :
--   Ophélie ou Steven « ouvrent » une sélection d'entreprises aux commerciaux (nom, date de fin, quota).
--   Chaque entreprise ouverte est rattachée à une équipe (A = est, B = ouest, selon son adresse)
--   et, au choix, à un commercial précis.
--   Un commercial ne voit QUE les entreprises ouvertes de son équipe (et celles qui lui sont attribuées).
--   Ophélie, Steven et les comptes en lecture seule voient tout.
--   Quota : nombre maximum d'entreprises qu'un commercial peut ajouter à sa prospection depuis une ouverture.
--   Fin d'ouverture : passé la date de fin (ou après fermeture manuelle), les cibles disparaissent
--   de la carte et de la liste des commerciaux ; celles déjà ajoutées restent des prospects.

begin;

-- 1) Équipe et commercial de chaque membre (pour le filtrage par équipe)
alter table public.prospection_members
  add column if not exists equipe text check (equipe in ('A', 'B')),
  add column if not exists commercial text;

update public.prospection_members pm
set equipe = v.equipe, commercial = v.commercial
from (values
  ('anthony.leroy@groupe-legrand.fr',  'A', 'Anthony'),
  ('thao.leroyer@groupe-legrand.fr',   'A', 'Thao'),
  ('tom.roger@groupe-legrand.fr',      'B', 'Tom'),
  ('julia.generoso@groupe-legrand.fr', 'B', 'Julia')
) as v(email, equipe, commercial)
join auth.users u on lower(u.email) = v.email
where pm.user_id = u.id;

-- 2) Ouvertures
create table if not exists public.prospection_ouvertures (
  id          uuid primary key default gen_random_uuid(),
  nom         text not null,
  date_fin    date not null,                       -- par défaut : fin du mois en cours
  quota       integer check (quota is null or quota > 0),  -- max par commercial (vide = illimité)
  ferme_le    timestamptz,                         -- fermeture manuelle
  ouvert_par  uuid default auth.uid(),
  created_at  timestamptz not null default now()
);

alter table public.prospection_cibles
  add column if not exists equipe text check (equipe in ('A', 'B')),
  add column if not exists commercial_attribue text,
  add column if not exists ouverture_id uuid references public.prospection_ouvertures(id) on delete set null,
  add column if not exists ajoute_commercial text;
create index if not exists prospection_cibles_ouverture_idx on public.prospection_cibles (ouverture_id);

-- 3) Fonctions de droits (security definer : lisent la liste des membres sans être bloquées par la RLS)
create or replace function public.prospection_my_equipe()
returns text language sql stable security definer set search_path = public as $$
  select equipe from public.prospection_members where user_id = auth.uid();
$$;
create or replace function public.prospection_my_commercial()
returns text language sql stable security definer set search_path = public as $$
  select commercial from public.prospection_members where user_id = auth.uid();
$$;
create or replace function public.prospection_sees_all()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.prospection_members
                 where user_id = auth.uid() and (peut_importer or lecture_seule));
$$;
create or replace function public.prospection_ouverture_active(oid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.prospection_ouvertures o
                 where o.id = oid and o.ferme_le is null and o.date_fin >= current_date);
$$;
grant execute on function public.prospection_my_equipe() to authenticated;
grant execute on function public.prospection_my_commercial() to authenticated;
grant execute on function public.prospection_sees_all() to authenticated;
grant execute on function public.prospection_ouverture_active(uuid) to authenticated;

-- 4) Qui voit quoi
alter table public.prospection_ouvertures enable row level security;
drop policy if exists ouvertures_members_select on public.prospection_ouvertures;
drop policy if exists ouvertures_importers_insert on public.prospection_ouvertures;
drop policy if exists ouvertures_importers_update on public.prospection_ouvertures;
drop policy if exists ouvertures_importers_delete on public.prospection_ouvertures;
create policy ouvertures_members_select  on public.prospection_ouvertures for select using (public.is_prospection_member());
create policy ouvertures_importers_insert on public.prospection_ouvertures for insert with check (public.is_prospection_importer());
create policy ouvertures_importers_update on public.prospection_ouvertures for update using (public.is_prospection_importer()) with check (public.is_prospection_importer());
create policy ouvertures_importers_delete on public.prospection_ouvertures for delete using (public.is_prospection_importer());
grant select, insert, update, delete on public.prospection_ouvertures to authenticated;

-- Cibles : tout pour Ophélie / Steven / lecture seule ; pour un commercial, seulement son équipe,
-- ce qui est ouvert (et attribué à lui ou à toute l'équipe), plus ce qui est déjà devenu un prospect.
drop policy if exists cibles_members_select on public.prospection_cibles;
create policy cibles_members_select on public.prospection_cibles for select using (
  public.is_prospection_member()
  and (
    public.prospection_sees_all()
    or (
      equipe is not null
      and equipe = public.prospection_my_equipe()
      and (
        prospect_id is not null
        or (
          ouverture_id is not null
          and public.prospection_ouverture_active(ouverture_id)
          and (commercial_attribue is null or commercial_attribue = public.prospection_my_commercial())
        )
      )
    )
  )
);

-- 5) Garde-fous à l'écriture : seuls Ophélie / Steven (import) changent l'ouverture, l'équipe ou l'attribution ;
--    le quota est vérifié par la base elle-même quand un commercial ajoute une entreprise à sa prospection.
create or replace function public.prospection_cibles_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare q integer; used integer;
begin
  if not public.is_prospection_importer() then
    if new.ouverture_id is distinct from old.ouverture_id
       or new.equipe is distinct from old.equipe
       or new.commercial_attribue is distinct from old.commercial_attribue then
      raise exception 'Seuls Ophélie et Steven peuvent ouvrir ou attribuer des cibles';
    end if;
  end if;
  if new.prospect_id is not null and old.prospect_id is null and new.ouverture_id is not null then
    select quota into q from public.prospection_ouvertures where id = new.ouverture_id;
    if q is not null then
      select count(distinct coalesce(siret, id::text)) into used
      from public.prospection_cibles
      where ouverture_id = new.ouverture_id
        and prospect_id is not null
        and ajoute_commercial is not distinct from new.ajoute_commercial
        and coalesce(siret, id::text) <> coalesce(new.siret, new.id::text);
      if used >= q then
        raise exception 'Quota atteint pour cette ouverture (% sur %)', used, q;
      end if;
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists prospection_cibles_guard_trg on public.prospection_cibles;
create trigger prospection_cibles_guard_trg before update on public.prospection_cibles
  for each row execute function public.prospection_cibles_guard();

commit;

-- Vérification : équipe / droits de chacun
select u.email, pm.equipe, pm.commercial,
       case when pm.lecture_seule then 'lecture seule' else 'lecture + écriture' end as fiches,
       case when pm.peut_importer then 'ouvre les cibles' else '—' end as ouverture
from public.prospection_members pm
join auth.users u on u.id = pm.user_id
order by pm.equipe nulls first, u.email;
