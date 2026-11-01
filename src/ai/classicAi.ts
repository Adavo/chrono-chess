import { isInCheck } from '../core/check';
import { legalMoves, type ClassicMove } from '../core/classic';
import type { Color, GameState, PieceState, PieceType } from '../core/types';
import type { Level } from './ai';

/** IA du mode classique (coup par coup) : recherche alpha-bêta sur une valeur de matériel. */
const WORTH: Record<PieceType, number> = { P: 100, B: 250, N: 300, R: 500, Q: 900, K: 0 };
const MATE = 100000;
const MASTER_BUDGET_MS = 1200;
const MASTER_MAX_DEPTH = 12;
const opp = (c: Color): Color => (c === 'white' ? 'black' : 'white');

/** Position après le coup (sans cloner l'état) ; la promotion est supposée en cavalier pendant la recherche. */
function apply(pieces: PieceState[], m: ClassicMove, size: number): PieceState[] {
  const out: PieceState[] = [];
  for (const p of pieces) {
    if (p.id === m.pieceId) {
      const promoted = p.type === 'P' && m.to.rank === (p.color === 'white' ? size - 1 : 0);
      out.push({ ...p, pos: { file: m.to.file, rank: m.to.rank }, type: promoted ? 'N' : p.type });
    } else if (!(p.pos.file === m.to.file && p.pos.rank === m.to.rank)) out.push(p);
  }
  return out;
}

/** Valeur de la position du point de vue de `color` : matériel, avancée des pions, échecs. */
function evaluate(pieces: PieceState[], color: Color, size: number): number {
  let score = 0;
  for (const p of pieces) {
    const sign = p.color === color ? 1 : -1;
    score += sign * WORTH[p.type];
    if (p.type === 'P') score += sign * 8 * (p.color === 'white' ? p.pos.rank : size - 1 - p.pos.rank);
  }
  if (isInCheck(pieces, size, opp(color))) score += 15;
  if (isInCheck(pieces, size, color)) score -= 15;
  return score;
}

class OutOfTime extends Error {}

/** Captures d'abord (la plus grosse prise en tête) : les coupures alpha-bêta arrivent beaucoup plus vite. */
function ordered(pieces: PieceState[], moves: ClassicMove[], size: number): ClassicMove[] {
  const worth = new Map<number, number>(pieces.map((p) => [p.pos.rank * size + p.pos.file, WORTH[p.type]]));
  const gain = (m: ClassicMove) => worth.get(m.to.rank * size + m.to.file) ?? 0;
  return moves.sort((a, b) => gain(b) - gain(a));
}

function negamax(pieces: PieceState[], toMove: Color, depth: number, alpha: number, beta: number, ply: number, size: number, stop: number): number {
  if (Date.now() > stop) throw new OutOfTime();
  const moves = legalMoves(pieces, size, toMove);
  if (!moves.length) return isInCheck(pieces, size, toMove) ? -MATE + ply : 0;
  if (depth === 0) return evaluate(pieces, toMove, size);
  let best = -Infinity;
  for (const m of ordered(pieces, moves, size)) {
    best = Math.max(best, -negamax(apply(pieces, m, size), opp(toMove), depth - 1, -beta, -alpha, ply + 1, size, stop));
    alpha = Math.max(alpha, best);
    if (alpha >= beta) break;
  }
  return best;
}

/** Score exact de chaque coup racine (fenêtre pleine) : utile quand on veut choisir avec du hasard. */
function scoreRoot(pieces: PieceState[], color: Color, moves: ClassicMove[], depth: number, size: number, stop: number): number[] {
  return moves.map((m) => -negamax(apply(pieces, m, size), opp(color), depth - 1, -Infinity, Infinity, 1, size, stop));
}

/**
 * Meilleur coup racine avec alpha-bêta dès la racine (seul le meilleur score est exact).
 * Les coups sont essayés dans l'ordre donné : le meilleur de l'itération précédente en premier.
 */
function bestRoot(pieces: PieceState[], color: Color, moves: ClassicMove[], depth: number, size: number, stop: number): { move: ClassicMove; score: number } {
  let alpha = -Infinity;
  let move = moves[0]!;
  for (const m of moves) {
    const v = -negamax(apply(pieces, m, size), opp(color), depth - 1, -Infinity, -alpha, 1, size, stop);
    if (v > alpha) { alpha = v; move = m; }
  }
  return { move, score: alpha };
}

/** Coup de l'IA pour `color`, selon le niveau (`null` si aucun coup légal). */
export function classicAiMove(state: GameState, color: Color, level: Level, rnd = Math.random): ClassicMove | null {
  const { pieces, size } = state;
  const moves = legalMoves(pieces, size, color);
  if (!moves.length) return null;
  const pick = (scores: number[], noise: number) => {
    let bi = 0, bs = -Infinity;
    scores.forEach((s, i) => { const v = s + rnd() * noise; if (v > bs) { bs = v; bi = i; } });
    return moves[bi]!;
  };
  const far = Date.now() + 60000;
  // Facile : coup au hasard.
  if (level === 'easy') return moves[Math.floor(rnd() * moves.length)]!;
  // Moyen : regarde son coup seulement (prend ce qui est à prendre, ne voit pas les reprises).
  if (level === 'medium') return pick(scoreRoot(pieces, color, moves, 1, size, far), 90);
  // Difficile : voit la réponse adverse (ne laisse plus ses pièces à la prise), un peu de hasard.
  if (level === 'hard') return pick(scoreRoot(pieces, color, moves, 2, size, far), 25);
  // Grand Maître : approfondissement itératif dans la limite de ~1,2 s ; mat vu dès qu'il est dans l'horizon.
  const stop = Date.now() + MASTER_BUDGET_MS;
  let order = ordered(pieces, moves, size);
  let best = bestRoot(pieces, color, order, 2, size, far);
  for (let depth = 3; depth <= MASTER_MAX_DEPTH && best.score < MATE / 2; depth++) {
    order = [best.move, ...order.filter((m) => m !== best.move)];
    try {
      best = bestRoot(pieces, color, order, depth, size, stop);
    } catch (e) {
      if (e instanceof OutOfTime) break; // on garde le résultat de la dernière profondeur terminée
      throw e;
    }
  }
  return best.move;
}
