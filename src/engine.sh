# =============================================================================
#  MOTEUR MYSH
#  Cette partie est identique pour toutes les configurations. Elle lit les
#  variables CFG_* définies plus haut et la fonction mysh_init_content.
# =============================================================================

# --- Téléchargements épinglés -------------------------------------------------
# Utilisés seulement si l'outil n'est pas dans les dépôts de ta distribution.
# L'empreinte SHA-256 est écrite ici, dans le script : un fichier modifié sur
# le serveur ne passera pas la vérification.
STARSHIP_VERSION="1.26.0"
STARSHIP_SHA256_X86_64="b7c232b0e8249d8e55a40beb79c5c43a7d370f3f9408bd215deb0170daeaadf3"
STARSHIP_SHA256_AARCH64="dc30189378d2f2e287384e8a692d3f95ad1df64cf0e8c36aa9201516028aed6b"
NERDFONT_VERSION="3.5.1"
# fastfetch ne publie pas de fichier d'empreintes : celles-ci ont été calculées
# à l'épinglage, sur les archives de la release officielle téléchargées en HTTPS.
FASTFETCH_VERSION="2.69.0"
FASTFETCH_SHA256_AMD64="9fe880a34de3fec88e57a69230c02fd7be0846db3f3ea9f88f2b74489a79ff55"
FASTFETCH_SHA256_AARCH64="843a0d4e3d604efc7cce18df1efcc09b00a1960cfea9949118b50bf999694027"

nerdfont_sha256() {
  case "$1" in
    JetBrainsMono) echo "04d5e8f903693f9dd13e16f867e994834e681eb3c72c0d337a770dcda09010cf" ;;
    FiraCode)      echo "68e3bd6164864b8b514605bc34e3a87ac401c8c48682fcce6478c70263340207" ;;
    Hack)          echo "cdd389472e10e2261520140ff1b382b4f8a226af5fd0b2735b975d31151d9c3c" ;;
    CascadiaCode)  echo "ae598e9401e2846aa3ee364513715de0490b844a4b54f0768991f45f23aa8369" ;;
    *) return 1 ;;
  esac
}

nerdfont_family() {
  case "$1" in
    CascadiaCode) echo "CaskaydiaCove Nerd Font" ;;
    *) echo "$1 Nerd Font" ;;
  esac
}

# --- Emplacements ---------------------------------------------------------------
DATA_HOME="${XDG_DATA_HOME:-$HOME/.local/share}"
CONF_HOME="${XDG_CONFIG_HOME:-$HOME/.config}"
STATE_DIR="$DATA_HOME/mysh"
MANIFEST="$STATE_DIR/manifest"
MYSH_CONF_DIR="$CONF_HOME/mysh"
LOCAL_BIN="$HOME/.local/bin"
MARK_BEGIN="# >>> mysh >>>"
MARK_END="# <<< mysh <<<"

DRY_RUN=0
ASSUME_YES=0
MODE="install"
REMOVE_PKGS=0
TMP_DIR=""
declare -A M=()

# --- Affichage ------------------------------------------------------------------
if [ -t 1 ]; then
  C_B=$'\e[1m'; C_DIM=$'\e[2m'; C_RED=$'\e[31m'; C_GRN=$'\e[32m'
  C_YEL=$'\e[33m'; C_BLU=$'\e[34m'; C_RST=$'\e[0m'
else
  C_B=""; C_DIM=""; C_RED=""; C_GRN=""; C_YEL=""; C_BLU=""; C_RST=""
fi

info() { printf '%s==>%s %s\n' "$C_BLU$C_B" "$C_RST" "$*"; }
ok()   { printf '%s  ✓%s %s\n' "$C_GRN" "$C_RST" "$*"; }
warn() { printf '%s  !%s %s\n' "$C_YEL" "$C_RST" "$*" >&2; }
die()  { printf '%s  ✗ %s%s\n' "$C_RED" "$*" "$C_RST" >&2; exit 1; }
item() { printf '    • %s\n' "$*"; }

# Exécute une commande, ou se contente de l'afficher en mode --dry-run.
run() {
  if [ "$DRY_RUN" = 1 ]; then
    printf '%s    [simulation]' "$C_DIM"
    printf ' %q' "$@"
    printf '%s\n' "$C_RST"
    return 0
  fi
  "$@"
}

cleanup() { [ -n "$TMP_DIR" ] && rm -rf "$TMP_DIR"; return 0; }
on_error() {
  printf '\n%s  ✗ Erreur à la ligne %s. Le script s'"'"'est arrêté.%s\n' "$C_RED" "$1" "$C_RST" >&2
  if [ -r "$MANIFEST" ]; then
    printf '    Pour revenir en arrière : %s --uninstall\n' "$STATE_DIR/mysh.sh" >&2
  fi
}
trap cleanup EXIT
trap 'on_error $LINENO' ERR

usage() {
  cat <<EOF
Mysh $MYSH_VERSION — personnalisation du terminal

Utilisation :
  $0                  installe la configuration choisie (demande confirmation)
  $0 --dry-run        affiche tout ce qui serait fait, sans rien modifier
  $0 --uninstall      annule les changements de Mysh
  $0 --uninstall --remove-packages
                      annule les changements ET supprime les paquets que
                      Mysh a installés

Options :
  -n, --dry-run       simulation, aucune modification
  -y, --yes           ne pose pas de questions (pour l'automatisation)
  -h, --help          affiche cette aide
EOF
}

parse_args() {
  while [ $# -gt 0 ]; do
    case "$1" in
      -n|--dry-run)      DRY_RUN=1 ;;
      -y|--yes)          ASSUME_YES=1 ;;
      --uninstall)       MODE="uninstall" ;;
      --remove-packages) REMOVE_PKGS=1 ;;
      -h|--help)         usage; exit 0 ;;
      *) die "Option inconnue : $1 (voir --help)" ;;
    esac
    shift
  done
}

confirm() {
  [ "$ASSUME_YES" = 1 ] && return 0
  [ "$DRY_RUN" = 1 ] && return 0
  local reply=""
  read -r -p "$1 [o/N] " reply </dev/tty || return 1
  case "$reply" in o|O|oui|Oui|y|Y|yes) return 0 ;; *) return 1 ;; esac
}

# --- Manifeste : la mémoire de ce que Mysh a changé ---------------------------
manifest_load() {
  [ -r "$MANIFEST" ] || return 1
  local line
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in ''|'#'*) continue ;; esac
    M["${line%%=*}"]="${line#*=}"
  done < "$MANIFEST"
}

mset_once() { [ -n "${M[$1]:-}" ] || M["$1"]="$2"; }

manifest_save() {
  if [ "$DRY_RUN" = 1 ]; then
    info "Simulation : le manifeste ($MANIFEST) n'est pas écrit."
    return 0
  fi
  mkdir -p "$STATE_DIR"
  {
    echo "# Mysh — ce que le script a modifié. Utilisé par --uninstall."
    echo "# Ne modifie ce fichier que si tu sais ce que tu fais."
    local k
    for k in VERSION PM SHELL RC_FILE RC_CREATED INIT_FILE ORIGINAL_SHELL SHELL_CHANGED \
             STARSHIP_TOML STARSHIP_BIN FASTFETCH_CONF FASTFETCH_BIN FONT_DIR BACKUP_DIR PACKAGES; do
      printf '%s=%s\n' "$k" "${M[$k]:-}"
    done
  } > "$MANIFEST"
  chmod 600 "$MANIFEST"
}

# --- Gestionnaire de paquets --------------------------------------------------------
pm_binary() {
  case "$1" in
    apt) echo apt-get ;; dnf) echo dnf ;; pacman) echo pacman ;; zypper) echo zypper ;;
    *) return 1 ;;
  esac
}

# Nom logique de l'outil -> nom du paquet sur la distribution choisie.
pkg_name() {
  case "$CFG_PM:$1" in
    apt:fd|dnf:fd) echo fd-find ;;
    *:tldr)        echo tealdeer ;;
    apt:xz)        echo xz-utils ;;
    *)             echo "$1" ;;
  esac
}

# shellcheck disable=SC2016  # ${Status} est un format dpkg, pas une variable
pkg_installed() {
  case "$CFG_PM" in
    apt)        dpkg-query -W -f='${Status}' "$1" 2>/dev/null | grep -q "install ok installed" ;;
    dnf|zypper) rpm -q "$1" >/dev/null 2>&1 ;;
    pacman)     pacman -Qi "$1" >/dev/null 2>&1 ;;
  esac
}

pkg_available() {
  case "$CFG_PM" in
    apt)    apt-cache show "$1" >/dev/null 2>&1 ;;
    dnf)    dnf -q info "$1" >/dev/null 2>&1 ;;
    pacman) pacman -Si "$1" >/dev/null 2>&1 ;;
    zypper) zypper -n -q search -x -t package "$1" >/dev/null 2>&1 ;;
  esac
}

pm_refresh() {
  case "$CFG_PM" in
    apt) run sudo apt-get update -qq ;;
    *)   return 0 ;;
  esac
}

pm_install() {
  case "$CFG_PM" in
    # confdef/confold : si un fichier système (ex. /etc/zsh/zshrc) a été
    # modifié, on garde toujours ta version au lieu de l'écraser.
    apt)    run sudo env DEBIAN_FRONTEND=noninteractive apt-get install -y \
              -o Dpkg::Options::=--force-confdef -o Dpkg::Options::=--force-confold "$@" ;;
    dnf)    run sudo dnf install -y "$@" ;;
    pacman) run sudo pacman -S --needed --noconfirm "$@" ;;
    zypper) run sudo zypper -n install "$@" ;;
  esac
}

pm_remove_cmd() {
  case "$1" in
    apt)    echo "sudo apt-get remove" ;;
    dnf)    echo "sudo dnf remove" ;;
    pacman) echo "sudo pacman -Rs" ;;
    zypper) echo "sudo zypper remove" ;;
  esac
}

pm_remove() {
  local pm="$1"; shift
  case "$pm" in
    apt)    run sudo apt-get remove -y "$@" ;;
    dnf)    run sudo dnf remove -y "$@" ;;
    pacman) run sudo pacman -Rs --noconfirm "$@" ;;
    zypper) run sudo zypper -n remove "$@" ;;
  esac
}

# --- Fichiers ---------------------------------------------------------------------
backup_file() {
  local f="$1"
  [ -e "$f" ] || return 0
  run mkdir -p "${M[BACKUP_DIR]}"
  run cp -p "$f" "${M[BACKUP_DIR]}/$(basename "$f")"
  ok "Sauvegarde de $f"
}

# Retire le bloc Mysh d'un fichier (et la ligne vide ajoutée juste avant).
strip_block() {
  local f="$1" tmp
  [ -f "$f" ] || return 0
  grep -qxF "$MARK_BEGIN" "$f" || return 0
  if [ "$DRY_RUN" = 1 ]; then
    printf '%s    [simulation] retirer le bloc Mysh de %s%s\n' "$C_DIM" "$f" "$C_RST"
    return 0
  fi
  tmp="$(mktemp)"
  awk -v b="$MARK_BEGIN" -v e="$MARK_END" '
    $0 == b { skip = 1; if (held && hold == "") held = 0; next }
    skip    { if ($0 == e) skip = 0; next }
            { if (held) print hold; hold = $0; held = 1 }
    END     { if (held) print hold }
  ' "$f" > "$tmp"
  cat "$tmp" > "$f"   # « cat > » garde les droits et les liens du fichier
  rm -f "$tmp"
}

add_rc_block() {
  local rc="$1" init="$2"
  if [ "$DRY_RUN" = 1 ]; then
    printf '%s    [simulation] ajouter à la fin de %s : . %s%s\n' "$C_DIM" "$rc" "$init" "$C_RST"
    return 0
  fi
  strip_block "$rc"
  {
    printf '\n%s\n' "$MARK_BEGIN"
    printf '# Ajouté par Mysh. Pour tout annuler : %s --uninstall\n' "$STATE_DIR/mysh.sh"
    printf '[ -r %q ] && . %q\n' "$init" "$init"
    printf '%s\n' "$MARK_END"
  } >> "$rc"
}

# Télécharge un fichier en HTTPS et vérifie son empreinte SHA-256 épinglée.
download_verified() {
  local url="$1" sha="$2" out="$3" got
  info "Téléchargement de $url"
  run curl --proto '=https' --tlsv1.2 -fsSL --retry 2 -o "$out" "$url"
  [ "$DRY_RUN" = 1 ] && return 0
  got="$(sha256sum "$out" | cut -d' ' -f1)"
  if [ "$got" != "$sha" ]; then
    rm -f "$out"
    die "Empreinte SHA-256 incorrecte pour $url
      attendue : $sha
      obtenue  : $got
    Le fichier a été supprimé, rien n'a été installé."
  fi
  ok "Empreinte SHA-256 vérifiée ($sha)"
}

install_starship_from_github() {
  local arch sha url
  case "$(uname -m)" in
    x86_64|amd64)  arch="x86_64";  sha="$STARSHIP_SHA256_X86_64" ;;
    aarch64|arm64) arch="aarch64"; sha="$STARSHIP_SHA256_AARCH64" ;;
    *) warn "Starship : architecture $(uname -m) non prise en charge, étape ignorée."; return 0 ;;
  esac
  url="https://github.com/starship/starship/releases/download/v${STARSHIP_VERSION}/starship-${arch}-unknown-linux-musl.tar.gz"
  download_verified "$url" "$sha" "$TMP_DIR/starship.tar.gz"
  run tar -xzf "$TMP_DIR/starship.tar.gz" -C "$TMP_DIR" starship
  run mkdir -p "$LOCAL_BIN"
  run install -m 0755 "$TMP_DIR/starship" "$LOCAL_BIN/starship"
  M[STARSHIP_BIN]="$LOCAL_BIN/starship"
  ok "Starship $STARSHIP_VERSION installé dans $LOCAL_BIN"
}

install_fastfetch_from_github() {
  local arch sha url
  case "$(uname -m)" in
    x86_64|amd64)  arch="amd64";   sha="$FASTFETCH_SHA256_AMD64" ;;
    aarch64|arm64) arch="aarch64"; sha="$FASTFETCH_SHA256_AARCH64" ;;
    *) warn "fastfetch : architecture $(uname -m) non prise en charge, étape ignorée."; return 0 ;;
  esac
  url="https://github.com/fastfetch-cli/fastfetch/releases/download/${FASTFETCH_VERSION}/fastfetch-linux-${arch}.tar.gz"
  download_verified "$url" "$sha" "$TMP_DIR/fastfetch.tar.gz"
  run tar -xzf "$TMP_DIR/fastfetch.tar.gz" -C "$TMP_DIR" "fastfetch-linux-${arch}/usr/bin/fastfetch"
  run mkdir -p "$LOCAL_BIN"
  run install -m 0755 "$TMP_DIR/fastfetch-linux-${arch}/usr/bin/fastfetch" "$LOCAL_BIN/fastfetch"
  M[FASTFETCH_BIN]="$LOCAL_BIN/fastfetch"
  ok "fastfetch $FASTFETCH_VERSION installé dans $LOCAL_BIN"
}

# Logo personnalisé. Dans mysh_logo_content, les codes couleur sont écrits
# « \e[...m » en texte pour que le script reste lisible ; ils sont convertis
# en vrais caractères d'échappement au moment d'écrire logo.txt.
install_logo() {
  local logo="$MYSH_CONF_DIR/logo.txt" ff_dir="$CONF_HOME/fastfetch" ff_conf json_path line
  ff_conf="$ff_dir/config.jsonc"
  info "Logo personnalisé"
  if [ -z "${M[FASTFETCH_CONF]:-}" ]; then
    if [ -e "$ff_conf" ]; then backup_file "$ff_conf"; M[FASTFETCH_CONF]="backup"
    else M[FASTFETCH_CONF]="created"; fi
  fi
  run mkdir -p "$MYSH_CONF_DIR" "$ff_dir"
  if [ "$DRY_RUN" = 1 ]; then
    printf '%s    [simulation] écrire %s et %s%s\n' "$C_DIM" "$logo" "$ff_conf" "$C_RST"
    return 0
  fi
  mysh_logo_content | while IFS= read -r line; do
    printf '%s\n' "${line//\\e/$'\e'}"
  done > "$logo"
  json_path="${logo//\\/\\\\}"
  json_path="${json_path//\"/\\\"}"
  cat > "$ff_conf" <<EOF
// Écrit par Mysh. « mysh.sh --uninstall » le supprime ou remet l'ancien.
{
  "\$schema": "https://github.com/fastfetch-cli/fastfetch/raw/dev/doc/json_schema.json",
  "logo": {
    "source": "$json_path",
    "type": "file-raw",
    "width": $CFG_LOGO_WIDTH,
    "height": $CFG_LOGO_HEIGHT,
    "padding": { "top": 1, "left": 1, "right": 3 }
  },
  "modules": ["title", "separator", "os", "host", "kernel", "uptime", "packages",
              "shell", "terminal", "cpu", "memory", { "type": "disk", "folders": "/" },
              "break", "colors"]
}
EOF
  ok "Logo écrit dans $logo"
  ok "$ff_conf utilise ce logo"
}

install_font() {
  local name="$1" sha dir url
  sha="$(nerdfont_sha256 "$name")" || { warn "Police inconnue : $name"; return 0; }
  dir="$DATA_HOME/fonts/mysh-$name"
  if [ -d "$dir" ]; then
    ok "Police $name déjà installée"
  else
    url="https://github.com/ryanoasis/nerd-fonts/releases/download/v${NERDFONT_VERSION}/${name}.tar.xz"
    download_verified "$url" "$sha" "$TMP_DIR/$name.tar.xz"
    run mkdir -p "$dir"
    run tar -xJf "$TMP_DIR/$name.tar.xz" -C "$dir"
    run fc-cache -f "$dir"
    ok "Police « $(nerdfont_family "$name") » installée"
  fi
  M[FONT_DIR]="$dir"
}

# Garde une copie du script : c'est elle qui sert à --uninstall.
save_self() {
  [ "$DRY_RUN" = 1 ] && return 0
  local self="$STATE_DIR/mysh.sh" here
  here="$(realpath "$0" 2>/dev/null || true)"
  mkdir -p "$STATE_DIR"
  if [ -n "$here" ] && [ -f "$here" ] && [ "$here" != "$(realpath "$self" 2>/dev/null || true)" ]; then
    cp "$here" "$self"
    chmod 700 "$self"
  fi
}

login_shell() {
  local s=""
  if command -v getent >/dev/null 2>&1; then s="$(getent passwd "$(id -un)" | cut -d: -f7)"; fi
  printf '%s' "${s:-${SHELL:-}}"
}

# =============================================================================
#  INSTALLATION
# =============================================================================
do_install() {
  [ "${BASH_VERSINFO[0]}" -ge 4 ] || die "Bash 4 ou plus est nécessaire."
  [ "$(id -u)" -ne 0 ] || die "Lance ce script avec ton utilisateur habituel, pas en root ni avec sudo. Il demandera sudo uniquement pour installer les paquets."
  [ -r /etc/os-release ] || die "Impossible d'identifier la distribution (/etc/os-release est absent)."
  local tool missing=()
  for tool in awk grep sed cut tar mktemp sha256sum realpath install sudo; do
    command -v "$tool" >/dev/null 2>&1 || missing+=("$tool")
  done
  [ "${#missing[@]}" -eq 0 ] || die "Commandes de base manquantes : ${missing[*]}. Installe-les puis relance le script."

  local os_name os_family pm_bin
  # shellcheck disable=SC1091
  os_name="$(. /etc/os-release && printf '%s' "${PRETTY_NAME:-${ID:-Linux}}")"
  # shellcheck disable=SC1091
  os_family="$(. /etc/os-release && printf '%s %s' "${ID:-}" "${ID_LIKE:-}")"
  pm_bin="$(pm_binary "$CFG_PM")" || die "Gestionnaire de paquets inconnu : $CFG_PM"
  command -v "$pm_bin" >/dev/null 2>&1 \
    || die "Ce script a été généré pour « $CFG_PM », mais $pm_bin est introuvable sur $os_name. Regénère-le en choisissant le bon gestionnaire de paquets."
  case "$CFG_PM:$os_family" in
    apt:*debian*|apt:*ubuntu*|dnf:*fedora*|dnf:*rhel*|dnf:*centos*|pacman:*arch*|zypper:*suse*) ;;
    *) warn "Distribution inhabituelle pour $CFG_PM ($os_name). Le script continue, mais vérifie bien le résumé." ;;
  esac

  local previous=0
  if manifest_load; then previous=1; fi
  TMP_DIR="$(mktemp -d)"

  # Fichiers concernés selon le shell choisi
  local rc_file="" init_file
  case "$CFG_SHELL" in
    zsh)  rc_file="$HOME/.zshrc";  init_file="$MYSH_CONF_DIR/init.zsh" ;;
    bash) rc_file="$HOME/.bashrc"; init_file="$MYSH_CONF_DIR/init.bash" ;;
    fish) init_file="$CONF_HOME/fish/conf.d/mysh.fish" ;;
    *) die "Shell inconnu : $CFG_SHELL" ;;
  esac
  local starship_toml="$CONF_HOME/starship.toml"

  # Liste des paquets
  local logical wanted=()
  for logical in "${CFG_PACKAGES[@]}"; do wanted+=("$(pkg_name "$logical")"); done
  [ "$CFG_STARSHIP" = 1 ] && wanted+=("starship")
  if [ -n "$CFG_FONT" ]; then
    command -v curl     >/dev/null 2>&1 || wanted+=("curl")
    command -v xz       >/dev/null 2>&1 || wanted+=("$(pkg_name xz)")
    command -v fc-cache >/dev/null 2>&1 || wanted+=("fontconfig")
  fi
  if ! command -v curl >/dev/null 2>&1; then
    case " ${CFG_PACKAGES[*]} " in
      *" fastfetch "*) wanted+=("curl") ;;
      *) if [ "$CFG_STARSHIP" = 1 ]; then wanted+=("curl"); fi ;;
    esac
  fi
  if [ "$CFG_CHSH" = 1 ] && [ "$CFG_PM" = dnf ] && ! command -v chsh >/dev/null 2>&1; then
    wanted+=("util-linux-user")
  fi

  # --- Résumé et confirmation ---
  printf '\n%sMysh %s%s — %s\n\n' "$C_B" "$MYSH_VERSION" "$C_RST" "$os_name"
  [ "$DRY_RUN" = 1 ] && printf '%sMODE SIMULATION : rien ne sera modifié.%s\n\n' "$C_YEL$C_B" "$C_RST"
  [ "$previous" = 1 ] && info "Une installation Mysh existe déjà : elle sera mise à jour, les sauvegardes d'origine sont conservées."
  info "Ce qui va se passer :"
  item "paquets via $CFG_PM (seulement ceux qui manquent) : ${wanted[*]:-aucun}"
  [ -n "$rc_file" ] && item "$rc_file : ajout d'un bloc de 4 lignes (fichier sauvegardé avant)"
  item "configuration écrite dans $init_file"
  [ "$CFG_STARSHIP" = 1 ] && [ -n "$CFG_STARSHIP_PRESET" ] && item "$starship_toml : thème « $CFG_STARSHIP_PRESET » (fichier sauvegardé avant)"
  [ "$CFG_LOGO" = 1 ] && item "logo personnalisé : $MYSH_CONF_DIR/logo.txt et $CONF_HOME/fastfetch/config.jsonc (sauvegardé avant)"
  [ -n "$CFG_FONT" ] && item "police $(nerdfont_family "$CFG_FONT") téléchargée depuis GitHub, empreinte SHA-256 vérifiée"
  [ "$CFG_CHSH" = 1 ] && item "$CFG_SHELL devient ton shell par défaut (chsh peut demander ton mot de passe)"
  item "sudo sert uniquement à installer les paquets"
  echo
  confirm "Continuer ?" || die "Annulé. Rien n'a été modifié."
  save_self

  # --- Sauvegardes ---
  mset_once VERSION "$MYSH_VERSION"
  mset_once BACKUP_DIR "$STATE_DIR/backups/$(date +%Y%m%d-%H%M%S)"
  M[PM]="$CFG_PM"
  M[SHELL]="$CFG_SHELL"
  info "Sauvegardes dans ${M[BACKUP_DIR]}"
  if [ -n "$rc_file" ] && [ -z "${M[RC_FILE]:-}" ]; then
    backup_file "$rc_file"
    if [ -e "$rc_file" ]; then M[RC_CREATED]=0; else M[RC_CREATED]=1; fi
  fi
  if [ "$CFG_STARSHIP" = 1 ] && [ -n "$CFG_STARSHIP_PRESET" ] && [ -z "${M[STARSHIP_TOML]:-}" ]; then
    if [ -e "$starship_toml" ]; then backup_file "$starship_toml"; M[STARSHIP_TOML]="backup"
    else M[STARSHIP_TOML]="created"; fi
  fi

  # --- Paquets ---
  info "Paquets"
  if [ "$DRY_RUN" = 0 ]; then
    info "sudo peut te demander ton mot de passe (installation des paquets uniquement)."
    sudo -v
  fi
  pm_refresh
  local p to_install=() starship_github=0 fastfetch_github=0
  for p in "${wanted[@]}"; do
    if pkg_installed "$p"; then
      ok "$p déjà installé"
    elif pkg_available "$p"; then
      to_install+=("$p")
    elif [ "$p" = starship ]; then
      if command -v starship >/dev/null 2>&1; then ok "starship déjà présent"
      else starship_github=1; warn "starship n'est pas dans les dépôts : version $STARSHIP_VERSION téléchargée depuis GitHub."; fi
    elif [ "$p" = fastfetch ]; then
      if command -v fastfetch >/dev/null 2>&1; then ok "fastfetch déjà présent"
      else fastfetch_github=1; warn "fastfetch n'est pas dans les dépôts : version $FASTFETCH_VERSION téléchargée depuis GitHub."; fi
    else
      warn "$p n'est pas disponible dans les dépôts de $os_name : ignoré."
    fi
  done
  if [ "${#to_install[@]}" -gt 0 ]; then
    local pm_ok=1 newly=()
    pm_install "${to_install[@]}" || pm_ok=0
    for p in "${to_install[@]}"; do
      # En cas d'échec, on note tout : la désinstallation pourra nettoyer.
      if [ "$DRY_RUN" = 1 ] || [ "$pm_ok" = 0 ] || pkg_installed "$p"; then newly+=("$p"); fi
    done
    # shellcheck disable=SC2086
    M[PACKAGES]="$(printf '%s\n' ${M[PACKAGES]:-} "${newly[@]}" | awk 'NF && !seen[$0]++' | tr '\n' ' ' | sed 's/ $//')"
    if [ "$pm_ok" = 0 ]; then
      manifest_save
      local hint=""
      [ "$CFG_PM" = pacman ] && hint=" Sur Arch, mets d'abord le système à jour (sudo pacman -Syu)."
      die "L'installation des paquets a échoué (voir le message de $CFG_PM au-dessus). Aucun fichier de configuration n'a été modifié.$hint
    Pour retirer ce qui a pu être installé : $STATE_DIR/mysh.sh --uninstall --remove-packages"
    fi
    ok "Installés : ${newly[*]}"
  else
    ok "Rien à installer"
  fi
  # Écrit le manifeste dès maintenant : même en cas d'erreur plus loin,
  # --uninstall saura quoi annuler.
  manifest_save

  # --- Téléchargements vérifiés ---
  [ "$starship_github" = 1 ] && install_starship_from_github
  [ "$fastfetch_github" = 1 ] && install_fastfetch_from_github
  [ -n "$CFG_FONT" ] && install_font "$CFG_FONT"

  # --- Configuration du shell ---
  info "Configuration de $CFG_SHELL"
  run mkdir -p "$(dirname "$init_file")"
  if [ "$DRY_RUN" = 1 ]; then
    printf '%s    [simulation] écrire %s%s\n' "$C_DIM" "$init_file" "$C_RST"
  else
    mysh_init_content > "$init_file"
  fi
  M[INIT_FILE]="$init_file"
  ok "$init_file écrit"
  if [ -n "$rc_file" ]; then
    add_rc_block "$rc_file" "$init_file"
    M[RC_FILE]="$rc_file"
    ok "$rc_file charge la configuration Mysh"
  fi

  [ "$CFG_LOGO" = 1 ] && install_logo

  # --- Thème Starship ---
  if [ "$CFG_STARSHIP" = 1 ] && [ -n "$CFG_STARSHIP_PRESET" ]; then
    local starship_cmd
    starship_cmd="$(command -v starship 2>/dev/null || true)"
    [ -z "$starship_cmd" ] && [ -x "$LOCAL_BIN/starship" ] && starship_cmd="$LOCAL_BIN/starship"
    if [ -n "$starship_cmd" ] || [ "$DRY_RUN" = 1 ]; then
      run mkdir -p "$CONF_HOME"
      # Écrit d'abord dans un fichier temporaire : Starship refuse d'écraser un
      # fichier existant, et l'ancien a déjà été sauvegardé plus haut.
      if run "${starship_cmd:-starship}" preset "$CFG_STARSHIP_PRESET" -o "$TMP_DIR/starship.toml" \
         && run cp "$TMP_DIR/starship.toml" "$starship_toml"; then
        ok "Thème Starship « $CFG_STARSHIP_PRESET » appliqué"
      else
        warn "Le thème Starship « $CFG_STARSHIP_PRESET » n'a pas pu être appliqué : thème par défaut conservé."
      fi
    fi
  fi

  # --- Shell par défaut ---
  if [ "$CFG_CHSH" = 1 ]; then
    local target current
    target="$(command -v "$CFG_SHELL" 2>/dev/null || true)"
    current="$(login_shell)"
    if [ -z "$target" ] && [ "$DRY_RUN" = 1 ]; then
      printf '%s    [simulation] chsh -s %s%s\n' "$C_DIM" "$CFG_SHELL" "$C_RST"
    elif [ -z "$target" ]; then
      warn "$CFG_SHELL est introuvable : shell par défaut inchangé."
    elif [ "$current" = "$target" ]; then
      ok "$CFG_SHELL est déjà ton shell par défaut"
    elif ! grep -qxF "$target" /etc/shells 2>/dev/null; then
      warn "$target n'est pas listé dans /etc/shells : shell par défaut inchangé."
    elif [ "$ASSUME_YES" = 1 ]; then
      warn "Mode --yes : chsh demande ton mot de passe, il n'est donc pas lancé. Fais-le toi-même : chsh -s $target"
    else
      mset_once ORIGINAL_SHELL "$current"
      if run chsh -s "$target"; then
        M[SHELL_CHANGED]=1
        ok "Shell par défaut : $target (effectif à la prochaine connexion)"
      else
        warn "chsh a échoué. Tu peux le faire toi-même : chsh -s $target"
      fi
    fi
  fi

  # --- Pages tldr ---
  if [ "$CFG_TLDR_UPDATE" = 1 ] && command -v tldr >/dev/null 2>&1; then
    run tldr --update >/dev/null 2>&1 || warn "tldr --update a échoué (réessaie plus tard)."
  fi

  manifest_save

  if [ "$DRY_RUN" = 1 ]; then
    printf '\n%s  ✓ Simulation terminée : rien n'"'"'a été modifié.%s\n' "$C_GRN$C_B" "$C_RST"
    echo "  Relance sans --dry-run pour installer."
    echo
    return 0
  fi
  printf '\n%s  ✓ Terminé.%s\n\n' "$C_GRN$C_B" "$C_RST"
  echo "  Prochaines étapes :"
  echo "    1. Ouvre un nouveau terminal (ou tape : exec $CFG_SHELL)."
  [ -n "$CFG_FONT" ] && echo "    2. Dans les préférences du terminal, choisis la police « $(nerdfont_family "$CFG_FONT") »."
  echo
  echo "  Pour tout annuler :  $STATE_DIR/mysh.sh --uninstall"
  echo "  Sauvegardes :        ${M[BACKUP_DIR]}"
  echo
}

# =============================================================================
#  DÉSINSTALLATION
# =============================================================================
do_uninstall() {
  [ "$(id -u)" -ne 0 ] || die "Lance la désinstallation avec ton utilisateur habituel, pas en root."
  manifest_load || die "Aucune installation Mysh trouvée ($MANIFEST est absent). Rien à annuler."

  local pm="${M[PM]:-}" pkgs="${M[PACKAGES]:-}"
  printf '\n%sAnnulation de Mysh%s\n\n' "$C_B" "$C_RST"
  [ "$DRY_RUN" = 1 ] && printf '%sMODE SIMULATION : rien ne sera modifié.%s\n\n' "$C_YEL$C_B" "$C_RST"
  info "Ce qui va être annulé :"
  [ -n "${M[RC_FILE]:-}" ]   && item "retrait du bloc Mysh de ${M[RC_FILE]} (le reste du fichier n'est pas touché)"
  [ -n "${M[INIT_FILE]:-}" ] && item "suppression de ${M[INIT_FILE]}"
  case "${M[STARSHIP_TOML]:-}" in
    backup)  item "restauration de ton ancien starship.toml" ;;
    created) item "suppression du starship.toml créé par Mysh" ;;
  esac
  [ -n "${M[STARSHIP_BIN]:-}" ]  && item "suppression de ${M[STARSHIP_BIN]}"
  case "${M[FASTFETCH_CONF]:-}" in
    backup)  item "restauration de ton ancienne configuration fastfetch" ;;
    created) item "suppression de la configuration fastfetch créée par Mysh (logo)" ;;
  esac
  [ -n "${M[FASTFETCH_BIN]:-}" ] && item "suppression de ${M[FASTFETCH_BIN]}"
  [ -n "${M[FONT_DIR]:-}" ]      && item "suppression de la police (${M[FONT_DIR]})"
  [ "${M[SHELL_CHANGED]:-0}" = 1 ] && item "retour au shell ${M[ORIGINAL_SHELL]}"
  if [ -n "$pkgs" ]; then
    if [ "$REMOVE_PKGS" = 1 ]; then item "suppression des paquets installés par Mysh : $pkgs"
    else item "paquets conservés : $pkgs (ajoute --remove-packages pour les supprimer)"; fi
  fi
  echo
  confirm "Annuler la configuration Mysh ?" || die "Abandon. Rien n'a été modifié."

  if [ -n "${M[RC_FILE]:-}" ]; then
    strip_block "${M[RC_FILE]}"
    if [ "${M[RC_CREATED]:-0}" = 1 ] && [ -f "${M[RC_FILE]}" ] && ! grep -q '[^[:space:]]' "${M[RC_FILE]}"; then
      run rm -f "${M[RC_FILE]}"
    fi
    ok "${M[RC_FILE]} nettoyé"
  fi
  if [ -n "${M[INIT_FILE]:-}" ]; then
    run rm -f "${M[INIT_FILE]}"
    [ -d "$MYSH_CONF_DIR" ] && run rm -rf "$MYSH_CONF_DIR"
    ok "Configuration Mysh supprimée"
  fi
  local toml="$CONF_HOME/starship.toml"
  case "${M[STARSHIP_TOML]:-}" in
    backup)
      if [ -f "${M[BACKUP_DIR]}/starship.toml" ]; then run cp -p "${M[BACKUP_DIR]}/starship.toml" "$toml"; ok "starship.toml restauré"
      else warn "Sauvegarde de starship.toml introuvable : fichier laissé tel quel."; fi ;;
    created) run rm -f "$toml"; ok "starship.toml supprimé" ;;
  esac
  if [ -n "${M[STARSHIP_BIN]:-}" ]; then run rm -f "${M[STARSHIP_BIN]}"; ok "Starship supprimé de ~/.local/bin"; fi
  local ff_conf="$CONF_HOME/fastfetch/config.jsonc"
  case "${M[FASTFETCH_CONF]:-}" in
    backup)
      if [ -f "${M[BACKUP_DIR]}/config.jsonc" ]; then run cp -p "${M[BACKUP_DIR]}/config.jsonc" "$ff_conf"; ok "Configuration fastfetch restaurée"
      else warn "Sauvegarde de la configuration fastfetch introuvable : fichier laissé tel quel."; fi ;;
    created)
      run rm -f "$ff_conf"
      if [ -d "$CONF_HOME/fastfetch" ]; then run rmdir --ignore-fail-on-non-empty "$CONF_HOME/fastfetch"; fi
      ok "Configuration fastfetch supprimée" ;;
  esac
  if [ -n "${M[FASTFETCH_BIN]:-}" ]; then run rm -f "${M[FASTFETCH_BIN]}"; ok "fastfetch supprimé de ~/.local/bin"; fi
  if [ -n "${M[FONT_DIR]:-}" ] && [ -d "${M[FONT_DIR]}" ]; then
    run rm -rf "${M[FONT_DIR]}"
    run rmdir --ignore-fail-on-non-empty "$(dirname "${M[FONT_DIR]}")"
    command -v fc-cache >/dev/null 2>&1 && run fc-cache -f
    ok "Police supprimée"
  fi
  if [ "${M[SHELL_CHANGED]:-0}" = 1 ] && [ -n "${M[ORIGINAL_SHELL]:-}" ] && [ "$ASSUME_YES" = 1 ]; then
    warn "Mode --yes : chsh n'est pas lancé. Pour revenir à ton ancien shell : chsh -s ${M[ORIGINAL_SHELL]}"
  elif [ "${M[SHELL_CHANGED]:-0}" = 1 ] && [ -n "${M[ORIGINAL_SHELL]:-}" ]; then
    if run chsh -s "${M[ORIGINAL_SHELL]}"; then ok "Shell par défaut : ${M[ORIGINAL_SHELL]}"
    else warn "chsh a échoué. Fais-le toi-même : chsh -s ${M[ORIGINAL_SHELL]}"; fi
  fi
  if [ -n "$pkgs" ]; then
    if [ "$REMOVE_PKGS" = 1 ]; then
      [ "$DRY_RUN" = 0 ] && sudo -v
      # shellcheck disable=SC2086
      pm_remove "$pm" $pkgs || warn "Certains paquets n'ont pas pu être supprimés."
      ok "Paquets supprimés"
    else
      info "Paquets conservés. Pour les supprimer plus tard : $(pm_remove_cmd "$pm") $pkgs"
    fi
  fi

  if [ "$DRY_RUN" = 0 ]; then
    local archive
    archive="$STATE_DIR.annule-$(date +%Y%m%d-%H%M%S)"
    mv "$STATE_DIR" "$archive"
    printf '\n%s  ✓ Mysh est désinstallé.%s\n' "$C_GRN$C_B" "$C_RST"
    echo "  Tes sauvegardes d'origine restent dans : $archive"
    echo "  Ouvre un nouveau terminal pour retrouver ta configuration d'avant."
    echo
  fi
}

main() {
  parse_args "$@"
  case "$MODE" in
    install)   do_install ;;
    uninstall) do_uninstall ;;
  esac
}

main "$@"
