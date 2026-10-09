# claude-mods

Mes mods Claude Code (plugins à base de function hooks). Le repo est aussi une marketplace : `.claude-plugin/marketplace.json` liste chaque mod.

## Arborescence

```
.claude-plugin/marketplace.json   la liste des mods, une entrée par mod
scripts/build.ts                  bundle chaque <famille>/<mod>/src/register.ts(x) en hooks/register.js
<famille>/
  lib/                            le code partagé par les mods de la famille
  <mod>/
    .claude-plugin/plugin.json    nom, version, description
    hooks/hooks.json              { "modules": ["./register.js"] }
    hooks/register.js             généré par le build, commité (c'est ce que Claude Code charge)
    src/register.ts               le source du mod
    register.test.ts              lancé par `claude plugin test`
```

Un module de hooks ne peut importer que les fichiers de son propre plugin et tourne sans Node : le build inline le `lib/` de la famille dans chaque `register.js`. Tout accès au système passe par `$` (`$.fs`, `$.http.fetch`, `$.env`, `$.process`).

Nouveau mod : un dossier `<famille>/<mod>/` avec les trois fichiers ci-dessus et `src/register.ts`, puis une entrée dans `marketplace.json`.

## Commandes

```bash
bun run build
```

```bash
bun run test
```

```bash
bun run validate
```

## Installer

En local, depuis ce dossier (Claude Code lit alors les mods directement ici ; après un build, `/reload-plugins`) :

```bash
claude plugin marketplace add /Users/aleclercq/Dev/IA/claude-mods
```

```bash
claude plugin install jev-guard@claude-mods
```

Depuis GitHub, une fois poussé : `/plugin install <mod> --marketplace <owner>/claude-mods`.

## Famille `jev`

Les extensions pi de [ten-levels-of-jev](https://github.com/disler/ten-levels-of-jev) (levels 6 à 10) portées en mods. `jev/lib/` est une copie adaptée de son `src/core` et `src/levels/level06..10` : `decide` et le système de fichiers sont des paramètres, le transport Node est retiré.

| Mod | Ce qu'il fait |
|---|---|
| `jev-guard` | Jev bloque les `Bash` irréversibles ou destructeurs, les `Write`/`Edit` hors du repo ou contenant un secret, et marque les résultats de `Read`/`Bash` qui contiennent des instructions |
| `jev-compact` | À chaque fin de tour, Jev juge s'il faut compacter ; outils `should_i_compact` et `compact_now` ; à la compaction, Jev choisit où commence le travail en cours |
| `ask-jev-file` | `ask_jev_file_bool`, `_choice`, `_score` : une question typée sur un fichier sans le lire dans le contexte |
| `ask-jev-files` | `ask_jev_files` sur beaucoup de fichiers en parallèle, puis `pick_first_file` |
| `ask-jev` | `ask_jev` sur n'importe quelle situation (fichiers, sortie d'une commande, état de l'agent), avec suivi des coûts |
| `jev-hud` | Bandeau au-dessus du prompt : spinner pendant que Jev réfléchit, chaque intervention en couleur (⛔ bloqué, ⚠ signalé, ✓ ok, ◆ réponse), appels, latence moyenne et coût. Bouton **Pause** (touche `p` quand le bandeau a le focus) : met `JEV_PAUSED=1` pour le process, et tous les mods jev arrêtent d'appeler Jev jusqu'à **Resume**. En pause, `jev-guard` laisse tout passer. Déplace les lignes `jev · …` du transcript vers le debug log |

Il faut `OPENROUTER_API_KEY` ou `TYPESAFE_API_KEY` dans l'environnement de Claude Code (`JEV_BACKEND` force l'un des deux). `JEV_LEVEL_CONFIG` (JSON) règle les gates de `jev-guard` (`{"gates":["A","B"]}`) et les seuils de `jev-compact` (`{"lines":{"notice":80000,"recommend":120000,"request":160000}}`).

Chaque décision Jev s'affiche en ligne grisée dans le transcript, invisible pour le modèle, et part aussi en JSON sur le debug log (préfixe `jev-event `) : c'est ce que lit `jev-hud`.
