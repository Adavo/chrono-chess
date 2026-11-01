import { inBounds, sameSquare } from './board';
import { forEachLegalMove, hasLegalMove, insufficientMaterial, isInCheck, type Outcome } from './check';
import { resolveSubTurn } from './resolution';
import { PROMOTIONS, type Color, type GameEvent, type GameState, type PieceState, type PlannedAction } from './types';

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

/** Tous les coups légaux de `color` : trajectoire libre, pas de capture de roi, roi jamais laissé en échec. */
export function legalMoves(pieces: readonly PieceState[], size: number, color: Color): ClassicMove[] {
  const out: ClassicMove[] = [];
  forEachLegalMove(pieces, size, color, (p, to) => void out.push({ pieceId: p.id, to }));
  return out;
}

/** Verdict après le coup de l'adversaire de `toMove` : mat, pat ou deux rois seuls. `null` = la partie continue. */
export function classicOutcome(pieces: readonly PieceState[], size: number, toMove: Color): Outcome | null {
  if (insufficientMaterial(pieces)) return { winner: 'draw', reason: 'insufficient' };
  if (hasLegalMove(pieces, size, toMove)) return null;
  return isInCheck(pieces, size, toMove)
    ? { winner: opp(toMove), reason: 'checkmate' }
    : { winner: 'draw', reason: 'stalemate' };
}

/** Clé d'une position (pièces, cases, camp au trait) : sert à détecter la répétition. */
export function positionKey(s: GameState): string {
  return `${turnOf(s)}|${s.pieces.map((p) => `${p.color[0]}${p.type}${p.pos.file}${p.pos.rank}`).sort().join(' ')}`;
}

/** Nombre de fois qu'une même position (avec le même camp au trait) entraîne la nulle. */
export const REPETITIONS_FOR_DRAW = 3;

/** Machine à états d'une partie classique. Autoritaire (IA, hôte) ; le chrono appartient à l'interface. */
export class ClassicGame {
  /** Combien de fois chaque position a été atteinte (la position de départ compte pour une). */
  private seen = new Map<string, number>();

  constructor(public state: GameState) { this.seen.set(positionKey(state), 1); }

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
    let outcome = classicOutcome(next.pieces, next.size, opp(color));
    if (!outcome) {
      const key = positionKey(next);
      const n = (this.seen.get(key) ?? 0) + 1;
      this.seen.set(key, n);
      if (n >= REPETITIONS_FOR_DRAW) outcome = { winner: 'draw', reason: 'repetition' };
    }
    if (outcome) {
      next.winner = outcome.winner;
      events.push({ kind: 'game-over', subTurn: 0, winner: outcome.winner, reason: outcome.reason });
    }
    this.state = next;
    return events;
  }
}
