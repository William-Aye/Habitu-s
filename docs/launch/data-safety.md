# Réponses au formulaire « Sécurité des données » (Google Play)

Dernière mise à jour : 2026-10-30

Ce document donne, question par question, les réponses à saisir dans la Play Console, rubrique « Contenu de l'application », « Sécurité des données ». Elles viennent du code de la version 1 (Android) et du registre des traitements (`docs/rgpd/registre-des-traitements.md`). Si une fonction change, relire ce document avant de publier la mise à jour. Les réponses doivent rester identiques à la politique de confidentialité (`<WEB_BASE_URL>/confidentialite`).

## Questions générales

| Question | Réponse | Pourquoi |
|---|---|---|
| L'application collecte-t-elle ou partage-t-elle des données utilisateur ? | Oui | Compte, profil, activités, messages ; la position approximative est partagée (voir plus bas). |
| Toutes les données sont-elles chiffrées en transit ? | Oui | Toutes les connexions passent par HTTPS (Supabase, Cloudflare). |
| Proposez-vous un moyen de demander la suppression des données ? | Oui | Dans l'application : Profil, « Mes données », « Supprimer mon compte » (immédiat, en cascade). Sur le web : `<WEB_BASE_URL>/app/profile`. |
| Adresse de suppression à saisir | `<WEB_BASE_URL>/app/profile` | Même adresse que dans `store-listing.fr.md`. |
| Application destinée aux enfants (Families Policy) ? | Non | Réservée aux 18 ans et plus. |
| Examen de sécurité indépendant (MASA) | Non | Pas fait. |

## Données collectées

Pour chaque ligne : « Collectée » = oui ; « Partagée » = non, sauf pour « Position approximative » qui est aussi « Partagée » = oui ; « Traitement éphémère » = non ; obligatoire ou facultatif comme indiqué ; finalité cochée comme indiqué. Aucune donnée n'est utilisée pour la publicité, le marketing ou l'analyse.

| Catégorie Google | Type | Collectée | Obligatoire ? | Finalité | D'où vient la donnée dans le code |
|---|---|---|---|---|---|
| Informations personnelles | Adresse e-mail | Oui | Obligatoire pour créer un compte (la navigation sans compte reste possible) | Fonctionnalités de l'application ; gestion du compte | Connexion par code ou compte Google ; conservée par Supabase Auth |
| Informations personnelles | Nom | Oui | Obligatoire pour créer un compte | Fonctionnalités de l'application ; gestion du compte | Prénom seulement, jamais de nom de famille |
| Informations personnelles | Identifiants utilisateur | Oui | Obligatoire | Fonctionnalités de l'application ; gestion du compte | Identifiant interne du compte ; identifiant Google si connexion avec Google |
| Position | Position approximative | Oui, et partagée (voir « Données partagées ») | Facultatif | Fonctionnalités de l'application | Zone d'habitation ramenée au centre de la commune et enregistrée ; la position GPS, arrondie à environ 1 km sur le téléphone, sert à chercher et n'est jamais enregistrée sur nos serveurs. Pas de position précise (la permission de position précise est bloquée dans `app.json`). |
| Photos et vidéos | Photos | Oui | Facultatif | Fonctionnalités de l'application | Photo de profil ; capture d'écran jointe à un message « Une idée ? Un problème ? ». Métadonnées retirées sur le téléphone avant l'envoi. |
| Fichiers et documents | Fichiers et documents | Oui | Facultatif | Fonctionnalités de l'application | Justificatif joint par une association qui revendique sa fiche (PDF, JPEG, PNG), dans un espace privé lisible seulement par l'équipe de modération |
| Messages | Autres messages dans l'application | Oui | Facultatif | Fonctionnalités de l'application | Messages de la discussion de groupe d'une activité (conservés 12 mois) ; message « Une idée ? Un problème ? » |
| Activité dans l'application | Interactions avec l'application | Oui | Obligatoire pour utiliser les fonctions de compte | Fonctionnalités de l'application | Activités rejointes, présences « Je serai là », centres d'intérêt, blocages et signalements |
| Activité dans l'application | Autre contenu généré par l'utilisateur | Oui | Facultatif | Fonctionnalités de l'application | Activités, séances, présentation de profil, collectifs créés par la personne |
| Identifiants d'appareil ou autres identifiants | Identifiants d'appareil ou autres | Oui | Facultatif (seulement si les notifications sont acceptées) | Fonctionnalités de l'application | Jeton de notification (Firebase Cloud Messaging, via le service de notifications d'Expo), supprimé à la déconnexion et à la suppression du compte |
| Infos et performances de l'appli | Diagnostics | Oui | Facultatif | Fonctionnalités de l'application | Version de l'application et type d'appareil, joints seulement lorsqu'une personne envoie un message « Une idée ? Un problème ? » |

## Données non collectées

Répondre « non » pour : adresse postale, numéro de téléphone, origine ethnique, orientation sexuelle, convictions, informations financières (aucun paiement), santé et forme physique, contacts, agenda (l'ajout d'une séance à l'agenda passe par l'application agenda du téléphone ; la permission de lecture ou d'écriture de l'agenda est bloquée), audio, position précise, historique de navigation, historique de recherche enregistré côté serveur (la table existe mais n'est pas utilisée par la version 1), liste des applications installées, et SMS.

Remarque : les centres d'intérêt et les activités suivies peuvent révéler des informations sensibles (religion, santé, orientation, opinions). Ils sont rangés dans « Activité dans l'application » parce que Google n'a pas de case dédiée. Ils ne sont jamais publics et jamais donnés à des annonceurs (voir l'analyse d'impact `docs/rgpd/aipd.md`).

## Journaux de plantage

Le code de l'application n'embarque aucun outil de rapport de plantage ni d'analyse (ni Sentry, ni Firebase Crashlytics, ni Firebase Analytics, ni aucun autre ; vérifié dans `app/package.json`). Répondre donc « non » à « Journaux de plantage ». Pour « Diagnostics » : oui, uniquement via le message de retour (version de l'application et type d'appareil joints à « Une idée ? Un problème ? »), comme dans la ligne du tableau ci-dessus. Les statistiques « Android vitals » de la Play Console viennent des appareils dont le propriétaire a activé leur partage avec Google ; ce n'est pas une collecte de l'application et il n'y a rien à déclarer pour elles. Si un outil de plantage est ajouté un jour, ce document, la politique de confidentialité et le registre devront être mis à jour avant la mise en ligne.

## Données partagées

Réponse unique à saisir : une seule catégorie est partagée, « Position approximative », avec la finalité « Fonctionnalités de l'application ». Cocher « Collectée » et « Partagée » pour cette ligne. Pour toutes les autres catégories, « Partagée » reste non.

Destinataires de la position approximative (aucun identifiant de compte n'est envoyé à l'un ni à l'autre) :

- geo.api.gouv.fr (service public français) : reçoit la position arrondie à environ 1 km, pour trouver la commune, et les noms de ville tapés dans la recherche.
- OpenStreetMap, service Overpass : reçoit les coordonnées arrondies d'un lieu pour vérifier qu'un lieu public est proche, et reçoit aussi l'adresse IP du téléphone.

Ces deux services ne sont pas des sous-traitants, c'est pourquoi la position est déclarée comme partagée. La politique de confidentialité (fr et en) nomme déjà les deux services, avec ces données : les réponses du formulaire et la politique disent la même chose.

Ne sont pas du partage au sens de Google : Supabase (hébergement de la base, de la connexion et des fichiers), Cloudflare (pages web, vérification anti-robot Turnstile), Expo et Google Firebase Cloud Messaging (acheminement des notifications) agissent comme sous-traitants pour notre compte, avec un accord de traitement (`docs/rgpd/sous-traitants.md`). Aucune publicité, aucun courtier de données, aucun partage à des fins commerciales.

## Sécurité des pratiques

- Chiffrement en transit : oui.
- Suppression demandée par la personne : oui, depuis l'application et depuis le web.
- Engagement de suivre la politique « Familles » : non (application pour adultes).

## Avant d'envoyer le formulaire

1. Relire le tableau face à `docs/rgpd/registre-des-traitements.md`.
2. Vérifier que la politique de confidentialité en ligne cite les mêmes données.
3. Enregistrer une copie d'écran du formulaire validé dans le dossier de suivi du lancement.
