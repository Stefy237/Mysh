#!/usr/bin/env node
// Génère des scripts Mysh depuis la ligne de commande (tests et CI).
//   node tools/generate.mjs <dossier-de-sortie> [pm...]
// Produit, pour chaque gestionnaire de paquets, une configuration « complète »
// et une configuration « minimale » par shell.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const Mysh = require(join(here, '..', 'src', 'generator.js'));
const engine = readFileSync(join(here, '..', 'src', 'engine.sh'), 'utf8');

const outDir = process.argv[2] || 'out';
const pms = process.argv.length > 3 ? process.argv.slice(3) : Object.keys(Mysh.PMS);
mkdirSync(outDir, { recursive: true });

// Petit logo déterministe (losange en braille, dégradé) pour tester l'option logo.
function sampleLogo() {
  const lines = [];
  for (let y = 0; y < 6; y++) {
    let line = '';
    for (let x = 0; x < 12; x++) {
      const on = Math.abs(x - 5.5) + Math.abs(y - 2.5) * 2 < 7;
      line += on ? `\\e[38;2;${255 - y * 17};${102 + x * 8};68m⣿` : ' ';
    }
    lines.push(line.replace(/ +$/, '') + '\\e[0m');
  }
  return { on: true, text: lines.join('\n'), w: 12 };
}

const allTools = Object.fromEntries(Mysh.TOOLS.map(t => [t.id, true]));
const noTools = Object.fromEntries(Mysh.TOOLS.map(t => [t.id, false]));

for (const pm of pms) {
  const variants = {
    full: { pm, shell: 'zsh', tools: allTools, fastfetchStart: true, replace: { ls: true, cat: true, cd: true, top: true, grep: true, find: true }, logo: sampleLogo() },
    fish: { pm, shell: 'fish', preset: 'pure-preset', font: 'Hack', fastfetchStart: true, tools: { ...allTools, fastfetch: false }, logo: sampleLogo() },
    bash: { pm, shell: 'bash', starship: false, font: '', tools: { ...noTools, bat: true, fzf: true } },
  };
  for (const [name, cfg] of Object.entries(variants)) {
    const file = join(outDir, `mysh-${pm}-${name}.sh`);
    writeFileSync(file, Mysh.buildScript(cfg, engine), { mode: 0o755 });
    console.log(file);
  }
}
