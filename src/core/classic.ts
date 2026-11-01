import { inBounds, sameSquare } from './board';
import { hasLegalMove, isInCheck, keepsKingSafe, snapshotOf, type Outcome } from './check';
import { checkMove } from './moves';
import { resolveSubTurn } from './resolution';
import { PROMOTIONS, type Color, type GameEvent, type GameState, type PieceState, type PlannedAction, type Square } from './types';

/**
 * ============================ MODE CLASSIQUE (coup par coup) ============================
 * Échecs standard sur le plateau 5x5 : les blancs commencent, on joue chacun son tour, un coup à la fois.
 * Règles classiques : trajectoires bloquées, capture par le mouvant, aucun coup qui met ou laisse son roi
 * en échec, mat et pat jugés immédiatement. Pas de double pas, de roque ni de prise en passant ; la promotion
 * est tirée au sort (cavalier, fou ou tour), comme dans les autres modes.
 * `state.sequence` compte les demi-coups : le trait est aux blancs quand il est pair.
 */
export type ClassicMove = PlannedAction;

const opp = (c: Color): Color => (c === 'white' ? 'black' : 'white');

/** À qui de jouer, déduit du nombre de coups déjà joués. */
export const turnOf = (s: GameState): Color => (s.sequence % 2 === 0 ? 'white' : 'black');

const KNIGHT_STEPS = [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]] as const;
const KING_STEPS = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]] as const;
const ORTHOGONAL = [[1, 0], [0, 1], [-1, 0], [0, -1]] as const;
const DIAGONAL = [[1, 1], [-1, 1], [-1, -1], [1, -1]] as const;

/** Cases que la géométrie de la pièce permet d'atteindre (sans regarder les autres pièces). */
export function targetsOf(p: PieceState, size: number): Square[] {
  const out: Square[] = [];
  const add = (file: number, rank: number) => { if (inBounds({ file, rank }, size)) out.push({ file, rank }); };
  const { file, rank } = p.pos;
  const ray = (dirs: ReadonlyArray<readonly [number, number]>) => {
    for (const [df, dr] of dirs) for (let k = 1; k < size; k++) add(file + df * k, rank + dr * k);
  };
  switch (p.type) {
    case 'P': { const d = p.color === 'white' ? 1 : -1; add(file, rank + d); add(file - 1, rank + d); add(file + 1, rank + d); break; }
    case 'N': for (const [df, dr] of KNIGHT_STEPS) add(file + df, rank + dr); break;
    case 'K': for (const [df, dr] of KING_STEPS) add(file + df, rank + dr); break;
    case 'B': ray(DIAGONAL); break;
    case 'R': ray(ORTHOGONAL); break;
    case 'Q': ray(DIAGONAL); ray(ORTHOGONAL); break;
  }
  return out;
}

/** Tous les coups légaux de `color` : trajectoire libre, pas de capture de roi, roi jamais laissé en échec. */
export function legalMoves(pieces: PieceState[], size: number, color: Color): ClassicMove[] {
  const snap = snapshotOf(pieces, size);
  const dir = color === 'white' ? 1 : -1;
  const out: ClassicMove[] = [];
  for (const p of pieces) {
    if (p.color !== color) continue;
    for (const to of targetsOf(p, size)) {
      if (!checkMove(snap, p, to, dir).ok || snap.at(to)?.type === 'K') continue;
      if (keepsKingSafe(pieces, size, p, to)) out.push({ pieceId: p.id, to });
    }
  }
  return out;
}

/** Verdict après le coup de l'adversaire de `toMove` : mat, pat ou deux rois seuls. `null` = la partie continue. */
export function classicOutcome(pieces: PieceState[], size: number, toMove: Color): Outcome | null {
  if (pieces.every((p) => p.type === 'K')) return { winner: 'draw', reason: 'insufficient' };
  if (hasLegalMove(pieces, size, toMove)) return null;
  return isInCheck(pieces, size, toMove)
    ? { winner: opp(toMove), reason: 'checkmate' }
    : { winner: 'draw', reason: 'stalemate' };
}

/** Machine à états d'une partie classique. Autoritaire (IA, hôte) ; le chrono appartient à l'interface. */
export class ClassicGame {
  constructor(public state: GameState) {}

  get turn(): Color { return turnOf(this.state); }

  /** Un coup au hasard parmi les coups légaux (fin du chrono). */
  randomMove(color: Color, rnd = Math.random): ClassicMove | null {
    const moves = legalMoves(this.state.pieces, this.state.size, color);
    return moves.length ? moves[Math.floor(rnd() * moves.length)]! : null;
  }

  /** Joue un coup. Renvoie les événements à animer, ou `null` si ce n'est pas son tour ou si le coup est illégal. */
  play(color: Color, raw: unknown, rnd = Math.random): GameEvent[] | null {
    const s = this.state;
    if (s.winner || color !== this.turn) return null;
    const m = raw as Partial<ClassicMove> | null;
    if (!m || typeof m.pieceId !== 'string' || !m.to || !inBounds(m.to, s.size)) return null;
    const legal = legalMoves(s.pieces, s.size, color).find((l) => l.pieceId === m.pieceId && sameSquare(l.to, m.to!));
    if (!legal) return null;
    const promo = PROMOTIONS.find((p) => p === m.promo);
    const res = resolveSubTurn(s, 0, [{ pieceId: legal.pieceId, to: legal.to, ...(promo ? { promo } : {}), subTurn: 0, owner: color, order: 0 }], rnd, new Set([color]));
    const events = res.events;
    const next: GameState = { ...res.state, sequence: s.sequence + 1 };
    const outcome = classicOutcome(next.pieces, next.size, opp(color));
    if (outcome) {
      next.winner = outcome.winner;
      events.push({ kind: 'game-over', subTurn: 0, winner: outcome.winner, reason: outcome.reason });
    }
    this.state = next;
    return events;
  }
}
