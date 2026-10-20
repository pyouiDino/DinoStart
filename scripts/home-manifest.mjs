// Déduit le manifeste de la version « page d'accueil » à partir de celui de la version « nouvel onglet » :
// plus de remplacement du nouvel onglet (donc plus de barre Chrome en bas), mais un bouton dans la barre d'outils
// et un raccourci clavier pour ouvrir DinoStart. Aucune permission supplémentaire.
export function buildHomeManifest(base) {
  const { chrome_url_overrides: _removed, ...rest } = base;
  void _removed;
  return {
    ...rest,
    name: "DinoStart (page d'accueil)",
    short_name: 'DinoStart',
    description: "DinoStart sans remplacer le nouvel onglet : ouvrez-le par le bouton de la barre d'outils, Alt+Maj+D ou comme page d'accueil de Chrome.",
    action: { default_title: 'Ouvrir DinoStart', default_icon: base.icons },
    background: { service_worker: 'background.js', type: 'module' },
    commands: { 'open-dinostart': { suggested_key: { default: 'Alt+Shift+D' }, description: 'Ouvrir DinoStart' } },
  };
}
