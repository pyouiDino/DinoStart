import { useState, type ReactNode } from 'react';
import { Bookmark, CloudCog } from 'lucide-react';
import { SEARCH_ENGINE_URLS } from '../core/defaults';
import { updateSettings } from '../core/ops';
import { SEARCH_ENGINES } from '../core/types';
import { Button, Toggle } from './common';
import { ThemeAndPalette } from './AppearanceQuick';
import { useApp, type Nav } from './context';

const STEPS = ['Bienvenue', 'Recherche', 'Apparence', 'C’est prêt'] as const;

/** Assistant de configuration du premier lancement (rejouable depuis les paramètres). */
export function Onboarding() {
  const { doc, store, act, go } = useApp();
  const [step, setStep] = useState(0);
  const s = doc.settings.search;
  const setSearch = (patch: Partial<typeof s>) => void act(store.mutate((d, c) => updateSettings(d, c, (x) => ({ ...x, search: { ...x.search, ...patch } }))));
  const finish = async (to?: Nav) => {
    const r = await act(store.mutate((d, c) => updateSettings(d, c, (x) => ({ ...x, general: { ...x.general, onboardingDone: true } }))));
    if (r.ok && to) go(to);
  };
  const body: ReactNode[] = [
    <div key="0" className="ob-body center"><img className="ob-logo" src="./logo.png" alt="" width="104" height="104" draggable={false} />
      <h2 id="ob-title">Bienvenue dans DinoStart</h2>
      <p className="muted">Votre nouvel onglet, à votre façon : favoris, projets, notes, tâches. Quelques questions rapides pour tout régler (1 minute). Vous pourrez tout modifier plus tard.</p></div>,
    <div key="1" className="ob-body"><h2 id="ob-title">Avec quel moteur de recherche ?</h2>
      <div className="engine-grid" role="radiogroup" aria-label="Moteur de recherche">
        {SEARCH_ENGINES.filter((e) => e !== 'custom').map((e) => (
          <button key={e} role="radio" aria-checked={s.engine === e} className={`engine ${s.engine === e ? 'sel' : ''}`} onClick={() => setSearch({ engine: e })}>{SEARCH_ENGINE_URLS[e].label}</button>
        ))}
      </div>
      <div className="form-grid">
        <Toggle label="Suggestions Google pendant que je tape" checked={s.googleSuggestions} onChange={(v) => setSearch({ googleSuggestions: v })} />
        <p className="muted small ob-note">Comme sur Google. Pour proposer ces suggestions, le texte que vous tapez est envoyé à Google. Désactivez-les si vous préférez que rien ne sorte de votre PC.</p>
        <Toggle label="Retenir mes recherches (sur cet appareil)" checked={s.rememberSearches} onChange={(v) => setSearch({ rememberSearches: v })} />
        <p className="muted small ob-note">Elles sont proposées quand vous cliquez dans la barre. Elles restent sur ce PC : jamais envoyées, jamais synchronisées.</p>
      </div></div>,
    <div key="2" className="ob-body"><h2 id="ob-title">Quelle apparence ?</h2><p className="muted">Le changement est visible tout de suite derrière cette fenêtre.</p><ThemeAndPalette /></div>,
    <div key="3" className="ob-body"><h2 id="ob-title">C’est prêt !</h2>
      <p className="muted">Les icônes de vos favoris sont récupérées automatiquement par Chrome (pour les sites déjà visités). Ensuite, que voulez-vous faire ?</p>
      <div className="ob-actions">
        <Button variant="primary" icon={<Bookmark size={16} />} onClick={() => void finish({ view: 'favorites' })}>Ajouter mes premiers favoris</Button>
        <Button variant="secondary" icon={<CloudCog size={16} />} onClick={() => void finish({ view: 'settings', settingsTab: 'sync' })}>Synchroniser mes PC (GitHub)</Button>
        <Button variant="ghost" onClick={() => void finish()}>Terminer</Button>
      </div></div>,
  ];
  return (
    <div className="ob-overlay">
      <div className="ob-card" role="dialog" aria-modal="true" aria-labelledby="ob-title">
        <ol className="ob-steps" aria-label="Progression">{STEPS.map((l, i) => <li key={l} className={i === step ? 'on' : i < step ? 'past' : ''} aria-current={i === step ? 'step' : undefined}>{l}</li>)}</ol>
        {body[step]}
        <div className="ob-foot">
          <Button variant="ghost" onClick={() => void finish()}>Passer</Button>
          <span className="spacer" />
          {step > 0 && <Button variant="secondary" onClick={() => setStep(step - 1)}>Retour</Button>}
          {step < STEPS.length - 1 && <Button variant="primary" onClick={() => setStep(step + 1)}>{step === 0 ? 'Commencer' : 'Suivant'}</Button>}
        </div>
      </div>
    </div>
  );
}
