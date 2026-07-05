# ParcLive — déploiement GitHub Pages + Supabase

## 1. Base de données Supabase

Si ce n'est pas déjà fait : dans votre projet Supabase → **SQL Editor** → New query, collez et exécutez :

```sql
create table parclive_data (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

alter table parclive_data enable row level security;

create policy "Allow anon read/write"
on parclive_data
for all
using (true)
with check (true);
```

## 2. Fichiers à mettre dans le dépôt GitHub

Deux fichiers, à placer **à la racine** du dépôt (pas dans un sous-dossier) :

- `index.html`
- `app.jsx`

Sur GitHub : ouvrez votre dépôt → bouton **Add file → Upload files** → glissez les deux fichiers → **Commit changes**.

## 3. Activer GitHub Pages

Dans le dépôt : **Settings → Pages** (menu de gauche) →
- **Source** : "Deploy from a branch"
- **Branch** : `main` (ou `master`), dossier `/ (root)`
- **Save**

GitHub affiche alors une adresse du type :
`https://stevenbeaumont-lab.github.io/NOM-DU-DEPOT/`

Ça peut prendre 1 à 2 minutes après le premier déploiement.

## 4. Tester

Ouvrez l'adresse ci-dessus, entrez le code **Legrand27**, importez vos deux fichiers Excel comme d'habitude.

## Comment ça marche techniquement

- `index.html` charge React, Tailwind et les autres librairies directement depuis un CDN (esm.sh / unpkg) — pas d'étape de build, pas de `npm install`, ça tourne tel quel sur GitHub Pages.
- `app.jsx` est transformé en JavaScript directement dans le navigateur au chargement de la page (via Babel), donc vous pouvez éditer ce fichier tel quel si besoin plus tard.
- Les données partagées (imports, réservations, accidentés) passent maintenant par **Supabase** au lieu du système propre à Claude — c'est ce qui permet à toute l'équipe de voir les mêmes données en temps réel, peu importe qui ouvre le lien.
- Le thème (clair/sombre), le nom du vendeur et le déverrouillage du code d'accès restent en local sur chaque navigateur (`localStorage`) — pas besoin de les partager.

## Sécurité — à lire

- Le code **Legrand27** et la clé Supabase sont visibles dans le code source de la page (n'importe qui peut les lire via les outils de développement du navigateur). Ça filtre les visiteurs occasionnels, pas un accès malveillant déterminé.
- La règle Supabase créée ci-dessus autorise **n'importe qui possédant la clé publique** à lire/écrire dans la table `parclive_data`. C'est cohérent avec le niveau de protection actuel (le code d'accès), mais si vous voulez une vraie sécurité plus tard, il faudra une authentification réelle côté Supabase (email/mot de passe par vendeur) — je peux vous accompagner sur cette évolution si besoin.
# rebuild trigger 1783007722
<!-- retry 1783020136 -->
<!-- retry2 1783020289 -->
<!-- retry 1783021481 -->
<!-- retry 1783061344 -->
<!-- retry2 1783061403 -->
<!-- retry 1783066872 -->
<!-- retry 1783068803 -->
<!-- retry 1783071910 -->
<!-- retry 1783074314 -->
<!-- retry 1783074537 -->
<!-- retry2 1783074597 -->
<!-- retry 1783085316 -->
<!-- retry2 1783085381 -->
<!-- retry3 1783085446 -->
<!-- retry 1783085906 -->
<!-- retry2 1783085969 -->
<!-- retry 1783087690 -->
<!-- retry 1783091318 -->
<!-- retry 1783194223 -->
<!-- retry 1783237299 -->
