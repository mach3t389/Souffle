# Souffle

Téléprompteur personnel : studio TypeScript/Tiptap pour ordinateur et téléphone, lecteur léger indépendant pour les essais sur iPad Mini 2.

```sh
npm install
npm run dev
npm run build
npm test
```

## Disponible localement

- Bibliothèque de projets avec ouverture, renommage direct et menu d’actions sur chaque carte.
- Deux barres de navigation : projet, puis sélecteur de script compact, création, menu unique et lecture. Le menu regroupe renommage, duplication, historique, télécommande, déplacement et corbeille.
- Menu principal repliable; plan du script à la demande sur grand écran et en dialogue sur téléphone.
- Plan automatique à partir des titres, chapitres et sous-titres. Cliquer une section place le curseur et prépare la lecture à cet endroit; le repère peut être remis au début. Le changement de script réinitialise le repère.
- Création, renommage, duplication, déplacement des scripts; renommage des projets.
- Une seule action « Nouveau script » propose la création d’un script vierge ou l’import Word/texte. Les commandes et libellés utilisent une échelle de texte cohérente, y compris sur téléphone.
- Corbeille récupérable des scripts et projets.
- Éditeur enrichi, import Word/texte et copier-coller. La fidélité des dispositions complexes et des polices Word n’est pas garantie.
- Contenu JSON Tiptap versionné avec identifiants stables de paragraphes. Migration automatique de l’ancien format HTML; l’ancienne clé de stockage est conservée.
- Historique des 30 derniers points de sauvegarde, restauration et export/import JSON.
- Détection des conflits entre onglets et récupération des deux versions sous forme de projets distincts.
- Thèmes clair/sombre mémorisés; éditeur sur fond neutre, logo « souffle. ».
- Lecteur `/lecteur.html` en JavaScript ES5 : lecture/pause, compte à rebours à chaque reprise, vitesse et taille par boutons −/+ et saisie numérique, polices, proportions et miroirs indépendants. Les réglages sont regroupés en sections Lecture, Texte et Affichage, avec des commandes de 44 px; le curseur de vitesse est placé sous la saisie et la taille utilise uniquement les boutons et la saisie directe. Le défilement conserve les fractions de pixel avec une translation visuelle pour limiter les saccades à basse vitesse. La pause et la reprise utilisent la position affichée; la fin arrête la lecture sur place, sans boucle automatique. Seul le retour au début explicite remet le lecteur en haut. Le bouton « Tester » lance un essai de vitesse sans décompte et laisse les réglages ouverts pour ajuster la vitesse pendant le défilement; « Lire » garde le décompte configuré. Une flèche en haut du panneau replie les réglages sans lancer la lecture. La lecture masque les barres de la page et garde trois petites commandes à icônes : retour direct à l’éditeur, pause/reprise et flèche pour rouvrir les réglages, sans activer le plein écran système. Un toucher/clic sur le texte met en pause ou reprend; un balayage ou la molette met en pause et permet de repositionner le texte sans relancer la lecture.

## Intégration cloud implémentée, activation requise

Le site hébergé exige une connexion Supabase; les visiteurs sans session ne voient pas l’espace de travail. La création de compte n’est pas offerte dans l’interface. Le mode local reste disponible pendant le développement sans configuration cloud. Cette restriction d’interface doit être accompagnée de la désactivation des nouvelles inscriptions dans Supabase (voir [la configuration détaillée](docs/CONFIGURATION.md)); le fournisseur d’authentification reste l’autorité qui bloque réellement la création de comptes. Le formulaire prend en charge Cloudflare Turnstile si sa clé publique est définie, et peut envoyer le jeton CAPTCHA à Supabase pour la connexion et la récupération de mot de passe.

L’espace cloud utilise une ligne JSON par compte avec révision atomique, droits de lecture par propriétaire et écritures via une fonction serveur. Ce choix protège les écritures concurrentes mais produit des conflits à l’échelle de l’espace entier. Une séparation future par document réduira ces conflits pour un usage en équipe.

Les brouillons locaux sont séparés par compte. Les projets locaux sont importés explicitement dans le compte, une fois, puis peuvent être restaurés depuis une sauvegarde. La synchronisation réessaie lors du retour du réseau et périodiquement; les conflits nécessitent une résolution explicite.

La télécommande crée une session avec lien temporaire, version figée du script, commandes ordonnées, confirmations, état de connexion, réglages à distance et révocation. Son transport utilise les fonctions REST Supabase pour limiter les dépendances du vieux lecteur. La connexion réelle entre appareils reste à vérifier sur le service configuré.

Voir [la configuration détaillée](docs/CONFIGURATION.md) et `.env.example`. Aucune migration n’a été appliquée à une base externe par cette implémentation.

## Vérifications

`npm test` exécute les tests du modèle et les deux migrations sur PostgreSQL embarqué PGlite avec pgcrypto : isolation de comptes, interdiction des écritures directes, conflits atomiques, accès limité au lecteur, séquences, confirmations et révocation. `npm run build` vérifie TypeScript et produit `dist`.

La compatibilité physique iOS 12.5.8, les courriels d’authentification, la fluidité sur l’iPad et le déploiement HTTPS restent à valider avec les appareils et services réels.

L’audit npm initial signale trois alertes modérées transitives dans la chaîne CLI de Mammoth (`argparse` / `sprintf-js`). Aucun correctif compatible n’est proposé. Ne pas appliquer le retour à une ancienne version suggéré par `npm audit fix --force` sans étude. L’application utilise la conversion navigateur, pas le CLI Mammoth.

