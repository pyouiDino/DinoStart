import { describe, expect, it } from 'vitest';
import { clampRect, COLS, DEFAULT_RECTS, intersects, layoutRows, MAX_ROW, resolveLayout, sameRect, snapMove, snapResize, type Rect } from '../../src/core/layout';

const noOverlap = (l: Record<string, Rect>) => {
  const ids = Object.keys(l);
  for (const a of ids) for (const b of ids) if (a < b) expect(intersects(l[a]!, l[b]!), `${a} / ${b}`).toBe(false);
};
const base = (): Record<string, Rect> => ({ a: { x: 0, y: 0, w: 6, h: 4 }, b: { x: 6, y: 0, w: 6, h: 4 }, c: { x: 0, y: 4, w: 12, h: 4 } });

describe('grille', () => {
  it('la disposition par défaut n’a aucun chevauchement et tient dans 12 colonnes', () => {
    noOverlap(DEFAULT_RECTS);
    for (const r of Object.values(DEFAULT_RECTS)) expect(r.x + r.w).toBeLessThanOrEqual(COLS);
  });
  it('clampRect : entiers, bornes, taille minimale', () => {
    expect(clampRect({ x: 9.4, y: -3, w: 99, h: 0 })).toEqual({ x: 0, y: 0, w: 12, h: 1 });
    expect(clampRect({ x: 11, y: 5, w: 4, h: 2 }, { w: 3, h: 3 })).toEqual({ x: 8, y: 5, w: 4, h: 3 });
    expect(clampRect({ x: 0, y: 99999, w: 2, h: 10 }).y + 10).toBeLessThanOrEqual(MAX_ROW);
  });
  it('déposer sur une carte la pousse sous la carte déplacée', () => {
    const r = resolveLayout(base(), 'a', { x: 6, y: 0, w: 6, h: 4 }); // a sur b
    expect(r.a).toEqual({ x: 6, y: 0, w: 6, h: 4 });
    expect(r.b.y).toBe(4);
    noOverlap(r);
  });
  it('les poussées se propagent en chaîne', () => {
    const r = resolveLayout(base(), 'a', { x: 0, y: 4, w: 6, h: 4 }); // a sur c ; c descend, rien ne se chevauche
    expect(r.c.y).toBe(8);
    expect(r.a.y).toBe(4);
    noOverlap(r);
    const chain = resolveLayout({ a: { x: 0, y: 0, w: 4, h: 2 }, b: { x: 0, y: 2, w: 4, h: 2 }, c: { x: 0, y: 4, w: 4, h: 2 }, d: { x: 8, y: 0, w: 4, h: 2 } }, 'd', { x: 0, y: 0, w: 4, h: 3 });
    expect(chain.a.y).toBe(3); expect(chain.b.y).toBe(5); expect(chain.c.y).toBe(7);
    noOverlap(chain);
  });
  it('ne touche pas aux cartes qui ne gênent pas, ni à la carte déplacée', () => {
    const r = resolveLayout(base(), 'a', { x: 0, y: 20, w: 3, h: 3 });
    expect(r.b).toEqual(base().b); expect(r.c).toEqual(base().c); expect(r.a).toEqual({ x: 0, y: 20, w: 3, h: 3 });
  });
  it('redimensionner une carte pousse ses voisines vers le bas', () => {
    const r = resolveLayout(base(), 'a', { x: 0, y: 0, w: 12, h: 4 });
    expect(r.b.y).toBe(4); expect(r.c.y).toBeGreaterThanOrEqual(8);
    noOverlap(r);
  });
  it('résultat toujours sans chevauchement sur 500 déplacements aléatoires (propriété)', () => {
    let seed = 42; const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
    let layout: Record<string, Rect> = { ...DEFAULT_RECTS };
    const ids = Object.keys(layout);
    for (let i = 0; i < 500; i++) {
      const id = ids[Math.floor(rnd() * ids.length)]!;
      const target = clampRect({ x: rnd() * 12, y: rnd() * 30, w: 1 + rnd() * 11, h: 1 + rnd() * 10 }, { w: 2, h: 3 });
      layout = resolveLayout(layout, id, target);
      expect(layout[id]).toEqual(target);
      noOverlap(layout);
      for (const r of Object.values(layout)) expect(r.x + r.w).toBeLessThanOrEqual(COLS);
    }
    expect(layoutRows(layout)).toBeGreaterThan(0);
  });
  it('conversion pixels → cellules (déplacement et redimensionnement)', () => {
    const unitX = 100, unitY = 56, gap = 16; // 40 px de ligne + 16 px d'espace
    const o: Rect = { x: 2, y: 3, w: 4, h: 3 };
    expect(snapMove(o, 210, 0, unitX, unitY)).toEqual({ ...o, x: 4 });
    expect(snapMove(o, -9999, -9999, unitX, unitY)).toEqual({ ...o, x: 0, y: 0 });
    expect(snapMove(o, 9999, 0, unitX, unitY).x).toBe(COLS - o.w);
    expect(snapResize(o, 104, 0, unitX, unitY, gap)).toEqual({ ...o, w: 5 });
    expect(snapResize(o, 0, 60, unitX, unitY, gap)).toEqual({ ...o, h: 4 });
    expect(snapResize(o, -9999, -9999, unitX, unitY, gap, { w: 2, h: 3 })).toEqual({ ...o, w: 2, h: 3 });
    expect(sameRect(o, { ...o })).toBe(true);
  });
});
