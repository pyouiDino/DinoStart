// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { addFavorite, live, updateSettings } from '../../src/core/ops';
import { MemoryStorageAdapter } from '../../src/storage/adapters';
import { DinoStore, KEYS } from '../../src/storage/store';
import { GithubClient } from '../../src/sync/githubClient';
import { SyncEngine } from '../../src/sync/syncEngine';
import { App } from '../../src/ui/App';
import { AppProvider } from '../../src/ui/context';
import { FakeGithub, TEST_TOKEN } from '../helpers/fakeGithub';

beforeAll(() => {
  window.matchMedia ||= ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false, onchange: null })) as typeof window.matchMedia;
  // jsdom n'implémente pas <dialog>.showModal
  HTMLDialogElement.prototype.showModal ||= function (this: HTMLDialogElement) { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close ||= function (this: HTMLDialogElement) { this.removeAttribute('open'); };
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); document.documentElement.removeAttribute('style'); });

async function mount(gh = new FakeGithub(), opts: { onboarded?: boolean } = {}) {
  const adapter = new MemoryStorageAdapter();
  let n = 0;
  const store = new DinoStore(adapter, undefined, () => `ui-${++n}`);
  await store.init();
  if (opts.onboarded !== false) await store.mutate((d, c) => updateSettings(d, c, (x) => ({ ...x, general: { ...x.general, onboardingDone: true } })));
  const engine = new SyncEngine({ store, createClient: (t) => new GithubClient({ token: t, fetchImpl: gh.fetch }), isOnline: () => true });
  const user = userEvent.setup();
  render(<AppProvider store={store} engine={engine}><App /></AppProvider>);
  return { store, engine, user, adapter, gh };
}
const nav = (name: RegExp) => screen.getByRole('button', { name });

describe('interface DinoStart (rendu réel dans jsdom)', () => {
  it('affiche l’accueil vide avec tous les widgets par défaut, sans fausses données', async () => {
    await mount();
    expect(screen.getByRole('search')).toBeTruthy();
    expect(screen.getByText('Aucun favori pour l’instant')).toBeTruthy();
    expect(screen.getByText('Aucun projet')).toBeTruthy();
    expect(screen.getByText('Rien à faire pour le moment.')).toBeTruthy();
    expect(screen.getByLabelText('Nouvelle note rapide')).toBeTruthy();
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(document.documentElement.style.getPropertyValue('--primary')).toBe('#5194f5'); // bleu du logo
  });

  it('ajoute un favori via le formulaire, valide l’URL et l’affiche sur l’accueil comme lien sûr', async () => {
    const { user, store } = await mount();
    await user.click(nav(/^Favoris$/));
    await user.click(screen.getAllByRole('button', { name: /Ajouter (un|mon premier) favori/ })[0]!);
    const dlg = screen.getByRole('dialog', { hidden: true });
    await user.type(within(dlg).getByLabelText('Titre'), 'Dino Industry');
    await user.type(within(dlg).getByLabelText('Adresse'), 'javascript:alert(1)');
    await user.click(within(dlg).getByRole('button', { name: 'Ajouter' }));
    expect(within(dlg).getByText(/n’est pas autorisé|Seuls les liens http/)).toBeTruthy();
    expect(live(store.getDoc().favorites)).toHaveLength(0);
    const url = within(dlg).getByLabelText('Adresse');
    await user.clear(url); await user.type(url, 'dino-industry.fr');
    await user.click(within(dlg).getByRole('button', { name: 'Ajouter' }));
    await waitFor(() => expect(live(store.getDoc().favorites)).toHaveLength(1));
    expect(store.getDoc().favorites[0]!.url).toBe('https://dino-industry.fr/');
    await user.click(nav(/^Accueil$/));
    const link = await screen.findByRole('link', { name: /Dino Industry/ });
    expect(link.getAttribute('href')).toBe('https://dino-industry.fr/');
    expect(link.getAttribute('rel')).toContain('noopener');
  });

  it('crée une catégorie, un favori classé, puis supprime la catégorie en conservant le favori', async () => {
    const { user, store } = await mount();
    await user.click(nav(/^Favoris$/));
    await user.click(screen.getByRole('button', { name: 'Nouvelle catégorie' }));
    await user.type(screen.getByLabelText('Nom'), 'Travail');
    await user.click(screen.getByRole('button', { name: 'Créer' }));
    await waitFor(() => expect(live(store.getDoc().categories)).toHaveLength(1));
    await user.click(screen.getAllByRole('button', { name: /Ajouter (un|mon premier) favori/ })[0]!);
    const dlg = screen.getByRole('dialog', { hidden: true });
    await user.type(within(dlg).getByLabelText('Titre'), 'GitHub');
    await user.type(within(dlg).getByLabelText('Adresse'), 'github.com');
    await user.click(within(dlg).getByRole('button', { name: 'Ajouter' }));
    await waitFor(() => expect(live(store.getDoc().favorites)).toHaveLength(1));
    expect(store.getDoc().favorites[0]!.categoryId).toBe(live(store.getDoc().categories)[0]!.id);
    await user.click(screen.getByRole('button', { name: /Supprimer « Travail »/ }));
    await user.click(within(screen.getByRole('dialog', { hidden: true })).getByRole('button', { name: 'Supprimer la catégorie' }));
    await waitFor(() => expect(live(store.getDoc().categories)).toHaveLength(0));
    expect(live(store.getDoc().favorites)).toHaveLength(1);
    expect(live(store.getDoc().favorites)[0]!.categoryId).toBeNull();
  });

  it('ajoute et termine une tâche depuis le widget, puis la masque', async () => {
    const { user, store } = await mount();
    await user.type(screen.getByLabelText('Nouvelle tâche'), 'Écrire le README{Enter}');
    await waitFor(() => expect(live(store.getDoc().tasks)).toHaveLength(1));
    await user.click(screen.getByRole('checkbox', { name: /Terminer : Écrire le README/ }));
    await waitFor(() => expect(store.getDoc().tasks[0]!.done).toBe(true));
    await waitFor(() => expect(screen.queryByRole('checkbox', { name: /Terminer : Écrire le README/ })).toBeNull()); // hideDone par défaut
  });

  it('enregistre une note rapide', async () => {
    const { user, store } = await mount();
    await user.type(screen.getByLabelText('Nouvelle note rapide'), 'Idée de projet');
    await user.click(screen.getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => expect(live(store.getDoc().notes)).toHaveLength(1));
    expect(await screen.findByText('Idée de projet')).toBeTruthy();
  });

  it('la recherche locale trouve les éléments et propose la recherche Web', async () => {
    const { user, store } = await mount();
    await user.type(screen.getByLabelText('Nouvelle tâche'), 'Envoyer le devis{Enter}');
    await waitFor(() => expect(live(store.getDoc().tasks)).toHaveLength(1));
    await user.type(screen.getByRole('combobox', { name: 'Rechercher' }), 'devis');
    const list = await screen.findByRole('listbox');
    expect(within(list).getByText('Envoyer le devis')).toBeTruthy();
    expect(within(list).getByText('Tâche')).toBeTruthy();
    expect(within(list).getByText(/Rechercher « devis » sur le Web/)).toBeTruthy();
  });

  it('change le thème et persiste les couleurs après « redémarrage »', async () => {
    const { user, store, adapter } = await mount();
    await user.click(screen.getByRole('button', { name: 'Paramètres' }));
    await user.click(screen.getByRole('button', { name: 'Clair' }));
    await waitFor(() => expect(document.documentElement.getAttribute('data-theme')).toBe('light'));
    expect(store.getDoc().settings.appearance.mode).toBe('light');
    cleanup();
    const store2 = new DinoStore(adapter); await store2.init();
    expect(store2.getDoc().settings.appearance.mode).toBe('light');
  });

  it('la disposition : masquer un widget le retire de l’accueil, tout restaurer le ramène', async () => {
    const { user, store } = await mount();
    await user.click(screen.getByRole('button', { name: 'Personnaliser' }));
    const bar = screen.getByRole('toolbar', { name: /Disposition de Notes rapides/ });
    await user.click(within(bar).getByRole('button', { name: 'Masquer' }));
    await waitFor(() => expect(store.getDoc().widgets.find((w) => w.type === 'quickNotes')!.enabled).toBe(false));
    await user.click(screen.getAllByRole('button', { name: 'Terminer' })[0]!);
    expect(screen.queryByLabelText('Nouvelle note rapide')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Personnaliser' }));
    await user.click(screen.getByRole('button', { name: /Tout restaurer/ }));
    await user.click(within(screen.getByRole('dialog', { hidden: true })).getByRole('button', { name: 'Restaurer' }));
    await waitFor(() => expect(store.getDoc().widgets.every((w) => w.enabled)).toBe(true));
  });

  it('sauvegardes : l’export n’inclut pas le jeton et un fichier invalide est rejeté', async () => {
    const { user, store } = await mount();
    await store.setLocal(KEYS.secret, { token: TEST_TOKEN });
    await user.click(screen.getByRole('button', { name: 'Sauvegardes' }));
    expect(screen.getByRole('button', { name: 'Exporter en JSON' })).toBeTruthy();
    const input = screen.getByLabelText('Choisir un fichier de sauvegarde') as HTMLInputElement;
    await user.upload(input, new File(['{pas du json'], 'mauvais.json', { type: 'application/json' }));
    expect(await screen.findByText(/pas un JSON valide/)).toBeTruthy();
    const before = JSON.stringify(store.getDoc());
    expect(JSON.stringify(store.getDoc())).toBe(before);
  });

  it('synchronisation : la vérification des paramètres affiche le détail des étapes, le jeton reste masqué', async () => {
    const gh = new FakeGithub();
    const { user } = await mount(gh);
    await user.click(screen.getByRole('button', { name: /Synchro désactivée/ }));
    await user.type(screen.getByLabelText('Propriétaire du dépôt'), 'moi');
    await user.type(screen.getByLabelText('Nom du dépôt'), 'dinostart-data');
    const tokenInput = screen.getByLabelText(/Jeton d’accès/) as HTMLInputElement;
    expect(tokenInput.type).toBe('password');
    await user.type(tokenInput, TEST_TOKEN);
    await user.click(screen.getByRole('button', { name: 'Vérifier les paramètres' }));
    const res = await screen.findByRole('list', { name: 'Résultat de la vérification' });
    expect(within(res).getByText(/Le dépôt est privé/)).toBeTruthy();
    expect(within(res).getByText(/sera créé à la première synchronisation/)).toBeTruthy();
    expect(gh.putCount()).toBe(0);
  });

  it('synchronisation de bout en bout depuis l’interface : crée le fichier distant et met à jour l’indicateur', async () => {
    const gh = new FakeGithub();
    const { user, store } = await mount(gh);
    await user.type(screen.getByLabelText('Nouvelle tâche'), 'Tâche à synchroniser{Enter}');
    await waitFor(() => expect(live(store.getDoc().tasks)).toHaveLength(1));
    await user.click(screen.getByRole('button', { name: /Synchro désactivée/ }));
    await user.type(screen.getByLabelText('Propriétaire du dépôt'), 'moi');
    await user.type(screen.getByLabelText('Nom du dépôt'), 'dinostart-data');
    await user.type(screen.getByLabelText(/Jeton d’accès/), TEST_TOKEN);
    await user.click(screen.getByRole('button', { name: 'Enregistrer et synchroniser' }));
    await waitFor(() => expect(gh.putCount()).toBe(1), { timeout: 4000 });
    expect(gh.getFileContent()).toContain('Tâche à synchroniser');
    expect(gh.getFileContent()).not.toContain('github_pat_');
    expect(await screen.findByText('Dernière synchronisation réussie')).toBeTruthy();
    await waitFor(() => expect(screen.getByRole('button', { name: /Synchronisé/ })).toBeTruthy());
  });

  it('l’assistant de premier lancement propose Google par défaut, applique les choix et ne revient plus', async () => {
    const { user, store } = await mount(new FakeGithub(), { onboarded: false });
    const dlg = screen.getByRole('dialog', { name: /Bienvenue/ });
    expect(dlg).toBeTruthy();
    await user.click(within(dlg).getByRole('button', { name: 'Commencer' }));
    expect(screen.getByRole('radio', { name: 'Google' }).getAttribute('aria-checked')).toBe('true');
    await user.click(screen.getByRole('radio', { name: 'Qwant' }));
    await waitFor(() => expect(store.getDoc().settings.search.engine).toBe('qwant'));
    await user.click(screen.getByRole('switch', { name: /Suggestions Google/ }));
    await waitFor(() => expect(store.getDoc().settings.search.googleSuggestions).toBe(false));
    await user.click(screen.getByRole('button', { name: 'Suivant' }));
    await user.click(screen.getByRole('button', { name: 'Clair' }));
    await waitFor(() => expect(document.documentElement.getAttribute('data-theme')).toBe('light'));
    await user.click(screen.getByRole('button', { name: /Orange/ }));
    await waitFor(() => expect(store.getDoc().settings.appearance.primary).toBe('#f97316'));
    await user.click(screen.getByRole('button', { name: 'Suivant' }));
    await user.click(screen.getByRole('button', { name: 'Terminer' }));
    await waitFor(() => expect(store.getDoc().settings.general.onboardingDone).toBe(true));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(store.getDoc().settings.search.engine).toBe('qwant');
  });

  it('« Passer » ferme l’assistant sans rien changer', async () => {
    const { user, store } = await mount(new FakeGithub(), { onboarded: false });
    await user.click(screen.getByRole('button', { name: 'Passer' }));
    await waitFor(() => expect(store.getDoc().settings.general.onboardingDone).toBe(true));
    expect(store.getDoc().settings.search.engine).toBe('google');
  });

  it('les paramètres permettent de relancer l’assistant', async () => {
    const { user, store } = await mount();
    await user.click(screen.getByRole('button', { name: 'Paramètres' }));
    await user.click(screen.getByRole('button', { name: 'Relancer l’assistant' }));
    await waitFor(() => expect(store.getDoc().settings.general.onboardingDone).toBe(false));
    expect(await screen.findByRole('dialog', { name: /Bienvenue/ })).toBeTruthy();
  });

  it('les favoris affichent l’icône locale de Chrome, avec repli sur la lettre si elle échoue', async () => {
    vi.stubGlobal('chrome', { runtime: { getURL: (p: string) => `chrome-extension://abc${p}` } });
    const { store } = await mount();
    await store.mutateAdd((d, c) => addFavorite(d, c, { title: 'Exemple', url: 'https://exemple.fr', categoryId: null }));
    await store.mutateAdd((d, c) => addFavorite(d, c, { title: 'Zèbre', url: 'https://zebre.fr', categoryId: null, icon: { kind: 'initial' } }));
    const img = await waitFor(() => { const i = document.querySelector('img[src*="_favicon"]'); expect(i).toBeTruthy(); return i as HTMLImageElement; });
    expect(img.src).toContain('pageUrl=https%3A%2F%2Fexemple.fr%2F');
    expect(document.querySelectorAll('img[src*="_favicon"]')).toHaveLength(1); // « Zèbre » a une lettre choisie
    fireEvent.error(img);
    await waitFor(() => expect(document.querySelector('img[src*="_favicon"]')).toBeNull());
    expect(screen.getAllByText('E').length).toBeGreaterThan(0);
  });

  it('dossiers façon téléphone : glisser un favori sur un autre crée un dossier, glisser sur un dossier y range', async () => {
    const { store, user } = await mount();
    for (const t of ['Alpha', 'Bravo', 'Charlie']) await store.mutateAdd((d, c) => addFavorite(d, c, { title: t, url: `https://${t}.fr`, categoryId: null }));
    const wrap = (t: string) => screen.getByTitle(new RegExp(`^${t} —`)).closest('.tile-wrap') as HTMLElement;
    fireEvent.dragStart(wrap('Alpha'));
    fireEvent.dragOver(wrap('Bravo'));
    fireEvent.drop(wrap('Bravo'));
    await waitFor(() => expect(live(store.getDoc().categories)).toHaveLength(1));
    const folder = live(store.getDoc().categories)[0]!;
    expect(live(store.getDoc().favorites).filter((f) => f.categoryId === folder.id).map((f) => f.title).sort()).toEqual(['Alpha', 'Bravo']);
    const tile = await screen.findByRole('button', { name: /Dossier Nouveau dossier, 2 favoris/ });
    fireEvent.dragStart(wrap('Charlie'));
    fireEvent.dragOver(tile);
    fireEvent.drop(tile);
    await waitFor(() => expect(live(store.getDoc().favorites).every((f) => f.categoryId === folder.id)).toBe(true));
    await user.click(await screen.findByRole('button', { name: /Dossier Nouveau dossier, 3 favoris/ }));
    const popup = screen.getByRole('dialog', { hidden: true });
    expect(within(popup).getAllByRole('link')).toHaveLength(3);
    await user.click(within(popup).getByRole('button', { name: 'Modifier le dossier' }));
    await user.click(within(popup).getAllByRole('button', { name: 'Retirer du dossier' })[0]!);
    await waitFor(() => expect(live(store.getDoc().favorites).filter((f) => f.categoryId === null)).toHaveLength(1));
  });

  it('la barre de recherche propose les suggestions Google et retient les recherches', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(['chat', ['chat noir', 'chatgpt']])));
    vi.stubGlobal('fetch', fetchMock);
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    const { user, store } = await mount();
    const box = screen.getByRole('combobox', { name: 'Rechercher' });
    await user.type(box, 'chat');
    const list = await screen.findByRole('listbox');
    await waitFor(() => expect(within(list).getByText('chat noir')).toBeTruthy());
    expect(String((fetchMock.mock.calls[0] as unknown as [string])[0])).toContain('suggestqueries.google.com');
    await user.keyboard('{ArrowDown}{Control>}{Enter}{/Control}');
    await waitFor(() => expect(open).toHaveBeenCalled());
    expect(String(open.mock.calls[0]![0])).toBe('https://www.google.com/search?q=chat%20noir');
    // les recherches passées sont proposées au clic dans la barre vide
    await user.clear(box); await user.click(document.body); await user.click(box);
    expect(await screen.findByText('Recherche récente')).toBeTruthy();
    expect(within(screen.getByRole('listbox')).getByText('chat noir')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: /Oublier « chat noir »/ }));
    await waitFor(() => expect(screen.queryByText('Recherche récente')).toBeNull());
    void store;
  });

  it('suggestions désactivées : aucune requête n’est envoyée pendant la frappe', async () => {
    const fetchMock = vi.fn(async () => new Response('[]'));
    vi.stubGlobal('fetch', fetchMock);
    const { user, store } = await mount();
    await store.mutate((d, c) => updateSettings(d, c, (x) => ({ ...x, search: { ...x.search, googleSuggestions: false } })));
    await user.type(screen.getByRole('combobox', { name: 'Rechercher' }), 'bonjour tout le monde');
    await new Promise((r) => setTimeout(r, 400));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('boutons façon Google : Lens, navigation privée, historique et assistants IA', async () => {
    const create = vi.fn(async () => ({}));
    const tabs = vi.fn(async () => ({}));
    vi.stubGlobal('chrome', { runtime: { getURL: (p: string) => `chrome-extension://abc${p}` }, windows: { create }, tabs: { create: tabs } });
    const { user } = await mount();
    expect(screen.getByRole('link', { name: /Google Lens/ }).getAttribute('href')).toBe('https://lens.google.com/');
    const chatgpt = screen.getByRole('link', { name: /ChatGPT/ });
    expect(chatgpt.getAttribute('href')).toBe('https://chatgpt.com/');
    expect(screen.queryByRole('link', { name: /Perplexity/ })).toBeNull(); // désactivé par défaut
    await user.type(screen.getByRole('combobox', { name: 'Rechercher' }), 'bonjour monde');
    expect(screen.getByRole('link', { name: /ChatGPT/ }).getAttribute('href')).toBe('https://chatgpt.com/?q=bonjour%20monde');
    expect(screen.getByRole('link', { name: /Gemini/ }).getAttribute('href')).toBe('https://gemini.google.com/app'); // pas de paramètre de question
    await user.click(screen.getByRole('button', { name: /Navigation privée/ }));
    await waitFor(() => expect(create).toHaveBeenCalledWith({ incognito: true, url: 'https://www.google.com/search?q=bonjour%20monde' }));
    await user.click(screen.getByRole('button', { name: /Historique/ }));
    await waitFor(() => expect(tabs).toHaveBeenCalledWith({ url: 'chrome://history' }));
  });

  it('une recherche privée n’est jamais enregistrée dans l’historique', async () => {
    vi.stubGlobal('chrome', { runtime: { getURL: (p: string) => p }, windows: { create: vi.fn(async () => ({})) } });
    vi.stubGlobal('fetch', vi.fn(async () => new Response('[]')));
    const { user, adapter } = await mount();
    await user.type(screen.getByRole('combobox', { name: 'Rechercher' }), 'très confidentiel');
    await user.click(screen.getByRole('button', { name: /Navigation privée/ }));
    await new Promise((r) => setTimeout(r, 300));
    expect(JSON.stringify(adapter.dump())).not.toContain('très confidentiel');
  });

  it('raccourcis : modifier, créer (adresse validée), réordonner, masquer et supprimer, comme sur la page', async () => {
    const { user, store } = await mount();
    const sc = () => store.getDoc().settings.search.shortcuts;
    await user.click(screen.getByRole('button', { name: 'Paramètres' }));
    await user.click(screen.getByRole('tab', { name: 'Recherche' }));
    await user.click(screen.getByRole('switch', { name: 'Recherche par image (Google Lens)' }));
    await waitFor(() => expect(store.getDoc().settings.search.showLens).toBe(false));

    // modifier un raccourci existant : le renommer et changer son icône
    await user.click(screen.getByRole('button', { name: 'Modifier Navigation privée' }));
    let dlg = screen.getByRole('dialog', { hidden: true });
    const name = within(dlg).getByLabelText('Nom affiché');
    await user.clear(name); await user.type(name, 'Privé');
    await user.click(within(dlg).getByRole('button', { name: 'Cadenas' }));
    await user.click(within(dlg).getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => expect(sc().find((x) => x.id === 'private')).toMatchObject({ label: 'Privé', icon: { kind: 'icon', name: 'lock' }, kind: 'private' }));

    // créer un lien : adresse dangereuse refusée, puis valide
    await user.click(screen.getByRole('button', { name: /Ajouter un raccourci/ }));
    dlg = screen.getByRole('dialog', { hidden: true });
    await user.type(within(dlg).getByLabelText('Nom affiché'), 'Mon site');
    await user.type(within(dlg).getByLabelText('Adresse du site'), 'javascript:alert(1)');
    await user.click(within(dlg).getByRole('button', { name: 'Ajouter' }));
    expect(await within(dlg).findByText(/n’est pas autorisé|Seuls les liens http/)).toBeTruthy();
    expect(sc().some((x) => x.label === 'Mon site')).toBe(false);
    const url = within(dlg).getByLabelText('Adresse du site');
    await user.clear(url); await user.type(url, 'mon-site.fr');
    await user.click(within(dlg).getByRole('button', { name: 'Icône du site' }));
    await user.click(within(dlg).getByRole('button', { name: 'Ajouter' }));
    await waitFor(() => expect(sc().some((x) => x.label === 'Mon site' && x.url === 'https://mon-site.fr/' && x.icon.kind === 'auto' && x.kind === 'link')).toBe(true));

    // créer une navigation privée vers un site précis
    await user.click(screen.getByRole('button', { name: /Ajouter un raccourci/ }));
    dlg = screen.getByRole('dialog', { hidden: true });
    await user.type(within(dlg).getByLabelText('Nom affiché'), 'Banque privée');
    await user.selectOptions(within(dlg).getByLabelText('Type'), 'private');
    await user.type(within(dlg).getByLabelText(/Adresse à ouvrir en privé/), 'banque.fr');
    await user.click(within(dlg).getByRole('button', { name: 'Ajouter' }));
    await waitFor(() => expect(sc().some((x) => x.label === 'Banque privée' && x.kind === 'private' && x.url === 'https://banque.fr/')).toBe(true));

    // réordonner, masquer, supprimer
    const idsBefore = sc().map((x) => x.id);
    await user.click(screen.getByRole('button', { name: 'Monter Historique' }));
    await waitFor(() => expect(sc().map((x) => x.id).slice(0, 2)).toEqual([idsBefore[1], idsBefore[0]]));
    await user.click(screen.getByRole('switch', { name: 'Afficher Gemini' }));
    await waitFor(() => expect(sc().find((x) => x.id === 'gemini')!.enabled).toBe(false));
    await user.click(screen.getByRole('button', { name: 'Supprimer Copilot' }));
    await user.click(within(screen.getByRole('dialog', { hidden: true })).getByRole('button', { name: 'Supprimer' }));
    await waitFor(() => expect(sc().some((x) => x.id === 'copilot')).toBe(false));

    // le résultat se voit sous la barre de recherche de l'accueil
    await user.click(screen.getByRole('button', { name: 'Accueil' }));
    expect(screen.getByRole('button', { name: /Privé/ })).toBeTruthy();                           // renommé
    expect(screen.getByRole('link', { name: /Mon site/ }).getAttribute('href')).toBe('https://mon-site.fr/');
    expect(screen.getByRole('button', { name: /Banque privée/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Navigation privée/ })).toBeNull();
    expect(screen.queryByRole('link', { name: /Gemini/ })).toBeNull();                              // masqué
    expect(screen.queryByRole('link', { name: /Copilot/ })).toBeNull();                             // supprimé
    expect(screen.queryByRole('link', { name: /Google Lens/ })).toBeNull();                         // Lens masqué
  });

  it('un raccourci « navigation privée » avec adresse ouvre cette adresse en privé, sans l’enregistrer', async () => {
    const create = vi.fn(async () => ({}));
    vi.stubGlobal('chrome', { runtime: { getURL: (p: string) => p }, windows: { create } });
    const { user, store } = await mount();
    await store.mutate((d, c) => updateSettings(d, c, (x) => ({ ...x, search: { ...x.search, shortcuts: [{ id: 'bp', label: 'Banque privée', kind: 'private', icon: { kind: 'icon', name: 'lock' }, url: 'https://banque.fr/', queryUrl: null, enabled: true }] } })));
    await user.type(screen.getByRole('combobox', { name: 'Rechercher' }), 'ignoré');
    await user.click(await screen.findByRole('button', { name: /Banque privée/ }));
    await waitFor(() => expect(create).toHaveBeenCalledWith({ incognito: true, url: 'https://banque.fr/' }));
  });

  it('le panneau Personnaliser donne accès à la gestion des raccourcis', async () => {
    const { user } = await mount();
    await user.click(screen.getByRole('button', { name: 'Personnaliser' }));
    await user.click(screen.getByRole('button', { name: /Gérer les boutons/ }));
    expect(await screen.findByRole('button', { name: /Ajouter un raccourci/ })).toBeTruthy();
  });

  describe('tableau à placement libre', () => {
    // Largeur de repli en test : 1200 px, espace de 16 px → colonne 101,33 px, ligne 56 px.
    const UNIT_X = (1200 - 11 * 16) / 12 + 16, UNIT_Y = 40 + 16;
    const rects = (store: DinoStore) => store.getDoc().widgets.filter((w) => w.enabled);
    const expectNoOverlap = (store: DinoStore) => { const v = rects(store); for (const a of v) for (const b of v) if (a !== b) expect(a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h, `${a.type}/${b.type}`).toBe(false); };
    const widget = (store: DinoStore, t: string) => store.getDoc().widgets.find((w) => w.type === t)!;

    it('glisser une carte par sa barre la place où on la dépose, les autres se poussent, tout est enregistré', async () => {
      const { user, store } = await mount();
      await user.click(screen.getByRole('button', { name: 'Personnaliser' }));
      const bar = screen.getByRole('toolbar', { name: /Disposition de Horloge/ });
      const title = within(bar).getByText('Horloge');
      fireEvent.pointerDown(title, { clientX: 100, clientY: 100, button: 0, pointerId: 1 });
      fireEvent.pointerMove(title, { clientX: 100 + UNIT_X * 2 + 4, clientY: 100 + UNIT_Y * 3, pointerId: 1 });
      fireEvent.pointerUp(title, { clientX: 100 + UNIT_X * 2 + 4, clientY: 100 + UNIT_Y * 3, pointerId: 1 });
      await waitFor(() => expect(widget(store, 'clock')).toMatchObject({ x: 2, y: 3 }));
      expectNoOverlap(store);
      expect(widget(store, 'clock')).toMatchObject({ w: 6, h: 4 }); // taille inchangée
    });

    it('tirer le coin en bas à droite redimensionne la carte (largeur et hauteur) et respecte le minimum', async () => {
      const { user, store } = await mount();
      await user.click(screen.getByRole('button', { name: 'Personnaliser' }));
      const handle = screen.getByRole('button', { name: /Redimensionner Tâches/ });
      const before = widget(store, 'tasks');
      fireEvent.pointerDown(handle, { clientX: 500, clientY: 500, button: 0, pointerId: 2 });
      fireEvent.pointerMove(handle, { clientX: 500 - UNIT_X, clientY: 500 + UNIT_Y, pointerId: 2 });
      fireEvent.pointerUp(handle, { clientX: 500 - UNIT_X, clientY: 500 + UNIT_Y, pointerId: 2 });
      await waitFor(() => expect(widget(store, 'tasks')).toMatchObject({ w: before.w - 1, h: before.h + 1, x: before.x, y: before.y }));
      expectNoOverlap(store);
      fireEvent.pointerDown(handle, { clientX: 500, clientY: 500, button: 0, pointerId: 3 });
      fireEvent.pointerMove(handle, { clientX: 500 - UNIT_X * 20, clientY: 500 - UNIT_Y * 20, pointerId: 3 });
      fireEvent.pointerUp(handle, { clientX: 500 - UNIT_X * 20, clientY: 500 - UNIT_Y * 20, pointerId: 3 });
      await waitFor(() => expect(widget(store, 'tasks')).toMatchObject({ w: 3, h: 4 })); // taille minimale de la carte
    });

    it('agrandir une carte vers une voisine la pousse sans superposition', async () => {
      const { user, store } = await mount();
      await user.click(screen.getByRole('button', { name: 'Personnaliser' }));
      const handle = screen.getByRole('button', { name: /Redimensionner Favoris/ });
      fireEvent.pointerDown(handle, { clientX: 300, clientY: 300, button: 0, pointerId: 4 });
      fireEvent.pointerMove(handle, { clientX: 300 + UNIT_X * 4, clientY: 300 + UNIT_Y * 2, pointerId: 4 });
      fireEvent.pointerUp(handle, { clientX: 300 + UNIT_X * 4, clientY: 300 + UNIT_Y * 2, pointerId: 4 });
      await waitFor(() => expect(widget(store, 'favorites').w).toBe(12));
      expectNoOverlap(store);
      expect(widget(store, 'quickLinks').y).toBeGreaterThanOrEqual(widget(store, 'favorites').y + widget(store, 'favorites').h);
    });

    it('un simple clic sur la barre ne déplace rien ; hors édition, aucune poignée n’existe', async () => {
      const { user, store } = await mount();
      expect(screen.queryByRole('button', { name: /Redimensionner/ })).toBeNull();
      const before = JSON.stringify(store.getDoc().widgets);
      await user.click(screen.getByRole('button', { name: 'Personnaliser' }));
      const title = within(screen.getByRole('toolbar', { name: /Disposition de Date/ })).getByText('Date');
      fireEvent.pointerDown(title, { clientX: 50, clientY: 50, button: 0, pointerId: 5 });
      fireEvent.pointerUp(title, { clientX: 50, clientY: 50, pointerId: 5 });
      await new Promise((r) => setTimeout(r, 50));
      expect(JSON.stringify(store.getDoc().widgets)).toBe(before);
    });

    it('au clavier : flèches pour déplacer, Maj + flèches pour redimensionner', async () => {
      const { user, store } = await mount();
      await user.click(screen.getByRole('button', { name: 'Personnaliser' }));
      const grip = screen.getByRole('button', { name: /Déplacer Notes rapides/ });
      const before = widget(store, 'quickNotes');
      fireEvent.keyDown(grip, { key: 'ArrowDown' });
      await waitFor(() => expect(widget(store, 'quickNotes').y).toBe(before.y + 1));
      fireEvent.keyDown(grip, { key: 'ArrowLeft', shiftKey: true });
      await waitFor(() => expect(widget(store, 'quickNotes').w).toBe(before.w - 1));
      fireEvent.keyDown(grip, { key: 'ArrowUp' });
      await waitFor(() => expect(widget(store, 'quickNotes').y).toBe(before.y));
      fireEvent.keyDown(grip, { key: 'ArrowUp' });
      await waitFor(() => expect(widget(store, 'quickNotes').y).toBe(before.y - 1));
      expectNoOverlap(store);
    });

    it('la disposition choisie est conservée après redémarrage', async () => {
      const { user, store, adapter } = await mount();
      await user.click(screen.getByRole('button', { name: 'Personnaliser' }));
      const grip = screen.getByRole('button', { name: /Déplacer Date/ });
      fireEvent.keyDown(grip, { key: 'ArrowDown' });
      await waitFor(() => expect(widget(store, 'date').y).toBe(1));
      cleanup();
      const again = new DinoStore(adapter); await again.init();
      expect(again.getDoc().widgets.find((w) => w.type === 'date')!.y).toBe(1);
    });

    it('le bouton Personnaliser est tout en bas de la page (pas flottant) ; le panneau permet de réactiver une carte masquée', async () => {
      const { user, store } = await mount();
      expect(document.querySelector('.fab')).toBeNull();
      const foot = document.querySelector('.home-foot')!;
      expect(within(foot as HTMLElement).getByRole('button', { name: 'Personnaliser' })).toBeTruthy();
      expect(document.querySelector('.board')!.compareDocumentPosition(foot) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy(); // après le tableau
      await user.click(within(foot as HTMLElement).getByRole('button', { name: 'Personnaliser' }));
      expect(within(foot as HTMLElement).getByRole('button', { name: 'Terminer' })).toBeTruthy();
      await user.click(within(screen.getByRole('toolbar', { name: /Disposition de Projets récents/ })).getByRole('button', { name: 'Masquer' }));
      await waitFor(() => expect(widget(store, 'projects').enabled).toBe(false));
      await user.click(screen.getByRole('switch', { name: 'Projets récents' }));
      await waitFor(() => expect(widget(store, 'projects').enabled).toBe(true));
      expectNoOverlap(store);
    });
  });

  describe('onglet Ouverture', () => {
    it('version « nouvel onglet » : pas d’onglet Ouverture ; l’onglet Aide donne le Discord, la version et le conseil de la barre', async () => {
      vi.stubGlobal('chrome', { runtime: { getManifest: () => ({ manifest_version: 3, version: '9.8.7', chrome_url_overrides: { newtab: 'newtab.html' } }), getURL: (p: string) => p } });
      const { user } = await mount();
      await user.click(screen.getByRole('button', { name: 'Paramètres' }));
      expect(screen.queryByRole('tab', { name: 'Ouverture' })).toBeNull();
      await user.click(screen.getByRole('tab', { name: 'Aide' }));
      const discord = await screen.findByRole('link', { name: /Rejoindre le Discord/ });
      expect(discord.getAttribute('href')).toBe('https://discord.gg/sjvcZ7qsJn');
      expect(discord.getAttribute('rel')).toContain('noopener');
      expect(discord.getAttribute('target')).toBe('_blank');
      expect(screen.getByText('9.8.7')).toBeTruthy();
      expect(screen.getByText(/Faites un clic droit dessus et désactivez-la/)).toBeTruthy();
      expect(screen.getByText(/Ne publiez jamais votre jeton/)).toBeTruthy();
    });

    it('version « page d’accueil » : affiche l’adresse, la copie, et ouvre les réglages de Chrome', async () => {
      const create = vi.fn(async () => ({}));
      vi.stubGlobal('chrome', { runtime: { getManifest: () => ({ manifest_version: 3 }), getURL: (p: string) => `chrome-extension://abcdef/${p}` }, tabs: { create } });
      const { user } = await mount();
      await user.click(screen.getByRole('button', { name: 'Paramètres' }));
      await user.click(screen.getByRole('tab', { name: 'Ouverture' }));
      const field = await screen.findByLabelText('Adresse de DinoStart') as HTMLInputElement;
      expect(field.value).toBe('chrome-extension://abcdef/newtab.html');
      expect(field.readOnly).toBe(true);
      expect(screen.getByText(/Alt \+ Maj \+ D/)).toBeTruthy();
      await user.click(screen.getByRole('button', { name: 'Copier l’adresse' }));
      await waitFor(async () => expect(await navigator.clipboard.readText()).toBe('chrome-extension://abcdef/newtab.html'));
      await user.click(screen.getByRole('button', { name: /Ouvrir « Apparence » de Chrome/ }));
      await waitFor(() => expect(create).toHaveBeenCalledWith({ url: 'chrome://settings/appearance' }));
      await user.click(screen.getByRole('button', { name: /Ouvrir « Au démarrage » de Chrome/ }));
      await waitFor(() => expect(create).toHaveBeenCalledWith({ url: 'chrome://settings/onStartup' }));
      await user.click(screen.getByRole('button', { name: /raccourcis des extensions/ }));
      await waitFor(() => expect(create).toHaveBeenCalledWith({ url: 'chrome://extensions/shortcuts' }));
    });
  });
});
