// Géométrie du tableau de bord : grille de 12 colonnes, lignes de hauteur fixe. Fonctions pures.
import type { WidgetType } from './types';

export const COLS = 12;
export const MAX_ROW = 400;
export const MAX_HEIGHT = 40;

export interface Rect { x: number; y: number; w: number; h: number }

/** Taille minimale de chaque carte (colonnes × lignes) pour que son contenu reste utilisable. */
export const MIN_SIZE: Record<WidgetType, { w: number; h: number }> = {
  clock: { w: 2, h: 3 }, date: { w: 2, h: 3 }, search: { w: 4, h: 4 }, favorites: { w: 3, h: 4 },
  quickLinks: { w: 2, h: 3 }, tasks: { w: 3, h: 4 }, projects: { w: 3, h: 4 }, quickNotes: { w: 3, h: 4 },
};

/** Disposition initiale (et « Restaurer »). */
export const DEFAULT_RECTS: Record<WidgetType, Rect> = {
  clock: { x: 0, y: 0, w: 6, h: 4 },
  date: { x: 6, y: 0, w: 6, h: 4 },
  search: { x: 0, y: 4, w: 12, h: 4 },
  favorites: { x: 0, y: 8, w: 8, h: 9 },
  quickLinks: { x: 8, y: 8, w: 4, h: 5 },
  tasks: { x: 8, y: 13, w: 4, h: 4 },
  projects: { x: 0, y: 17, w: 6, h: 6 },
  quickNotes: { x: 6, y: 17, w: 6, h: 6 },
};

export const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

export const intersects = (a: Rect, b: Rect): boolean => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
export const sameRect = (a: Rect, b: Rect): boolean => a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;

/** Ramène un rectangle dans la grille (entiers, taille minimale, sans dépasser les 12 colonnes). */
export function clampRect(r: Rect, min: { w: number; h: number } = { w: 1, h: 1 }): Rect {
  const w = clamp(Math.round(r.w), min.w, COLS);
  const h = clamp(Math.round(r.h), min.h, MAX_HEIGHT);
  return { x: clamp(Math.round(r.x), 0, COLS - w), y: clamp(Math.round(r.y), 0, MAX_ROW - h), w, h };
}

/**
 * Place `fixedId` à `target` et pousse vers le bas les cartes qui le gênent.
 * Les autres cartes sont replacées de haut en bas dans leur ordre d'origine : chacune descend seulement si elle
 * chevauche une carte déjà placée. La carte déplacée n'est jamais bougée, le résultat ne contient aucun
 * chevauchement, et le calcul est fini (à chaque tour, la carte descend strictement).
 */
export function resolveLayout<K extends string>(layout: Record<K, Rect>, fixedId: NoInfer<K>, target: Rect): Record<K, Rect> {
  const out = { ...layout, [fixedId]: target } as Record<K, Rect>;
  const placed: K[] = [fixedId];
  const order = (Object.keys(layout) as K[]).filter((k) => k !== fixedId).sort((a, b) => layout[a].y - layout[b].y || layout[a].x - layout[b].x);
  for (const k of order) {
    let r = out[k];
    for (let guard = 0; guard < 1000; guard++) {
      const hits = placed.filter((p) => intersects(out[p], r));
      if (!hits.length) break;
      r = { ...r, y: Math.max(...hits.map((p) => out[p].y + out[p].h)) };
    }
    out[k] = r;
    placed.push(k);
  }
  return out;
}

/** Nombre de lignes occupées. */
export const layoutRows = (layout: Record<string, Rect>): number => Object.values(layout).reduce((m, r) => Math.max(m, r.y + r.h), 0);

/** Pixels → cellules : utile aux gestes de souris et testable sans navigateur. */
export function snapMove(origin: Rect, dxPx: number, dyPx: number, unitX: number, unitY: number, min?: { w: number; h: number }): Rect {
  return clampRect({ ...origin, x: (origin.x * unitX + dxPx) / unitX, y: (origin.y * unitY + dyPx) / unitY }, min);
}
export function snapResize(origin: Rect, dxPx: number, dyPx: number, unitX: number, unitY: number, gap: number, min?: { w: number; h: number }): Rect {
  const wPx = origin.w * unitX - gap + dxPx, hPx = origin.h * unitY - gap + dyPx;
  return clampRect({ ...origin, w: (wPx + gap) / unitX, h: (hPx + gap) / unitY }, min);
}
