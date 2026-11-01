import { sqKey } from './board';
import { pieceGeometry, pathClear, type Snapshot } from './moves';
import type { Color, PieceState, Square } from './types';

const dirOf = (c: Color): 1 | -1 => (c === 'white' ? 1 : -1);
const opp = (c: Color): Color => (c === 'white' ? 'black' : 'white');

/** Plateau indexé par case (sqKey) : accès direct, sans recherche dans la liste des pièces. */
export type Grid = (PieceState | undefined)[];

export function gridOf(pieces: readonly PieceState[], size: number): Grid {
  const grid: Grid = new Array(size * size);
  for (const p of pieces) grid[sqKey(p.pos, size)] = p;
  return grid;
}

/** Une pièce attaque-t-elle `target` (sur la position donnée) ? Les pions n'attaquent qu'en diagonale. */
export function attacksSquare(snap: Snapshot, p: PieceState, target: Square): boolean {
  const dx = target.file - p.pos.file;
  const dy = target.rank - p.pos.rank;
  if (p.type === 'P') return Math.abs(dx) === 1 && dy === dirOf(p.color);
  const geo = pieceGeometry(p.type, dx, dy);
  return geo.ok && (!geo.slides || pathClear(snap, p.pos, target));
}

export function snapshotOf(pieces: readonly PieceState[], size: number): Snapshot {
  const grid = gridOf(pieces, size);
  return { size, at: (s) => grid[sqKey(s, size)] };
}

const KNIGHT = [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]] as const;
const KING = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]] as const;
const ORTHOGONAL = [[1, 0], [0, 1], [-1, 0], [0, -1]] as const;
const DIAGONAL = [[1, 1], [-1, 1], [-1, -1], [1, -1]] as const;

/**
 * La case (file, rank) est-elle attaquée par une pièce de `by` ? On part de la case et on regarde
 * dans chaque direction (sauts du cavalier et du roi, rayons, diagonales des pions) : bien plus rapide
 * que de tester chaque pièce adverse. Même sémantique que `attacksSquare`.
 */
export function squareAttacked(grid: Grid, size: number, file: number, rank: number, by: Color): boolean {
  const at = (f: number, r: number) => (f >= 0 && f < size && r >= 0 && r < size ? grid[r * size + f] : undefined);
  const is = (q: PieceState | undefined, ...types: string[]) => !!q && q.color === by && types.includes(q.type);
  // Un pion de `by` attaque en diagonale vers l'avant : il se trouve donc une rangée « derrière » la case.
  const pr = rank - dirOf(by);
  if (is(at(file - 1, pr), 'P') || is(at(file + 1, pr), 'P')) return true;
  for (const [df, dr] of KNIGHT) if (is(at(file + df, rank + dr), 'N')) return true;
  for (const [df, dr] of KING) if (is(at(file + df, rank + dr), 'K')) return true;
  const ray = (dirs: ReadonlyArray<readonly [number, number]>, types: string[]) => {
    for (const [df, dr] of dirs) {
      for (let f = file + df, r = rank + dr; f >= 0 && f < size && r >= 0 && r < size; f += df, r += dr) {
        const q = grid[r * size + f];
        if (q) { if (is(q, ...types)) return true; break; }
      }
    }
    return false;
  };
  return ray(ORTHOGONAL, ['R', 'Q']) || ray(DIAGONAL, ['B', 'Q']);
}

/** Le roi de `color` est-il attaqué sur cette position ? (Sans roi : jamais en échec.) */
export function isInCheck(pieces: readonly PieceState[], size: number, color: Color): boolean {
  const king = pieces.find((p) => p.type === 'K' && p.color === color);
  return !!king && squareAttacked(gridOf(pieces, size), size, king.pos.file, king.pos.rank, opp(color));
}

/**
 * Joue le coup sur la grille (en place), teste si le roi du joueur reste hors d'échec, puis défait le coup.
 * L'adversaire reste immobile ; une éventuelle pièce ennemie sur la case d'arrivée est capturée.
 */
function safeOnGrid(grid: Grid, size: number, mover: PieceState, to: Square, king: Square | undefined): boolean {
  if (!king) return true;
  const from = sqKey(mover.pos, size);
  const dest = sqKey(to, size);
  const taken = grid[dest];
  grid[from] = undefined;
  grid[dest] = mover;
  const k = mover.type === 'K' ? to : king;
  const safe = !squareAttacked(grid, size, k.file, k.rank, opp(mover.color));
  grid[dest] = taken;
  grid[from] = mover;
  return safe;
}

/**
 * Après ce déplacement (l'adversaire restant immobile, une éventuelle pièce ennemie sur
 * la case d'arrivée étant capturée), le roi du joueur est-il hors d'échec ?
 */
export function keepsKingSafe(pieces: readonly PieceState[], size: number, mover: PieceState, to: Square): boolean {
  const king = pieces.find((p) => p.type === 'K' && p.color === mover.color);
  return safeOnGrid(gridOf(pieces, size), size, mover, to, king?.pos);
}

/**
 * Coups légaux de `color` : trajectoire libre, pas de capture de roi, roi jamais laissé en échec.
 * `onMove` est appelé pour chaque coup ; s'il renvoie `true`, la recherche s'arrête (test d'existence).
 * Les cases sont générées directement (rayons stoppés au premier obstacle), sans passer par `checkMove`.
 */
export function forEachLegalMove(pieces: readonly PieceState[], size: number, color: Color, onMove: (p: PieceState, to: Square) => boolean | void): void {
  const grid = gridOf(pieces, size);
  const king = pieces.find((p) => p.type === 'K' && p.color === color)?.pos;
  const inside = (f: number, r: number) => f >= 0 && f < size && r >= 0 && r < size;
  for (const p of pieces) {
    if (p.color !== color) continue;
    const { file, rank } = p.pos;
    /** Case d'arrivée : vide (si permis) ou ennemie hors roi (si permis). Renvoie true pour arrêter. */
    const tryTo = (f: number, r: number, quiet: boolean, capture: boolean): boolean => {
      const q = grid[r * size + f];
      if (q ? !capture || q.color === color || q.type === 'K' : !quiet) return false;
      const to = { file: f, rank: r };
      return safeOnGrid(grid, size, p, to, king) && onMove(p, to) === true;
    };
    const jumps = (steps: ReadonlyArray<readonly [number, number]>) => {
      for (const [df, dr] of steps) if (inside(file + df, rank + dr) && tryTo(file + df, rank + dr, true, true)) return true;
      return false;
    };
    const rays = (dirs: ReadonlyArray<readonly [number, number]>) => {
      for (const [df, dr] of dirs) {
        for (let f = file + df, r = rank + dr; inside(f, r); f += df, r += dr) {
          if (tryTo(f, r, true, true)) return true;
          if (grid[r * size + f]) break;
        }
      }
      return false;
    };
    let stop = false;
    switch (p.type) {
      case 'P': {
        const r = rank + dirOf(color);
        if (!inside(file, r)) break;
        stop = tryTo(file, r, true, false)
          || (inside(file - 1, r) && tryTo(file - 1, r, false, true))
          || (inside(file + 1, r) && tryTo(file + 1, r, false, true));
        break;
      }
      case 'N': stop = jumps(KNIGHT); break;
      case 'K': stop = jumps(KING); break;
      case 'B': stop = rays(DIAGONAL); break;
      case 'R': stop = rays(ORTHOGONAL); break;
      case 'Q': stop = rays(ORTHOGONAL) || rays(DIAGONAL); break;
    }
    if (stop) return;
  }
}

/** Le joueur a-t-il au moins un coup légal (géométrie, trajectoire, pas de capture de roi, roi en sécurité) ? */
export function hasLegalMove(pieces: readonly PieceState[], size: number, color: Color): boolean {
  let found = false;
  forEachLegalMove(pieces, size, color, () => (found = true));
  return found;
}

export interface Outcome {
  winner: Color | 'draw';
  reason: 'checkmate' | 'stalemate' | 'king-lost' | 'insufficient' | 'repetition';
}

/**
 * Matériel insuffisant : les deux rois seuls, ou un seul cavalier / fou en plus (aucun mat possible, même avec
 * un adversaire coopératif). Sur 5x5, dès qu'il y a deux pièces en plus (même mineures) un mat redevient possible
 * (le roi se bloque avec ses propres pièces), et un pion peut toujours se promouvoir en tour.
 */
export function insufficientMaterial(pieces: readonly PieceState[]): boolean {
  const others = pieces.filter((p) => p.type !== 'K');
  return others.length === 0 || (others.length === 1 && (others[0]!.type === 'N' || others[0]!.type === 'B'));
}

/**
 * Fin de partie classique, évaluée UNIQUEMENT sur la position finale d'une manche (après les 5 coups) :
 * mat => le joueur maté perd (les deux maté => nulle) ; pat (aucun coup, pas en échec) => nulle.
 * Deux rois seuls : nulle. Filet de sécurité : un roi absent (état personnalisé) fait perdre son camp.
 */
export function gameOutcome(pieces: readonly PieceState[], size: number): Outcome | null {
  const colors: Color[] = ['white', 'black'];
  const hasKing = (c: Color) => pieces.some((p) => p.type === 'K' && p.color === c);
  if (!hasKing('white') || !hasKing('black')) {
    return { winner: hasKing('white') ? 'white' : hasKing('black') ? 'black' : 'draw', reason: 'king-lost' };
  }
  // Matériel insuffisant : personne ne peut plus gagner.
  if (insufficientMaterial(pieces)) return { winner: 'draw', reason: 'insufficient' };
  const stuck = colors.filter((c) => !hasLegalMove(pieces, size, c));
  const mated = stuck.filter((c) => isInCheck(pieces, size, c));
  if (mated.length === 2) return { winner: 'draw', reason: 'checkmate' };
  if (mated.length === 1) return { winner: opp(mated[0]!), reason: 'checkmate' };
  if (stuck.length > 0) return { winner: 'draw', reason: 'stalemate' };
  return null;
}
