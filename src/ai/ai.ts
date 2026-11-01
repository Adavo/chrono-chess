import { attacksSquare, gameOutcome, isInCheck, keepsKingSafe, snapshotOf } from '../core/check';
import { checkMove } from '../core/moves';
import { resolveSubTurn } from '../core/resolution';
import { DEFAULT_RULES, type Color, type GameState, type Plan, type RulesConfig, type Square } from '../core/types';

const VALUE = { P: 1, B: 2, N: 3, R: 5, Q: 9, K: 0 } as const;

/**
 * IA : enchaîne `subTurns` coups en jouant son plan sur une copie du plateau où l'adversaire
 * reste immobile (comme le fait le moteur pour juger l'échec). Elle préfère les captures gagnantes,
 * la promotion, l'échec et le mat, évite d'offrir ses pièces.
 * L'adversaire bouge pourtant : certains de ses coups deviendront caducs, comme ceux d'un humain.
 */
export function aiPlan(state: GameState, color: Color, rules: RulesConfig = DEFAULT_RULES, rnd = Math.random): Plan {
  const dir = color === 'white' ? 1 : -1;
  const enemy: Color = color === 'white' ? 'black' : 'white';
  const plan: Plan = [];
  let working = state;
  let obliged = isInCheck(state.pieces, state.size, color); // doit d'abord sortir d'échec

  for (let t = 0; t < rules.subTurns; t++) {
    obliged = obliged && isInCheck(working.pieces, working.size, color);
    const escape: ReadonlySet<Color> = new Set(obliged ? [color] : []);
    const snap = snapshotOf(working.pieces, working.size);
    let best: { pieceId: string; to: Square; score: number } | null = null;

    for (const p of working.pieces) {
      if (p.color !== color) continue;
      for (let f = 0; f < working.size; f++) for (let r = 0; r < working.size; r++) {
        const to = { file: f, rank: r };
        const c = checkMove(snap, p, to, dir);
        if (!c.ok || snap.at(to)?.type === 'K' || (obliged && !keepsKingSafe(working.pieces, working.size, p, to))) continue;
        const victim = snap.at(to);
        let score = rnd() * 1.5;
        if (victim) score += VALUE[victim.type] * 2 + 1;
        if (p.type === 'P') score += 0.4 + (color === 'white' ? r : working.size - 1 - r) * 0.5;
        if (p.type === 'P' && r === (color === 'white' ? working.size - 1 : 0)) score += 6; // promotion
        const attacked = working.pieces.some((q) => q.color === enemy && q.id !== victim?.id && attacksSquare(snap, q, to));
        if (attacked && p.type !== 'K') score -= VALUE[p.type] * 1.2;
        const after = resolveSubTurn(working, t, [{ pieceId: p.id, to, subTurn: t, owner: color, order: 0 }], () => 0, escape).state;
        if (isInCheck(after.pieces, after.size, color)) score -= t === rules.subTurns - 1 ? 50 : 4; // finir en échec est dangereux
        if (isInCheck(after.pieces, after.size, enemy)) {
          score += 2;
          if (gameOutcome(after.pieces, after.size)?.winner === color) score += 60;
        }
        if (!best || score > best.score) best = { pieceId: p.id, to, score };
      }
    }
    if (!best) { plan.push([]); continue; }
    plan.push([{ pieceId: best.pieceId, to: best.to }]);
    working = resolveSubTurn(working, t, [{ pieceId: best.pieceId, to: best.to, subTurn: t, owner: color, order: 0 }], () => 0, escape).state;
  }
  return plan;
}
