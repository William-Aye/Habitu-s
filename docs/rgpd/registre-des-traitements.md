# Registre des traitements

Dernière mise à jour : 2026-10-30

Ce registre est la liste des traitements de données personnelles faits par Habitués (article 30 du RGPD). Il décrit la version 1 (Android). Il doit être relu à chaque nouvelle fonction qui touche aux données, et au moins une fois par an.

## Responsable de traitement

- Responsable : [NOM À COMPLÉTER], adresse [ADRESSE À COMPLÉTER] (même identité que dans les mentions légales).
- Contact pour les demandes sur les données : `confidentialite@<domaine>` (réponse sous un mois).
- Délégué à la protection des données : aucun désigné (non obligatoire pour ce service).
- Documents liés : `aipd.md` (analyse d'impact), `sous-traitants.md`, `violation-de-donnees.md`, `journal-des-incidents.md`, et la politique de confidentialité (`app/src/content/privacy.fr.ts`, affichée dans l'application et sur le site).

## Principes valables pour tous les traitements

- Minimisation : prénom seulement (jamais de nom de famille), pas de date de naissance (une case « 18 ans ou plus »), pas de genre.
- Pas de mot de passe. Connexion par code à 8 chiffres reçu par e-mail (valable 10 minutes) ou par Google. Un déclencheur de la base vide tout mot de passe qui serait enregistré.
- Position : jamais précise. La zone d'habitation est ramenée au centre de la commune. La position GPS est arrondie à environ 1 km sur le téléphone, sert à chercher des activités et n'est jamais enregistrée sur nos serveurs.
- Les centres d'intérêt et les activités suivies peuvent révéler des informations sensibles (article 9 : religion, santé, orientation, opinions). Ils ne sont jamais publics, seules les personnes d'une même activité voient l'appartenance, et ils ne sont jamais donnés à des annonceurs. La base légale de ce volet est traitée dans l'AIPD.
- Pas de traceur publicitaire tiers. Pas de publicité dans la version 1.
- Hébergement des données : Supabase, Union européenne (Paris). Chiffrement au repos et en transit.
- Suppression de compte immédiate par la personne, en cascade (Profil, « Mes données »).
- Une tâche nocturne (pg_cron) applique les durées de conservation ci-dessous. Les durées ci-dessous sont celles des migrations `20261024000032_retention.sql` et `20261023000027_chat.sql`.

## 1. Comptes et profils

- Finalité : créer et gérer le compte, connecter la personne, afficher un prénom et une présentation aux membres des mêmes activités.
- Base légale : exécution du contrat (conditions d'utilisation).
- Personnes concernées : utilisatrices et utilisateurs de 18 ans ou plus.
- Données : prénom, adresse e-mail ou compte Google (identifiant fourni par Google), confirmation « 18 ans ou plus », langue, zone d'habitation (centre de commune), photo de profil et présentation (facultatives), date de dernière visite (mise à jour au plus une fois par heure), date de création. L'e-mail est détenu par Supabase Auth, pas copié dans les tables de l'application.
- Photos : stockées sous un nom d'objet aléatoire ; `profiles.photo_url` contient ce nom d'objet, pas une adresse. Les métadonnées (EXIF, dont le lieu de prise de vue) sont retirées sur le téléphone avant l'envoi ; le serveur impose le type et la taille.
- Destinataires : l'équipe d'administration (accès restreint, double authentification obligatoire) ; les autres membres voient le prénom, la photo et la présentation uniquement dans une même activité.
- Sous-traitants : Supabase ; Google (connexion avec Google) ; Cloudflare (Turnstile à l'inscription).
- Transferts hors UE : Google et Cloudflare (États-Unis), encadrés par le cadre de protection des données UE–États-Unis ou des clauses contractuelles types (voir `sous-traitants.md`).
- Conservation : tant que le compte existe. Suppression immédiate à la demande. Compte inactif depuis 3 ans : avertissement à 35 mois (notification et message dans l'application), suppression 30 jours après si la personne n'est pas revenue. Les administrateurs ne sont jamais supprimés automatiquement. Un compte suspendu n'est pas averti ; il est supprimé après 36 mois et 30 jours d'inactivité.
- Mesures de sécurité : sécurité au niveau des lignes sur toutes les tables, testée ; session conservée dans le stockage sécurisé du téléphone (Android Keystore) ; la sauvegarde automatique Android est désactivée (`allowBackup` à faux) ; photos sous noms aléatoires, bucket avec limite de type et de taille ; limites d'écriture par personne.

## 2. Activités, séances et présences

- Finalité : publier des activités régulières, proposer des séances, rejoindre une activité, indiquer sa présence, organiser avec d'autres.
- Base légale : exécution du contrat.
- Personnes concernées : membres, organisatrices et organisateurs, personnes qui demandent à rejoindre.
- Données : activités (titre, description, catégorie, lieu public de rendez-vous), séances (date, lieu), appartenance à une activité, présences et absences déclarées, collectifs et invitations, centres d'intérêt, recherches enregistrées (table existante, non exposée dans l'application de la version 1).
- Pages publiques : chaque activité en cours a une page publique (titre, description, catégorie, ville ou lieu, prochaine séance, nombre de personnes confirmées, organisateur). Aucun nom ni aucune photo de membre n'y figure ; le prénom de l'organisateur n'est visible que des personnes connectées.
- Destinataires : les membres de l'activité ; le public pour la page de l'activité (sans donnée de membre) ; l'équipe d'administration.
- Sous-traitants : Supabase ; Cloudflare (hébergement des pages) ; OpenStreetMap Overpass et geo.api.gouv.fr (requêtes sans donnée de compte, voir `sous-traitants.md`).
- Transferts hors UE : Cloudflare (États-Unis), encadré comme ci-dessus.
- Conservation : tant que l'activité existe ou que le compte existe ; à la suppression du compte, les activités organisées sont supprimées avec leurs séances, présences et messages. Les compteurs agrégés (statistiques de fréquentation) ne contiennent aucune donnée personnelle.
- Mesures de sécurité : sécurité au niveau des lignes ; aucun point d'accès ne liste des personnes ; les listes de membres ne sont lisibles que par les membres ; blocage entre personnes ; limites de création par jour.

## 3. Discussion de groupe (chat)

- Finalité : permettre aux membres d'une même activité d'échanger.
- Base légale : exécution du contrat.
- Personnes concernées : membres d'une activité.
- Données : messages de groupe, auteur, date. Journal d'envoi pour limiter le débit (conservé 1 heure).
- Destinataires : les membres de l'activité ; l'équipe d'administration uniquement lorsqu'un message est signalé (une copie est alors jointe au signalement).
- Sous-traitants : Supabase ; Expo et Google Firebase Cloud Messaging pour les notifications de nouveaux messages (texte générique, sans contenu du message).
- Transferts hors UE : Expo et Google (États-Unis), encadrés comme ci-dessus.
- Conservation : 12 mois, puis suppression automatique (`20261023000027_chat.sql`). Copie jointe à un signalement : 3 ans après la décision, comme le signalement.
- Mesures de sécurité : seuls les membres lisent et écrivent ; un blocage coupe les échanges ; mots interdits et limites de débit ; messages supprimés avec le compte.

## 4. Sécurité et modération

- Finalité : traiter les signalements, bloquer les abus, suspendre les comptes qui ne respectent pas les règles, tracer les actions de l'équipe, répondre aux obligations de transparence du règlement sur les services numériques (exposé des motifs).
- Base légale : intérêt légitime (sécurité du service et des personnes) ; obligation légale pour les informations sur les décisions de modération.
- Personnes concernées : personnes qui signalent, personnes signalées, personnes qui revendiquent une association, personnes qui nous écrivent.
- Données :
  - signalements : motif, précisions écrites, élément visé, copie du message signalé, décision, date et motif de la décision ;
  - journal d'administration : qui a fait quoi et quand ;
  - revendications d'association : rôle, e-mail de l'association ou justificatif (statuts, récépissé, lettre signée) dans un espace privé ;
  - formulaire « Une idée ? Un problème ? » : message, type, version de l'application, type d'appareil, capture d'écran facultative (personnes connectées) ;
  - blocages entre personnes ;
  - pour l'envoi sans compte : l'adresse IP est envoyée à Cloudflare Turnstile pour la vérification anti-robot, et une empreinte à clé (HMAC) de cette adresse est gardée en mémoire de la fonction au plus une heure pour limiter le débit. Aucune adresse IP n'est enregistrée dans la base ni dans un journal de notre code.
- Destinataires : équipe d'administration (double authentification). La personne qui signale et la personne concernée reçoivent l'information de modération qui les concerne.
- Sous-traitants : Supabase ; Cloudflare (Turnstile).
- Transferts hors UE : Cloudflare (États-Unis), encadré comme ci-dessus.
- Conservation :
  - signalements, copies de messages et décisions : 3 ans après la décision (ou après la création si le signalement reste ouvert), puis suppression ;
  - journal d'administration : 3 ans ;
  - idées et problèmes envoyés et leur capture d'écran : 2 ans ;
  - revendications en attente : supprimées au bout d'un an avec leur justificatif ; revendications décidées : la ligne reste tant que l'association reste vérifiée, le justificatif et l'e-mail de contact sont supprimés un an après la décision ;
  - fichiers sans rattachement (formulaires abandonnés) : supprimés après 7 jours ;
  - journaux de limitation de débit : 1 jour ; journal d'invitations : 2 jours.
- Mesures de sécurité : accès administrateur réservé à une session à double authentification (aal2) ; chaque action d'administration est journalisée ; espaces privés pour justificatifs et captures ; types et tailles de fichiers imposés par le serveur ; limites par personne et plafond global sur l'envoi sans compte.

## 5. Import de l'annuaire public d'associations

- Finalité : alimenter l'annuaire des associations à partir de sources publiques (répertoire national des associations et OpenStreetMap), sans saisie par les personnes.
- Base légale : intérêt légitime (réutilisation d'informations publiques sur des personnes morales) ; données ouvertes publiées pour être réutilisées.
- Personnes concernées : associations (personnes morales) ; indirectement les personnes dont le nom figurerait dans une raison sociale publique.
- Données : nom, objet, adresse, commune, catégories, coordonnées publiques de l'association. Le cache de géocodage et les journaux d'import ne contiennent aucune donnée personnelle de membres.
- Destinataires : le public (annuaire).
- Sous-traitants : GitHub (le travail planifié d'import tourne sur GitHub Actions et écrit dans la base) ; Supabase.
- Transferts hors UE : GitHub (États-Unis), encadré comme ci-dessus.
- Conservation : tant que la source publique les publie et que l'association est active ; mise à jour à chaque import.
- Mesures de sécurité : le travail d'import utilise une clé stockée dans les secrets GitHub, jamais dans le dépôt ; schéma dédié ; analyse des secrets et protection des branches sur le dépôt.

## 6. Site web et journaux de sécurité

- Finalité : pages publiques (accueil, activités, associations, mentions légales, conditions, confidentialité), version web de l'application sous /app, sécurité et bon fonctionnement.
- Base légale : intérêt légitime (sécurité) ; la session sur le site est strictement nécessaire au service, donc sans consentement.
- Personnes concernées : visiteuses et visiteurs.
- Données : adresse IP, page demandée et date dans les journaux techniques de Cloudflare et de Supabase ; session de connexion dans le stockage du navigateur (localStorage) pour les personnes connectées ; aucun cookie sur les pages publiques ; script Cloudflare Turnstile sur la page d'inscription et le formulaire sans compte.
- Destinataires : l'équipe technique.
- Sous-traitants : Cloudflare (Pages, DNS, Turnstile) ; Supabase.
- Transferts hors UE : Cloudflare (États-Unis), encadré comme ci-dessus.
- Conservation : durée par défaut de l'hébergeur, au plus 90 jours ; session effacée à la déconnexion.
- Mesures de sécurité : en-têtes de sécurité (HSTS, CSP, interdiction d'être affiché dans un cadre, politique de référent stricte) ; règles WAF et protection contre les robots chez Cloudflare ; DNSSEC ; pas de traceur.

## 7. Notifications

- Finalité : rappels de séance, nouveaux membres, invitations, informations de modération, avertissement avant suppression d'un compte inactif.
- Base légale : exécution du contrat ; la personne peut les refuser ou les couper dans les réglages du téléphone.
- Personnes concernées : personnes qui ont activé les notifications.
- Données : identifiant de notification du téléphone (jeton), plateforme, texte de la notification, état d'envoi. Les notifications sont génériques : aucun nom d'activité ni prénom, les détails ne s'affichent que dans l'application.
- Destinataires : le téléphone de la personne.
- Sous-traitants : Supabase ; Expo (relais) ; Google Firebase Cloud Messaging (Android).
- Transferts hors UE : Expo et Google (États-Unis), encadrés comme ci-dessus.
- Conservation : jeton tant que la personne est connectée sur l'appareil, supprimé à la déconnexion ou à la suppression du compte ; notifications : 30 jours sur nos serveurs après leur envoi (ou leur échec), puis supprimées.
- Mesures de sécurité : le jeton n'est lisible que par son propriétaire ; l'envoi passe par une fonction serveur protégée par une clé secrète ; textes sans donnée personnelle.

## Fonctions prévues plus tard

Des traitements supplémentaires sont envisagés après la première version (par exemple la publicité, des retours après séance, la vérification de téléphone, des messages privés). Ils ne sont pas actifs et ne sont donc pas décrits ici. Chacun devra être ajouté à ce registre, à l'AIPD, à la politique de confidentialité et, si besoin, aux conditions avant sa mise en service.
