import { describe, expect, it, vi } from 'vitest';
import { openDinoStart, OPEN_COMMAND, registerBackground, type ChromeLike } from '../../src/background/open';

function fakeChrome() {
  const clicked: Array<() => void> = [], commands: Array<(c: string) => void> = [];
  const create = vi.fn(async () => ({}));
  const api: ChromeLike = {
    runtime: { getURL: (p) => `chrome-extension://abc/${p}` }, tabs: { create },
    action: { onClicked: { addListener: (cb) => clicked.push(cb) } }, commands: { onCommand: { addListener: (cb) => commands.push(cb) } },
  };
  return { api, clicked, commands, create };
}

describe('ouverture de DinoStart (version page d’accueil)', () => {
  it('ouvre la page de DinoStart dans un nouvel onglet', async () => {
    const { api, create } = fakeChrome();
    await openDinoStart(api);
    expect(create).toHaveBeenCalledWith({ url: 'chrome-extension://abc/newtab.html' });
  });
  it('le bouton de la barre d’outils ouvre DinoStart', () => {
    const { api, clicked, create } = fakeChrome();
    registerBackground(api, {});
    expect(clicked).toHaveLength(1);
    clicked[0]!();
    expect(create).toHaveBeenCalledTimes(1);
  });
  it('le raccourci clavier ouvre DinoStart, les autres commandes sont ignorées', () => {
    const { api, commands, create } = fakeChrome();
    registerBackground(api, {});
    commands[0]!('autre-commande');
    expect(create).not.toHaveBeenCalled();
    commands[0]!(OPEN_COMMAND);
    expect(create).toHaveBeenCalledTimes(1);
  });
  it('expose un crochet de test et ne demande aucune permission particulière', () => {
    const { api, create } = fakeChrome();
    const host: Record<string, unknown> = {};
    registerBackground(api, host);
    (host.dinoOpen as () => void)();
    expect(create).toHaveBeenCalledTimes(1);
  });
});
