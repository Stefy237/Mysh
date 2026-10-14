#!/bin/sh
# Test d'intégration, lancé en root dans un conteneur de la distribution testée.
#   sh tests/container-test.sh <apt|dnf|pacman|zypper> <dossier-des-scripts>
# Pour chaque variante (full, fish, bash) : installation, vérifications,
# désinstallation, puis contrôle que les fichiers d'origine sont identiques.
set -eu
PM="$1"
SCRIPTS="$2"

echo "::group::Prérequis ($PM)"
case "$PM" in
  apt)    apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq sudo curl ca-certificates gawk passwd >/dev/null ;;
  dnf)    dnf install -y -q sudo curl gawk shadow-utils tar >/dev/null ;;
  pacman) pacman -Syu --noconfirm --needed sudo curl gawk tar >/dev/null ;;
  zypper) zypper -n -q install sudo curl gawk shadow tar gzip >/dev/null ;;
esac
id tester >/dev/null 2>&1 || useradd -m -s /bin/bash tester
echo 'tester ALL=(ALL) NOPASSWD:ALL' > /etc/sudoers.d/tester
chmod 440 /etc/sudoers.d/tester
echo "::endgroup::"

H=/home/tester
as_tester() { sudo -u tester -H env -C "$H" "$@" </dev/null; }

for variant in full fish bash; do
  script="$SCRIPTS/mysh-$PM-$variant.sh"
  echo "::group::$variant"
  # Fichiers « personnels » qui doivent revenir intacts
  printf '# zshrc perso\nalias ll="ls -l"\n' > "$H/.zshrc"
  printf '# bashrc perso\n' > "$H/.bashrc"
  mkdir -p "$H/.config"
  printf 'add_newline = false\n' > "$H/.config/starship.toml"
  mkdir -p "$H/.config/fastfetch"
  printf '{ "logo": { "type": "small" } }\n' > "$H/.config/fastfetch/config.jsonc"
  chown -R tester: "$H"
  sha256sum "$H/.zshrc" "$H/.bashrc" "$H/.config/starship.toml" "$H/.config/fastfetch/config.jsonc" > /tmp/before.sha

  install -m 0755 -o tester "$script" "$H/mysh-install.sh"
  as_tester ./mysh-install.sh --dry-run --yes
  sha256sum -c --quiet /tmp/before.sha    # la simulation ne change rien
  as_tester ./mysh-install.sh --yes
  as_tester ./mysh-install.sh --yes   # relance : pas de doublon

  test -r "$H/.local/share/mysh/manifest"
  test -x "$H/.local/share/mysh/mysh.sh"
  case "$variant" in
    full)
      test "$(grep -c '>>> mysh >>>' "$H/.zshrc")" = 1
      as_tester zsh -i -c 'alias ls' | grep -q eza
      # Logo : vrais codes couleur dans logo.txt, et fastfetch l'affiche
      grep -q "$(printf '\033')\[38;2;" "$H/.config/mysh/logo.txt"
      test -r "$H/.config/fastfetch/config.jsonc"
      as_tester sh -c 'PATH="$HOME/.local/bin:$PATH" fastfetch --pipe false' | grep -q '⣿'
      ;;
    fish)
      test -r "$H/.config/fish/conf.d/mysh.fish"
      as_tester fish -i -c 'functions -q ls'
      test -r "$H/.config/mysh/logo.txt"
      ;;
    bash)
      test "$(grep -c '>>> mysh >>>' "$H/.bashrc")" = 1
      as_tester bash -i -c 'alias cat' | grep -q bat
      ;;
  esac

  as_tester ./.local/share/mysh/mysh.sh --uninstall --remove-packages --yes
  sha256sum -c /tmp/before.sha
  test ! -e "$H/.config/mysh"
  test ! -e "$H/.config/fish/conf.d/mysh.fish"
  rm -rf "$H"/.local/share/mysh.annule-*
  echo "::endgroup::"
  echo "✓ $PM / $variant"
done
