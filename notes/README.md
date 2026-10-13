# Mod `notes` : les fichiers de notes

`branch-notes` tient un fichier markdown par branche git. Les README racine résument le mod ; cette page décrit le disque, les sections et les cas qui mordent.

## Où vivent les notes

```
~/.claude/branch-notes/<repo>-<hash>/<branche>.md
```

- `<repo>` est le nom du dépôt, `<hash>` un FNV-1a du chemin absolu du *git common dir* (`git rev-parse --git-common-dir`). Deux clones du même projet rangés dans des dossiers différents ont donc des notes séparées, et tous les worktrees d'un même clone partagent les leurs.
- `<branche>` passe par `encodeURIComponent` : `claude/ma-feature` devient `claude%2Fma-feature.md`.
- Rien n'est écrit dans le repo. Les notes ne sont pas versionnées, ne partent pas en PR, et ne suivent pas une branche poussée ailleurs.
- `main`, `master` et `develop` n'ont pas de notes : le mod ne crée rien et `/notes` répond qu'il n'y a rien à suivre.

Le fichier est créé à la première session sur la branche, à partir d'un gabarit : un titre, la date, et les quatre sections vides.

## Les sections

| Clé | Titre dans le fichier | Alias acceptés |
|---|---|---|
| `objectif` | `## Objectif` | `objective`, `goal` |
| `decisions` | `## Décisions` | `décisions`, `decision`, `décision` |
| `contraintes` | `## Contraintes` | `constraints`, `constraint` |
| `etat` | `## État / prochaines étapes` | `état`, `state`, `status`, `next` |

Chaque entrée est une puce d'une ligne ; les retours à la ligne du texte sont aplatis. `replace` (l'option de `note_add`, pas de `/notes add`) remplace toute la section au lieu d'ajouter : c'est le mode normal pour `etat`, qui doit montrer où en est le travail, pas son historique.

## Ce qu'on y met

Garde le **quoi** — objectif de la branche, décisions prises et leur raison, contraintes, état d'avancement. Jette le **comment** — logs d'outils, traces de raisonnement, « j'ai fait X puis Y ». Un fichier qui raconte la session repart dans le prompt à chaque tour sans rien apporter.

Le modèle écrit via l'outil `note_add` au fil de la session ; `/notes add <section> <texte>` fait la même chose à la main.

## Dans le system prompt

Les sections non vides partent dans le system prompt à chaque tour, en `scope: "session"` : elles survivent à un compactage. Une section de plus de 25 lignes est tronquée au passage — 10 premières, 15 dernières, et une ligne `… N more line(s) in the notes file` entre les deux. Le fichier, lui, garde tout. C'est une raison de plus de remplacer `etat` plutôt que de l'empiler.

## Écriture concurrente

Plusieurs sessions (worktrees, agents) peuvent viser le même fichier. Chaque écriture prend un verrou `<fichier>.md.lock` (un `mkdir`, atomique) : 50 essais espacés de 100 ms, soit 5 s d'attente, et un verrou de plus de 10 s est considéré comme mort et retiré. Si le verrou ne vient pas, l'écriture est refusée avec `The notes file is busy (another session is writing it). Try again.` — rien n'est perdu, il suffit de refaire l'appel.

## Changement de branche

Un `git checkout`, `git switch` ou `git worktree` lancé via l'outil `Bash` déclenche un rechargement : les notes de la nouvelle branche remplacent les précédentes dans le prompt et dans le panneau. Un changement de branche fait hors de la session (autre terminal, IDE) n'est pas vu avant le prochain démarrage.

## Nettoyage

`/notes prune` compare les fichiers du dossier aux refs locales et distantes (`refs/heads`, `refs/remotes`) et liste ceux dont la branche n'existe plus. `--yes` les supprime, verrou compris. Sans accès à git, la commande ne propose rien plutôt que de risquer une suppression à tort.

`/notes all` liste les branches du repo, marque la courante d'une `*`, donne la date du dernier changement et la première entrée d'`Objectif` et d'`État`.

## Éditer le fichier à la main

`/notes edit` ouvre le fichier dans l'éditeur par défaut (`open -t` sur macOS, `xdg-open` ailleurs).

En revanche, **l'outil `Bash` ne peut pas écrire là** : il tourne dans le sandbox de Claude Code, qui n'autorise l'écriture que dans le projet, et un `echo >> ~/.claude/branch-notes/…` échoue en `operation not permitted`. `note_add` et `/notes add` passent par le moteur du mod, hors sandbox, et marchent toujours. Pour laisser un agent écrire le fichier avec `Write`/`Edit`, ajoute le dossier aux chemins autorisés de `jev-guard` (voir [jev/README.md](../jev/README.md)) *et* à ceux du sandbox :

```json
{ "guard": { "allowPaths": ["~/.claude/branch-notes/"] } }
```
