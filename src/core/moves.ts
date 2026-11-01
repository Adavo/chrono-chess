import { inBounds, sameSquare } from './board';
import type { CancelReason, PieceState, PieceType, Square } from './types';

/** Vue en lecture seule de la grille au DÉBUT d'un sous-tour. */
export interface Snapshot {
  size: number;
  at(s: Square): PieceState | undefined;
}

export type MoveCheck = { ok: true; capture: boolean } | { ok: false; reason: CancelReason };

const fail = (reason: CancelReason): MoveCheck => ({ ok: false, reason });

/** Les cases strictement entre `from` et `to` (ligne droite ou diagonale) doivent être vides. */
export function pathClear(snap: Snapshot, from: Square, to: Square): boolean {
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

/** Géométrie pure d'une pièce non-pion (sans tenir compte des autres pièces). */
export function pieceGeometry(type: Exclude<PieceType, 'P'>, dx: number, dy: number): { ok: boolean; slides: boolean } {
  const adx = Math.abs(dx);
  const ady = Math.abs(dy);
  if (adx === 0 && ady === 0) return { ok: false, slides: false };
  switch (type) {
    case 'N': return { ok: (adx === 1 && ady === 2) || (adx === 2 && ady === 1), slides: false };
    case 'K': return { ok: Math.max(adx, ady) === 1, slides: false };
    case 'B': return { ok: adx === ady, slides: true };
    case 'R': return { ok: dx === 0 || dy === 0, slides: true };
    case 'Q': return { ok: adx === ady || dx === 0 || dy === 0, slides: true };
  }
}

/**
 * La destination est-elle atteignable "en principe" par cette pièce, indépendamment de ce qui
 * occupe le plateau ? Sert à l'interface : on peut programmer un coup actuellement bloqué,
 * qui deviendra peut-être possible quand le moment venu.
 */
export function geometryReachable(piece: PieceState, to: Square, size: number, dir: 1 | -1): boolean {
  if (!inBounds(to, size) || sameSquare(piece.pos, to)) return false;
  const dx = to.file - piece.pos.file;
  const dy = to.rank - piece.pos.rank;
  if (piece.type === 'P') return (dx === 0 && dy === dir) || (Math.abs(dx) === 1 && dy === dir);
  return pieceGeometry(piece.type, dx, dy).ok;
}

/**
 * Vérifie un déplacement depuis la position ACTUELLE de la pièce, sur l'instantané
 * du début de sous-tour. Aucune "réparation" : si c'est invalide, on renvoie la raison.
 * Collisions classiques : une pièce immobile (alliée ou ennemie) bloque les trajectoires.
 * (Règle d'échec : voir check.ts.)
 */
export function checkMove(snap: Snapshot, piece: PieceState, to: Square, dir: 1 | -1): MoveCheck {
  const from = piece.pos;
  if (!inBounds(to, snap.size)) return fail('out-of-bounds');
  if (sameSquare(from, to)) return fail('no-move');

  const dx = to.file - from.file;
  const dy = to.rank - from.rank;
  const occupant = snap.at(to);

  if (piece.type === 'P') {
    if (dx === 0 && dy === dir) return occupant ? fail('blocked-forward') : { ok: true, capture: false };
    if (Math.abs(dx) === 1 && dy === dir) {
      if (!occupant) return fail('no-capture-target');
      return occupant.color === piece.color ? fail('friendly-occupied') : { ok: true, capture: true };
    }
    return fail('illegal-geometry');
  }

  const geo = pieceGeometry(piece.type, dx, dy);
  if (!geo.ok) return fail('illegal-geometry');
  if (geo.slides && !pathClear(snap, from, to)) return fail('path-blocked');
  if (occupant?.color === piece.color) return fail('friendly-occupied');
  return { ok: true, capture: !!occupant };
}
