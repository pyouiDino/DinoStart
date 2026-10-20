import { useState } from 'react';
import {
  Bookmark, Bot, Book, Brain, Calculator, Calendar, Camera, Cloud, Code, Download, Folder, Gamepad2, GitBranch, Globe, Heart, History, House, Image as ImageIcon,
  Languages, Link2, Lock, Mail, Map as MapIcon, MessageSquare, Music, Newspaper, Rocket, Search, ShoppingBag, Sparkles, Star, Terminal, VenetianMask, Video, Wallet, Wrench,
  type LucideIcon,
} from 'lucide-react';
import type { Shortcut, ShortcutIconName } from '../core/types';
import { faviconUrl } from '../search/browser';

export const SHORTCUT_ICON_MAP: Record<ShortcutIconName, LucideIcon> = {
  sparkles: Sparkles, bot: Bot, brain: Brain, globe: Globe, search: Search, mask: VenetianMask, history: History, star: Star, heart: Heart, bookmark: Bookmark,
  home: House, mail: Mail, calendar: Calendar, code: Code, terminal: Terminal, git: GitBranch, music: Music, video: Video, image: ImageIcon, book: Book,
  newspaper: Newspaper, shopping: ShoppingBag, wallet: Wallet, cloud: Cloud, map: MapIcon, chat: MessageSquare, gamepad: Gamepad2, wrench: Wrench,
  camera: Camera, rocket: Rocket, lock: Lock, languages: Languages, calculator: Calculator, folder: Folder, download: Download, link: Link2,
};
export const SHORTCUT_ICON_LABELS: Record<ShortcutIconName, string> = {
  sparkles: 'Étincelles', bot: 'Robot', brain: 'Cerveau', globe: 'Globe', search: 'Recherche', mask: 'Masque', history: 'Historique', star: 'Étoile', heart: 'Cœur',
  bookmark: 'Marque-page', home: 'Maison', mail: 'Courrier', calendar: 'Calendrier', code: 'Code', terminal: 'Terminal', git: 'Dépôt', music: 'Musique', video: 'Vidéo',
  image: 'Image', book: 'Livre', newspaper: 'Actualités', shopping: 'Achats', wallet: 'Finances', cloud: 'Cloud', map: 'Carte', chat: 'Messagerie', gamepad: 'Jeux',
  wrench: 'Outils', camera: 'Appareil photo', rocket: 'Fusée', lock: 'Cadenas', languages: 'Langues', calculator: 'Calculatrice', folder: 'Dossier', download: 'Téléchargement', link: 'Lien',
};
const DEFAULT_ICON: Record<Shortcut['kind'], ShortcutIconName> = { link: 'globe', private: 'mask', history: 'history' };

/** Icône d'un raccourci : icône choisie, ou icône du site fournie localement par Chrome (repli sur une icône par défaut). */
export function ShortcutGlyph({ shortcut, size = 16 }: { shortcut: Pick<Shortcut, 'icon' | 'url' | 'kind'>; size?: number }) {
  const [failed, setFailed] = useState(false);
  if (shortcut.icon.kind === 'auto' && shortcut.url && !failed) {
    const src = faviconUrl(shortcut.url, 32);
    if (src) return <img className="sc-fav" src={src} alt="" width={size} height={size} onError={() => setFailed(true)} draggable={false} />;
  }
  const name = shortcut.icon.kind === 'icon' ? shortcut.icon.name : DEFAULT_ICON[shortcut.kind];
  const I = SHORTCUT_ICON_MAP[name];
  return <I size={size} aria-hidden="true" />;
}
