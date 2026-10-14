/*
 * Mysh — générateur de script.
 * Fonctionne dans le navigateur (window.Mysh) et dans Node (require).
 * Toutes les valeurs passent par une liste blanche avant d'entrer dans le
 * script : rien de ce que l'interface reçoit n'est recopié tel quel.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Mysh = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const VERSION = '1.0.0';

  const PMS = {
    apt:    { label: 'APT',    distros: 'Debian, Ubuntu, Linux Mint, Pop!_OS', update: 'sudo apt update && sudo apt upgrade' },
    dnf:    { label: 'DNF',    distros: 'Fedora, RHEL, Rocky, Alma',          update: 'sudo dnf upgrade --refresh' },
    pacman: { label: 'Pacman', distros: 'Arch, Manjaro, EndeavourOS',          update: 'sudo pacman -Syu' },
    zypper: { label: 'Zypper', distros: 'openSUSE Tumbleweed, Leap',           update: 'sudo zypper refresh && sudo zypper update' },
  };

  const SHELLS = {
    zsh:  { label: 'Zsh',  desc: 'Compatible Bash, avec suggestions et coloration via deux plugins.' },
    fish: { label: 'Fish', desc: 'Suggestions et couleurs intégrées. Syntaxe différente de Bash.' },
    bash: { label: 'Bash', desc: 'Garder ton shell actuel et ajouter seulement les outils.' },
  };

  const TOOLS = [
    { id: 'eza',       replaces: 'ls',   desc: 'Listes en couleur, icônes, statut Git' },
    { id: 'bat',       replaces: 'cat',  desc: 'Coloration syntaxique, numéros de ligne' },
    { id: 'fzf',       replaces: null,   desc: 'Recherche floue : Ctrl+R (historique), Ctrl+T (fichiers)' },
    { id: 'zoxide',    replaces: 'cd',   desc: '« z proj » saute au dossier le plus visité' },
    { id: 'ripgrep',   replaces: 'grep', desc: 'Recherche rapide, ignore .git et node_modules' },
    { id: 'fd',        replaces: 'find', desc: 'Recherche de fichiers à la syntaxe simple' },
    { id: 'btop',      replaces: 'top',  desc: 'Moniteur système lisible' },
    { id: 'tldr',      replaces: 'man',  desc: 'Exemples concrets pour chaque commande' },
    { id: 'fastfetch', replaces: null,   desc: 'Infos système en un coup d’œil' },
  ];

  const PRESETS = [
    { id: 'tokyo-night',          label: 'Tokyo Night',     nerd: true },
    { id: 'catppuccin-powerline', label: 'Catppuccin',      nerd: true },
    { id: 'pastel-powerline',     label: 'Pastel',          nerd: true },
    { id: 'gruvbox-rainbow',      label: 'Gruvbox',         nerd: true },
    { id: 'pure-preset',          label: 'Pure (minimal)',  nerd: false },
    { id: 'plain-text-symbols',   label: 'Texte seul',      nerd: false },
    { id: '',                     label: 'Par défaut',      nerd: true },
  ];

  const FONTS = [
    { id: 'JetBrainsMono', label: 'JetBrains Mono', family: 'JetBrainsMono Nerd Font' },
    { id: 'FiraCode',      label: 'Fira Code',      family: 'FiraCode Nerd Font' },
    { id: 'Hack',          label: 'Hack',           family: 'Hack Nerd Font' },
    { id: 'CascadiaCode',  label: 'Cascadia Code',  family: 'CaskaydiaCove Nerd Font' },
    { id: '',              label: 'Aucune',         family: '' },
  ];

  const DEFAULTS = {
    pm: 'apt',
    shell: 'zsh',
    chsh: true,
    autosuggestions: true,
    highlighting: true,
    history: true,
    completion: true,
    starship: true,
    preset: 'tokyo-night',
    font: 'JetBrainsMono',
    tools: { eza: true, bat: true, fzf: true, zoxide: true, ripgrep: true, fd: true, btop: true, tldr: true, fastfetch: false },
    replace: { ls: true, cat: true, cd: false, top: false, grep: false, find: false },
    aliasUpdate: true,
    aliasGit: true,
    fastfetchStart: false,
    logo: { on: false, text: '', w: 0, h: 0, style: 'braille', cols: 36, color: 'image', density: 50, ignoreBg: true },
  };

  // Remplacer une commande classique par sa version moderne (alias interactifs uniquement).
  // « risky » : options ou syntaxe différentes, un réflexe peut donner un résultat inattendu.
  const REPLACEMENTS = [
    { id: 'ls',   from: 'ls',   to: 'eza',    tool: 'eza',     risky: false, note: 'Mêmes usages, en couleur, avec icônes et statut Git.' },
    { id: 'cat',  from: 'cat',  to: 'bat',    tool: 'bat',     risky: false, note: 'Affiche les fichiers avec coloration ; ne pagine pas.' },
    { id: 'cd',   from: 'cd',   to: 'zoxide', tool: 'zoxide',  risky: false, note: '« cd dossier » marche comme avant ; « cd proj » saute au dossier le plus visité.' },
    { id: 'top',  from: 'top',  to: 'btop',   tool: 'btop',    risky: false, note: 'Mêmes informations, interface différente.' },
    { id: 'grep', from: 'grep', to: 'rg',     tool: 'ripgrep', risky: true,  note: 'Options différentes : la recherche est récursive par défaut, certaines options changent de sens.' },
    { id: 'find', from: 'find', to: 'fd',     tool: 'fd',      risky: true,  note: 'Syntaxe différente : « find . -name "*.md" » s’écrit « fd -e md ».' },
  ];

  const LOGO_STYLES = ['braille', 'blocks', 'ascii'];
  const LOGO_COLORS = ['image', 'cyan', 'magenta', 'green', 'orange', 'white', 'none'];
  // Un logo ne peut contenir que ces éléments : codes couleur 24 bits écrits
  // « \e[...m », caractères braille, blocs, la rampe ASCII, espaces et retours.
  const LOGO_TOKEN = /\\e\[(?:0|38;2;\d{1,3};\d{1,3};\d{1,3}(?:;48;2;\d{1,3};\d{1,3};\d{1,3})?)m|[\u2800-\u28FF\u2580\u2584\u2588 .:\-=+*#%@\n]/gu;
  const LOGO_MAX_COLS = 80, LOGO_MAX_ROWS = 48, LOGO_MAX_BYTES = 160000;

  function validLogoText(t) {
    if (typeof t !== 'string' || !t || t.length > LOGO_MAX_BYTES) return false;
    if (t.replace(LOGO_TOKEN, '') !== '') return false;
    const lines = t.split('\n');
    return lines.length <= LOGO_MAX_ROWS;
  }

  const clampInt = (v, lo, hi, d) => (Number.isInteger(v) && v >= lo && v <= hi ? v : d);

  const pick = (v, allowed, dflt) => (allowed.includes(v) ? v : dflt);
  const bool = (v, dflt) => (typeof v === 'boolean' ? v : dflt);

  /** Remet n'importe quelle entrée dans les valeurs autorisées. */
  function normalize(input) {
    const i = input && typeof input === 'object' ? input : {};
    const c = {
      pm: pick(i.pm, Object.keys(PMS), DEFAULTS.pm),
      shell: pick(i.shell, Object.keys(SHELLS), DEFAULTS.shell),
      preset: pick(i.preset, PRESETS.map(p => p.id), DEFAULTS.preset),
      font: pick(i.font, FONTS.map(f => f.id), DEFAULTS.font),
      tools: {},
    };
    for (const k of ['chsh', 'autosuggestions', 'highlighting', 'history', 'completion', 'starship',
                     'aliasUpdate', 'aliasGit', 'fastfetchStart']) {
      c[k] = bool(i[k], DEFAULTS[k]);
    }
    for (const t of TOOLS) c.tools[t.id] = bool(i.tools && i.tools[t.id], DEFAULTS.tools[t.id]);

    const ri = i.replace && typeof i.replace === 'object' ? i.replace : {};
    c.replace = {};
    for (const r of REPLACEMENTS) {
      const legacy = r.id === 'cd' && typeof i.zoxideCd === 'boolean' ? i.zoxideCd : undefined;
      c.replace[r.id] = bool(ri[r.id], legacy ?? DEFAULTS.replace[r.id]);
    }
    const li = i.logo && typeof i.logo === 'object' ? i.logo : {};
    const D = DEFAULTS.logo;
    c.logo = {
      on: bool(li.on, D.on),
      style: pick(li.style, LOGO_STYLES, D.style),
      cols: clampInt(li.cols, 12, 64, D.cols),
      color: pick(li.color, LOGO_COLORS, D.color),
      density: clampInt(li.density, 5, 95, D.density),
      ignoreBg: bool(li.ignoreBg, D.ignoreBg),
      text: '', w: 0, h: 0,
    };
    if (validLogoText(li.text)) {
      c.logo.text = li.text;
      c.logo.h = li.text.split('\n').length;
      c.logo.w = clampInt(li.w, 1, LOGO_MAX_COLS, 0);
    }
    if (!c.logo.text || !c.logo.w) c.logo.on = false;
    if (c.logo.on) c.tools.fastfetch = true;
    if (!c.tools.fastfetch) c.fastfetchStart = false;
    for (const r of REPLACEMENTS) if (!c.tools[r.tool]) c.replace[r.id] = false;
    return c;
  }

  function logicalPackages(c) {
    const out = [];
    if (c.shell !== 'bash') out.push(c.shell);
    if (c.shell === 'zsh' && c.autosuggestions) out.push('zsh-autosuggestions');
    if (c.shell === 'zsh' && c.highlighting) out.push('zsh-syntax-highlighting');
    for (const t of TOOLS) if (c.tools[t.id]) out.push(t.id);
    return out;
  }

  // ---------------------------------------------------------------- init files
  function shAliases(c) {
    const icons = c.font ? ' --icons' : '';
    const R = c.replace;
    const L = [];
    if (REPLACEMENTS.some(r => R[r.id])) L.push(
      '# Les commandes d’origine restent installées. Pour les lancer malgré un alias :',
      '#   \\ls   ou   command ls',
      '# Les alias ne valent que dans ton terminal : les scripts ne sont jamais concernés.', '');
    if (c.tools.eza) L.push(
      '# eza' + (R.ls ? ' (remplace ls)' : ''),
      'if command -v eza >/dev/null 2>&1; then',
      ...(R.ls ? [`  alias ls='eza --group-directories-first${icons}'`] : []),
      `  alias ll='eza -lah --group-directories-first${icons} --git'`,
      `  alias lt='eza --tree --level=2${icons}'`,
      'fi', '');
    if (c.tools.bat) L.push(
      '# bat' + (R.cat ? ' (remplace cat)' : '') + ' ; il s’appelle batcat sur Debian/Ubuntu',
      'if command -v batcat >/dev/null 2>&1; then',
      ...(R.cat ? ["  alias cat='batcat --paging=never'"] : []),
      "  command -v bat >/dev/null 2>&1 || alias bat='batcat'",
      ...(R.cat ? ['elif command -v bat >/dev/null 2>&1; then', "  alias cat='bat --paging=never'"] : []),
      'fi', '');
    if (c.tools.fd) L.push(
      '# fd' + (R.find ? ' (remplace find)' : '') + ' ; il s’appelle fdfind sur Debian/Ubuntu',
      'if command -v fdfind >/dev/null 2>&1; then',
      "  command -v fd >/dev/null 2>&1 || alias fd='fdfind'",
      ...(R.find ? ["  alias find='fdfind'", 'elif command -v fd >/dev/null 2>&1; then', "  alias find='fd'"] : []),
      'fi', '');
    if (R.top) L.push('# btop (remplace top)', 'if command -v btop >/dev/null 2>&1; then', "  alias top='btop'", 'fi', '');
    if (R.grep) L.push('# ripgrep (remplace grep)', 'if command -v rg >/dev/null 2>&1; then', "  alias grep='rg'", 'fi', '');
    if (c.aliasUpdate) L.push('# Mise à jour du système', `alias update='${PMS[c.pm].update}'`, '');
    if (c.aliasGit) L.push(
      '# Raccourcis Git',
      "alias gs='git status -sb'",
      "alias ga='git add'",
      "alias gc='git commit'",
      "alias gp='git push'",
      "alias gd='git diff'",
      "alias gl='git log --oneline --graph --decorate -20'", '');
    return L;
  }

  function firstReadable(paths, action) {
    return [
      `for _cq_f in ${paths.join(' ')}; do`,
      `  if [ -r "$_cq_f" ]; then ${action} "$_cq_f"; break; fi`,
      'done',
      'unset _cq_f',
    ];
  }

  function header(c, shellName) {
    return [
      `# Mysh ${VERSION} — configuration ${shellName}`,
      '# Fichier écrit par Mysh. Tu peux le modifier ; il sera remplacé si',
      '# tu relances le script, et supprimé par « mysh.sh --uninstall ».',
      '',
    ];
  }

  const PATH_LINE = [
    '# Commandes installées dans ~/.local/bin',
    'case ":$PATH:" in *":$HOME/.local/bin:"*) ;; *) export PATH="$HOME/.local/bin:$PATH" ;; esac',
    '',
  ];

  function startupSh(c) {
    const L = [c.logo.on ? '# Logo et infos système à l’ouverture' : '# Infos système à l’ouverture',
               'if command -v fastfetch >/dev/null 2>&1; then', '  fastfetch'];
    if (c.logo.on) L.push('elif [ -r "${XDG_CONFIG_HOME:-$HOME/.config}/mysh/logo.txt" ]; then',
                          '  cat "${XDG_CONFIG_HOME:-$HOME/.config}/mysh/logo.txt"');
    L.push('fi', '');
    return L;
  }

  function initZsh(c) {
    const L = header(c, 'Zsh').concat(PATH_LINE);
    if (c.history) L.push(
      '# Historique : partagé entre terminaux, sans doublons',
      'HISTFILE="${HISTFILE:-$HOME/.zsh_history}"',
      'HISTSIZE=50000',
      'SAVEHIST=50000',
      'setopt share_history hist_ignore_all_dups hist_reduce_blanks', '');
    if (c.completion) L.push(
      '# Complétion : menu navigable, insensible à la casse',
      'autoload -Uz compinit && compinit',
      "zstyle ':completion:*' menu select",
      "zstyle ':completion:*' matcher-list 'm:{a-z}={A-Za-z}'", '');
    if (c.autosuggestions) L.push('# Suggestions grisées (flèche → pour accepter)',
      ...firstReadable(['/usr/share/zsh-autosuggestions/zsh-autosuggestions.zsh',
                        '/usr/share/zsh/plugins/zsh-autosuggestions/zsh-autosuggestions.zsh'], 'source'), '');
    L.push(...shAliases(c));
    if (c.tools.zoxide) L.push('# zoxide',
      'if command -v zoxide >/dev/null 2>&1; then',
      `  eval "$(zoxide init zsh${c.replace.cd ? ' --cmd cd' : ''})"`,
      'fi', '');
    if (c.tools.fzf) L.push('# fzf : Ctrl+R (historique), Ctrl+T (fichiers)',
      'if command -v fzf >/dev/null 2>&1; then',
      '  if fzf --zsh >/dev/null 2>&1; then',
      '    source <(fzf --zsh)',
      '  else',
      ...firstReadable(['/usr/share/doc/fzf/examples/key-bindings.zsh', '/usr/share/fzf/key-bindings.zsh',
                        '/usr/share/fzf/shell/key-bindings.zsh'], 'source').map(s => '    ' + s),
      '  fi',
      'fi', '');
    if (c.starship) L.push('# Prompt Starship',
      'if command -v starship >/dev/null 2>&1; then',
      '  eval "$(starship init zsh)"',
      'fi', '');
    if (c.fastfetchStart) L.push(...startupSh(c));
    if (c.highlighting) L.push('# Coloration des commandes (doit rester en dernier)',
      ...firstReadable(['/usr/share/zsh-syntax-highlighting/zsh-syntax-highlighting.zsh',
                        '/usr/share/zsh/plugins/zsh-syntax-highlighting/zsh-syntax-highlighting.zsh'], 'source'), '');
    return L;
  }

  function initBash(c) {
    const L = header(c, 'Bash').concat([
      '# Rien à faire hors d’un terminal interactif',
      'case $- in *i*) ;; *) return ;; esac', '',
    ], PATH_LINE);
    L.push(...shAliases(c));
    if (c.tools.zoxide) L.push('# zoxide',
      'if command -v zoxide >/dev/null 2>&1; then',
      `  eval "$(zoxide init bash${c.replace.cd ? ' --cmd cd' : ''})"`,
      'fi', '');
    if (c.tools.fzf) L.push('# fzf : Ctrl+R (historique), Ctrl+T (fichiers)',
      'if command -v fzf >/dev/null 2>&1; then',
      '  if fzf --bash >/dev/null 2>&1; then',
      '    eval "$(fzf --bash)"',
      '  else',
      ...firstReadable(['/usr/share/doc/fzf/examples/key-bindings.bash', '/usr/share/fzf/key-bindings.bash',
                        '/usr/share/fzf/shell/key-bindings.bash'], 'source').map(s => '    ' + s),
      '  fi',
      'fi', '');
    if (c.starship) L.push('# Prompt Starship',
      'if command -v starship >/dev/null 2>&1; then',
      '  eval "$(starship init bash)"',
      'fi', '');
    if (c.fastfetchStart) L.push(...startupSh(c));
    return L;
  }

  function initFish(c) {
    const icons = c.font ? ' --icons' : '';
    const L = header(c, 'Fish');
    L.push('if status is-interactive');
    L.push('    # Commandes installées dans ~/.local/bin',
           '    if functions -q fish_add_path', '        fish_add_path -g $HOME/.local/bin', '    end', '');
    const R = c.replace;
    if (REPLACEMENTS.some(r => R[r.id])) L.push(
      '    # Les commandes d’origine restent installées. Pour les lancer malgré un alias :',
      '    #   command ls', '');
    if (c.tools.eza) L.push('    if type -q eza',
      ...(R.ls ? [`        alias ls 'eza --group-directories-first${icons}'`] : []),
      `        alias ll 'eza -lah --group-directories-first${icons} --git'`,
      `        alias lt 'eza --tree --level=2${icons}'`, '    end', '');
    if (c.tools.bat) L.push('    if type -q batcat',
      ...(R.cat ? ["        alias cat 'batcat --paging=never'"] : []),
      "        type -q bat; or alias bat 'batcat'",
      ...(R.cat ? ['    else if type -q bat', "        alias cat 'bat --paging=never'"] : []), '    end', '');
    if (c.tools.fd) L.push('    if type -q fdfind',
      "        type -q fd; or alias fd 'fdfind'",
      ...(R.find ? ["        alias find 'fdfind'", '    else if type -q fd', "        alias find 'fd'"] : []), '    end', '');
    if (R.top) L.push('    if type -q btop', "        alias top 'btop'", '    end', '');
    if (R.grep) L.push('    if type -q rg', "        alias grep 'rg'", '    end', '');
    if (c.aliasUpdate) L.push(`    alias update '${PMS[c.pm].update}'`, '');
    if (c.aliasGit) L.push(
      "    abbr -a gs 'git status -sb'", "    abbr -a ga 'git add'", "    abbr -a gc 'git commit'",
      "    abbr -a gp 'git push'", "    abbr -a gd 'git diff'",
      "    abbr -a gl 'git log --oneline --graph --decorate -20'", '');
    if (c.tools.zoxide) L.push('    if type -q zoxide',
      `        zoxide init fish${c.replace.cd ? ' --cmd cd' : ''} | source`, '    end', '');
    if (c.tools.fzf) L.push('    if type -q fzf; and fzf --fish >/dev/null 2>&1',
      '        fzf --fish | source', '    end', '');
    if (c.fastfetchStart) {
      L.push('    set -g fish_greeting', '    if type -q fastfetch', '        fastfetch');
      if (c.logo.on) L.push('    else if test -r (set -q XDG_CONFIG_HOME; and echo $XDG_CONFIG_HOME; or echo $HOME/.config)/mysh/logo.txt',
                            '        cat (set -q XDG_CONFIG_HOME; and echo $XDG_CONFIG_HOME; or echo $HOME/.config)/mysh/logo.txt');
      L.push('    end', '');
    }
    if (c.starship) L.push('    if type -q starship', '        starship init fish | source', '    end');
    L.push('end');
    return L;
  }

  function initContent(c) {
    const L = c.shell === 'zsh' ? initZsh(c) : c.shell === 'bash' ? initBash(c) : initFish(c);
    while (L.length && L[L.length - 1] === '') L.pop();
    return L.join('\n');
  }

  // ---------------------------------------------------------------- summary
  function summarize(input) {
    const c = normalize(input);
    const rc = c.shell === 'zsh' ? '~/.zshrc' : c.shell === 'bash' ? '~/.bashrc' : null;
    const init = c.shell === 'fish' ? '~/.config/fish/conf.d/mysh.fish' : `~/.config/mysh/init.${c.shell}`;
    const files = [];
    if (rc) files.push({ path: rc, what: 'un bloc de 4 lignes ajouté à la fin, fichier sauvegardé avant' });
    files.push({ path: init, what: 'ta configuration, dans un fichier à part' });
    if (c.starship && c.preset) files.push({ path: '~/.config/starship.toml', what: `thème « ${PRESETS.find(p => p.id === c.preset).label} », fichier sauvegardé avant` });
    const downloads = [];
    if (c.font) downloads.push(`Police ${FONTS.find(f => f.id === c.font).label} (Nerd Fonts 3.5.1)`);
    if (c.starship) downloads.push('Starship 1.26.0, seulement s’il n’est pas dans tes dépôts');
    if (c.tools.fastfetch) downloads.push('fastfetch 2.69.0, seulement s’il n’est pas dans tes dépôts');
    if (c.logo.on) {
      files.push({ path: '~/.config/mysh/logo.txt', what: `ton logo, ${c.logo.w}×${c.logo.h} caractères` });
      files.push({ path: '~/.config/fastfetch/config.jsonc', what: 'fastfetch affiche ton logo, fichier sauvegardé avant' });
    }
    return {
      config: c,
      packages: logicalPackages(c).concat(c.starship ? ['starship'] : []),
      files,
      downloads,
      replaced: REPLACEMENTS.filter(r => c.replace[r.id]).map(r => `${r.from} → ${r.to}`),
      chsh: c.chsh && c.shell !== 'bash' ? c.shell : null,
      fontFamily: c.font ? FONTS.find(f => f.id === c.font).family : '',
    };
  }

  // ---------------------------------------------------------------- script
  function describe(c) {
    const yes = b => (b ? 'oui' : 'non');
    const tools = TOOLS.filter(t => c.tools[t.id]).map(t => t.id).join(', ') || 'aucun';
    const lines = [
      `Gestionnaire de paquets : ${c.pm} (${PMS[c.pm].distros})`,
      `Shell                   : ${c.shell}${c.chsh && c.shell !== 'bash' ? ' (devient le shell par défaut)' : ''}`,
    ];
    if (c.shell === 'zsh') lines.push(
      `Plugins Zsh             : suggestions ${yes(c.autosuggestions)}, coloration ${yes(c.highlighting)}`,
      `Historique, complétion  : ${yes(c.history)}, ${yes(c.completion)}`);
    lines.push(
      `Prompt Starship         : ${c.starship ? (PRESETS.find(p => p.id === c.preset).label) : 'non'}`,
      `Police Nerd Font        : ${c.font ? FONTS.find(f => f.id === c.font).label : 'aucune'}`,
      `Outils                  : ${tools}`,
      `Commandes remplacées    : ${REPLACEMENTS.filter(r => c.replace[r.id]).map(r => `${r.from}→${r.to}`).join(', ') || 'aucune'}`,
      `Alias                   : update ${yes(c.aliasUpdate)}, git ${yes(c.aliasGit)}`,
      `Logo personnalisé       : ${c.logo.on ? `${{ braille: 'braille', blocks: 'blocs', ascii: 'ASCII' }[c.logo.style]}, ${c.logo.w}×${c.logo.h} caractères` : 'non'}`);
    return lines;
  }

  function buildScript(input, engine) {
    if (typeof engine !== 'string' || !engine.includes('main "$@"')) throw new Error('Moteur Mysh manquant');
    const c = normalize(input);
    const init = initContent(c);
    if (init.includes('MYSH_EOF')) throw new Error('Contenu invalide');
    const out = [
      '#!/usr/bin/env bash',
      '# =============================================================================',
      `#  Mysh ${VERSION} — personnalisation du terminal Linux`,
      '#  Script généré par l’interface Mysh. Lis-le avant de l’exécuter :',
      '#  tout ce qu’il fait est écrit ici, rien n’est téléchargé en plus sauf les',
      '#  fichiers listés plus bas, vérifiés par leur empreinte SHA-256.',
      '#',
      '#  Tes choix :',
      ...describe(c).map(l => '#    ' + l),
      '#',
      '#  Utilisation :',
      '#    chmod +x mysh-install.sh',
      '#    ./mysh-install.sh --dry-run     # voir ce qui serait fait, sans rien changer',
      '#    ./mysh-install.sh               # installer',
      '#',
      '#  Annuler :',
      '#    ~/.local/share/mysh/mysh.sh --uninstall',
      '#    ~/.local/share/mysh/mysh.sh --uninstall --remove-packages',
      '# =============================================================================',
      'set -Eeuo pipefail',
      '',
      '# --- Tes choix --------------------------------------------------------------',
      `MYSH_VERSION="${VERSION}"`,
      `CFG_PM="${c.pm}"`,
      `CFG_SHELL="${c.shell}"`,
      `CFG_CHSH=${c.chsh && c.shell !== 'bash' ? 1 : 0}`,
      `CFG_PACKAGES=(${logicalPackages(c).join(' ')})`,
      `CFG_STARSHIP=${c.starship ? 1 : 0}`,
      `CFG_STARSHIP_PRESET="${c.starship ? c.preset : ''}"`,
      `CFG_FONT="${c.font}"`,
      `CFG_TLDR_UPDATE=${c.tools.tldr ? 1 : 0}`,
      `CFG_LOGO=${c.logo.on ? 1 : 0}`,
      `CFG_LOGO_WIDTH=${c.logo.on ? c.logo.w : 0}`,
      `CFG_LOGO_HEIGHT=${c.logo.on ? c.logo.h : 0}`,
      '',
      '# --- Contenu du fichier de configuration que le script va écrire -----------',
      'mysh_init_content() {',
      "  cat <<'MYSH_EOF'",
      init,
      'MYSH_EOF',
      '}',
      '',
      '# --- Logo (codes couleur écrits « \\e[...m », convertis à l’installation) ---',
      'mysh_logo_content() {',
      ...(c.logo.on ? ["  cat <<'MYSH_LOGO'", c.logo.text, 'MYSH_LOGO'] : ['  :']),
      '}',
      '',
    ];
    return out.join('\n') + engine.replace(/^\s+/, '') ;
  }

  return { VERSION, PMS, SHELLS, TOOLS, PRESETS, FONTS, DEFAULTS, REPLACEMENTS, LOGO_STYLES, LOGO_COLORS, normalize, summarize, buildScript, initContent, validLogoText };
});
