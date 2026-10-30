# Taxi CRM

Planning des chauffeurs, circuits réguliers, présences et facturation mensuelle pour une société de taxi.

- **Gérant** : tous les agendas, fichier clients, circuits, tarifs, mémoires de facturation.
- **Chauffeur** : uniquement ses courses, sans aucun montant. Il pointe les présences et signale les absences.

Ces règles sont appliquées par le serveur : ce que le navigateur d'un chauffeur ne doit pas voir ne lui est jamais envoyé.

## Stack

| Rôle       | Technologie                                          |
| ---------- | ---------------------------------------------------- |
| Interface  | React 19, TypeScript, Vite, TanStack Query           |
| API        | Node.js 24, Fastify 5, validation Zod                |
| Données    | PostgreSQL, Drizzle ORM (PGlite en local et en test) |
| Métier     | `packages/domain` : TypeScript pur, partagé et testé |
| Qualité    | Vitest, ESLint, Prettier, GitHub Actions, Dependabot |
| Production | Image Docker unique, déployée sur Railway            |

```
apps/web          Interface React
apps/api          API Fastify, schéma et migrations de la base
packages/domain   Règles métier : dates, tarifs, circuits, facturation, contrats d'API
docs/             Architecture, sécurité et revue du projet d'origine
```

## Démarrer en local

Prérequis : Node.js 24 ([nodejs.org](https://nodejs.org)). Aucune base à installer.

```bash
npm ci
```

```bash
cp .env.example .env
```

Renseignez `ADMIN_INITIAL_PASSWORD` dans `.env` (12 caractères minimum), puis :

```bash
npm run db:seed:demo
```

```bash
npm run dev
```

L'application s'ouvre sur <http://localhost:5173>. Connexion gérant : identifiant `gerant` et le mot de passe choisi.
Le jeu de démonstration est entièrement fictif ; ses chauffeurs sont `alex`, `sam` et `lou`, avec les codes `demo-alex`, `demo-sam` et `demo-lou`.

## Commandes

| Commande              | Effet                                                         |
| --------------------- | ------------------------------------------------------------- |
| `npm run dev`         | API et interface en rechargement automatique                  |
| `npm run check`       | Tout ce que vérifie la CI : lint, format, types, tests, build |
| `npm test`            | Tests uniquement                                              |
| `npm run db:generate` | Génère une migration après modification du schéma             |
| `npm run build`       | Construit l'interface, servie ensuite par l'API               |
| `npm start`           | Démarre le serveur de production                              |

## Déployer sur Railway

1. Créer un projet Railway depuis ce dépôt : `Dockerfile` et `railway.json` sont détectés.
2. Ajouter un service **PostgreSQL** et choisir une **région européenne** pour les deux services.
3. Sur le service de l'application, définir :
   - `DATABASE_URL` = `${{Postgres.DATABASE_URL}}`
   - `ADMIN_INITIAL_PASSWORD` = un mot de passe long et unique
4. Générer un domaine public. Les migrations s'appliquent au démarrage.
5. Se connecter avec `gerant`, puis changer le mot de passe et retirer `ADMIN_INITIAL_PASSWORD`.

### Reprendre les données de l'ancienne application

1. Dans l'ancien `agenda.html`, cliquer sur **Sauvegarder mes données** pour obtenir un fichier à jour.
2. Dans la nouvelle application, cliquer sur **Restaurer une sauvegarde** et choisir ce fichier.
3. Attribuer un code à chaque chauffeur avec ⚙ : les anciens codes ne sont volontairement pas repris.
4. Vérifier les totaux de la fenêtre **Facturation** avant d'abandonner l'ancien fichier.

Avant toute mise en ligne, lire [docs/SECURITY.md](docs/SECURITY.md) : l'application contient des données de mineurs.

## Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [Sécurité et données personnelles](docs/SECURITY.md)
- [Revue du projet d'origine](docs/REVIEW.md)
