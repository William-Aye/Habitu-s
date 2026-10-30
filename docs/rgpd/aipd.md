# Analyse d'impact relative à la protection des données (AIPD)

Dernière mise à jour : 2026-10-30

Cette analyse suit l'ordre de l'outil PIA de la CNIL : contexte, principes fondamentaux, risques, puis mesures. Elle est faite parce que Habitués combine des données de localisation approximative, des centres d'intérêt qui peuvent révéler des informations sensibles et des rencontres entre personnes qui ne se connaissent pas. Elle porte sur la première version (Android). Elle doit être refaite si un traitement change de nature (publicité, messages privés, vérification de téléphone, application iPhone).

Responsable : [NOM À COMPLÉTER]. Avis du délégué à la protection des données : aucun délégué désigné. Avis des personnes concernées : à recueillir pendant le test fermé avant le lancement public.

## 1. Contexte

### Ce que fait le traitement

Habitués aide des adultes à trouver des associations et des activités régulières près de chez eux, à les rejoindre, et à rencontrer des gens autour de ces activités. Les principaux traitements sont décrits dans `registre-des-traitements.md` : comptes, activités et séances, discussion de groupe, sécurité et modération, annuaire public, site web, notifications.

### Données traitées

Prénom, e-mail ou compte Google, confirmation « 18 ans ou plus », zone d'habitation au niveau de la commune, photo et présentation facultatives, centres d'intérêt et activités suivies, présences, messages de groupe, signalements, jeton de notification. Aucune date de naissance, aucun nom de famille, aucun mot de passe, aucune position précise enregistrée.

### Supports

Application Android, site web et version web de l'application (Cloudflare Pages), base de données et fichiers chez Supabase (UE, Paris), notifications via Expo et Google Firebase Cloud Messaging, code et travail d'import sur GitHub. La liste complète est dans `sous-traitants.md`.

### Pourquoi une AIPD

- Données pouvant révéler des informations sensibles par déduction (religion, santé, orientation, opinions, à travers les associations suivies).
- Public potentiellement vulnérable (personnes isolées qui cherchent à rencontrer du monde).
- Rencontres physiques entre inconnus, avec un risque de harcèlement ou de danger.
- Croisement de zone géographique et d'horaires réguliers.

## 2. Principes fondamentaux

### Finalités, bases légales, minimisation

| Sujet | Réponse |
|---|---|
| Finalités | Déterminées, explicites, listées dans le registre. Aucune réutilisation commerciale. |
| Bases légales | Exécution du contrat pour le service ; intérêt légitime pour la sécurité et la modération . Pour les centres d'intérêt à caractère sensible : la personne les choisit elle-même et ils ne servent qu'au service (voir ci-dessous). |
| Minimisation | Prénom seul, pas de date de naissance, position arrondie et non enregistrée, zone d'habitation ramenée au centre de la commune. Fichier d'export limité aux données de la personne. |
| Exactitude | La personne corrige son profil elle-même. |
| Conservation | Durées courtes et automatiques (voir le registre) : 12 mois pour les messages, 3 ans pour les signalements, 2 ans pour les idées et problèmes, 30 jours pour les notifications, journaux techniques selon la durée par défaut des hébergeurs (au plus 90 jours chez Supabase). |

Remarque sur les données sensibles : les centres d'intérêt et les activités suivies ne sont jamais publics. Seules les personnes d'une même activité voient l'appartenance. Ils ne sont jamais donnés à des annonceurs ni utilisés pour la publicité. La personne les saisit volontairement. Aucune catégorie particulière de données n'est demandée directement.

### Droits des personnes

| Droit | Comment |
|---|---|
| Information | Politique de confidentialité en français et en anglais, affichée à l'inscription (lien) et dans Profil ; conditions d'utilisation sur le site. |
| Accès et portabilité | Profil, « Mes données », « Télécharger mes données » : fichier avec toutes les données de la personne et rien sur les autres. |
| Rectification | Profil : prénom, présentation, photo, ville. |
| Effacement | Profil, « Mes données », « Supprimer mon compte » : immédiat, définitif, en cascade. |
| Opposition, limitation | Par e-mail à `confidentialite@<domaine>`, réponse sous un mois. |
| Réclamation | CNIL (www.cnil.fr), rappelée dans la politique de confidentialité. |
| Contestation d'une décision de modération | Par e-mail, avec exposé des motifs fourni à la personne. |

### Sous-traitants et transferts

Cinq sous-traitants principaux (Supabase, Cloudflare, Google, Expo, GitHub), chacun avec un accord de traitement (DPA) et, pour les transferts hors Union européenne, le cadre de protection des données UE–États-Unis ou des clauses contractuelles types. Voir `sous-traitants.md`. Les données de compte restent en Union européenne (Paris).

## 3. Risques

Pour chaque risque : sources, impacts, vraisemblance et gravité avant et après mesures. Échelle : négligeable, limitée, importante, maximale.

### 3.1 Accès illégitime à des données

Ce que la personne pourrait subir : harcèlement ou suivi par une personne qui apprendrait où elle vit ou quand elle sort ; révélation de ses centres d'intérêt à des tiers ; usurpation de compte ; atteinte à la vie privée.

Sources de risque : une autre personne inscrite qui cherche à pister quelqu'un ; un attaquant extérieur qui vise la base ou l'API ; un compte volé ; un administrateur malveillant ; un sous-traitant compromis ; un appareil perdu ou partagé.

| | Avant mesures | Après mesures |
|---|---|---|
| Vraisemblance | Importante | Limitée |
| Gravité | Importante | Limitée |

Mesures en place :

- Sécurité au niveau des lignes sur toutes les tables, testée à chaque modification (tests pgTAP dans `supabase/tests/`). Aucun point d'accès ne liste des personnes ; la recherche renvoie des associations et des activités, jamais des personnes.
- Accès anonyme limité : l'API anonyme ne lit ni les membres ni les identifiants de personnes (migrations `20261029000038_hide_welcome_member.sql`, `20261029000040_no_person_ids_for_anon.sql`) ; la vérification après déploiement est faite par `scripts/smoke.mjs`.
- Photos stockées sous un nom d'objet aléatoire et non devinable (`20261029000039_avatar_names.sql`) ; `profiles.photo_url` contient ce nom, pas une adresse publique.
- Pas de mot de passe à voler ou à réutiliser : code à 8 chiffres valable 10 minutes ou Google ; un déclencheur vide tout mot de passe (`20261029000048_auth_hardening.sql`) ; Turnstile et limites de débit sur l'envoi du code.
- Administration protégée par double authentification (aal2), chaque action journalisée (`20261024000029_admin_security.sql`) ; journal conservé 3 ans.
- Position jamais précise : zone d'habitation au centre de la commune, GPS arrondi sur le téléphone et jamais enregistré. Pages publiques d'activités sans nom ni photo de membre (`20261024000036_web_pages.sql`).
- Appareil : session dans le stockage sécurisé Android, `allowBackup` à faux (pas de copie dans la sauvegarde Android), EXIF retiré avant envoi d'une photo.
- Site : en-têtes de sécurité (HSTS, CSP, aucun cadre), contrôle de l'échappement du HTML ; analyse du code et des dépendances en continu (CodeQL, `npm audit`, Dependabot, analyse des secrets) ; relecture de sécurité avant lancement (`docs/security/2026-11-review.md`).
- Chiffrement au repos et en transit chez Supabase ; clé de service jamais dans l'application ni dans le dépôt.

Risque résiduel : un membre d'une même activité voit le prénom et la photo des autres membres (c'est le but du service) ; un compte Google ou une boîte e-mail piratés donnent accès au compte. Acceptable : données peu sensibles, aucune adresse ni position précise.

### 3.2 Modification non désirée des données

Ce que la personne pourrait subir : activité ou séance falsifiée (lieu déplacé vers un endroit non public), faux profil, messages usurpés, présences modifiées, décisions de modération altérées.

Sources : un membre malveillant, un compte volé, un organisateur qui change une séance, un administrateur, une injection dans l'API.

| | Avant mesures | Après mesures |
|---|---|---|
| Vraisemblance | Importante | Limitée |
| Gravité | Importante | Limitée |

Mesures en place :

- Les règles de la base n'autorisent que le propriétaire (ou l'organisateur) à modifier ses données ; chaque règle est testée.
- Lieux publics uniquement : vérification qu'un lieu public se trouve à proximité à la publication d'une activité ou au déplacement d'une séance ; conseil de sécurité affiché quand le lieu change.
- Limites de modification des séances (`20261029000041_session_change_limits.sql`), limites de création par jour, mots interdits, longueur et contrôle du prénom (`20261029000046_first_name_checks.sql`), contrôle des jetons de notification.
- Les comptes suspendus n'écrivent plus (`20261029000044_banned_writes.sql`).
- Les actions d'administration sont journalisées (qui, quoi, quand).
- Signalement et blocage disponibles pour toute personne ; exposé des motifs et possibilité de contester.

Risque résiduel : une fausse activité peut exister brièvement avant d'être signalée. Acceptable : le rendez-vous reste dans un lieu public, avec rappels de sécurité.

### 3.3 Disparition des données

Ce que la personne pourrait subir : perte de son compte, de ses activités, de l'historique de ses groupes ; impossibilité de prouver une décision de modération.

Sources : panne ou erreur de l'hébergeur, suppression par erreur, rançongiciel, erreur de migration.

| | Avant mesures | Après mesures |
|---|---|---|
| Vraisemblance | Limitée | Limitée |
| Gravité | Limitée | Limitée |

Mesures en place :

- Sauvegarde quotidienne de la base (Supabase Pro) et procédure de restauration, avec un script de preuve de restauration (`scripts/restore-check.sh`, `docs/ops/backup-restore.md`) à rejouer chaque trimestre et avant le lancement.
- Les photos et justificatifs ne sont pas dans les sauvegardes de la base : leur perte est acceptable (la personne peut renvoyer une photo).
- Suppressions automatiques bornées et testées ; suppression de compte confirmée par la personne.
- Code et migrations versionnés sur GitHub, branche principale protégée.

Risque résiduel : jusqu'à un jour de données récentes en cas de restauration. Acceptable : les conséquences sont limitées pour un service de rencontres associatives.

## 4. Autres risques propres au service

- Danger physique lors d'une rencontre : hors du champ des données mais traité par le service (lieux publics, conseils de sécurité avant la première séance, partage du programme, signalement, blocage, modération, rappel dans les conditions d'utilisation).
- Mineurs : service réservé aux 18 ans et plus (case de confirmation, pas de date de naissance) ; un compte appartenant à un mineur est supprimé dès qu'il est connu.
- Fuite complète de la base : elle exposerait prénoms, e-mails, zones au niveau de la commune, activités suivies et messages de groupe des 12 derniers mois ; pas de mot de passe, pas d'adresse précise, pas de date de naissance.

## 5. Plan d'action et validation

| Action | Responsable | Quand |
|---|---|---|
| Appliquer les réglages du projet hébergé décrits dans le README (double authentification, réglages d'authentification) | Propriétaire | Avant le lancement |
| Accepter les accords de traitement (voir `sous-traitants.md`) | Propriétaire | Avant le lancement |
| Prouver une restauration de sauvegarde | Propriétaire | Avant le lancement, puis chaque trimestre |
| Faire relire la politique de confidentialité et les conditions par une personne qualifiée | Propriétaire | Avant le lancement |
| Recueillir l'avis des testeurs sur la clarté des informations | Propriétaire | Pendant le test fermé |
| Refaire cette analyse avant toute nouvelle fonction qui change les données | Propriétaire | À chaque évolution |

Conclusion : après mesures, les trois risques sont jugés acceptables pour la première version, sous réserve de la réalisation des actions ci-dessus. Validation par le responsable de traitement ([NOM À COMPLÉTER]) avant le lancement public.
