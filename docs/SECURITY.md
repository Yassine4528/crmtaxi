# Sécurité et données personnelles

L'application traite des **données de mineurs accueillis en établissement médico-éducatif** : noms, adresses, emplois du temps, présences et consignes parfois liées au comportement. Le RGPD les protège particulièrement ; une partie peut relever des données de santé.

## À décider avant la mise en ligne

Ces points relèvent du responsable de traitement et ne sont pas réglés par le code :

1. **Hébergement.** Choisir une région européenne sur Railway. Railway étant une société américaine, faire vérifier le cadre de transfert et le contrat de sous-traitance (DPA).
2. **Données de santé.** Faire vérifier si les notes et consignes en relèvent. Si oui, un hébergeur certifié HDS peut être exigé en France, et Railway ne conviendrait alors pas pour ces données.
3. **Base légale et information.** Vérifier avec les établissements les conventions, l'information des familles et le registre des traitements.
4. **Durée de conservation.** Définir quand supprimer les fiches et les anciennes courses. Aucune purge automatique n'existe aujourd'hui.

## Mesures en place

| Risque                             | Mesure                                                                                  |
| ---------------------------------- | --------------------------------------------------------------------------------------- |
| Vol de mots de passe               | Empreintes scrypt salées, jamais de stockage ni d'export en clair                       |
| Essais de codes                    | Verrouillage 15 min après 5 échecs ; 20 tentatives/min par adresse IP                   |
| Vol de session                     | Cookie `HttpOnly`, `Secure`, `SameSite=Strict` ; seule l'empreinte du jeton est stockée |
| Poste du gérant laissé ouvert      | Déconnexion après 15 min d'inactivité, côté serveur et côté navigateur                  |
| Chauffeur curieux                  | Filtrage côté serveur : ses courses seulement, sans montant                             |
| Prise de contrôle à l'installation | Pas d'écran de première utilisation : le gérant est créé par variable d'environnement   |
| Injection, XSS                     | Requêtes paramétrées, validation Zod, React, CSP stricte sans script externe            |
| Fuite par les journaux             | URL journalisées sans paramètres ; journal d'audit sans contenu                         |
| Fuite par Git                      | `.gitignore`, `.dockerignore` et contrôle `npm run check:private` en CI                 |
| Indexation                         | Balise `noindex` sur toutes les pages                                                   |

## Règles de travail

- **Ne jamais versionner** de vraie donnée : ni sauvegarde, ni capture d'écran, ni exemple copié de la production. Les tests et la démonstration utilisent des données fictives.
- `agenda.html` et les anciennes sauvegardes contiennent ces données, et les sauvegardes contiennent le code gérant en clair. Les conserver hors de tout dossier partagé et les supprimer une fois la migration validée.
- Les sauvegardes téléchargées depuis l'application ne contiennent aucun code, mais toutes les données : à stocker chiffrées.

## À prévoir ensuite

- Activer les sauvegardes automatiques de PostgreSQL et tester une restauration.
- Ajouter une purge selon la durée de conservation retenue, et l'export ou l'effacement sur demande d'une famille.
- Mettre en place une double authentification pour le gérant.
