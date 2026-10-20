// Lit le dernier thème appliqué (copie locale non sensible) pour éviter un flash au démarrage.
(function () {
  try {
    var raw = localStorage.getItem('dinostart:themeCache');
    if (!raw) return;
    var c = JSON.parse(raw);
    var root = document.documentElement;
    var mode = c.mode === 'light' || c.mode === 'dark' ? c.mode : (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
    root.setAttribute('data-theme', mode);
    if (c.vars && typeof c.vars === 'object') {
      for (var k in c.vars) {
        if (k.indexOf('--') === 0 && typeof c.vars[k] === 'string') root.style.setProperty(k, c.vars[k]);
      }
    }
  } catch { /* cache absent ou invalide : le thème par défaut s'applique */ }
})();
