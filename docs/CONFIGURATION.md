# Activer les comptes, le cloud et la télécommande

Le fonctionnement local est disponible immédiatement. Les fonctions cloud utilisent un vrai projet Supabase; aucun compte fictif ni base publique de démonstration n’est fourni.

1. Créer ou choisir un projet Supabase.
2. Dans SQL Editor, appliquer dans l’ordre les fichiers `supabase/migrations/001_workspace.sql` et `002_reading_sessions.sql`. Ces migrations sont également compatibles avec le suivi de migrations du CLI Supabase. Les appliquer une seule fois dans une base vierge; ne pas modifier une migration déjà déployée.
3. Copier `.env.example` en `.env.local`, puis renseigner l’URL du projet et sa clé publique publishable. Ne jamais mettre une clé secrète ou `service_role` dans une variable `VITE_` : ces valeurs sont intégrées au navigateur.
4. Dans Authentication / URL Configuration, définir l’URL du site et autoriser les origines de développement et de production. Une fois le compte propriétaire activé, aucune route de récupération par courriel n’est nécessaire.
5. Activer l’authentification courriel/mot de passe. Créer le compte propriétaire dans Authentication / Users et définir son mot de passe avant de désactiver l’expéditeur SMTP. Tester une déconnexion et une reconnexion avec ce compte avant de retirer la clé Resend. Sans SMTP, il n’y a pas de récupération autonome : conserver le mot de passe dans un gestionnaire fiable. En cas de perte, l’administrateur devra rétablir l’accès depuis Supabase.
6. Pour le site personnel public, désactiver **Allow new users to sign up** dans Authentication / Sign In / Providers (ou les réglages d’inscription Auth équivalents) et désactiver les connexions anonymes. Conserver uniquement ton utilisateur dans Authentication / Users; les comptes doivent être créés par l’administrateur, jamais par le formulaire public. La page d’inscription a été retirée du site, mais seul ce réglage Supabase bloque aussi les demandes directes à l’API.
7. Dans Authentication / Bot and Abuse Protection, activer CAPTCHA avec Cloudflare Turnstile. Ajouter le secret Turnstile uniquement dans Supabase. Ajouter sa clé de site publique à Vercel sous `VITE_TURNSTILE_SITE_KEY` (et à `.env.local` pour tester); cette clé est visible dans le navigateur. Vérifier que les domaines Souffle utilisés figurent dans les paramètres Turnstile. Sans clé publique, le formulaire n’affiche pas Turnstile, mais les limites de débit Supabase restent appliquées.
8. Examiner Authentication / Rate Limits et garder des limites prudentes pour les tentatives de connexion. Supabase limite les demandes par adresse IP; ces réglages varient selon le plan. Activer la protection contre les mots de passe compromis si le plan le permet, et protéger le compte propriétaire avec un mot de passe unique et l’authentification multifacteur.
9. Redémarrer `npm run dev` après l’ajout de `.env.local`. En production, fournir les variables à Vercel au moment du build, puis servir `dist` en HTTPS.

Ne place jamais le secret Turnstile, un mot de passe SMTP, ni une clé `service_role` dans une variable `VITE_`, dans GitHub, ou dans le code navigateur. La désactivation de l’inscription ne supprime pas un utilisateur déjà créé : supprimer manuellement dans Authentication / Users tout compte que tu ne reconnais pas.

## Vérification avant utilisation du cloud

- Compte propriétaire : créer un projet; l’ouvrir sur un deuxième appareil connecté au même compte.
- Vérifier que les inscriptions publiques restent désactivées et qu’un visiteur ne peut pas consulter les projets.
- Éditer en même temps depuis deux appareils et vérifier la résolution explicite du conflit. Le bouton « Conserver les deux » crée des projets distincts; il ne fusionne pas les paragraphes.
- Couper Internet, modifier un script, puis rétablir la connexion. Le brouillon local doit être conservé et synchronisé ou signalé en conflit.
- Changer le mot de passe depuis « Mon compte », puis tester la déconnexion et la reconnexion avec le nouveau mot de passe avant de supprimer l’expéditeur.

## Sessions à distance

Depuis un script, ouvrir Télécommande et créer une session. Ouvrir le lien affiché dans le navigateur de l’iPad. L’application doit être accessible depuis l’iPad : une adresse `localhost` sur l’ordinateur n’est pas joignable depuis la tablette. Pour les essais réseau, ouvrir le studio par l’adresse réseau fournie par Vite; pour l’usage final, utiliser l’adresse HTTPS déployée.

Le lien contient un jeton aléatoire de 256 bits dans son fragment. Il donne un accès limité au script de la session pendant deux heures; il est révocable. La base conserve uniquement son empreinte. Le lecteur ne reçoit aucun accès aux autres projets et n’a pas besoin du mot de passe du compte. Une session est destinée à un lecteur; plusieurs lecteurs utilisant le même lien partageraient les confirmations.

Les commandes utilisent un numéro de séquence avec comparaison atomique. Le lecteur interroge le serveur toutes les 750 ms environ et confirme la dernière commande appliquée. Il défile localement. Un seul état de commande est conservé : des commandes successives très rapprochées peuvent être remplacées par la plus récente. La position est un paragraphe stable, pas un défilement en pixels. La navigation à l’intérieur d’un très long paragraphe reste à affiner.

La session utilise une version figée du contenu. Les réglages, la vitesse, la lecture, la pause et le repositionnement peuvent être commandés à distance. Pour charger une nouvelle révision, mettre le lecteur en pause, fermer la télécommande, modifier le document puis rouvrir Télécommande. Dans les sessions existantes, « Charger ce script » applique la version courante; le serveur exige un lecteur connecté, en pause et ayant confirmé la dernière commande. « Contrôler » permet de reprendre le pilotage d’une session existante. Le lecteur essaie de retrouver son paragraphe après remplacement du texte. La télécommande avec aperçu défilant et la navigation au caractère dans un paragraphe restent des évolutions supplémentaires.

En cas de coupure, une lecture en cours continue localement; au rétablissement de la connexion, le lecteur reste en pause et les anciennes commandes de lecture ne sont pas rejouées. La mise en arrière-plan met également en pause. Une session terminée coupe l’accès aux nouvelles commandes, mais ne peut pas effacer une copie déjà chargée dans le navigateur du lecteur.

## Exploitation

Activer et vérifier les sauvegardes de la base selon le plan Supabase retenu. Conserver une procédure de restauration testée. Les points de sauvegarde internes à un script sont limités aux 30 derniers et ne remplacent pas une sauvegarde de la base. Prévoir le nettoyage des sessions expirées et révoquées avant un usage prolongé : leurs snapshots contiennent encore le script.

Les connexions entre appareils sur le service hébergé et la compatibilité physique iOS 12.5.8 doivent être validées avec la configuration réelle. Les tests PostgreSQL embarqués couvrent les migrations et permissions, mais ne remplacent pas ces essais.

## Déployer sur Vercel

Importer le dépôt GitHub dans Vercel. Le fichier `vercel.json` fixe le framework Vite, la commande `npm run build` et le dossier de sortie `dist`. Le studio est servi à la racine, et le lecteur indépendant à `/lecteur.html`.

Pour activer la connexion et la télécommande, ajouter `VITE_SUPABASE_URL` et `VITE_SUPABASE_PUBLISHABLE_KEY` aux variables d’environnement du projet Vercel avant la compilation. Ajouter aussi `VITE_TURNSTILE_SITE_KEY` après avoir activé Turnstile dans Supabase. Seules les clés publiques sont destinées au navigateur; le secret Turnstile reste dans Supabase. Ajouter ensuite l’adresse HTTPS déployée aux URL autorisées dans Supabase Auth et vérifier la connexion sur iPhone et iPad.

Un déploiement sans ces variables propose le fonctionnement local sur chaque appareil; il ne synchronise pas les projets entre appareils. Les scripts stockés dans le navigateur ne font pas partie de la sauvegarde du code sur GitHub : utiliser « Exporter » pour en conserver une copie.

Documentation : https://vercel.com/docs/frameworks/frontend/vite
