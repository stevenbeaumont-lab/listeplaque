-- ParcLive — nettoyage des données Prospection : À VALIDER LIGNE PAR LIGNE.
-- Rien n'est exécuté automatiquement : chaque bloc commence par un SELECT pour voir ce qui serait touché,
-- puis un UPDATE/DELETE commenté. Décommentez seulement ce que vous validez.

-- A) Fiches de test (XXX, XXXX, XXXXX, TEST) ----------------------------------------------------
select id, societe, statut, client_existant, commercial, created_at::date
from public.prospects where societe ~* '^(x{3,}|test)$' order by created_at;
-- delete from public.prospects where societe ~* '^(x{3,}|test)$';   -- (les actions liées partent avec, si cascade)

-- B) Clients CRM restés en statut « Prospect » (importés comme clients, jamais travaillés) -------
--    Ils sont déjà exclus de l'entonnoir et des relances ; le statut « Prospect » ne sert qu'à brouiller les filtres.
select commercial, count(*) from public.prospects
where client_existant and statut = 'Prospect' group by 1 order by 2 desc;
-- Option 1 (recommandée, réversible) : ne rien changer en base, l'appli les ignore déjà.
-- Option 2 : les marquer « Gagné » (ce sont des clients) :
-- update public.prospects set statut = 'Gagné' where client_existant and statut = 'Prospect';

-- C) Anciens vendeurs (Alexandre, Lucas, Mathis, Edouard) : fiches sans propriétaire actif ----------
select commercial, statut, count(*) from public.prospects
where commercial in ('Alexandre','Lucas','Mathis','Edouard') group by 1,2 order by 1,2;
-- Réaffecter à un vendeur actif (à vous de choisir lequel, par ex. 'Steven') :
-- update public.prospects set commercial = 'Steven' where commercial in ('Alexandre','Lucas','Mathis','Edouard') and not client_existant;

-- D) Fiches sans commercial -------------------------------------------------------------------------
select id, societe, statut, created_at::date from public.prospects where commercial is null;

-- E) Doublons probables (même société à la casse/espaces près, ou même SIRET) ------------------------
select lower(trim(societe)) as societe_norm, count(*) as n, array_agg(id) as ids
from public.prospects group by 1 having count(*) > 1;

-- F) Fiches non géolocalisées (invisibles sur la carte ; le bouton « Localiser » de la carte les traite) ---
select count(*) as sans_coordonnees from public.prospects where lat is null and not client_existant;
