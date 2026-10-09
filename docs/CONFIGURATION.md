# Activer les comptes, le cloud et la télécommande

Le fonctionnement local est disponible immédiatement. Les fonctions cloud utilisent un vrai projet Supabase; aucun compte fictif ni base publique de démonstration n’est fourni.

1. Créer ou choisir un projet Supabase.
2. Dans SQL Editor, appliquer dans l’ordre les fichiers `supabase/migrations/001_workspace.sql`, `002_reading_sessions.sql`, puis `003_session_maintenance.sql` (maintenance du service Supabase hébergé). Ces migrations sont également compatibles avec le suivi de migrations du CLI Supabase. Les appliquer une seule fois dans une base vierge; ne pas modifier une migration déjà déployée.
3. Copier `.env.example` en `.env.local`, puis renseigner l’URL du projet et sa clé publique publishable. Ne jamais mettre une clé secrète ou `service_role` dans une variable `VITE_` : ces valeurs sont intégrées au navigateur.
4. Dans Authentication / URL Configuration, définir l’URL du site. Autoriser l’origine de développement et celle de production, avec les routes de retour nécessaires, notamment `/#nouveau-mot-de-passe`.
5. Activer l’authentification courriel/mot de passe et la confirmation de courriel. Configurer l’expéditeur SMTP pour les confirmations et récupérations. Vérifier la délivrabilité avec une adresse de test.
6. Pour le site personnel public, désactiver **Allow new users to sign up** dans Authentication / Sign In / Providers et désactiver les connexions anonymes. Garder uniquement les comptes que tu reconnais dans Authentication / Users; ces réglages bloquent les nouvelles inscriptions côté serveur, y compris les appels directs à l’API.
7. Supabase Auth applique déjà des limites de débit par adresse IP. Dans ce projet, le seuil « sign-ups and sign-ins » est abaissé à 10 requêtes par 5 minutes. Vérifier cette valeur dans Authentication / Rate Limits et protéger le compte propriétaire avec un mot de passe unique et l’authentification multifacteur.
8. La prise en charge Cloudflare Turnstile est ajoutée à l’application, mais la protection CAPTCHA Supabase ne peut être activée qu’après création d’un site Turnstile et ajout de ses clés dans Cloudflare, Supabase et Vercel. La clé secrète doit rester uniquement dans Supabase; la clé de site publique va dans `VITE_TURNSTILE_SITE_KEY` sur Vercel.
9. Redémarrer `npm run dev` après l’ajout de `.env.local`. En production, fournir les variables à Vercel au moment du build, puis servir `dist` en HTTPS.

## Vérification avant utilisation du cloud

- Pour l’utilisation personnelle, ne pas créer de comptes publics de test. Vérifier que le propriétaire peut se connecter et récupérer son mot de passe.
- Vérifier séparément avec les tests automatisés que les politiques isolent les espaces entre comptes; conserver l’inscription désactivée sur le projet de production.
- Vérifier qu’un appel direct d’inscription est refusé par Supabase, et pas seulement caché dans l’interface.
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

Activer et vérifier les sauvegardes de la base selon le plan Supabase retenu. Conserver une procédure de restauration testée. Les points de sauvegarde internes à un script sont limités aux 30 derniers et ne remplacent pas une sauvegarde de la base. La migration `003_session_maintenance.sql` active un nettoyage horaire des sessions expirées ou révoquées et conserve sept jours de journaux pour cette tâche. Les projets et l’historique des scripts ne sont pas supprimés. Vérifier les exécutions dans Integrations / Cron. Cette migration utilise `pg_cron` et vise le service Supabase hébergé.

Les parcours de courriel, les connexions entre appareils sur le service hébergé et la compatibilité physique iOS 12.5.8 doivent être validés avec la configuration réelle. Les tests PostgreSQL embarqués couvrent les migrations et permissions, mais ne remplacent pas ces essais.

## Déployer sur Vercel

Importer le dépôt GitHub dans Vercel. Le fichier `vercel.json` fixe le framework Vite, la commande `npm test && npm run build` et le dossier de sortie `dist`. Le studio est servi à la racine, et le lecteur indépendant à `/lecteur.html`.

Pour activer la connexion et la télécommande, ajouter `VITE_SUPABASE_URL` et `VITE_SUPABASE_PUBLISHABLE_KEY` aux variables d’environnement du projet Vercel avant la compilation. Ajouter `VITE_TURNSTILE_SITE_KEY` seulement après avoir créé et configuré Turnstile dans Supabase. Seules les clés publiques sont destinées au navigateur; le secret Turnstile reste dans Supabase. Ajouter ensuite l’adresse HTTPS déployée aux URL autorisées dans Supabase Auth et vérifier la connexion, la récupération et l’accès iPhone/iPad.

Un déploiement sans ces variables propose le fonctionnement local sur chaque appareil; il ne synchronise pas les projets entre appareils. Les scripts stockés dans le navigateur ne font pas partie de la sauvegarde du code sur GitHub : utiliser « Exporter » pour en conserver une copie.

Documentation : https://vercel.com/docs/frameworks/frontend/vite

## Configuration de production — 7 octobre 2026

- Site : https://souffle-chi.vercel.app
- Projet Supabase dédié : `faqtxhowyeqzeailpfct`, région Canada Central.
- Migrations 001, 002 et 003 appliquées; RLS activée sur les deux tables.
- Variables publiques Supabase configurées dans l’environnement **Production** de Vercel. Aucune clé secrète n’est incluse dans le navigateur.
- Site URL Supabase : `https://souffle-chi.vercel.app`.
- Retours autorisés : `https://souffle-chi.vercel.app/` et `https://souffle-chi.vercel.app/#nouveau-mot-de-passe`.
- Inscription publique désactivée dans Supabase; connexions anonymes désactivées; confirmation de courriel maintenue pour les comptes existants.
- Limite Auth « sign-ups and sign-ins » abaissée à 10 requêtes par 5 minutes et par adresse IP.
- CAPTCHA Turnstile non activé : un compte Cloudflare/site key et son secret Supabase sont encore nécessaires.
- Tests transactionnels sur le serveur : sauvegarde, isolation entre comptes, conflits de révision et de séquence, accès au lecteur par jeton, révocation et remplacement du snapshot. Les données de test ont été annulées.

L’expéditeur SMTP personnalisé reste à configurer. Le service de courriel Supabase par défaut est limité aux adresses des membres du projet et sert aux essais; il ne constitue pas un expéditeur de production. Voir [la documentation Supabase SMTP](https://supabase.com/docs/guides/auth/auth-smtp). Valider l’inscription, la récupération de mot de passe et les essais entre appareils après cette configuration. Aucune sauvegarde externe automatique de la base n’est encore configurée; exporter régulièrement les projets depuis Souffle.
