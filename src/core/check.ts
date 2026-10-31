import { sqKey } from './board';
import { checkMove, pathClear, pieceGeometry, type Snapshot } from './moves';
import type { Color, PieceState, Square } from './types';

/** Une pièce attaque-t-elle `target` (sur la position donnée) ? Les pions n'attaquent qu'en diagonale. */
function attacks(snap: Snapshot, p: PieceState, target: Square): boolean {
  const dx = target.file - p.pos.file;
  const dy = target.rank - p.pos.rank;
  if (p.type === 'P') return Math.abs(dx) === 1 && dy === (p.color === 'white' ? 1 : -1);
  const geo = pieceGeometry(p.type, dx, dy);
  return geo.ok && (!geo.slides || pathClear(snap, p.pos, target));
}

function snapshotOf(pieces: PieceState[], size: number): Snapshot {
  const board = new Map(pieces.map((p) => [sqKey(p.pos, size), p]));
  return { size, at: (s) => board.get(sqKey(s, size)) };
}

/** Le roi de `color` est-il attaqué sur cette position ? (Sans roi : jamais en échec.) */
export function isInCheck(pieces: PieceState[], size: number, color: Color): boolean {
  const king = pieces.find((p) => p.type === 'K' && p.color === color);
  if (!king) return false;
  const snap = snapshotOf(pieces, size);
  return pieces.some((p) => p.color !== color && attacks(snap, p, king.pos));
}

/**
 * Après ce déplacement (l'adversaire restant immobile, une éventuelle pièce ennemie sur
 * la case d'arrivée étant capturée), le roi du joueur est-il hors d'échec ?
 */
export function keepsKingSafe(pieces: PieceState[], size: number, mover: PieceState, to: Square): boolean {
  const after = pieces
    .filter((p) => !(p.color !== mover.color && p.pos.file === to.file && p.pos.rank === to.rank))
    .map((p) => (p.id === mover.id ? { ...p, pos: { ...to } } : p));
  return !isInCheck(after, size, mover.color);
}

/** Le joueur a-t-il au moins un coup légal (géométrie, trajectoire, pas de capture de roi, roi en sécurité) ? */
export function hasLegalMove(pieces: PieceState[], size: number, color: Color): boolean {
  const snap = snapshotOf(pieces, size);
  const dir = color === 'white' ? 1 : -1;
  const startRank = color === 'white' ? 1 : size - 2;
  for (const p of pieces) {
    if (p.color !== color) continue;
    for (let f = 0; f < size; f++) for (let r = 0; r < size; r++) {
      const to = { file: f, rank: r };
      const c = checkMove(snap, p, to, startRank, dir);
      if (!c.ok || snap.at(to)?.type === 'K') continue;
      if (keepsKingSafe(pieces, size, p, to)) return true;
    }
  }
  return false;
}

export interface Outcome {
  winner: Color | 'draw';
  reason: 'checkmate' | 'stalemate' | 'king-lost';
}

/**
 * Fin de partie classique, évaluée sur la position à la fin d'un sous-tour :
 * mat => le joueur maté perd (les deux maté => nulle) ; pat (aucun coup, pas en échec) => nulle.
 * Filet de sécurité : un roi absent (état personnalisé) fait perdre son camp.
 */
export function gameOutcome(pieces: PieceState[], size: number): Outcome | null {
  const colors: Color[] = ['white', 'black'];
  const hasKing = (c: Color) => pieces.some((p) => p.type === 'K' && p.color === c);
  if (!hasKing('white') || !hasKing('black')) {
    return { winner: hasKing('white') ? 'white' : hasKing('black') ? 'black' : 'draw', reason: 'king-lost' };
  }
  const stuck = colors.filter((c) => !hasLegalMove(pieces, size, c));
  const mated = stuck.filter((c) => isInCheck(pieces, size, c));
  if (mated.length === 2) return { winner: 'draw', reason: 'checkmate' };
  if (mated.length === 1) return { winner: mated[0] === 'white' ? 'black' : 'white', reason: 'checkmate' };
  if (stuck.length > 0) return { winner: 'draw', reason: 'stalemate' };
  return null;
}
