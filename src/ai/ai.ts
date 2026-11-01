import { attacksSquare, gameOutcome, isInCheck, keepsKingSafe, snapshotOf } from '../core/check';
import { checkMove } from '../core/moves';
import { resolvePlans, resolveSubTurn } from '../core/resolution';
import { DEFAULT_RULES, PROMOTIONS, type Color, type GameState, type PieceType, type Plan, type RulesConfig, type Square } from '../core/types';

export type Level = 'easy' | 'medium' | 'hard' | 'master';
export const LEVELS: Level[] = ['easy', 'medium', 'hard', 'master'];

const VALUE = { P: 1, B: 2, N: 3, R: 5, Q: 9, K: 0 } as const;

/** Réglages de l'IA « gloutonne » : poids des critères et part de hasard. */
interface Style { noise: number; capture: number; danger: number; check: number; selfCheck: number }
const STYLES = {
  // Joue presque au hasard, ne voit ni les menaces ni les échecs.
  easy: { noise: 7, capture: 0.4, danger: 0, check: 0, selfCheck: 0 },
  // Capture, protège ses pièces, cherche l'échec.
  medium: { noise: 1.5, capture: 1, danger: 1, check: 1, selfCheck: 1 },
  // Base des plans candidats de la recherche (niveaux difficile et Grand Maître).
  hard: { noise: 0.5, capture: 1, danger: 1.3, check: 1.3, selfCheck: 1.5 },
} satisfies Record<'easy' | 'medium' | 'hard', Style>;

/**
 * Plan glouton : enchaîne `subTurns` coups en jouant son plan sur une copie du plateau où l'adversaire
 * reste immobile (comme le fait le moteur pour juger l'échec). L'adversaire bouge pourtant : certains
 * coups deviendront caducs, comme ceux d'un humain.
 */
function greedyPlan(state: GameState, color: Color, rules: RulesConfig, rnd: () => number, style: Style): Plan {
  const dir = color === 'white' ? 1 : -1;
  const enemy: Color = color === 'white' ? 'black' : 'white';
  const plan: Plan = [];
  let working = state;
  let obliged = isInCheck(state.pieces, state.size, color); // doit d'abord sortir d'échec

  for (let t = 0; t < rules.subTurns; t++) {
    obliged = obliged && isInCheck(working.pieces, working.size, color);
    const escape: ReadonlySet<Color> = new Set(obliged ? [color] : []);
    const snap = snapshotOf(working.pieces, working.size);
    let best: { pieceId: string; to: Square; promo?: PieceType; score: number } | null = null;

    for (const p of working.pieces) {
      if (p.color !== color) continue;
      for (let f = 0; f < working.size; f++) for (let r = 0; r < working.size; r++) {
        const to = { file: f, rank: r };
        const c = checkMove(snap, p, to, dir);
        if (!c.ok || snap.at(to)?.type === 'K' || ((obliged || p.type === 'K') && !keepsKingSafe(working.pieces, working.size, p, to))) continue;
        const victim = snap.at(to);
        // Promotion : la pièce est tirée au sort dès la programmation (l'IA la connaît donc pour la suite).
        const promo = p.type === 'P' && r === (color === 'white' ? working.size - 1 : 0) ? PROMOTIONS[Math.floor(rnd() * PROMOTIONS.length)] : undefined;
        const action = { pieceId: p.id, to, ...(promo ? { promo } : {}) };
        let score = rnd() * style.noise;
        if (victim) score += (VALUE[victim.type] * 2 + 1) * style.capture;
        if (p.type === 'P') score += 0.4 + (color === 'white' ? r : working.size - 1 - r) * 0.5;
        if (p.type === 'P' && r === (color === 'white' ? working.size - 1 : 0)) score += 6; // promotion
        if (style.danger > 0 && p.type !== 'K' && working.pieces.some((q) => q.color === enemy && q.id !== victim?.id && attacksSquare(snap, q, to))) {
          score -= VALUE[p.type] * 1.2 * style.danger;
        }
        if (style.check > 0 || style.selfCheck > 0) {
          const after = resolveSubTurn(working, t, [{ ...action, subTurn: t, owner: color, order: 0 }], () => 0, escape).state;
          // finir en échec est dangereux
          if (style.selfCheck > 0 && isInCheck(after.pieces, after.size, color)) score -= (t === rules.subTurns - 1 ? 50 : 4) * style.selfCheck;
          if (style.check > 0 && isInCheck(after.pieces, after.size, enemy)) {
            score += 2 * style.check;
            if (gameOutcome(after.pieces, after.size)?.winner === color) score += 60;
          }
        }
        if (!best || score > best.score) best = { ...action, score };
      }
    }
    if (!best) { plan.push([]); continue; }
    const chosen = { pieceId: best.pieceId, to: best.to, ...(best.promo ? { promo: best.promo } : {}) };
    plan.push([chosen]);
    working = resolveSubTurn(working, t, [{ ...chosen, subTurn: t, owner: color, order: 0 }], () => 0, escape).state;
  }
  return plan;
}

/** Valeur d'une position finale pour `color` : victoire/défaite, sinon matériel et échecs. */
function evaluate(final: GameState, color: Color): number {
  const enemy: Color = color === 'white' ? 'black' : 'white';
  if (final.winner === color) return 1000;
  if (final.winner === enemy) return -1000;
  if (final.winner === 'draw') return -30;
  let score = 0;
  for (const p of final.pieces) score += (p.color === color ? 1 : -1) * VALUE[p.type] * 2;
  if (isInCheck(final.pieces, final.size, enemy)) score += 2;
  if (isInCheck(final.pieces, final.size, color)) score -= 6; // devra d'abord parer l'échec
  return score;
}

/**
 * Recherche par simulation : génère des plans candidats variés, imagine des plans adverses plausibles,
 * rejoue chaque duel avec le vrai moteur et garde le plan au meilleur résultat (moyenne et pire cas).
 * Plus on simule de candidats et d'adversaires, plus l'IA est forte (et lente).
 */
function searchPlan(state: GameState, color: Color, rules: RulesConfig, rnd: () => number, candidates: number, opponents: number): Plan {
  const enemy: Color = color === 'white' ? 'black' : 'white';
  const theirs = Array.from({ length: opponents }, (_, i) =>
    greedyPlan(state, enemy, rules, rnd, i % 2 ? STYLES.hard : STYLES.medium));
  let bestPlan: Plan = [];
  let bestScore = -Infinity;
  for (let i = 0; i < candidates; i++) {
    const mine = greedyPlan(state, color, rules, rnd, { ...STYLES.hard, noise: 0.3 + (i / candidates) * 3 });
    const scores = theirs.map((opp) => {
      const plans = (color === 'white' ? { white: mine, black: opp } : { white: opp, black: mine }) as Record<Color, Plan>;
      return evaluate(resolvePlans(state, plans, rules, () => 0).state, color);
    });
    const score = 0.7 * (scores.reduce((a, b) => a + b, 0) / scores.length) + 0.3 * Math.min(...scores);
    if (score > bestScore) { bestScore = score; bestPlan = mine; }
  }
  return bestPlan;
}

/** Plan complet de l'IA pour `color`, selon le niveau. */
export function aiPlan(state: GameState, color: Color, rules: RulesConfig = DEFAULT_RULES, rnd = Math.random, level: Level = 'medium'): Plan {
  if (level === 'master') return searchPlan(state, color, rules, rnd, 40, 10);
  if (level === 'hard') return searchPlan(state, color, rules, rnd, 8, 3);
  return greedyPlan(state, color, rules, rnd, STYLES[level]);
}
