# Sous-traitants et accords de traitement

Dernière mise à jour : 2026-10-30

Un sous-traitant est une entreprise qui traite des données personnelles pour notre compte. Le RGPD (article 28) demande un accord écrit avec chacun (un DPA, « Data Processing Addendum »). Cette page liste ceux de la première version (Android), ce qu'ils reçoivent, où ils sont, comment les transferts hors de l'Union européenne sont encadrés, et où le propriétaire accepte l'accord.

À faire avant le lancement : accepter chaque accord ci-dessous, puis noter la date dans la colonne « Accepté le » du tableau final. Les adresses des pages d'accord changent parfois : si un lien ne marche plus, cherchez « DPA » ou « Data Processing Addendum » dans les pages légales du fournisseur.

Transferts hors Union européenne : les cinq fournisseurs sont des sociétés américaines ou ont une société mère américaine. Le transfert est encadré par le cadre de protection des données UE–États-Unis (Data Privacy Framework) lorsque le fournisseur y est certifié, et sinon, ou en plus, par les clauses contractuelles types de la Commission européenne, qui sont intégrées à leur accord de traitement. Vérifier la certification du fournisseur sur dataprivacyframework.gov au moment de l'acceptation.

Publicité : la première version n'affiche aucune publicité, donc aucun service publicitaire n'est utilisé. Il faudra mettre à jour cette page avant d'en ajouter un.

## Supabase

- Rôle : hébergement de la base de données, de la connexion (e-mail et Google), des fichiers (photos, justificatifs, captures d'écran) et des fonctions serveur.
- Données : tout ce qui est dans le registre des traitements, y compris l'e-mail des comptes (dans Supabase Auth) et les journaux techniques.
- Région : Union européenne (Paris). La société Supabase Inc. est américaine, d'où l'encadrement des transferts d'assistance.
- Base du transfert : clauses contractuelles types et cadre de protection des données UE–États-Unis, dans le DPA.
- Où accepter : tableau de bord Supabase, organisation, onglet « Legal Documents » (« Data Processing Addendum »), puis demander la signature en ligne. Le plan Pro est nécessaire pour les sauvegardes quotidiennes.

## Cloudflare

- Rôle : hébergement du site et de la version web (Cloudflare Pages), DNS, protection contre les attaques (WAF, robots), vérification anti-robot Turnstile.
- Données : adresse IP et requêtes web de tous les visiteurs (journaux de Cloudflare) ; pour Turnstile, l'adresse IP et des informations techniques du navigateur. Aucune donnée de compte stockée, hors la session du navigateur côté visiteur.
- Région : réseau mondial ; Cloudflare est une société américaine.
- Base du transfert : cadre de protection des données UE–États-Unis (Cloudflare est certifié) et clauses contractuelles types dans son DPA.
- Où accepter : le DPA de Cloudflare est intégré à l'accord client en ligne (Cloudflare Customer DPA, sur cloudflare.com/cloudflare-customer-dpa). Il s'applique à l'acceptation des conditions du compte ; garder une copie PDF.
- Mentions légales : Cloudflare, Inc. est aussi l'hébergeur du site (voir `web/src/legal.ts`).

## Google

- Rôle : deux services distincts.
  - Connexion avec Google : Google fournit une identité à la demande de la personne ; Google agit pour son propre compte pour son compte Google, et nous recevons l'identifiant, l'e-mail et le prénom.
  - Firebase Cloud Messaging : acheminement des notifications vers les téléphones Android, pour notre compte (sous-traitant).
- Données : pour la connexion, l'identifiant Google, l'e-mail et le prénom ; pour les notifications, le jeton de l'appareil et le texte (générique, sans nom d'activité ni prénom).
- Région : mondiale ; Google LLC est américaine.
- Base du transfert : cadre de protection des données UE–États-Unis (Google est certifié) et clauses contractuelles types dans les conditions de traitement de Google.
- Où accepter : console Firebase, projet, « Paramètres du projet », puis acceptation des « Conditions de traitement des données Firebase » (Data Processing and Security Terms) ; elles s'appliquent aussi à la console Google Cloud utilisée pour la connexion Google.
- AdMob : non utilisé dans la première version.

## Expo

- Rôle : relais d'envoi des notifications (service de notifications Expo), qui transmet à Firebase Cloud Messaging. La construction du fichier de l'application (EAS) ne reçoit aucune donnée d'utilisateur.
- Données : jeton de notification de l'appareil, texte de la notification (générique), identifiant de projet.
- Région : États-Unis (Expo est une société américaine).
- Base du transfert : clauses contractuelles types et, le cas échéant, cadre de protection des données UE–États-Unis, dans son accord de traitement.
- Où accepter : tableau de bord Expo (expo.dev), compte ou organisation, pages légales (« Data Processing Addendum » ou demande par le support si l'accord n'est pas en ligne). Garder la confirmation écrite.

## GitHub

- Rôle : hébergement du code, des vérifications automatiques (CI) et du travail planifié d'import de l'annuaire public d'associations, qui écrit dans la base.
- Données : aucune donnée d'utilisateur stockée. Le travail d'import utilise une clé secrète (secrets GitHub) et traite uniquement des données publiques d'associations. Les journaux de CI ne doivent contenir aucun secret ni donnée personnelle.
- Région : États-Unis (GitHub, filiale de Microsoft).
- Base du transfert : cadre de protection des données UE–États-Unis (GitHub/Microsoft est certifié) et clauses contractuelles types dans l'accord de protection des données de GitHub.
- Où accepter : l'accord de protection des données de GitHub fait partie du « GitHub Customer Agreement » ; pour un compte personnel ou une organisation, il s'applique sur acceptation des conditions, et la signature en ligne se trouve dans les paramètres de l'organisation, section de facturation et de légal. Activer aussi l'analyse des secrets, la protection des envois, Dependabot et CodeQL (voir `docs/ops/github-settings.md`).

## Services publics et ouverts sans accord de traitement

Ces services reçoivent des requêtes sans donnée de compte. Ils ne sont pas des sous-traitants au sens du RGPD, mais ils sont cités dans la politique de confidentialité.

- geo.api.gouv.fr (service public) : reçoit la position arrondie à environ 1 km pour trouver la commune, et les noms de villes tapés dans la recherche.
- OpenStreetMap (Overpass) : reçoit les coordonnées arrondies d'un lieu, pour vérifier qu'un lieu public se trouve à proximité, et l'adresse IP du téléphone. Aucune donnée de compte.

## Suivi des accords

| Fournisseur | Accord | Accepté le | Copie rangée dans |
|---|---|---|---|
| Supabase | DPA (organisation, Legal Documents) | | |
| Cloudflare | Customer DPA | | |
| Google | Firebase, conditions de traitement des données | | |
| Expo | DPA | | |
| GitHub | Accord de protection des données | | |
