# Mods jev : la clé API

Les mods jev appellent Jev via OpenRouter ou TypeSafe. Ils lisent la clé dans l'**environnement du process Claude Code** (`$.env`). Ni le repo ni les mods ne la stockent.

## Variables

| Variable             | Rôle                                                                                                                                                       |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `OPENROUTER_API_KEY` | Clé OpenRouter (`sk-or-…`)                                                                                                                                 |
| `TYPESAFE_API_KEY`   | Clé TypeSafe ; prioritaire si les deux sont définies                                                                                                       |
| `JEV_BACKEND`        | Optionnel : `openrouter` ou `typesafe` pour forcer un fournisseur                                                                                          |
| `JEV_LEVEL_CONFIG`   | Optionnel, JSON : gates de `jev-guard` (`{"gates":["A","B"]}`), seuils de `jev-compact` (`{"lines":{"notice":80000,"recommend":120000,"request":160000}}`) |
| `JEV_PAUSED`         | Posée par le bouton Pause de `jev-hud` ; à `1`, aucun mod n'appelle Jev                                                                                    |

Sans clé, les outils `ask_jev*` répondent « No Jev credentials », et `jev-guard` laisse tout passer.

## Où mettre la clé

Le principe : la clé vit dans **un fichier hors de git**, chargé par le shell. On ne la met jamais dans un fichier versionné.

### 1. Un fichier de secrets non versionné

```bash
# ~/.config/zsh/secrets.zsh  (ou ~/.secrets.zsh)
export OPENROUTER_API_KEY="sk-or-..."
```

Si ce fichier est dans un repo de dotfiles, ajoute-le à son `.gitignore`, puis vérifie qu'il est bien ignoré :

```bash
git -C ~/dotfiles check-ignore -v .config/zsh/secrets.zsh
```

### 2. CLI (`claude` dans un terminal)

Charge le fichier depuis **`~/.zprofile`**, lu par les shells de login (un nouvel onglet Terminal sur macOS) :

```bash
[ -f ~/.config/zsh/secrets.zsh ] && source ~/.config/zsh/secrets.zsh
```

Si tu le charges seulement depuis `~/.zshrc`, ça marche dans un shell interactif, mais pas pour tout ce qui démarre via un shell de login.

Vérification, qui doit afficher `ok` :

```bash
zsh -lc '[ -n "$OPENROUTER_API_KEY" ] && echo ok'
```

### 3. App desktop (Claude, onglet Code)

Lancée depuis le Dock, l'app ne lit pas tes fichiers de shell. Pour lui transmettre la clé, passe par launchd. Ajoute cette ligne à `~/.zprofile`, après le `source` des secrets :

```bash
launchctl setenv OPENROUTER_API_KEY "$OPENROUTER_API_KEY"
```

Ensuite, quitte l'app avec **Cmd+Q** et relance-la. La valeur se perd au redémarrage du Mac. Elle est reposée à l'ouverture du premier terminal, ce qui veut dire qu'une app lancée avant ce terminal n'aura pas la clé.

Autre option : lancer l'app depuis un terminal où la clé est chargée.

```bash
open -a Claude
```

### 4. Plusieurs profils (`CLAUDE_CONFIG_DIR`)

Un profil pro (`~/.claude`) et un profil perso (`CLAUDE_CONFIG_DIR=~/.claude-perso`) partagent le même environnement de shell, donc la même clé. Pour avoir une clé par profil, définis-la dans l'alias :

```bash
alias claude-perso='CLAUDE_CONFIG_DIR=$HOME/.claude-perso OPENROUTER_API_KEY=$OPENROUTER_API_KEY_PERSO claude'
```

Les mods, eux, s'installent dans chaque profil :

```bash
CLAUDE_CONFIG_DIR=$HOME/.claude-perso claude plugin marketplace add <chemin du repo claude-mods>
```

## À éviter

- **Le bloc `env` de `~/.claude/settings.json`** : il fonctionne en CLI comme en desktop, mais le fichier est souvent versionné (dotfiles). La clé finirait dans git.
- **`~/.claude/settings.local.json`** : ce fichier n'existe pas au niveau utilisateur. `settings.local.json` n'est lu qu'au niveau projet (`<repo>/.claude/settings.local.json`).
- **Un `.env` dans un repo** : les mods ne le lisent pas.

## Vérifier depuis Claude Code

Demande à Claude un appel de test, par exemple : « appelle ask_jev pour classer “le total de la facture est faux après un remboursement” en bug ou feature ». S'il répond « No Jev credentials », la clé n'a pas atteint le process : revois l'étape de la surface utilisée (CLI ou desktop), puis relance Claude Code.
