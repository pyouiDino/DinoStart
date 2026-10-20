# DinoStart — documentation pour les développeurs

> Le guide pour **utiliser** DinoStart est dans le [README](../README.md). Ce fichier décrit comment construire, tester et faire évoluer le projet.

Le dossier `dist/` est **volontairement versionné** : ainsi, télécharger le dépôt GitHub suffit pour installer l'extension, sans Node.js.
Relancez `npm run build` avant chaque publication pour qu'il corresponde au code.

## Prérequis (Windows)

- Windows 10/11, PowerShell
- [Node.js](https://nodejs.org) 20 ou plus récent (testé avec Node 22) — vérifiez avec `node -v`
- Google Chrome 111 ou plus récent
- Un compte GitHub (seulement pour la synchronisation)

## Installer, tester, construire

Dans PowerShell, depuis le dossier du projet :

```powershell
npm install            # installe les dépendances (fichier package-lock.json fourni)
npm run check          # typecheck + ESLint + tous les tests + build de production
```

Commandes individuelles :

```powershell
npm run typecheck      # vérification TypeScript (mode strict)
npm run lint           # ESLint
npm test               # tous les tests (unitaires, intégration, interface)
npm run test:unit
npm run test:integration
npm run test:ui
npm run build          # produit DEUX extensions installables : dist\ (nouvel onglet) et dist-home\ (page d'accueil)
npm run e2e            # facultatif : test de bout en bout dans un vrai Chromium, version « nouvel onglet » (Python + Playwright)
npm run e2e:home       # idem pour la version « page d'accueil »
```

Pour reconstruire depuis une installation propre : supprimez `node_modules` et `dist`, puis relancez
`npm install` et `npm run build` (ou `npm ci` si vous voulez exactement les versions du `package-lock.json`).

> `npm run icons` régénère les icônes PNG (nécessite Python 3 + Pillow). Ce n'est pas utile pour construire
> l'extension : les icônes sont déjà dans `public\icons`.

## Charger l'extension dans Chrome

1. Lancez `npm run build` : le dossier **`dist`** est créé.
2. Ouvrez `chrome://extensions`.
3. Activez le **Mode développeur** (en haut à droite).
4. Cliquez sur **Charger l'extension non empaquetée** et choisissez le dossier `dist` du projet.
5. Ouvrez un nouvel onglet : DinoStart s'affiche. Chrome peut vous demander de confirmer le remplacement de la
   page de nouvel onglet : choisissez « Conserver les modifications ».

### Version « page d'accueil » (sans la barre verte de Chrome)

Quand une extension remplace le nouvel onglet, **Chrome ajoute lui-même une barre en bas de la page** (le nom de l'extension et
« Personnaliser Chrome »). Aucune extension ne peut la retirer, et il n'existe pas de réglage `chrome://flags` pour la désactiver
(vérifié sur Chromium 141). La solution est de **ne pas remplacer le nouvel onglet** : c'est le rôle du dossier **`dist-home`**.

Dans cette version, Ctrl+T ouvre la page normale de Chrome ; DinoStart s'ouvre par :
1. le **bouton DinoStart** de la barre d'outils (icône puzzle → punaise pour l'épingler) ;
2. le **raccourci Alt + Maj + D** (modifiable : `chrome://extensions/shortcuts`) ;
3. le bouton **Page d'accueil** de Chrome (la maison) ou Alt + Origine ;
4. la **page de démarrage** de Chrome.

Pour 3 et 4, DinoStart → Paramètres → **Ouverture** affiche l'adresse exacte à copier (elle diffère d'un PC à l'autre) et ouvre
directement les bons réglages de Chrome (« Apparence » : bouton Page d'accueil → adresse personnalisée ; « Au démarrage » →
ouvrir une page spécifique).

**Passer d'une version à l'autre sans perdre vos données** : les deux versions sont deux extensions distinctes, avec chacune
ses propres données (Chrome les sépare par extension). Dans l'ancienne : **Sauvegardes → Exporter en JSON** (ou synchronisez avec
GitHub). Dans la nouvelle : **Sauvegardes → Importer** (mode « remplacer »). Puis retirez l'ancienne DinoStart de `chrome://extensions`
pour ne pas en avoir deux. Les permissions sont identiques dans les deux versions.

Après chaque nouveau `npm run build`, cliquez sur l'icône « Actualiser » de l'extension dans `chrome://extensions`.
Vos données sont conservées lors des mises à jour (elles sont dans le stockage de l'extension, pas dans `dist`).

Permissions demandées :
- `storage` : vos données, en local.
- `favicon` : afficher l'icône des sites en favori, **fournie par Chrome sur votre PC** (aucune requête vers les sites).
- accès à `https://api.github.com/*` : synchronisation (si vous la configurez).
- accès à `https://suggestqueries.google.com/*` : suggestions de recherche Google pendant la frappe
  (désactivables dans l'assistant ou Paramètres → Recherche).

Aucun accès à l'historique de navigation, aux cookies, ni au contenu des sites. Les boutons « Historique » et
« Navigation privée » ouvrent simplement la page d'historique de Chrome ou une fenêtre privée.

### Mise à jour depuis une version précédente

Reconstruisez (`npm run build`) ou remplacez le dossier `dist`, puis cliquez sur « Actualiser » sur la carte de
l'extension dans `chrome://extensions`. Chrome peut demander d'accepter les nouvelles permissions. Vos données sont
**converties automatiquement** (schéma 1 → 2 → 3) : vos cartes gardent leur ordre et leur largeur d'avant, converties en position et taille sur la grille ; vos favoris gardent leur icône choisie, ceux en « initiale »
passent en icône automatique, et l'assistant de démarrage s'affiche une fois.
Si vous synchronisez plusieurs PC, mettez-les tous à jour : une ancienne version refuse de lire un fichier v2
(avec un message clair) plutôt que de l'abîmer.

## Limites connues

- **Connexion à votre compte Google : impossible.** Google ne donne pas accès à votre historique de recherches aux
  extensions. DinoStart retient donc *les recherches faites depuis sa barre*, sur l'appareil uniquement (jamais
  synchronisées ni exportées, 100 maximum), et propose en plus les suggestions publiques de Google.
- Icônes automatiques : Chrome ne les connaît que pour les sites **déjà visités** ; sinon il affiche une icône générique.
  Choisissez alors « initiale » ou une icône dans la fiche du favori.
- Navigation privée : si Chrome refuse d'ouvrir la fenêtre (règle d'organisation…), un message propose Ctrl+Maj+N.
- Raccourcis IA : le pré-remplissage de la question dépend du site et peut cesser de fonctionner si le site change ; le
  lien ouvre alors simplement l'assistant.
- **Ce qui a été vérifié dans un vrai Chromium 141** (script `npm run e2e`, 16 vérifications : extension chargée, nouvel onglet remplacé,
  icônes locales, glisser/redimensionner à la souris, absence de chevauchement et de débordement, persistance, fenêtre privée réelle,
  `chrome://history`, aucune erreur de console ni de CSP). **Ce qui ne l'a pas été** : un vrai dépôt GitHub (l'environnement de
  développement n'y a pas accès), les suggestions Google en direct (pas d'accès réseau), et Chrome « normal » avec interface graphique.
  Les tests d'intégration utilisent un faux serveur GitHub qui reproduit le comportement documenté (SHA, 401/403/404/409/422/429,
  ETag), et l'interface est testée dans jsdom. Faites un premier essai réel avec un dépôt de test (section 5).
- La synchronisation automatique ne s'exécute **que lorsqu'un onglet DinoStart est ouvert** (il n'y a pas de service
  worker en arrière-plan, par choix de simplicité et de permissions minimales).
- Le jeton n'est **pas chiffré** (limite de `chrome.storage.local`, voir l'avertissement en 5.6).
- Fusion : un réglage ou un champ « liste » (par exemple la liste des liens d'un projet) est traité comme une seule
  valeur : modifié différemment sur deux PC, il donne un conflit à arbitrer plutôt qu'une fusion ligne par ligne.
- Les suppressions logiques sont conservées indéfiniment dans le fichier (nécessaire pour propager les suppressions) ;
  le fichier grossit très lentement. Il n'y a pas de purge automatique.
- Le fichier de données doit rester raisonnable (quelques Mo au plus ; le contenu de plus de 1 Mo est lu via le mode
  « raw » de GitHub, et la limite de l'API est de 100 Mo). Limites internes : 5 000 éléments par collection, 50 000
  caractères par note.
- L'image de fond est réduite à 1920 px et stockée sur l'appareil seulement (non synchronisée, non exportée).
- Cartes : quand on en réduit une, son contenu reste dans son cadre (il défile à l'intérieur si besoin, l'horloge et la date se réduisent). Placement libre : sur une fenêtre étroite (moins de 720 px) les cartes s'empilent et ne peuvent plus être déplacées ; élargissez la fenêtre pour les replacer. Les cartes ont une hauteur fixe (une barre de défilement apparaît si le contenu dépasse). Le glisser-déposer des favoris (dossiers) utilise la souris.
- Les icônes des favoris sont une initiale colorée ou une icône locale : DinoStart ne télécharge jamais d'icône
  depuis les sites.
- Les chemins de dossiers de projets sont de simples textes à copier : une extension ne peut pas ouvrir vos dossiers.
- La recherche Web ouvre le moteur choisi dans l'onglet courant (Ctrl+Entrée : nouvel onglet).
- `npm audit` signale un avis modéré sur l'outillage de **test** (Vitest/Vite, non inclus dans l'extension) ;
  aucune vulnérabilité sur les dépendances de production.

---

## Identité visuelle

Le logo est un dino en pixel art (`branding/logo-original.png`). Les icônes de l'extension (`public/icons`) et le logo de
l'interface (`public/logo.png`) en sont générés par `npm run icons` (Python + Pillow ; les fichiers générés sont déjà fournis).
Pour changer de logo : remplacez `branding/logo-original.png` (PNG à fond transparent) puis lancez `npm run icons` et `npm run build`.

Palette par défaut, tirée du logo : bleu **#5194f5**, pêche **#fdc096**, fond bleu nuit. L'ancienne palette orange reste
disponible (Personnaliser → Couleurs → « Orange »). Au passage à cette version, seuls les réglages restés aux anciennes couleurs
d'origine sont convertis ; une couleur que vous avez choisie n'est jamais modifiée. L'accent s'ajuste automatiquement (plus foncé en
thème clair, plus clair en thème sombre) pour que l'horloge et les étoiles restent lisibles quelle que soit la couleur choisie.

## Architecture

```
src/
  core/      modèles, validation, migrations, opérations métier pures, recherche, fusion à 3 voies
  storage/   adaptateur chrome.storage, magasin (écritures sérialisées, sauvegardes, récupération)
  sync/      configuration, client REST GitHub, moteur de synchronisation, planificateur
  backup/    export / import JSON
  ui/        contexte, composants, widgets, vues (accueil, favoris, projets, notes, tâches, sauvegardes, paramètres)
  newtab/    point d'entrée de la page de nouvel onglet
  styles/    CSS (variables, thèmes sombre/clair)
tests/
  unit/ integration/ ui/ helpers/   (faux serveur GitHub utilisé uniquement dans les tests)
public/      manifest.json, icônes, theme-boot.js (anti-flash du thème)
```

Sécurité : CSP stricte (`script-src 'self'`, `connect-src https://api.github.com`), aucun script distant, aucune
évaluation de code, aucun `innerHTML` (rendu React), liens de navigation limités à http/https et revalidés avant
affichage, importation par liste blanche de champs, `credentials: 'omit'` et `redirect: 'error'` sur les requêtes GitHub.


## Régénérer les captures d'écran de la documentation

Les images de `docs/images/` sont de **vraies captures** de l'extension dans un vrai Chromium, avec des données d'exemple fictives
(profil temporaire). Après un changement d'interface :

```powershell
npm run build
pip install playwright pillow
python -m playwright install chromium
python scripts/make-docs-images.py
```

Les pages `chrome://extensions` apparaissent dans la langue du Chromium utilisé (anglais ici) ; le README le signale.
