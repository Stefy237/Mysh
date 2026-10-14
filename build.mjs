#!/usr/bin/env node
// Assemble l'interface en un seul fichier HTML autonome.
//   node build.mjs  ->  dist/index.html    (page complète, pour l'hébergement)
//                      dist/fragment.html (même contenu sans <html>/<head>)
//
// Sources :
//   src/index.html   structure de la page
//   src/styles.css   mise en page et thèmes
//   src/app.js       logique de la page
//   src/generator.js génération du script (partagé avec les tests)
//   src/engine.sh    moteur Bash, inclus tel quel dans chaque script
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';

const read = p => readFileSync(new URL(p, import.meta.url), 'utf8');
const page = read('./src/index.html');
const parts = {
  'styles.css': read('./src/styles.css'),
  'generator.js': read('./src/generator.js'),
  'app.js': read('./src/app.js'),
  'engine.sh': read('./src/engine.sh'),
};

for (const [name, text] of Object.entries(parts)) {
  if (/<\/script|<\/style|<!--/i.test(text)) throw new Error(`${name} contient « </script », « </style » ou « <!-- » : impossible de l'intégrer tel quel.`);
}

// Chaque balise qui pointe vers un fichier source est remplacée par son contenu.
// Remplacement par fonction : les fichiers contiennent des « $ ».
const swap = (html, tag, content) => {
  if (!html.includes(tag)) throw new Error(`Balise introuvable dans src/index.html : ${tag}`);
  return html.replace(tag, () => content);
};
let fragment = page;
fragment = swap(fragment, '<link rel="stylesheet" href="styles.css">', `<style>\n${parts['styles.css']}</style>`);
fragment = swap(fragment, '<script src="generator.js"></script>', `<script>\n${parts['generator.js']}</script>`);
fragment = swap(fragment, '<script src="app.js"></script>', `<script>\n${parts['app.js']}</script>`);
fragment = swap(fragment, '@@ENGINE@@', parts['engine.sh']);

// Politique de sécurité du contenu pour la page hébergée : seuls les scripts de
// la page (identifiés par leur empreinte) s'exécutent, et la page ne peut
// envoyer aucune requête réseau (connect-src 'none').
const scriptHashes = [...fragment.matchAll(/<script>([\s\S]*?)<\/script>/g)]
  .map(m => `'sha256-${createHash('sha256').update(m[1]).digest('base64')}'`);
const csp = [
  "default-src 'none'",
  `script-src ${scriptHashes.join(' ')}`,
  "style-src 'unsafe-inline' https://fonts.googleapis.com",
  'font-src https://fonts.gstatic.com',
  'img-src data: blob:',
  "connect-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

const cut = fragment.indexOf('<div class="page">');
const full = `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="referrer" content="no-referrer">
${fragment.slice(0, cut).trim()}
</head>
<body>
${fragment.slice(cut)}
</body>
</html>
`;

mkdirSync(new URL('./dist/', import.meta.url), { recursive: true });
writeFileSync(new URL('./dist/index.html', import.meta.url), full);
writeFileSync(new URL('./dist/fragment.html', import.meta.url), fragment);
console.log('dist/index.html', (full.length / 1024).toFixed(0), 'Ko,', scriptHashes.length, 'scripts');
