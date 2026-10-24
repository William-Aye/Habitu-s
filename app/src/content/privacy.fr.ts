import { PRIVACY_CONTACT } from './contact';

// Stored as a TypeScript string because Metro does not load .md files as source by default.
// MARKERS: every sentence tagged "(dès que cette fonctionnalité sera disponible)" describes a feature that
// is not built yet. Remove the marker when it ships: post-session feedback (collection and its 6-month
// deletion), phone verification for organisers, private messages (retention and their mention in the
// export paragraph). Group chat, reports and moderation, feedback, claims and inactive-account deletion are live.
export const privacyFr = `Version à faire relire par une personne qualifiée avant la publication.

# Politique de confidentialité

Habitués vous aide à rencontrer des gens autour d'activités régulières. Cette page explique, simplement, quelles données nous collectons, pourquoi, combien de temps nous les gardons et comment vous gardez la main dessus.

# Ce que nous collectons

- Votre prénom (jamais votre nom de famille), votre adresse e-mail ou votre compte Google pour vous connecter. Aucun mot de passe n'est stocké.
- Une confirmation que vous avez 18 ans ou plus. Nous ne demandons pas votre date de naissance.
- Votre zone d'habitation, ramenée au centre de votre commune (environ 1 km de précision). Votre position GPS est arrondie à environ 1 km sur votre téléphone avant tout usage ; elle sert uniquement à chercher des activités autour de vous et à trouver votre commune (le service public geo.api.gouv.fr reçoit cette position arrondie). Elle n'est jamais enregistrée sur nos serveurs.
- Facultatif : une photo de profil et une courte présentation. Les informations cachées de la photo (dont le lieu de prise de vue) sont supprimées avant l'envoi.
- Vos centres d'intérêt, les activités que vous rejoignez, vos présences, vos messages de groupe et vos avis après séance (dès que cette fonctionnalité sera disponible).
- Votre numéro de téléphone, seulement si vous organisez des activités, pour vérifier votre identité. Il est conservé par notre service de connexion et n'apparaît jamais dans l'application (dès que cette fonctionnalité sera disponible).
- La date de votre dernière visite, mise à jour au plus une fois par heure.
- Si vous nous écrivez via « Une idée ? Un problème ? » : votre message, son type, la version de l'application et le type d'appareil, et une capture d'écran facultative (réservée aux personnes connectées). Vous pouvez écrire sans compte : l'envoi est alors protégé par Cloudflare Turnstile, une vérification anti-robot invisible.
- Si vous signalez un contenu ou une personne : le motif et les précisions que vous écrivez. Si vous revendiquez une association : votre rôle, l'adresse e-mail de l'association ou un justificatif (statuts, récépissé ou lettre signée).
- Si vous activez les notifications : l'identifiant de votre téléphone pour les envoyer, et le texte des notifications (rappels de séance, nouveaux membres, invitations). Vous pouvez les refuser ou les désactiver dans les réglages de votre téléphone.

Vos centres d'intérêt et les activités que vous suivez peuvent révéler des informations sensibles (religion, santé, orientation, opinions). Nous les traitons comme telles : elles ne sont jamais publiques, seules les personnes d'une même activité voient que vous en faites partie, et elles ne sont jamais données à des annonceurs ni utilisées pour personnaliser des publicités.

# Pourquoi, et sur quelle base légale

- Faire fonctionner le service (compte, activités, groupes, messages) : exécution du contrat.
- Publicités personnalisées, si elles existent un jour : votre consentement, que vous pouvez retirer à tout moment.
- Sécurité et modération (signalements, lutte contre les abus) : intérêt légitime.

Nous n'utilisons aucun traceur publicitaire tiers. Les statistiques de fréquentation sont des totaux, sans lien avec une personne.

# Combien de temps nous gardons vos données

- Messages de groupe : 12 mois, puis supprimés automatiquement.
- Messages privés : 12 mois, puis supprimés automatiquement (dès que cette fonctionnalité sera disponible).
- Réponses aux avis après séance : regroupées en statistiques, puis les réponses brutes sont supprimées après 6 mois (dès que cette fonctionnalité sera disponible).
- Signalements et décisions de modération : 3 ans après la décision, puis supprimés. Les précisions du signalement et le motif de la décision sont conservés avec lui comme preuve. Lorsqu'un message est signalé, une copie est conservée avec le signalement, pendant la même durée.
- Journal d'administration (les actions faites par l'équipe de modération) : 3 ans.
- Idées et problèmes envoyés (texte, version de l'application, type d'appareil) et leur capture d'écran : 2 ans.
- Revendications d'association : conservées tant que l'association reste vérifiée. Le justificatif joint est supprimé au plus 1 an après la décision.
- Comptes inactifs depuis 3 ans : une notification (et un message dans l'application) vous prévient 30 jours avant la suppression ; ouvrir l'application garde le compte. Cet avertissement n'atteint que les personnes qui ont activé les notifications.
- Comptes suspendus pour non-respect des règles : les données sont masquées aux autres personnes et conservées comme preuve pendant la durée prévue pour les signalements. Pour connaître le motif de la décision ou la contester, écrivez à ${PRIVACY_CONTACT}.
- Notifications : 30 jours sur nos serveurs après leur envoi, puis supprimées.
- Journaux techniques (dont adresses IP) : durée par défaut de notre hébergeur, au plus 90 jours.

La suppression de votre compte est immédiate (voir plus bas).

# Qui traite vos données

- Supabase (hébergement, base de données et connexion), dans l'Union européenne (Paris).
- Google (connexion avec Google et, le cas échéant, publicités).
- Cloudflare (protection du service, vérification anti-robot à l'inscription et Turnstile pour les messages envoyés sans compte).
- OpenStreetMap (service Overpass) : quand vous publiez une activité ou déplacez une séance, l'application vérifie qu'un lieu public se trouve à proximité. Il ne reçoit que les coordonnées arrondies du lieu, jamais votre identité.
- Expo (relais d'envoi des notifications), puis Google Firebase Cloud Messaging (Android) et Apple Push Notification service (iPhone) pour les acheminer jusqu'à votre téléphone. Les notifications sont volontairement génériques : elles ne contiennent aucun nom d'activité ni prénom, seulement un texte court du type « Rappel : vous avez une activité demain ». Les détails ne s'affichent que dans l'application, après connexion.
- GitHub (hébergement du code de l'application et du site : aucune donnée d'utilisateur).
- geo.api.gouv.fr (service public français, data.gouv) : reçoit la position arrondie à environ 1 km pour trouver votre commune, et les noms de villes que vous tapez dans la recherche.

Quand un de ces services est situé hors de l'Union européenne, le transfert est encadré par le cadre de protection des données UE–États-Unis ou par des clauses contractuelles types.

# Information de modération

Quand un signalement est traité, la personne qui l'a envoyé en est informée dans l'application. La personne concernée par un retrait, un avertissement ou une suspension reçoit le motif de la décision. Les deux reçoivent une notification discrète (« Information de modération »), sans détail. Vous les retrouvez dans Profil, « Informations de modération ».

# Vos droits et comment les exercer

Dans l'application, ouvrez Profil, puis « Mes données » :

- Télécharger mes données : vous recevez un fichier avec toutes les données personnelles que nous avons sur vous (dont votre adresse e-mail, vos dates de création de compte et de dernière connexion, et vos moyens de connexion), et rien sur les autres. Les messages privés que vous avez reçus sont supprimés avec votre compte, mais ne figurent pas dans votre export : ils appartiennent à leur expéditeur (art. 15, § 4 du RGPD) (dès que cette fonctionnalité sera disponible).
- Corriger : modifiez votre prénom, votre présentation, votre photo et votre ville directement dans Profil (vous pouvez aussi retirer votre ville).
- Supprimer mon compte : la suppression est immédiate et définitive, après confirmation.

Supprimer votre compte supprime aussi les activités que vous organisez, avec leurs séances, leurs présences et les messages de leur groupe. Les signalements et vos suggestions « Une idée ? Un problème ? » restent, mais ne sont plus rattachés à vous.

Vous pouvez aussi vous opposer à un traitement ou demander une limitation en nous écrivant : ${PRIVACY_CONTACT}. Nous répondons dans un délai d'un mois.

# Réclamation

Si vous pensez que vos droits ne sont pas respectés, vous pouvez saisir la CNIL (Commission nationale de l'informatique et des libertés) sur www.cnil.fr.

# Contact

${PRIVACY_CONTACT}
`;
