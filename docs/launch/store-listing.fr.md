# Fiche Google Play (français)

Dernière mise à jour : 2026-10-30

Ce document contient tous les textes à copier dans la Play Console, rubrique « Présence sur le Store », « Fiche Play Store principale ». Rien ici ne promet une fonction absente de la version 1 : pas de messages privés, pas de badges, pas d'application iPhone, pas de publicité.

## Identité

- Nom de l'application : Habitués
- Nom du paquet : `fr.habitues.app`
- Catégorie : Social
- Langue par défaut : français (France)
- E-mail de contact (champ obligatoire) : la même adresse que `PRIVACY_CONTACT` dans `app/src/content/contact.ts` (aujourd'hui encore le texte provisoire `confidentialite@<domaine>`, à remplacer avant de remplir la fiche)
- Site web : `<WEB_BASE_URL>`
- Politique de confidentialité : `<WEB_BASE_URL>/confidentialite`
- Conditions d'utilisation (à citer dans la description si besoin) : `<WEB_BASE_URL>/conditions`
- Suppression de compte, adresse demandée par Google : `<WEB_BASE_URL>/app/profile` (version web de l'onglet Profil, section « Mes données », bouton « Supprimer mon compte »). Il faut être connecté pour l'utiliser ; la politique de confidentialité et l'adresse de contact donnent l'autre voie. Dans l'application : Profil, « Mes données », « Supprimer mon compte ».
- Âge : 18 ans et plus (voir `content-rating.md`).

`<WEB_BASE_URL>` est l'adresse publique du site, sans barre oblique finale (la même valeur que la variable `WEB_BASE_URL` de Cloudflare Pages).

## Titre (30 caractères au plus)

Habitués : activités proches

## Description courte (80 caractères au plus)

Trouvez des activités régulières et des associations près de chez vous.

## Description complète (4 000 caractères au plus)

Se faire des amis, ce n'est pas un rendez-vous unique : c'est se retrouver, semaine après semaine, au même endroit, avec les mêmes personnes. Habitués vous aide à trouver ce rendez-vous régulier près de chez vous.

Habitués, c'est trois choses.

1. DES GROUPES QUI SE RETROUVENT RÉGULIÈREMENT

Un club de go le mardi, une marche le dimanche, un cours de dessin un soir sur deux : chaque activité a ses séances, planifiées à l'avance. Vous voyez quand, où et qui vient. Un tap sur « Je serai là », et la séance s'ajoute à l'agenda de votre téléphone. Vous pouvez venir avec quelqu'un. Les organisateurs peuvent marquer une séance « découverte » : pas d'engagement, on vient essayer. Et pour ne pas arriver dans le vide, l'organisateur peut désigner une personne d'accueil : « À votre arrivée, demandez Sam. »

2. L'ANNUAIRE DES ASSOCIATIONS DE TOUTE LA FRANCE

Plus d'un million d'associations, repérées à partir de données publiques ouvertes, sont déjà dans l'annuaire : sport, culture, jeux, nature, entraide. Cherchez par thème, par ville ou par distance, avec une recherche qui comprend le sens de vos mots. Une association peut revendiquer sa fiche et y publier ses séances. Si votre club préféré n'y est pas encore, demandez à être prévenu quand il arrive.

3. LA SÉCURITÉ D'ABORD

- Réservé aux personnes de 18 ans et plus.
- Seul votre prénom est affiché. Pas de nom de famille, pas de date de naissance.
- Votre position n'est jamais précise : elle est arrondie, utilisée pour chercher autour de vous, et jamais enregistrée sur nos serveurs.
- Les lieux de rendez-vous sont publics.
- Vous pouvez bloquer une personne, signaler un message ou une activité, et nos modérateurs répondent avec un motif écrit.
- Pas de mot de passe : vous vous connectez avec un code à 8 chiffres reçu par e-mail, ou avec votre compte Google.
- Vous supprimez votre compte et toutes vos données quand vous le voulez, depuis l'application.

CE QUE VOUS POUVEZ FAIRE

- Parcourir et chercher des activités et des associations sans créer de compte.
- Choisir vos centres d'intérêt pour voir d'abord ce qui vous ressemble.
- Rejoindre une activité et discuter avec ses membres dans la discussion de groupe de l'activité.
- Créer votre propre activité régulière en quelques minutes, ou un collectif (un groupe sans statut juridique).
- Partager le lien d'une activité : la page s'ouvre aussi dans un navigateur, sans compte, avec un aperçu dans vos messageries.
- Recevoir un rappel la veille d'une séance, et couper les notifications quand vous voulez.
- Utiliser l'application en français ou en anglais.

POUR QUI ?

Pour celles et ceux qui viennent d'arriver dans une ville, pour les étudiants et les expatriés, pour les personnes qui ont changé de vie ou de quartier, et pour toutes celles qui ont envie d'avoir enfin « leur » rendez-vous de la semaine.

Habitués est gratuit, sans publicité. Aucune donnée n'est vendue ni donnée à des annonceurs.

Une idée, un problème ? Écrivez-nous depuis l'application : Profil, « Une idée ? Un problème ? ». Habitués est en cours de lancement et s'améliore grâce à vos retours.

## Captures d'écran à prendre (6)

Téléphone Android, mode clair, langue française, données d'exemple dans une ville connue (par exemple Lyon). Format 16:9 ou 9:16, entre 320 et 3 840 pixels. Aucune vraie personne, aucun vrai prénom : utiliser des comptes de test (« Camille », « Sam », « Inès »).

1. Explorer : la liste d'activités proches de Lyon, filtre « Séances découverte » visible, trois activités variées (jeux de société, marche, dessin).
2. Une activité : « Go le mardi, Lyon », avec la prochaine séance, le lieu, 6 personnes confirmées, le bouton « Je serai là » et « Ajouter à mon agenda ».
3. Annuaire : la fiche d'une association (un club de go ou d'escalade de Lyon) avec ses coordonnées publiques et ses activités.
4. Recherche : la recherche « escalade » avec des résultats d'associations et d'activités triés par distance.
5. Discussion de groupe : la discussion d'une activité, trois messages courts et amicaux entre Camille, Sam et Inès, sans information personnelle.
6. Sécurité : l'écran « Conseils de sécurité » ou le menu de signalement et de blocage.

Image de présentation (1024 × 500) : `docs/launch/feature-graphic.png`. Icône : celle de l'application (512 × 512).

## Vérification des limites

Ces deux commandes, lancées depuis la racine du dépôt, comptent les caractères des trois textes ci-dessus. Chaque ligne doit afficher `ok`.

```bash
node -e 'const t=require("fs").readFileSync("docs/launch/store-listing.fr.md","utf8");const s=(h)=>t.split("\n## "+h+"\n")[1].split("\n## ")[0].trim();const c=(n,x,m)=>console.log(n,[...x].length,"/",m,[...x].length<=m?"ok":"TROP LONG");c("titre",s("Titre (30 caractères au plus)"),30);c("courte",s("Description courte (80 caractères au plus)"),80);c("complete",s("Description complète (4 000 caractères au plus)"),4000)'
```
