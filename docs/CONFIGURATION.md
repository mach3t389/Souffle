# Activer les comptes, le cloud et la télécommande

Le fonctionnement local est disponible immédiatement. Les fonctions cloud utilisent un vrai projet Supabase; aucun compte fictif ni base publique de démonstration n’est fourni.

1. Créer ou choisir un projet Supabase.
2. Dans SQL Editor, appliquer dans l’ordre les fichiers `supabase/migrations/001_workspace.sql` et `002_reading_sessions.sql`. Ces migrations sont également compatibles avec le suivi de migrations du CLI Supabase. Les appliquer une seule fois dans une base vierge; ne pas modifier une migration déjà déployée.
3. Copier `.env.example` en `.env.local`, puis renseigner l’URL du projet et sa clé publique publishable. Ne jamais mettre une clé secrète ou `service_role` dans une variable `VITE_` : ces valeurs sont intégrées au navigateur.
4. Dans Authentication / URL Configuration, définir l’URL du site. Autoriser l’origine de développement et celle de production, avec les routes de retour nécessaires, notamment `/#nouveau-mot-de-passe`.
5. Activer l’authentification courriel/mot de passe et la confirmation de courriel. Configurer l’expéditeur SMTP pour les confirmations et récupérations. Vérifier la délivrabilité avec une adresse de test.
6. Redémarrer `npm run dev` après l’ajout de `.env.local`. En production, fournir les mêmes variables au moment du build, puis servir `dist` en HTTPS.

## Vérification avant utilisation du cloud

- Créer deux comptes de test A et B, confirmer leurs courriels.
- Compte A : créer un projet; l’ouvrir sur un deuxième appareil connecté à A.
- Compte B : vérifier qu’aucun document ni aucune session de A n’est accessible.
- Éditer en même temps depuis deux appareils et vérifier la résolution explicite du conflit. Le bouton « Conserver les deux » crée des projets distincts; il ne fusionne pas les paragraphes.
- Couper Internet, modifier un script, puis rétablir la connexion. Le brouillon local doit être conservé et synchronisé ou signalé en conflit.
- Tester « Mot de passe oublié » et le lien de réinitialisation, ainsi qu’un lien expiré. Une session de récupération valide est nécessaire pour enregistrer un nouveau mot de passe.
- Tester la déconnexion puis la connexion à un autre compte : les caches sont séparés par identifiant de compte.

## Sessions à distance

Depuis un script, ouvrir Télécommande et créer une session. Ouvrir le lien affiché dans le navigateur de l’iPad. L’application doit être accessible depuis l’iPad : une adresse `localhost` sur l’ordinateur n’est pas joignable depuis la tablette. Pour les essais réseau, ouvrir le studio par l’adresse réseau fournie par Vite; pour l’usage final, utiliser l’adresse HTTPS déployée.

Le lien contient un jeton aléatoire de 256 bits dans son fragment. Il donne un accès limité au script de la session pendant deux heures; il est révocable. La base conserve uniquement son empreinte. Le lecteur ne reçoit aucun accès aux autres projets et n’a pas besoin du mot de passe du compte. Une session est destinée à un lecteur; plusieurs lecteurs utilisant le même lien partageraient les confirmations.

Les commandes utilisent un numéro de séquence avec comparaison atomique. Le lecteur interroge le serveur toutes les 750 ms environ et confirme la dernière commande appliquée. Il défile localement. Un seul état de commande est conservé : des commandes successives très rapprochées peuvent être remplacées par la plus récente. La position est un paragraphe stable, pas un défilement en pixels. La navigation à l’intérieur d’un très long paragraphe reste à affiner.

La session utilise une version figée du contenu. Les réglages, la vitesse, la lecture, la pause et le repositionnement peuvent être commandés à distance. Pour charger une nouvelle révision, mettre le lecteur en pause, fermer la télécommande, modifier le document puis rouvrir Télécommande. Dans les sessions existantes, « Charger ce script » applique la version courante; le serveur exige un lecteur connecté, en pause et ayant confirmé la dernière commande. « Contrôler » permet de reprendre le pilotage d’une session existante. Le lecteur essaie de retrouver son paragraphe après remplacement du texte. La télécommande avec aperçu défilant et la navigation au caractère dans un paragraphe restent des évolutions supplémentaires.

En cas de coupure, une lecture en cours continue localement; au rétablissement de la connexion, le lecteur reste en pause et les anciennes commandes de lecture ne sont pas rejouées. La mise en arrière-plan met également en pause. Une session terminée coupe l’accès aux nouvelles commandes, mais ne peut pas effacer une copie déjà chargée dans le navigateur du lecteur.

## Exploitation

Activer et vérifier les sauvegardes de la base selon le plan Supabase retenu. Conserver une procédure de restauration testée. Les points de sauvegarde internes à un script sont limités aux 30 derniers et ne remplacent pas une sauvegarde de la base. Prévoir le nettoyage des sessions expirées et révoquées avant un usage prolongé : leurs snapshots contiennent encore le script.

Les parcours de courriel, les connexions entre appareils sur le service hébergé et la compatibilité physique iOS 12.5.8 doivent être validés avec la configuration réelle. Les tests PostgreSQL embarqués couvrent les migrations et permissions, mais ne remplacent pas ces essais.

## Déployer sur Vercel

Importer le dépôt GitHub dans Vercel. Le fichier `vercel.json` fixe le framework Vite, la commande `npm run build` et le dossier de sortie `dist`. Le studio est servi à la racine, et le lecteur indépendant à `/lecteur.html`.

Pour activer les comptes et la télécommande, ajouter `VITE_SUPABASE_URL` et `VITE_SUPABASE_PUBLISHABLE_KEY` aux variables d’environnement du projet Vercel avant la compilation. Seules les clés publiques sont destinées au navigateur. Ajouter ensuite l’adresse HTTPS déployée aux URL autorisées dans Supabase Auth et vérifier les parcours de courriel ainsi que la connexion iPhone/iPad.

Un déploiement sans ces variables propose le fonctionnement local sur chaque appareil; il ne synchronise pas les projets entre appareils. Les scripts stockés dans le navigateur ne font pas partie de la sauvegarde du code sur GitHub : utiliser « Exporter » pour en conserver une copie.

Documentation : https://vercel.com/docs/frameworks/frontend/vite
