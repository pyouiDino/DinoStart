import { live } from './ops';
import type { DinoDocument } from './types';
import { hostOf } from './url';

export type SearchKind = 'favorite' | 'category' | 'project' | 'note' | 'task';
export interface SearchHit { kind: SearchKind; id: string; title: string; subtitle: string; score: number; url?: string }

export const KIND_LABELS: Record<SearchKind, string> = { favorite: 'Favori', category: 'Catégorie', project: 'Projet', note: 'Note', task: 'Tâche' };
const STATUS_LABEL = { active: 'actif', paused: 'en pause', done: 'terminé' } as const;

export function normalize(s: string): string {
  return s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

function scoreFields(tokens: string[], title: string, others: string[]): number {
  const t = normalize(title);
  const rest = others.map(normalize);
  let total = 0;
  for (const tok of tokens) {
    if (t.startsWith(tok)) total += 100;
    else if (t.split(/[\s\-_/.]+/).some((w) => w.startsWith(tok))) total += 80;
    else if (t.includes(tok)) total += 60;
    else if (rest.some((r) => r.includes(tok))) total += 20;
    else return 0; // tous les mots doivent être trouvés
  }
  return total;
}

const snippet = (s: string, n = 90) => { const x = s.replace(/\s+/g, ' ').trim(); return x.length > n ? `${x.slice(0, n)}…` : x; };

/** Recherche locale (aucune donnée n'est envoyée ailleurs). Tous les mots saisis doivent correspondre. */
export function searchAll(doc: DinoDocument, query: string, limit = 30): SearchHit[] {
  const tokens = normalize(query).split(/\s+/).filter(Boolean);
  if (!tokens.length) return [];
  const catName = new Map(live(doc.categories).map((c) => [c.id, c.name]));
  const projName = new Map(live(doc.projects).map((p) => [p.id, p.name]));
  const hits: SearchHit[] = [];
  const push = (h: SearchHit) => { if (h.score > 0) hits.push(h); };

  for (const f of live(doc.favorites)) {
    push({ kind: 'favorite', id: f.id, title: f.title, url: f.url, subtitle: [hostOf(f.url), f.categoryId ? catName.get(f.categoryId) : null].filter(Boolean).join(' • '), score: scoreFields(tokens, f.title, [f.url, catName.get(f.categoryId ?? '') ?? '']) });
  }
  for (const c of live(doc.categories)) push({ kind: 'category', id: c.id, title: c.name, subtitle: 'Catégorie de favoris', score: scoreFields(tokens, c.name, []) });
  for (const p of live(doc.projects)) {
    push({ kind: 'project', id: p.id, title: p.name, subtitle: STATUS_LABEL[p.status], score: scoreFields(tokens, p.name, [p.description, ...p.links.map((l) => l.label)]) });
  }
  for (const n of live(doc.notes)) {
    push({ kind: 'note', id: n.id, title: n.title || snippet(n.content, 60), subtitle: n.title ? snippet(n.content) : projName.get(n.projectId ?? '') ?? '', score: scoreFields(tokens, n.title || n.content.slice(0, 60), [n.content]) });
  }
  for (const t of live(doc.tasks)) {
    const s = scoreFields(tokens, t.title, [t.description]);
    push({ kind: 'task', id: t.id, title: t.title, subtitle: t.done ? 'Terminée' : t.dueDate ? `À faire pour le ${t.dueDate}` : 'À faire', score: t.done && s ? Math.max(1, s - 10) : s });
  }
  return hits.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title)).slice(0, limit);
}
