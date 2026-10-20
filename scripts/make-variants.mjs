// Après `vite build` : produit les deux extensions installables.
//   dist/       → remplace le nouvel onglet (version d'origine)
//   dist-home/  → ne remplace pas le nouvel onglet : bouton de barre d'outils + raccourci + page d'accueil
import { cpSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { buildHomeManifest } from './home-manifest.mjs';

if (!existsSync('dist/manifest.json')) throw new Error('dist/ introuvable : lancez d\'abord vite build.');
const base = JSON.parse(readFileSync('dist/manifest.json', 'utf8'));
rmSync('dist-home', { recursive: true, force: true });
cpSync('dist', 'dist-home', { recursive: true });
writeFileSync('dist-home/manifest.json', `${JSON.stringify(buildHomeManifest(base), null, 2)}\n`);
rmSync('dist/background.js', { force: true }); // inutile dans la version « nouvel onglet »
console.log('✓ dist/ (nouvel onglet) et dist-home/ (page d\'accueil) prêts');
