import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildHomeManifest } from '../../scripts/home-manifest.mjs';

const base = JSON.parse(readFileSync('public/manifest.json', 'utf8'));
const home = buildHomeManifest(base) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

describe('manifestes des deux versions', () => {
  it('la version « nouvel onglet » remplace bien le nouvel onglet', () => {
    expect(base.chrome_url_overrides).toEqual({ newtab: 'newtab.html' });
    expect(base.background).toBeUndefined();
  });
  it('la version « page d’accueil » ne remplace PAS le nouvel onglet (donc pas de barre Chrome)', () => {
    expect(home.chrome_url_overrides).toBeUndefined();
  });
  it('elle ajoute un bouton de barre d’outils, un service worker et un raccourci clavier', () => {
    expect(home.action).toMatchObject({ default_title: 'Ouvrir DinoStart' });
    expect(home.background).toEqual({ service_worker: 'background.js', type: 'module' });
    expect(home.commands['open-dinostart'].suggested_key.default).toBe('Alt+Shift+D');
    expect(home.name).not.toBe(base.name); // distinguable dans chrome://extensions
  });
  it('elle ne demande AUCUNE permission de plus et garde la même politique de sécurité', () => {
    expect(home.permissions).toEqual(base.permissions);
    expect(home.host_permissions).toEqual(base.host_permissions);
    expect(home.content_security_policy).toEqual(base.content_security_policy);
    expect(home.manifest_version).toBe(3);
    expect(home.version).toBe(base.version);
  });
  it('ne modifie pas le manifeste d’origine', () => {
    expect(base.chrome_url_overrides).toBeDefined();
  });
});
