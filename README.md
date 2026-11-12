# Plan du studio

Site officiel de préparation du studio de contenu. Chaque fiche est une page HTML lisible sans JavaScript, par une personne ou par une IA.

## Organisation

- `src/plan.json` : tout le contenu du site. C’est le seul fichier à modifier pour changer le plan.
- `src/studio.css`, `src/studio.js`, `src/tools.js`, `src/assets/` : présentation, interactions et outils.
- `build.mjs` : contrôle le plan, puis génère le site dans `dist/`.
- `tests/` : cas à blanc des outils (comparateur de formats, dossier de lot, contrôle d’autonomie).
- `brouillon.mjs` et `src/brouillon.json` : suivi du brouillon publié ailleurs.
- `dist/` : le site généré. Ne pas le modifier à la main.

## Commandes

```
node build.mjs              contrôle le plan et génère le site
node --test                 rejoue les cas à blanc des outils
node brouillon.mjs          liste ce qui a changé dans le brouillon depuis la dernière intégration
node brouillon.mjs --integre   à lancer une fois les nouveautés du brouillon reportées dans src/plan.json
```

Node 20 ou plus récent suffit, sans dépendance. Pour voir le résultat, ouvrir `dist/index.html`. Pour publier, envoyer le contenu de `dist/`.

`brouillon.mjs` ne modifie jamais `src/plan.json` : il écrit le détail des écarts dans `brouillon-ecarts.json`, à reporter à la main.

## Ce que la génération refuse

- une fiche sans titre, sans introduction ou sans direction;
- un identifiant en double, un parent, un lien ou une source introuvable;
- deux points de même titre dans une fiche, deux liens vers la même fiche, une liste de liens vide;
- deux sources de même adresse, ou une source citée nulle part;
- un état de fiche autre que `open` ou `closed`, ou un état sans statut;
- un format de quiz dont `revelation` ou `reponses` sort du vocabulaire admis.

## Une fiche dans `plan.json`

| Champ | Rôle |
| --- | --- |
| `id`, `parent`, `titre`, `intro` | Identité et place dans l’arborescence. L’`id` devient le nom de la page. |
| `direction` | Obligatoire. Ce qu’il faut faire ici, en premier. |
| `apport` | Ce qu’il reste à apporter : idées et création. |
| `pret` | La condition vérifiable qui clôt la préparation. |
| `champs` | Le contrat en bref : des paires libellé et texte. |
| `blocs` | Les règles détaillées. Chaque point porte un `etat` défini dans `etiquettes`, et ses `references`. |
| `gabarit`, `liens`, `sources`, `bibliographie` | Gabarit à copier, fiches suivantes, sources propres à la fiche. |
| `statut`, `etat` | Statut affiché. `open` range la fiche dans les décisions ouvertes, `closed` dans les décisions closes. |
| `consigneIA` | Consigne jointe à la fiche copiée. À défaut, `consigne_defaut`. |
| `comparateurQuiz`, `controleLot`, `controleAutonomie` | Affichent l’outil correspondant dans la fiche. |

## Ce que le site déduit

- Un point `regle` sans source liée s’affiche « Règle fixée ». Avec une source, il s’affiche « Règle documentée ».
- Une fiche `open` et les points `ouvert`, `condition`, `annonce`, `hypothese` alimentent la page Décisions.
- La page Sources, `plan.md`, `llms.txt` et l’index de recherche sont produits à partir des mêmes données.
- `alias` redirige les anciens identifiants vers la fiche qui les remplace.
