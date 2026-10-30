# Procédure en cas de violation de données

Dernière mise à jour : 2026-10-30

Une violation de données, c'est quand des données personnelles sont perdues, détruites, modifiées ou vues par quelqu'un qui n'aurait pas dû. Par exemple : une base ouverte par erreur, une clé secrète publiée, un compte administrateur volé, une sauvegarde perdue. Cette page dit quoi faire, dans quel ordre et qui décide.

La règle à retenir : la CNIL doit être prévenue dans les 72 heures après avoir pris connaissance de la violation, si elle présente un risque pour les personnes. En cas de doute, on prévient.

## Qui décide

- Le responsable de traitement ([NOM À COMPLÉTER]) décide de tout : le niveau de gravité, la notification à la CNIL, l'information des personnes.
- S'il est injoignable, la personne qui découvre l'incident agit sur l'étape 1 (contenir) sans attendre, puis le prévient immédiatement.
- Tout incident, même mineur, est inscrit dans `journal-des-incidents.md`.

## Les étapes

### 1. Contenir (tout de suite)

Arrêter l'accès illégitime avant de comprendre tout le reste.

- Changer les clés exposées : clé de service Supabase, clés de fonctions, secrets GitHub, clé Turnstile. Les clés sont dans le tableau de bord Supabase, les secrets GitHub et la console Cloudflare.
- Révoquer les sessions : Supabase, Authentication, utilisateurs concernés, déconnexion forcée ; en cas de doute général, tourner le secret JWT de la base.
- Bloquer le chemin d'attaque : désactiver la fonction ou la règle en cause, couper l'accès à l'API en dernier recours, bloquer l'adresse ou la requête dans Cloudflare.
- Ne rien supprimer qui serve de preuve : garder les journaux (Supabase, Cloudflare, GitHub, journal d'administration).

### 2. Évaluer (dans les 24 heures)

Noter par écrit :

- ce qui s'est passé, quand, comment cela a été découvert ;
- quelles données (prénoms, e-mails, zones, messages, signalements, justificatifs) et combien de personnes ;
- si les données étaient lisibles par l'attaquant ou seulement atteintes ;
- le risque pour les personnes : faible (données peu sensibles, peu de personnes), ou élevé (messages, centres d'intérêt, justificatifs, adresses e-mail de beaucoup de personnes, compte administrateur).

Sources : journal d'administration, journaux Supabase (API, base, Auth), journaux Cloudflare, historique GitHub.

À savoir : grâce à la minimisation, une fuite complète de la base n'exposerait pas de mot de passe, d'adresse précise ni de date de naissance ; les e-mails sont dans Supabase Auth. Cela ne dispense pas de notifier s'il y a un risque.

### 3. Notifier la CNIL (dans les 72 heures)

- Si la violation présente un risque pour les personnes : notification en ligne sur **notifications.cnil.fr** (téléservice « Notifier une violation de données personnelles »).
- Le délai court à partir du moment où l'on a une connaissance raisonnablement certaine de la violation, pas de la fin de l'enquête. Si tout n'est pas connu, faire une notification initiale puis l'enrichir.
- Si le risque est écarté (par exemple données illisibles), ne pas notifier, mais écrire la raison dans le journal.
- Contenu : nature de la violation, catégories et nombre approximatif de personnes et de données, conséquences probables, mesures prises, contact.

### 4. Informer les personnes (sans retard injustifié)

Obligatoire quand le risque est élevé. Message en français simple, par e-mail et par notification dans l'application, sans jargon. Il dit ce qui s'est passé, quelles données, les conséquences possibles, ce qui a été fait, ce que la personne peut faire, et le contact.

Modèle de message :

> Objet : Information importante sur la sécurité de votre compte Habitués
>
> Bonjour,
>
> Le [date], nous avons découvert que [description simple : par exemple « une personne non autorisée a pu consulter une partie de la base de Habitués »]. Cela a concerné [données : par exemple « votre prénom, votre adresse e-mail et les messages de vos groupes »]. Cela n'a pas concerné [ce qui est protégé : par exemple « aucun mot de passe, puisque Habitués n'en utilise pas, ni votre position précise »].
>
> Ce que nous avons fait : [mesures : par exemple « nous avons fermé l'accès, changé nos clés et prévenu la CNIL »].
>
> Ce que vous pouvez faire : [conseils : par exemple « soyez prudent avec les messages inattendus qui prétendent venir de Habitués ; nous ne demandons jamais de code par message »]. Vous pouvez à tout moment télécharger ou supprimer vos données dans Profil, « Mes données ».
>
> Nous sommes désolés. Pour toute question : confidentialite@<domaine>.
>
> L'équipe Habitués

### 5. Enregistrer et corriger

- Inscrire l'incident dans `journal-des-incidents.md` : date, découverte, données, personnes, mesures, notification CNIL (oui/non, date, numéro), information des personnes, cause, correction.
- Corriger la cause, ajouter un test qui aurait détecté le problème, et mettre à jour le registre, l'AIPD et la politique de confidentialité si besoin.
- Relire l'incident un mois après : la correction tient-elle ?

## Contacts utiles

- CNIL : notifications.cnil.fr (violations), www.cnil.fr.
- Supabase : tableau de bord, support du projet.
- Cloudflare : tableau de bord, journaux de sécurité.
- GitHub : paramètres de sécurité du dépôt, journaux d'audit.
