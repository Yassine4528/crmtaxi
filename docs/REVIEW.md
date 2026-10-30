# Revue du projet d'origine

État de départ : un unique fichier `agenda.html` (1 811 lignes, CSS et JavaScript intégrés), sans dépôt, sans test et sans serveur, avec toutes les données dans le `localStorage` du navigateur.

Ce fichier reste volontairement hors de Git, car il contient des données de mineurs dans son code source. Cette revue n'en cite aucune.

## Critique : bloquait toute mise en ligne

| #   | Constat                                                                                                                                                                                                              | Résolution                                                                            |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| C1  | **Données de mineurs en dur dans le code** : noms, adresses, consignes de comportement, téléphone, tarifs. Héberger le fichier les aurait publiées avant toute connexion.                                            | Code sans aucune donnée réelle. Elles entrent par import, dans la base.               |
| C2  | **Connexion uniquement décorative** : écrire `{"role":"admin"}` dans le `sessionStorage` donnait l'accès gérant, sans code.                                                                                          | Sessions côté serveur, droits vérifiés à chaque requête.                              |
| C3  | **Tout était dans le navigateur de chacun** : un chauffeur pouvait lire tarifs et codes via les outils de développement. Le commentaire affirmant que les montants n'étaient « jamais mis dans la page » était faux. | L'API n'envoie jamais les montants à un chauffeur (testé).                            |
| C4  | **Codes en clair** dans le `localStorage` et dans les sauvegardes. Code gérant de 6 chiffres, chauffeurs sans longueur minimale.                                                                                     | Empreintes scrypt, 12 caractères pour le gérant, 6 pour les chauffeurs, verrouillage. |
| C5  | **Aucune synchronisation** : chaque appareil avait sa propre copie. Les présences pointées sur un téléphone n'arrivaient jamais au gérant.                                                                           | Base PostgreSQL commune, rafraîchissement automatique.                                |

## Élevé : bugs et risques réels

| #   | Constat                                                                                                                                                                               | Résolution                                                       |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| H1  | **Fenêtres gérant restées ouvertes après déconnexion** : un chauffeur se connectant ensuite voyait Circuits ou Facturation, malgré la déconnexion automatique prévue pour l'empêcher. | Tout l'écran est démonté à la fin de la session (vérifié).       |
| H2  | Le premier visiteur choisissait le code gérant.                                                                                                                                       | Compte créé par variable d'environnement.                        |
| H3  | Migrations et données métier mêlées au code, avec dates en dur, et rejouées à chaque ouverture y compris chez les chauffeurs.                                                         | Migrations SQL versionnées, données séparées du code.            |
| H4  | L'affichage écrivait des valeurs techniques dans les données (`_l`, `_n` sur 76 courses), reprises dans les sauvegardes.                                                              | Calcul de disposition pur, champs retirés à l'import.            |
| H5  | Un chauffeur créé via « + Ajouter » pouvait recevoir le code du gérant : le contrôle n'existait que dans l'autre écran.                                                               | Contrôle unique côté serveur.                                    |
| H6  | Aucun test sur des calculs qui servent à facturer.                                                                                                                                    | 68 tests, et comparaison avec l'ancien calcul (voir ci-dessous). |

## Moyen : qualité et ergonomie

| #   | Constat                                                                                                                             | Résolution                                      |
| --- | ----------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| M1  | Choix du mode de facturation par « OK / Annuler » : annuler créait quand même un circuit.                                           | Fenêtre avec choix explicite.                   |
| M2  | `prompt`, `confirm` et `alert` natifs partout, impossibles à styliser et bloquants.                                                 | Fenêtres intégrées et accessibles au clavier.   |
| M3  | Le rafraîchissement de la grille pouvait interrompre un glisser-déposer en cours.                                                   | Rendu React sans perte de l'état du glissement. |
| M4  | Le code du chauffeur s'affichait en clair dans l'écran d'accès.                                                                     | Champ masqué, le code n'est jamais relu.        |
| M5  | Noms des établissements et de la société en dur.                                                                                    | Paramètres modifiables.                         |
| M6  | Une erreur de stockage (quota de 5 Mo) n'était signalée que par une alerte, avec risque de perte en cas de nettoyage du navigateur. | Base de données.                                |

## Vérification de non-régression

La logique de l'ancien fichier a été exécutée à côté de la nouvelle sur la vraie sauvegarde du 24 octobre 2026 :

| Contrôle                                                       | Résultat                                                                                  |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Montant et nombre de jeunes des 687 courses                    | Aucun écart                                                                               |
| 63 totaux circuit × mois, HT et TVA                            | Aucun écart                                                                               |
| Jours fériés 2025-2035, montants en lettres                    | Aucun écart                                                                               |
| Import par l'API puis facturation de novembre et décembre 2026 | Mêmes totaux                                                                              |
| Génération du 2 novembre au 18 décembre 2026                   | 687 courses, mêmes chauffeurs, jeunes et prix (voir point 1 ci-dessous pour les horaires) |
| Accès des 7 chauffeurs aux données réelles                     | Aucun montant ni donnée d'un autre                                                        |

## Points à traiter par le gérant

Ces constats viennent des données, pas du code : ils existaient déjà et ne sont pas corrigés automatiquement.

1. **Horaires types à mettre à jour sur 5 circuits.** Les courses de novembre-décembre ont été décalées à la main (départ 7h00), mais le modèle du circuit indique encore 7h30-9h00 et 16h00-17h30. Les courses créées pour janvier partiraient donc à la mauvaise heure. À corriger dans **Circuits** avant de les créer.
2. **Codes chauffeurs.** Les 7 chauffeurs n'ont aucun code dans la sauvegarde : aucun ne pourrait se connecter avant que le gérant leur en attribue.
3. **Orthographes.** Certains jeunes sont écrits différemment selon les trajets, et 3 lignes de convention regroupent deux enfants sous une seule entrée, ce qui fausse le suivi individuel des absences. À harmoniser, en vérifiant au passage la facturation des jours où une même personne apparaît sur une ligne seule et sur une ligne groupée.
4. **Sauvegarde périmée.** Le fichier disponible date du 24 octobre. Refaire une sauvegarde depuis le navigateur habituel juste avant la migration, pour ne rien perdre de ce qui a été saisi depuis.

## Fonctionnalité retirée

Le bouton « Reprendre sept.–oct. (tableaux Excel) » réimportait un historique figé dans le code, qui ne peut pas rester dans un dépôt. Les tarifs qu'il contenait sont conservés dans chaque circuit. L'historique lui-même n'a jamais été importé dans l'agenda et reste dans `agenda.html`.
