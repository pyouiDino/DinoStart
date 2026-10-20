// Ouverture de DinoStart dans un onglet (version « page d'accueil », qui ne remplace pas le nouvel onglet).
// Le module ne dépend que d'une interface minimale de `chrome` : il se teste sans navigateur.
export const OPEN_COMMAND = 'open-dinostart';
export const PAGE = 'newtab.html';

export interface ChromeLike {
  runtime: { getURL(path: string): string };
  tabs: { create(options: { url: string }): Promise<unknown> | void };
  action: { onClicked: { addListener(cb: () => void): void } };
  commands: { onCommand: { addListener(cb: (command: string) => void): void } };
}

export function openDinoStart(api: Pick<ChromeLike, 'runtime' | 'tabs'>) {
  return api.tabs.create({ url: api.runtime.getURL(PAGE) });
}

/** Branche le bouton de la barre d'outils et le raccourci clavier. `host` reçoit un crochet de test (`dinoOpen`). */
export function registerBackground(api: ChromeLike, host: Record<string, unknown> = globalThis as unknown as Record<string, unknown>): void {
  api.action.onClicked.addListener(() => { void openDinoStart(api); });
  api.commands.onCommand.addListener((command) => { if (command === OPEN_COMMAND) void openDinoStart(api); });
  host.dinoOpen = () => openDinoStart(api);
}
