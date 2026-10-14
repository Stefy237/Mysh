#!/usr/bin/env node
// Assemble l'interface en un seul fichier HTML autonome.
//   node build.mjs  ->  dist/index.html  (page complète, pour GitHub Pages)
//                      dist/fragment.html (même contenu sans <html>/<head>)
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';

const read = p => readFileSync(new URL(p, import.meta.url), 'utf8');
const page = read('./src/index.html');
const generator = read('./src/generator.js');
const engine = read('./src/engine.sh');

for (const [name, text] of [['engine.sh', engine], ['generator.js', generator]]) {
  if (/<\/script|<!--/i.test(text)) throw new Error(`${name} contient « </script » ou « <!-- » : impossible de l'intégrer tel quel.`);
}

// Remplacement par fonction : le texte du moteur contient des « $ ».
const fragment = page
  .replace('@@ENGINE@@', () => engine)
  .replace('/*@@GENERATOR@@*/', () => generator);

// Politique de sécurité du contenu pour la page hébergée : seuls les deux scripts
// de la page (identifiés par leur empreinte) s'exécutent, et la page ne peut
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

const cut = fragment.indexOf('<div class="wrap">');
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
console.log('dist/index.html', createHash('sha256').update(full).digest('hex').slice(0, 16));
