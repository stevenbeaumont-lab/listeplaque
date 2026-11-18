-- Prospection : « passage du jour » (résultat de la dernière visite terrain).
alter table public.prospects
  add column if not exists dernier_passage_le date,
  add column if not exists dernier_passage_par text,
  add column if not exists resultat_passage text;
alter table public.prospects drop constraint if exists prospects_resultat_passage_check;
alter table public.prospects add constraint prospects_resultat_passage_check
  check (resultat_passage is null or resultat_passage in ('vu','interesse','rdv','proposition','refus','ferme'));
