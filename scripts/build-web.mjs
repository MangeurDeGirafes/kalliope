// Construit une version web autonome du jeu (un seul fichier HTML) :
// - le code du jeu est compilé, minifié et intégré dans la page ;
// - three.js et Rapier sont chargés depuis jsDelivr (versions exactes) via une import map.
// Usage : npm run build:web  →  dist-web/index.html
import { build } from 'vite';
import { readFileSync, writeFileSync, readdirSync, rmSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'dist-web');
const tmpDir = join(outDir, '.build');

const version = (pkg) => JSON.parse(readFileSync(join(root, 'node_modules', pkg, 'package.json'), 'utf8')).version;
const THREE = version('three');
const RAPIER = version('@dimforge/rapier3d-compat');
const CDN = 'https://cdn.jsdelivr.net/npm';

const importMap = {
  imports: {
    three: `${CDN}/three@${THREE}/build/three.module.js`,
    'three/examples/jsm/': `${CDN}/three@${THREE}/examples/jsm/`,
    '@dimforge/rapier3d-compat': `${CDN}/@dimforge/rapier3d-compat@${RAPIER}/dist/rapier.mjs`,
  },
};

rmSync(outDir, { recursive: true, force: true });
await build({
  root,
  logLevel: 'warn',
  build: {
    outDir: tmpDir,
    emptyOutDir: true,
    modulePreload: false,
    rolldownOptions: {
      external: ['three', /^three\/examples\/jsm\//, '@dimforge/rapier3d-compat'],
    },
  },
});

const assets = join(tmpDir, 'assets');
const files = readdirSync(assets);
const js = files.filter((f) => f.endsWith('.js')).map((f) => readFileSync(join(assets, f), 'utf8')).join('\n');
const css = files.filter((f) => f.endsWith('.css')).map((f) => readFileSync(join(assets, f), 'utf8')).join('\n');
// Un « </script » littéral fermerait la balise : on l'échappe.
const safeJs = js.replace(/<\/script/gi, '<\\/script');

// La plateforme fournit doctype, <html>, <head> et <body> : on écrit seulement le contenu.
const html = `<title>Neon Vertigo</title>
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover" />
<meta name="theme-color" content="#05030a" />
<meta name="description" content="Prototype FPS de parkour et de combat sur les toits d'une ville cyberpunk nocturne." />
<style>
${css}
</style>
<script type="importmap">${JSON.stringify(importMap)}</script>
<div id="app"></div>
<div id="boot">INITIALISATION DU NEURAL-LINK…</div>
<script type="module">
${safeJs}
</script>
`;

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'index.html'), html);
rmSync(tmpDir, { recursive: true, force: true });
console.log(`dist-web/index.html — ${(html.length / 1024).toFixed(0)} Ko (three ${THREE}, rapier ${RAPIER} via jsDelivr)`);
