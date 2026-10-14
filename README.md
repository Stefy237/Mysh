# Mysh

Configure ton terminal Linux depuis une page web, et récupère un **script d'installation lisible, vérifiable et réversible**.

On choisit sa distribution, son shell, un thème de prompt, une police et des outils. La page génère un script Bash. On peut le lire, vérifier son empreinte SHA-256, le lancer en simulation, puis l'installer, et l'annuler plus tard.

## Ce que l'on peut configurer

| Catégorie | Options |
|---|---|
| Distribution | APT (Debian, Ubuntu, Mint), DNF (Fedora, RHEL, Rocky, Alma), Pacman (Arch, Manjaro), Zypper (openSUSE) |
| Shell | Zsh (suggestions, coloration, historique partagé, complétion en menu), Fish, ou garder Bash |
| Prompt | Starship avec un thème : Tokyo Night, Catppuccin, Pastel, Gruvbox, Pure, texte seul, ou celui par défaut |
| Police | JetBrains Mono, Fira Code, Hack ou Cascadia Code (Nerd Fonts) |
| Outils | eza, bat, fzf, zoxide, ripgrep, fd, btop, tldr, fastfetch |
| Commandes classiques | `ls` → eza et `cat` → bat (activés par défaut) ; `cd` → zoxide, `top` → btop, `grep` → rg, `find` → fd (au choix) |
| Confort | alias `update`, raccourcis Git, fastfetch à l'ouverture |
| Logo | une image à toi, convertie en caractères (braille, blocs ou ASCII), affichée par fastfetch |

## Logo personnalisé

On dépose une image sur la page, et elle est convertie **dans le navigateur** en caractères colorés :

- braille, pour un rendu fin ;
- demi-blocs `▀▄`, pour des pixels en couleurs pleines ;
- rampe ASCII, pour du texte classique.

On règle la largeur, la densité et la couleur (celles de l'image, une seule couleur, ou aucune). On peut aussi retirer le fond. Le résultat est écrit dans le script, avec les codes couleur sous la forme `\e[38;2;R;G;Bm` pour qu'il reste lisible.

À l'installation :

- `~/.config/mysh/logo.txt` reçoit le logo, avec de vrais codes couleur ;
- `~/.config/fastfetch/config.jsonc` l'utilise, avec `"type": "file-raw"`. Une éventuelle configuration existante est sauvegardée avant ;
- si fastfetch est absent des dépôts (par exemple sur Ubuntu 24.04), la version épinglée est téléchargée depuis GitHub ;
- si fastfetch n'est pas disponible du tout, le logo s'affiche seul à l'ouverture du terminal.

Le texte du logo passe par une liste blanche stricte (`validLogoText`) : codes couleur 24 bits, braille, blocs, rampe ASCII, espaces. Rien d'autre ne peut entrer dans le script par ce biais.

## Utilisation

```bash
sha256sum mysh-install.sh        # comparer avec l'empreinte affichée sur la page
chmod +x mysh-install.sh
./mysh-install.sh --dry-run      # voir chaque commande, sans rien modifier
./mysh-install.sh                # installer (un résumé s'affiche, puis demande confirmation)
```

Options : `--dry-run`, `--yes` (sans questions), `--uninstall`, `--remove-packages`, `--help`.

## Annuler

```bash
~/.local/share/mysh/mysh.sh --uninstall --dry-run          # voir ce qui sera annulé
~/.local/share/mysh/mysh.sh --uninstall                    # annuler
~/.local/share/mysh/mysh.sh --uninstall --remove-packages  # annuler et supprimer les paquets installés
```

Pendant l'installation, le script se copie dans `~/.local/share/mysh/`. Il y écrit aussi un **manifeste** qui liste ce qu'il a modifié, et y garde les **sauvegardes** des fichiers d'origine. L'annulation suit ce manifeste :

- elle retire le bloc entre `# >>> mysh >>>` et `# <<< mysh <<<` dans `~/.zshrc` ou `~/.bashrc`, sans toucher au reste du fichier ;
- elle supprime `~/.config/mysh/` (ou `~/.config/fish/conf.d/mysh.fish`) ;
- elle restaure l'ancien `starship.toml`, ou supprime celui de Mysh s'il n'en existait pas ;
- elle supprime le logo et restaure l'ancienne configuration fastfetch, ou supprime celle de Mysh ;
- elle supprime Starship, fastfetch et la police s'ils ont été téléchargés dans `~/.local` ;
- elle remet l'ancien shell par défaut ;
- elle **conserve les paquets** par défaut. Avec `--remove-packages`, elle supprime uniquement ceux que Mysh a installés.

Le dossier d'état est ensuite renommé en `mysh.annule-<date>`, et les sauvegardes y restent.

## Modèle de sécurité

- **Rien ne quitte le navigateur.** Le script est assemblé côté client, sans serveur ni statistiques.
- **Script déterministe.** Les mêmes choix donnent toujours le même fichier, donc la même empreinte SHA-256.
- **Entrées filtrées.** Toutes les options passent par une liste blanche (`normalize` dans `src/generator.js`) avant d'entrer dans le script.
- **Dépôts officiels d'abord.** Les paquets passent par le gestionnaire de la distribution, avec ses signatures.
- **Téléchargements épinglés.** Starship et fastfetch (seulement s'ils ne sont pas dans les dépôts) et les Nerd Fonts viennent de GitHub, en HTTPS uniquement. Leur version et leur empreinte SHA-256 sont **écrites dans le script**. fastfetch ne publiant pas de fichier d'empreintes, la sienne a été calculée à l'épinglage, sur l'archive officielle téléchargée en HTTPS. Si l'empreinte ne correspond pas, le fichier est supprimé et le script s'arrête.
- **Jamais en root.** Le script refuse de tourner en root et n'appelle `sudo` que pour le gestionnaire de paquets.
- **Fichiers système préservés.** Avec APT, `--force-confold` garde toujours les fichiers de `/etc` déjà modifiés.
- **Relançable.** Le bloc ajouté dans le fichier de configuration du shell est remplacé, jamais dupliqué. Les sauvegardes d'origine sont conservées.
- **Arrêt propre.** Avec `set -Eeuo pipefail`, le script s'arrête à la première erreur et indique comment revenir en arrière.

## Structure

```
src/engine.sh        moteur du script (identique pour toutes les configurations)
src/generator.js     options, filtrage et assemblage du script (navigateur et Node)
src/index.html       structure de la page (balises seulement)
src/styles.css       apparence : thème Console, en mode clair et sombre
src/app.js           logique de la page : formulaire, aperçu, logo, téléchargement
build.mjs            réunit le tout dans dist/index.html, une page autonome
tools/generate.mjs   génère des scripts en ligne de commande (tests)
tests/container-test.sh   test d'intégration dans un conteneur
.github/workflows/ci.yml  ShellCheck + tests sur 5 distributions + GitHub Pages
```

## Commandes classiques

Les alias ne remplacent rien sur le disque : `ls`, `cat`, `grep`… restent installés. Ils ne s'appliquent que dans un terminal interactif, donc les scripts et `sudo` utilisent toujours les vraies commandes. Pour passer outre le temps d'une commande : `\ls` ou `command ls` (Fish : `command ls`).

`grep` → rg et `find` → fd sont marqués « prudence » : leurs options diffèrent, et une habitude comme `find . -name "*.md"` ne marche plus telle quelle.

## Ouvrir la page en local

Ouvre **`dist/index.html`** dans ton navigateur. `src/index.html` n'est que le modèle : sans `node build.mjs`, il ne contient ni le moteur ni le générateur, et il affiche seulement un avertissement.

```bash
node build.mjs                                   # (re)génère dist/index.html
python3 -m http.server --directory dist 8000     # optionnel : http://localhost:8000
```

La page construite embarque une politique de sécurité du contenu (CSP). Seuls ses deux scripts, identifiés par leur empreinte, peuvent s'exécuter, et `connect-src 'none'` interdit toute requête réseau.

## Développement

```bash
node build.mjs                      # -> dist/index.html
node tools/generate.mjs out         # scripts de test pour chaque gestionnaire de paquets
shellcheck out/*.sh
```

La CI génère les scripts et les passe à ShellCheck. Ensuite, sur Debian 13, Ubuntu 24.04, Fedora 42, Arch et openSUSE Tumbleweed, elle installe, relance, désinstalle, puis vérifie que les fichiers personnels sont revenus **identiques octet par octet**. Sur `main`, la page est publiée sur GitHub Pages.

Pour publier la page, active GitHub Pages dans *Settings → Pages* avec la source *GitHub Actions*.

### Mettre à jour une version épinglée

1. Choisis une version publiée depuis au moins deux semaines.
2. Récupère l'empreinte depuis la page de la release, par exemple `starship-x86_64-unknown-linux-musl.tar.gz.sha256`, ou `SHA-256.txt` pour Nerd Fonts.
3. Remplace la version et l'empreinte en haut de `src/engine.sh`, puis lance la CI.

## Licence

MIT
