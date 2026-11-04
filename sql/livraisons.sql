-- ParcLive · Onglet « En livraison » (bêta, Ford St-Lô). Autonome : aucune liaison avec le stock ni les dossiers.
-- Ajouts uniquement, relançable sans risque (aucun drop).
--
-- Droits :
--   gestion      : crée, modifie, supprime (livraison_members, droit = 'gestion')
--   preparateur  : coche uniquement Prépa et Champagne (livraison_members, droit = 'preparateur')
--   lecture      : tout compte rattaché à Ford St-Lô dans la liste des vendeurs de ParcLive (rapprochement par e-mail)

create table if not exists public.livraison_members (
  user_id uuid primary key references auth.users (id) on delete cascade,
  nom text not null,
  droit text not null default 'gestion' check (droit in ('gestion', 'preparateur')),
  created_at timestamptz not null default now()
);
alter table public.livraison_members enable row level security;

create table if not exists public.livraisons (
  id uuid primary key default gen_random_uuid(),
  site text not null default 'Ford St-Lô' check (site = 'Ford St-Lô'),
  date_livraison date not null,
  heure text,
  no_commande text,
  modele text,
  n_serie text,
  immat text,
  client text,
  vendeur text,
  paiement text,
  montage text,
  accessoires text,
  carburant text,
  kms text,
  sous_traiter text,
  note text,
  champagne_pris_le date,
  champagne_debit boolean not null default false,
  prepa text not null default 'a_faire' check (prepa in ('a_faire', 'meca_ok', 'pret')),
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  updated_by uuid
);
create index if not exists livraisons_date_idx on public.livraisons (date_livraison);
alter table public.livraisons enable row level security;

-- Droit du compte connecté : 'gestion' | 'preparateur' | 'lecture' | ''
create or replace function public.livraison_droit()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select droit from public.livraison_members where user_id = auth.uid()),
    case when coalesce(auth.jwt() ->> 'email', '') <> '' and exists (
      select 1
      from jsonb_array_elements(
             coalesce((select value::jsonb from public.parclive_data where key = 'dsr:vendeurs-list'), '[]'::jsonb)
           ) e
      where lower(coalesce(e ->> 'email', '')) = lower(auth.jwt() ->> 'email')
        and e ->> 'site' = 'Ford St-Lô'
    ) then 'lecture' end,
    ''
  );
$$;
revoke all on function public.livraison_droit() from public, anon;
grant execute on function public.livraison_droit() to authenticated;

-- Horodatage + garde-fou : le préparateur ne peut modifier que Prépa et Champagne.
create or replace function public.livraisons_before_update()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if public.livraison_droit() = 'preparateur' then
    if (to_jsonb(new) - array['prepa', 'champagne_pris_le', 'champagne_debit', 'updated_at', 'updated_by'])
       is distinct from
       (to_jsonb(old) - array['prepa', 'champagne_pris_le', 'champagne_debit', 'updated_at', 'updated_by']) then
      raise exception 'Le préparateur ne peut modifier que Prépa et Champagne';
    end if;
  end if;
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end; $$;

create or replace trigger livraisons_before_update_trg before update on public.livraisons
  for each row execute function public.livraisons_before_update();

-- Politiques
create policy "livraison_members_self" on public.livraison_members
  for select using (user_id = auth.uid());

create policy "livraisons_read" on public.livraisons
  for select using (public.livraison_droit() <> '');
create policy "livraisons_insert" on public.livraisons
  for insert with check (public.livraison_droit() = 'gestion');
create policy "livraisons_update" on public.livraisons
  for update using (public.livraison_droit() in ('gestion', 'preparateur'))
  with check (public.livraison_droit() in ('gestion', 'preparateur'));
create policy "livraisons_delete" on public.livraisons
  for delete using (public.livraison_droit() = 'gestion');

revoke all on public.livraisons, public.livraison_members from anon;

-- Mise à jour en direct
do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'livraisons') then
    alter publication supabase_realtime add table public.livraisons;
  end if;
end $$;

-- Gestion : Steven et Florence Morin (secrétariat St-Lô)
insert into public.livraison_members (user_id, nom, droit) values
  ('492225fd-ee2d-4d79-8713-a22e9f24c40d', 'Steven', 'gestion'),
  ('633e13be-ac4e-4f8b-a0cc-4765d27b769a', 'Florence', 'gestion')
on conflict (user_id) do nothing;

-- Pour ajouter un préparateur :
-- insert into public.livraison_members (user_id, nom, droit)
-- select id, 'Prénom', 'preparateur' from auth.users where lower(email) = 'prenom.nom@groupe-legrand.fr';
