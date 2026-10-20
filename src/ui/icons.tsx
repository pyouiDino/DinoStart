import { useState } from 'react';
import {
  Book, Calendar, Code, Gamepad2, GitBranch, Globe, Image as ImageIcon, MessageSquare, Mail, Map as MapIcon, Music, Newspaper,
  ShoppingBag, Terminal, Video, Wallet, Wrench, Cloud, type LucideIcon,
} from 'lucide-react';
import type { Favorite, IconName } from '../core/types';
import { faviconUrl } from '../search/browser';

export const ICON_MAP: Record<IconName, LucideIcon> = {
  globe: Globe, code: Code, mail: Mail, calendar: Calendar, book: Book, music: Music, video: Video, image: ImageIcon, shopping: ShoppingBag,
  wallet: Wallet, cloud: Cloud, terminal: Terminal, github: GitBranch, chat: MessageSquare, map: MapIcon, gamepad: Gamepad2, newspaper: Newspaper, wrench: Wrench,
};
export const ICON_LABELS: Record<IconName, string> = {
  globe: 'Globe', code: 'Code', mail: 'Courrier', calendar: 'Calendrier', book: 'Livre', music: 'Musique', video: 'Vidéo', image: 'Image', shopping: 'Achats',
  wallet: 'Finances', cloud: 'Cloud', terminal: 'Terminal', github: 'Dépôt', chat: 'Messagerie', map: 'Carte', gamepad: 'Jeux', newspaper: 'Actualités', wrench: 'Outils',
};

type IconFav = Pick<Favorite, 'icon' | 'title'> & { url?: string };

/**
 * Icône d'un favori : icône du site fournie localement par Chrome (par défaut), sinon lettre colorée ou icône choisie.
 * Aucune requête n'est faite vers le site ni vers un service tiers.
 */
export function FavIcon({ fav, color, size = 36 }: { fav: IconFav; color: string; size?: number }) {
  const [failed, setFailed] = useState(false);
  const base = { width: size, height: size };
  if (fav.icon.kind === 'auto' && fav.url && !failed) {
    const src = faviconUrl(fav.url, size > 32 ? 64 : 32);
    if (src) {
      return (
        <span className="fav-icon fav-icon-img" style={base} aria-hidden="true">
          <img src={src} alt="" width={size * 0.64} height={size * 0.64} onError={() => setFailed(true)} draggable={false} />
        </span>
      );
    }
  }
  const style = { ...base, background: `color-mix(in srgb, ${color} 22%, transparent)`, color };
  if (fav.icon.kind === 'icon') {
    const I = ICON_MAP[fav.icon.name];
    return <span className="fav-icon" style={style} aria-hidden="true"><I size={size * 0.52} /></span>;
  }
  const initial = Array.from(fav.title.trim())[0]?.toUpperCase() ?? '?';
  return <span className="fav-icon" style={{ ...style, fontSize: size * 0.46 }} aria-hidden="true">{initial}</span>;
}
