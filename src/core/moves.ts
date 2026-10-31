import { inBounds, sameSquare, sqKey } from './board';
import type { CancelReason, PieceState, Square } from './types';

/** Vue en lecture seule de la grille au DÉBUT d'un sous-tour. */
export interface Snapshot {
  size: number;
  at(s: Square): PieceState | undefined;
}

export type MoveCheck = { ok: true; capture: boolean } | { ok: false; reason: CancelReason };

const fail = (reason: CancelReason): MoveCheck => ({ ok: false, reason });

/** Les cases strictement entre `from` et `to` (ligne droite ou diagonale) doivent être vides. */
function pathClear(snap: Snapshot, from: Square, to: Square): boolean {
  const sx = Math.sign(to.file - from.file);
  const sy = Math.sign(to.rank - from.rank);
  let f = from.file + sx;
  let r = from.rank + sy;
  while (f !== to.file || r !== to.rank) {
    if (snap.at({ file: f, rank: r })) return false;
    f += sx;
    r += sy;
  }
  return true;
}

/**
 * Vérifie un déplacement depuis la position ACTUELLE de la pièce, sur l'instantané
 * du début de sous-tour. Aucune "réparation" : si c'est invalide, on renvoie la raison.
 */
export function checkMove(snap: Snapshot, piece: PieceState, to: Square, startRank: number, dir: 1 | -1): MoveCheck {
  const from = piece.pos;
  if (!inBounds(to, snap.size)) return fail('out-of-bounds');
  if (sameSquare(from, to)) return fail('no-move');

  const dx = to.file - from.file;
  const dy = to.rank - from.rank;
  const adx = Math.abs(dx);
  const ady = Math.abs(dy);
  const occupant = snap.at(to);

  if (piece.type === 'P') {
    if (dx === 0 && dy === dir) return occupant ? fail('blocked-forward') : { ok: true, capture: false };
    if (dx === 0 && dy === 2 * dir && from.rank === startRank && !piece.hasMoved) {
      const mid = { file: from.file, rank: from.rank + dir };
      return snap.at(mid) || occupant ? fail('blocked-forward') : { ok: true, capture: false };
    }
    if (adx === 1 && dy === dir) {
      if (!occupant) return fail('no-capture-target');
      return occupant.color === piece.color ? fail('friendly-occupied') : { ok: true, capture: true };
    }
    return fail('illegal-geometry');
  }

  let geometryOk: boolean;
  let slides = false;
  switch (piece.type) {
    case 'N': geometryOk = (adx === 1 && ady === 2) || (adx === 2 && ady === 1); break;
    case 'K': geometryOk = Math.max(adx, ady) === 1; break;
    case 'B': geometryOk = adx === ady; slides = true; break;
    case 'R': geometryOk = dx === 0 || dy === 0; slides = true; break;
    case 'Q': geometryOk = adx === ady || dx === 0 || dy === 0; slides = true; break;
  }
  if (!geometryOk) return fail('illegal-geometry');
  if (slides && !pathClear(snap, from, to)) return fail('path-blocked');
  if (occupant?.color === piece.color) return fail('friendly-occupied');
  return { ok: true, capture: !!occupant };
}

export { sqKey };
