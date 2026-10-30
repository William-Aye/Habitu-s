# Test fermé (Google Play)

Dernière mise à jour : 2026-10-30

Google exige, pour un compte développeur personnel créé récemment, un test fermé avec au moins 12 testeurs, qui restent inscrits pendant 14 jours de suite, avant de demander l'accès à la production. Ce document explique comment faire, et contient les messages à envoyer aux testeurs. Les règles de Google changent : relire la page « Exigences de test » de la Play Console avant de commencer.

## 1. Créer la piste de test fermé

1. Play Console, l'application Habitués, « Tests et publication », « Tests », « Test fermé ».
2. Créer une piste (nom : « Bêta Habitués »).
3. Onglet « Testeurs » : créer une liste d'adresses e-mail (des comptes Google, un par testeur) ou un groupe Google. Enregistrer.
4. Copier le lien d'inscription (« Copier le lien ») : c'est lui que les testeurs ouvrent pour s'inscrire.
5. Onglet « Versions » : « Créer une version », envoyer le fichier `.aab` fabriqué avec le profil EAS `production` (voir `docs/launch/checklist.md`), remplir les notes de version en français, puis « Envoyer pour examen ». Le premier examen peut prendre plusieurs jours.
6. Avant l'envoi, la fiche du Store, la classification (`content-rating.md`), le formulaire « Sécurité des données » (`data-safety.md`) et la politique de confidentialité doivent être remplis.

## 2. La règle des 12 testeurs et des 14 jours, et comment compter

- Il faut au moins 12 personnes inscrites au test, et inscrites en continu pendant 14 jours. La Play Console montre le compteur dans « Tests », « Test fermé » (et la page « Exigences de production »).
- Le jour 1 est le jour où le douzième testeur s'est inscrit (ouvert le lien et accepté), pas le jour de l'envoi de la version. Si un testeur se désinscrit et qu'il n'en reste que 11, le compte s'arrête : il faut en retrouver un douzième, et la console indique la date où le compte reprend.
- Visez 15 à 20 inscrits pour garder une marge.
- Notez dans un tableau (dates, nombre d'inscrits) pour ne pas dépendre de la seule console :

| Date | Inscrits | Remarque |
|---|---|---|
|  |  |  |

- Le jour 15, dans la Play Console, « Tableau de bord », « Demander l'accès à la production ». Google pose des questions sur le test (retours reçus, corrections faites) : les réponses sont dans la section 5.

## 3. Message d'invitation (à envoyer aux testeurs)

Objet : Testez Habitués avant tout le monde (2 minutes pour vous inscrire)

Bonjour,

Je prépare Habitués, une application gratuite pour trouver des activités régulières et des associations près de chez soi, et se faire des amis en se retrouvant chaque semaine au même endroit. Avant de la publier, j'ai besoin de testeurs sur Android, pendant 14 jours.

Ce que je vous demande : installer l'application, l'ouvrir de temps en temps, et me dire ce qui ne va pas ou ce qui manque. Quelques minutes par semaine suffisent.

Pour vous inscrire :
1. Utilisez un téléphone Android avec votre compte Google.
2. Ouvrez ce lien : [LIEN D'INSCRIPTION AU TEST FERMÉ]
3. Touchez « Devenir testeur », puis « Télécharger sur Google Play ».
4. Merci de ne pas vous désinscrire avant la fin des 14 jours : Google exige que 12 personnes restent inscrites sans interruption.

Votre prénom est la seule information demandée à l'inscription dans l'application, et vous pouvez supprimer votre compte à tout moment (Profil, « Mes données »). Rien n'est publié à votre nom.

Merci beaucoup !
[PRÉNOM]

## 4. Instructions pour les testeurs (ce qu'il faut essayer chaque semaine)

À envoyer dans le message d'accueil, puis à rappeler à chaque début de semaine.

Semaine 1 : découvrir
- Parcourez l'accueil sans compte : regardez des activités et des associations, changez la ville, le rayon, les centres d'intérêt.
- Cherchez « escalade », « chorale » ou un mot qui vous intéresse, et regardez si les résultats ont du sens.
- Créez votre compte (code à 8 chiffres reçu par e-mail, ou Google). Dites-moi si le code arrive vite et s'il est clair.
- Ouvrez une activité, touchez « Je serai là » et « Ajouter à mon agenda ».

Semaine 2 : participer
- Rejoignez une activité et écrivez un message dans sa discussion de groupe.
- Créez une activité de test (par exemple « Café du jeudi »), avec une séance. Dites-moi si c'est facile ou long.
- Essayez de signaler un message (ne signalez pas de vraie personne pour rien) et de bloquer un compte de test, puis regardez ce qui se passe.
- Cherchez une association connue autour de chez vous et ouvrez sa fiche.
- Partagez le lien d'une activité à un ami et regardez comment la page s'ouvre dans le navigateur.

Chaque semaine
- Vérifiez que les rappels (notifications) arrivent la veille d'une séance.
- Changez la langue (français, anglais) dans Profil.
- Avant la fin du test : dans Profil, « Mes données », téléchargez vos données, puis supprimez votre compte de test pour vérifier que tout s'efface (faites-le en dernier).

Pour chaque problème, indiquez : l'écran, ce que vous avez fait, ce que vous attendiez, ce qui s'est passé. Une capture d'écran aide.

## 5. Comment arrivent les retours

- Dans l'application : Profil, « Une idée ? Un problème ? ». Le message (type idée ou problème, texte, capture d'écran facultative, version et type d'appareil) arrive dans Administration, « Idées et problèmes ». Un admin les lit au moins une fois par semaine pendant le test et répond au testeur s'il a laissé un moyen de le joindre.
- Sans compte : le même formulaire est accessible depuis l'écran d'accueil avant la connexion.
- Dans la Play Console : les commentaires laissés sur la page de test (« Retours des testeurs ») et le rapport « Android vitals » (plantages).
- Pour la demande d'accès à la production, garder la liste des retours reçus et de ce qui a été corrigé : Google demande de décrire comment les retours ont été utilisés.
- Chaque lundi pendant le test : lire les retours, corriger ce qui bloque, envoyer une nouvelle version au test fermé si nécessaire (cela ne remet pas le compteur de 14 jours à zéro tant que les testeurs restent inscrits).
