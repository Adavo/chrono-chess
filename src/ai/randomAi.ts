import { checkMove } from '../core/moves';
import { sqKey } from '../core/board';
import { DEFAULT_RULES, type Color, type GameState, type PieceState, type Plan, type RulesConfig } from '../core/types';

/**
 * IA simple : à chaque sous-tour, choisit un coup légal depuis la position de DÉPART
 * de la Séquence (elle ne prédit pas l'avenir), en préférant les captures.
 * Ses plans deviennent donc parfois caducs — comme ceux d'un humain.
 */
export function randomPlan(state: GameState, color: Color, rules: RulesConfig = DEFAULT_RULES, rnd = Math.random): Plan {
  const byId = new Map(state.pieces.map((p) => [p.id, p]));
  const snap = { size: state.size, at: (s: { file: number; rank: number }) => { const id = state.grid[sqKey(s, state.size)]; return id ? byId.get(id) : undefined; } };
  const dir = color === 'white' ? 1 : -1;
  const startRank = color === 'white' ? 1 : state.size - 2;
  const mine = state.pieces.filter((p) => p.color === color);
  const used = new Set<string>();

  const options = (p: PieceState) => {
    const out: { to: { file: number; rank: number }; capture: boolean }[] = [];
    for (let f = 0; f < state.size; f++) for (let r = 0; r < state.size; r++) {
      const c = checkMove(snap, p, { file: f, rank: r }, startRank, dir);
      if (c.ok) out.push({ to: { file: f, rank: r }, capture: c.capture });
    }
    return out;
  };

  return Array.from({ length: rules.subTurns }, () => {
    const candidates = mine
      .filter((p) => !used.has(p.id))
      .flatMap((p) => options(p).map((o) => ({ p, ...o })));
    if (!candidates.length) return [];
    const captures = candidates.filter((c) => c.capture);
    const pool = captures.length && rnd() < 0.7 ? captures : candidates;
    const pick = pool[Math.floor(rnd() * pool.length)]!;
    used.add(pick.p.id);
    return [{ pieceId: pick.p.id, to: pick.to }];
  });
}
