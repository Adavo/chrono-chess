import { geometryReachable } from '../core/moves';
import type { Color, GameState, PieceState, PieceType, Square } from '../core/types';

/** Notation algébrique des coups (journal de partie), sans dépendance au DOM : testable telle quelle. */
const FILES = 'abcdefgh';
export const sqName = (s: Square) => FILES[s.file]! + (s.rank + 1);

/** Figurines (à la Lichess) : le pion n'en a pas. Pleines pour les noirs, creuses pour les blancs. */
const FIGURINE: Record<Color, Record<PieceType, string>> = {
  white: { K: '♔', Q: '♕', R: '♖', B: '♗', N: '♘', P: '' },
  black: { K: '♚', Q: '♛', R: '♜', B: '♝', N: '♞', P: '' },
};

/**
 * Coup en notation algébrique : ♘c3, ♖xd5, bxc4, c5=♘… Si une autre pièce identique pouvait aller sur la même
 * case, on précise la colonne d'origine (ou la rangée si elles partagent la colonne).
 */
export function notate(p: PieceState, to: Square, before: GameState, capture: boolean, promo?: PieceType): string {
  let origin = '';
  if (p.type === 'P') {
    if (capture) origin = FILES[p.pos.file]!;
  } else {
    const dir = p.color === 'white' ? 1 : -1;
    const rivals = before.pieces.filter((q) => q.id !== p.id && q.color === p.color && q.type === p.type && geometryReachable(q, to, before.size, dir));
    if (rivals.length) origin = rivals.some((q) => q.pos.file === p.pos.file) ? String(p.pos.rank + 1) : FILES[p.pos.file]!;
  }
  const fig = (t: PieceType) => (FIGURINE[p.color][t] ? `<span class="fig">${FIGURINE[p.color][t]}</span>` : '');
  return `${fig(p.type)}${origin}${capture ? 'x' : ''}${sqName(to)}${promo ? '=' + fig(promo) : ''}`;
}
