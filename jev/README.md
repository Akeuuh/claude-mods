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

Charge le fichier depuis **`~/.zshrc`**, lu par tous les shells interactifs (Terminal, tmux, terminal de l'IDE) :

```bash
[ -f ~/.config/zsh/secrets.zsh ] && source ~/.config/zsh/secrets.zsh
```

Vérification, qui doit afficher `ok` :

```bash
zsh -ic '[ -n "$OPENROUTER_API_KEY" ] && echo ok'
```

### 3. App desktop (Claude, onglet Code)

Lancée depuis le Dock, l'app ne lit pas tes fichiers de shell : elle prend l'environnement de launchd. `launchctl setenv` y pose la clé, mais la valeur se perd au redémarrage du Mac. Pour la reposer à chaque login, crée un LaunchAgent qui source le même fichier de secrets (la clé n'est donc pas écrite dans le plist), dans `~/Library/LaunchAgents/local.openrouter-env.plist` :

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>local.openrouter-env</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/zsh</string>
    <string>-c</string>
    <string>source ~/.config/zsh/secrets.zsh && launchctl setenv OPENROUTER_API_KEY "$OPENROUTER_API_KEY"</string>
  </array>
  <key>RunAtLoad</key><true/>
</dict>
</plist>
```

Active-le une fois ; il tourne aussitôt, puis à chaque login :

```bash
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/local.openrouter-env.plist
```

Une app déjà ouverte garde son ancien environnement : quitte-la avec **Cmd+Q** et relance-la. Si l'app démarre au login avant le LaunchAgent, elle n'aura pas la clé ; relance-la une fois.

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
